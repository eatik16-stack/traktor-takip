// Firestore okuma/yazma ve değişiklik günlüğü.
//
// Veri düzeni
//   config/steps          adım tanımları (tek belge, dizi)
//   config/lookups        seçim listeleri
//   config/catalog        hazır hata tanımları
//   config/people         beklenen kişiler (erişim talebini karşılamak için)
//   allowed/<e-posta>     giriş yetkisi + roller + varsayılan istasyon
//   requests/<e-posta>    erişim talebi
//   tractors/<id>         traktör + ŞU ANKİ durumu + adım özetleri (rapor bunu okur)
//   tractors/<id>/events  adımın her ziyareti (ayrıntı ekranı bunu okur)
//   defects/<id>          hata kayıtları (kuyruklar için üst seviyede)
//   log/<id>              değişiklik günlüğü — SALT EKLEME
//
// Adım süreleri traktör belgesinde ÖZETLENİR (steps alanı). Böylece yönetim
// raporu tek sorguyla çıkar; bütün adım olaylarını taramak gerekmez.

import { fb } from "./fb.js";
import { myEmail, myName } from "./auth.js";
import { toDate, newId, fold, matchesAll } from "./util.js";

/* ---------------- canlı durum ---------------- */

export const data = {
  steps: [],        // [{id, seq, code, name, kind, targetMinutes, posX, posY, allowsDefect, active}]
  lookups: {},
  catalog: [],      // [{d: tanım, c: kategori, s: kaynak, n: kaç kez}] — sık kullanılan önce
  people: [],
  allowed: [],      // [{email, name, roles[], stepCode, active}]
  requests: [],
  tractors: [],
  defects: [],
  ready: false
};

let listeners = [];
export function onData(fn) {
  listeners.push(fn);
  return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
}
function emit() { listeners.forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); }

const unsubs = [];
export function stopWatching() {
  while (unsubs.length) { try { unsubs.pop()(); } catch (e) {} }
  data.ready = false;
}

function docsOf(snap) {
  const out = [];
  snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
  return out;
}

export async function startWatching() {
  const f = await fb();
  stopWatching();

  const pending = { config: 0 };

  unsubs.push(f.onSnapshot(f.doc(f.db, "config", "steps"), function (s) {
    const d = s.exists() ? s.data() : null;
    data.steps = ((d && d.items) || []).slice().sort(function (a, b) { return a.seq - b.seq; });
    emit();
  }));
  unsubs.push(f.onSnapshot(f.doc(f.db, "config", "lookups"), function (s) {
    data.lookups = (s.exists() && s.data()) || {}; emit();
  }));
  unsubs.push(f.onSnapshot(f.doc(f.db, "config", "catalog"), function (s) {
    const items = (s.exists() && s.data() && s.data().items) || [];
    // Sık kullanılan önce: öneriler bu sırayla gelir.
    data.catalog = items.slice().sort(function (a, b) { return (b.n || 0) - (a.n || 0); });
    emit();
  }));
  unsubs.push(f.onSnapshot(f.doc(f.db, "config", "people"), function (s) {
    data.people = (s.exists() && s.data() && s.data().items) || []; emit();
  }));
  unsubs.push(f.onSnapshot(f.collection(f.db, "allowed"), function (s) {
    data.allowed = docsOf(s).map(function (u) {
      return Object.assign({}, u, { email: u.id, roles: u.roles || [] });
    });
    emit();
  }));
  // Traktörler ve hatalar iki dinleyiciyle gelir: (1) hattaki/açık olanların
  // tamamı, (2) son RECENT_DAYS günün kayıtları. Bir yıl sonra binlerce eski
  // kaydı her açılışta indirmemek için. Daha eski dönem rapor istediğinde
  // ensureHistory() ile ayrıca çekilir.
  const cutoff = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();

  const tr = { live: [], recent: [], old: [] };
  const mergeTractors = function () {
    data.tractors = mergeById(tr.live, tr.recent, tr.old);
    data.ready = true;
    emit();
  };
  unsubs.push(f.onSnapshot(
    f.query(f.collection(f.db, "tractors"), f.where("status", "in", ["devam", "beklemede", "sevke_hazir"])),
    function (s) { tr.live = docsOf(s); mergeTractors(); }));
  unsubs.push(f.onSnapshot(
    f.query(f.collection(f.db, "tractors"), f.where("rollDownAt", ">=", cutoff)),
    function (s) { tr.recent = docsOf(s); mergeTractors(); }));

  const df = { open: [], recent: [], old: [] };
  const mergeDefects = function () {
    data.defects = mergeById(df.open, df.recent, df.old);
    emit();
  };
  unsubs.push(f.onSnapshot(
    f.query(f.collection(f.db, "defects"), f.where("status", "in", ["acik", "reworkta", "rework_tamam"])),
    function (s) { df.open = docsOf(s); mergeDefects(); }));
  unsubs.push(f.onSnapshot(
    f.query(f.collection(f.db, "defects"), f.where("detectedAt", ">=", cutoff)),
    function (s) { df.recent = docsOf(s); mergeDefects(); }));

  history.tr = tr; history.df = df;
  history.mergeTractors = mergeTractors; history.mergeDefects = mergeDefects;
  history.loadedDays = RECENT_DAYS;
  return pending;
}

export const RECENT_DAYS = 90;
const history = { loadedDays: 0 };

function mergeById() {
  const seen = {}, out = [];
  Array.prototype.forEach.call(arguments, function (arr) {
    (arr || []).forEach(function (d) {
      if (seen[d.id]) return;
      seen[d.id] = true; out.push(d);
    });
  });
  return out;
}

// Rapor daha geniş bir dönem isteyince (180 / 365 gün) eski kayıtlar bir
// kez çekilir ve canlı listeye eklenir. Tekrar çağrılırsa yeniden indirmez.
export async function ensureHistory(days) {
  if (!history.tr || days <= history.loadedDays) return false;
  const f = await fb();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const until = new Date(Date.now() - history.loadedDays * 86400000).toISOString();
  const [ts, ds] = await Promise.all([
    f.getDocs(f.query(f.collection(f.db, "tractors"), f.where("rollDownAt", ">=", since), f.where("rollDownAt", "<", until))),
    f.getDocs(f.query(f.collection(f.db, "defects"),  f.where("detectedAt", ">=", since), f.where("detectedAt", "<", until)))
  ]);
  history.tr.old = mergeById(history.tr.old, docsOf(ts));
  history.df.old = mergeById(history.df.old, docsOf(ds));
  history.loadedDays = days;
  history.mergeTractors(); history.mergeDefects();
  return true;
}

// Talepler yalnızca yöneticide okunabilir; ayrı başlatılır ki diğer roller
// kurallar yüzünden hata almasın.
export async function watchRequests() {
  const f = await fb();
  const un = f.onSnapshot(f.collection(f.db, "requests"), function (s) {
    data.requests = docsOf(s); emit();
  }, function () { /* yetki yok - sessiz geç */ });
  unsubs.push(un);
}

/* ---------------- yardımcılar ---------------- */

export function stepById(id)   { return data.steps.find(function (s) { return s.id === id; }) || null; }
export function stepByCode(c)  { return data.steps.find(function (s) { return s.code === c; }) || null; }
export function activeSteps()  { return data.steps.filter(function (s) { return s.active !== false; }); }
export function tractorById(id){ return data.tractors.find(function (t) { return t.id === id; }) || null; }
export function defectById(id) { return data.defects.find(function (d) { return d.id === id; }) || null; }

export function tractorByChassis(ch) {
  const k = String(ch || "").trim().toUpperCase();
  return data.tractors.find(function (t) { return String(t.chassisNo || "").toUpperCase() === k; }) || null;
}

// Şasi arama: operatör çoğunlukla SON 6 HANEYİ yazar ("501492"), bazen tamamını.
// Sondan eşleşenler önce, sonra herhangi bir yerde geçenler. Sevk edilmişler
// en sona (hatta olan traktör aranıyordur).
export function findTractors(query, limit) {
  const q = String(query || "").trim().toUpperCase();
  if (!q) return [];
  const suffix = [], inside = [];
  data.tractors.forEach(function (t) {
    const ch = String(t.chassisNo || "").toUpperCase();
    if (ch.slice(-q.length) === q) suffix.push(t);
    else if (ch.indexOf(q) !== -1) inside.push(t);
  });
  const rank = function (t) { return t.status === "sevk_edildi" ? 1 : 0; };
  const all = suffix.concat(inside).sort(function (a, b) { return rank(a) - rank(b); });
  return all.slice(0, limit || 20);
}

/* ---------------- hazır hata tanımları ---------------- */

// Yazdıkça süzer: kelimelerin hepsi geçiyorsa eşleşir, sık kullanılan önce.
// Kategori verilirse önce o kategoridekiler, sonra diğerleri gelir — kişi
// yanlış kategori seçmiş olsa da aradığını bulsun.
export function searchCatalog(query, category, limit) {
  const q = String(query || "").trim();
  const max = limit || 12;
  const list = data.catalog;
  if (!q) {
    return (category ? list.filter(function (i) { return i.c === category; }) : list).slice(0, max);
  }
  const hits = list.filter(function (i) { return matchesAll(i.d, q); });
  if (!category) return hits.slice(0, max);
  const own = hits.filter(function (i) { return i.c === category; });
  const other = hits.filter(function (i) { return i.c !== category; });
  return own.concat(other).slice(0, max);
}

export function catalogFind(desc) {
  const k = fold(desc);
  return data.catalog.find(function (i) { return fold(i.d) === k; }) || null;
}

// Yeni yazılan tanım kataloğa girer; varsa sayacı artar (bir sonraki sefer
// daha üstte önerilir). Listede olmayan hatayı yazınca sistem öğrenir.
export async function catalogRemember(desc, category, source) {
  const d = String(desc || "").replace(/\s+/g, " ").trim();
  if (d.length < 2) return;
  const items = data.catalog.slice();
  const k = fold(d);
  const i = items.findIndex(function (x) { return fold(x.d) === k; });
  if (i === -1) {
    items.push({ d: d, c: category || "Diğer", s: source || null, n: 1 });
  } else {
    items[i] = Object.assign({}, items[i], { n: (items[i].n || 0) + 1 });
  }
  try { await saveDoc("config", "catalog", { items: items }); }
  catch (e) { /* yetki yoksa sessiz geç — asıl kayıt yazıldı */ }
}

/* ---------------- değişiklik günlüğü ---------------- */

// Salt ekleme. Kurallar "by" alanının giriş yapan kişi, "at" alanının sunucu
// saati olmasını şart koşar; geçmiş sonradan değiştirilemez.
export async function log(action, target, detail) {
  const f = await fb();
  try {
    await f.setDoc(f.doc(f.db, "log", newId("log")), {
      at: f.serverTimestamp(),
      atISO: new Date().toISOString(),
      by: myEmail(),
      byName: myName(),
      action: String(action || ""),
      target: String(target || ""),
      detail: String(detail == null ? "" : detail)
    });
  } catch (e) {
    // Günlük yazılamazsa asıl işlem geri alınmaz; sessizce geçilir.
    console.warn("günlük yazılamadı", e);
  }
}

export async function readLog(max) {
  const f = await fb();
  const q = f.query(f.collection(f.db, "log"), f.orderBy("at", "desc"), f.limit(max || 200));
  return docsOf(await f.getDocs(q));
}

/* ---------------- yazma ---------------- */

// Firestore çevrimdışıyken yazma sözü sunucu onayı gelene kadar bekler; bu
// sırada düğmeler kilitli kalırdı. Kayıt cihazda anında işlenir ve bağlantı
// gelince gönderilir, o yüzden en çok WRITE_WAIT_MS bekleyip devam ederiz.
// Yetki hatası gibi hızlı yanıtlar bu sürede zaten gelir ve fırlatılır.
const WRITE_WAIT_MS = 1500;
export const net = { pending: 0 };

function settle(p) {
  net.pending++;
  const done = function () { net.pending = Math.max(0, net.pending - 1); };
  p.then(done, done);
  return Promise.race([
    p,
    new Promise(function (res) { setTimeout(res, WRITE_WAIT_MS); })
  ]);
}

export async function saveDoc(path, id, obj) {
  const f = await fb();
  await settle(f.setDoc(f.doc(f.db, path, id), obj, { merge: true }));
}

export async function setDocFull(path, id, obj) {
  const f = await fb();
  await settle(f.setDoc(f.doc(f.db, path, id), obj));
}

export async function removeDoc(path, id) {
  const f = await fb();
  await settle(f.deleteDoc(f.doc(f.db, path, id)));
}

export async function addEvent(tractorId, ev) {
  const f = await fb();
  const id = newId("ev");
  await settle(f.setDoc(f.doc(f.db, "tractors", tractorId, "events", id), ev));
  return id;
}

export async function updateEvent(tractorId, eventId, patch) {
  const f = await fb();
  await settle(f.updateDoc(f.doc(f.db, "tractors", tractorId, "events", eventId), patch));
}

export async function readEvents(tractorId) {
  const f = await fb();
  const snap = await f.getDocs(f.collection(f.db, "tractors", tractorId, "events"));
  const rows = docsOf(snap);
  rows.sort(function (a, b) {
    const x = toDate(a.enteredAt), y = toDate(b.enteredAt);
    return (x ? x.getTime() : 0) - (y ? y.getTime() : 0);
  });
  return rows;
}

/* ---------------- kullanıcılar ---------------- */

export async function grantAccess(email, name, roles, stepCode) {
  const mail = String(email || "").trim().toLowerCase();
  const adi = String(name || "").trim();
  await setDocFull("allowed", mail, {
    name: adi,
    roles: roles || [],
    stepCode: stepCode || "",
    active: true,
    at: new Date().toISOString()
  });
  await log("yetki_verildi", mail, (roles || []).join(","));
  // Ad her kaydedilişinde eski kayıtlardaki kopyalarıyla eşitlenir; yoksa bir
  // yazım hatası düzeltildikten sonra ekranlarda eski ad kalırdı. Değişecek
  // bir şey yoksa hiçbir yazma yapmaz.
  try { await renameEverywhere(mail, adi); } catch (e) { console.error(e); }
}

export async function revokeAccess(email) {
  await removeDoc("allowed", String(email || "").toLowerCase());
  await log("yetki_kaldirildi", String(email || "").toLowerCase(), "");
}

/* ---------------- eski kayıtlardaki ismi düzeltme ---------------- */
// Bir kayıt oluşturulurken kişinin o anki adı kaydın İÇİNE de yazılır; böylece
// kişi sistemden çıkarılsa bile "kim yaptı" görünür. Ad sonradan düzeltilince
// eski kayıtlar eski adı göstermeye devam eder — bu işlem hepsini tarayıp
// günceller. Değişiklik günlüğü bilerek dışarıda bırakıldı: o koleksiyon
// salt-ekleme, yazılmış bir satır hiç kimse tarafından değiştirilemez.
const NAME_FIELDS = {
  tractors: [["createdBy", "createdByName"], ["currentOperator", "currentOperatorName"]],
  defects:  [["detectedBy", "detectedByName"], ["reworkBy", "reworkByName"],
             ["approvedBy", "approvedByName"], ["cancelledBy", "cancelledByName"]]
};

export async function renameEverywhere(email, newName) {
  const mail = String(email || "").trim().toLowerCase();
  const name = String(newName || "").trim();
  if (!mail || !name) throw new Error("E-posta ve ad gerekli.");

  const f = await fb();
  const jobs = [];   // { path: [...], patch: {} }

  for (const coll of ["tractors", "defects"]) {
    const rows = docsOf(await f.getDocs(f.collection(f.db, coll)));
    rows.forEach(function (row) {
      const patch = {};
      NAME_FIELDS[coll].forEach(function (pair) {
        if (String(row[pair[0]] || "").toLowerCase() === mail && row[pair[1]] !== name) {
          patch[pair[1]] = name;
        }
      });
      if (Object.keys(patch).length) jobs.push({ path: [coll, row.id], patch: patch });
    });
  }

  // Adım geçişleri traktörün altındaki ayrı koleksiyonda duruyor.
  const tractorIds = docsOf(await f.getDocs(f.collection(f.db, "tractors")))
    .map(function (t) { return t.id; });
  for (const tid of tractorIds) {
    const evs = docsOf(await f.getDocs(f.collection(f.db, "tractors", tid, "events")));
    evs.forEach(function (ev) {
      if (String(ev.operator || "").toLowerCase() === mail && ev.operatorName !== name) {
        jobs.push({ path: ["tractors", tid, "events", ev.id], patch: { operatorName: name } });
      }
    });
  }

  // Firestore toplu yazmada 500 işlem sınırı var; 400'lük paketler hâlinde.
  for (let i = 0; i < jobs.length; i += 400) {
    const batch = f.writeBatch(f.db);
    jobs.slice(i, i + 400).forEach(function (j) {
      batch.update(f.doc.apply(null, [f.db].concat(j.path)), j.patch);
    });
    await batch.commit();
  }

  if (jobs.length) await log("isim_guncellendi", mail, name + " · " + jobs.length + " kayıt");
  return jobs.length;
}

export async function decideRequest(email, approve, roles, stepCode, name) {
  const mail = String(email || "").toLowerCase();
  if (approve) {
    await grantAccess(mail, name, roles, stepCode);
    await removeDoc("requests", mail);
    await log("talep_onaylandi", mail, (roles || []).join(","));
  } else {
    await saveDoc("requests", mail, { status: "reddedildi", decidedAt: new Date().toISOString() });
    await log("talep_reddedildi", mail, "");
  }
}
