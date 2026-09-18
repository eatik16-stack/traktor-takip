// İş kuralları. Şirket içi sürümdeki kuralların tamamı buraya taşındı.
//
// Traktör belgesindeki alanlar
//   status          devam | beklemede | sevke_hazir | sevk_edildi
//   currentStepId   bulunduğu adım
//   currentEnteredAt / currentStartedAt / currentOperator / currentEventId
//   steps           { ADIMKODU: {result, wait, work, total, operator, finishedAt} }
//                   Rapor bu özeti okur; ayrıntılı geçmiş alt koleksiyonda.

import { data, stepById, activeSteps, tractorById, tractorByChassis,
         saveDoc, setDocFull, updateEvent, log } from "./store.js";
import { fb } from "./fb.js";
import { myEmail, myName, can, canExact } from "./auth.js";
import { workMinutes, newId, normChassis } from "./util.js";

// Bir adımın "tamamlandı" sayılması için sonucun bunlardan biri olması gerekir.
// Başka adıma yönlendirilerek kapanan kayıtlar (result="yonlendirildi")
// tamamlanmış sayılmaz — aksi halde atlanan adımlar yapılmış görünürdü.
export const COMPLETED_RESULTS = ["ok", "nok"];
export const OPEN_STATES = ["acik", "reworkta", "rework_tamam"];

class Uyari extends Error {}
export function uyari(msg) { return new Uyari(msg); }

/* ---------------- sorgular ---------------- */

export function openDefects(tractorId) {
  return data.defects.filter(function (d) {
    return d.tractorId === tractorId && OPEN_STATES.indexOf(d.status) !== -1;
  });
}

export function completedStepCodes(t) {
  const m = (t && t.steps) || {};
  return Object.keys(m).filter(function (code) {
    return COMPLETED_RESULTS.indexOf(m[code].result) !== -1;
  });
}

export function pendingSteps(t) {
  const m = (t && t.steps) || {};
  const done = completedStepCodes(t);
  return activeSteps().filter(function (s) {
    if (m[s.code] && m[s.code].result === SKIPPED) return false;   // işi yoktu
    return done.indexOf(s.code) === -1;
  });
}

/* ---------------- adım türleri ve yönlendirme ---------------- */
//
// Adımlar iki işe ayrılır: KALİTE adımları (kontrol, onay) hatayı tespit eder,
// İŞ adımları (rework, islem) hatayı giderir ya da üretim işini yapar.
// Yönlendirme bu ayrıma dayanır.

export function isReworkStep(s)  { return !!s && s.kind === "rework"; }
export function isQualityStep(s) { return !!s && (s.kind === "kontrol" || s.kind === "onay"); }

// Bir traktörde rework istasyonunu ilgilendiren iş var mı? "rework_tamam"
// olanlar onay bekler, rework personelinin işi bitmiştir.
export function pendingReworkCount(tractorId) {
  return data.defects.filter(function (d) {
    return d.tractorId === tractorId && (d.status === "acik" || d.status === "reworkta");
  }).length;
}

// Hata çıkaran kalite adımından sonra traktörün gideceği rework istasyonu.
// Önce SONRAKİ rework adımı denenir (normal akış: RDC -> RW-1). Yoksa en
// yakın ÖNCEKİ rework adımına geri gönderilir (FINAL -> RW-2) ve traktörün
// nereden geldiği kaydedilir ki iş bitince oraya dönsün.
function reworkTargetFor(steps, cur) {
  const ileri = steps.filter(function (s) { return s.seq > cur.seq && isReworkStep(s); });
  if (ileri.length) return { step: ileri[0], back: false };
  const geri = steps.filter(function (s) { return s.seq < cur.seq && isReworkStep(s); });
  if (geri.length) return { step: geri[geri.length - 1], back: true };
  return null;
}

// İşi olmayan rework istasyonu atlanır — RW-2 personeli boş traktör görmesin.
// Üretim adımları (OIL, PAINT) atlanmaz: onlar her traktörde yapılır.
// Atlanan adımlar geçmişe "atlandı" diye işlenir ki çizelgede boşluk kalmasın.
export const SKIPPED = "atlandi";

function skipIdleRework(steps, from, tractorId) {
  let s = from;
  const atlanan = [];
  let guard = steps.length + 1;
  while (s && isReworkStep(s) && pendingReworkCount(tractorId) === 0 && guard-- > 0) {
    atlanan.push(s);
    s = steps.find(function (x) { return x.seq > s.seq; }) || null;
  }
  return { step: s, skipped: atlanan };
}

export function minutesHere(t) {
  if (!t || !t.currentEnteredAt) return 0;
  return workMinutes(t.currentEnteredAt, new Date());
}

export function isOverdue(t) {
  const s = t && stepById(t.currentStepId);
  if (!s || !s.targetMinutes) return false;
  return minutesHere(t) > s.targetMinutes;
}

/* ---------------- traktör ---------------- */

export async function createTractor(fields) {
  const chassis = normChassis(fields.chassisNo);
  if (chassis.length < 3) throw uyari("Şasi no en az 3 karakter olmalı.");
  // Aynı şasi ikinci kez açılırsa traktörün geçmişi iki kayda bölünür:
  // adımların bir kısmı birinde, bir kısmı ötekinde kalır ve hiçbir rapor
  // doğru çıkmaz. Sevk edilmiş traktör de dahil, şasi bir kere kaydedilir.
  const eski = tractorByChassis(chassis);
  if (eski) {
    const nerede = eski.status === "sevk_edildi" ? "sevk edilmiş"
      : eski.status === "sevke_hazir" ? "sevke hazır bekliyor"
      : (stepById(eski.currentStepId) || {}).code || "hatta";
    throw uyari(chassis + " şasi numarası zaten kayıtlı (" + nerede +
                "). Yeni kayıt açmak yerine listeden o traktörü açın.");
  }

  const steps = activeSteps();
  if (!steps.length) throw uyari("Tanımlı adım yok. Önce Tanımlar > Adımlar ekranından adım tanımlayın.");

  const id = newId("t");
  const now = new Date().toISOString();
  const first = steps[0];
  const evId = newId("ev");

  await setDocFull("tractors", id, {
    chassisNo: chassis,
    saleCode: (fields.saleCode || "").trim() || null,
    family: fields.family || null,
    engineNo: (fields.engineNo || "").trim() || null,
    cabinKeyNo: (fields.cabinKeyNo || "").trim() || null,
    traffic: fields.traffic || null,
    color: fields.color || null,
    yearCode: fields.yearCode || null,
    rollDownAt: fields.rollDownAt || now,
    status: "devam",
    currentStepId: first.id,
    currentEnteredAt: now,
    currentStartedAt: null,
    currentOperator: null,
    currentEventId: evId,
    steps: {},
    createdBy: myEmail(),
    createdByName: myName(),
    createdAt: now
  });
  await addEventDoc(id, evId, first, now);
  await log("traktor_olusturuldu", chassis, first.code);
  return id;
}

// Adımın her ziyareti için alt koleksiyona bir kayıt açar.
// Olay kaydı yazılamamışsa (bağlantı kesintisi) yeniden kurulabilsin diye
// traktörün şu anki adım bilgisi. updateEvent bunu merge ile yazar.
function eventTemel(t) {
  const s = stepById(t.currentStepId);
  return {
    stepId: t.currentStepId || null,
    stepCode: s ? s.code : null,
    stepName: s ? s.name : null,
    enteredAt: t.currentEnteredAt || null
  };
}

async function addEventDoc(tractorId, evId, step, enteredAt) {
  const f = await fb();
  await f.setDoc(f.doc(f.db, "tractors", tractorId, "events", evId), {
    stepId: step.id, stepCode: step.code, stepName: step.name,
    enteredAt: enteredAt, startedAt: null, finishedAt: null,
    operator: null, operatorName: null, result: null, note: null
  });
}

export async function startWork(tractorId) {
  const t = tractorById(tractorId);
  if (!t) throw uyari("Traktör bulunamadı.");
  if (!t.currentEventId) throw uyari("Traktör için açık bir adım kaydı yok.");
  if (t.currentStartedAt) throw uyari("Bu adım zaten başlatılmış.");

  const now = new Date().toISOString();
  await saveDoc("tractors", tractorId, {
    currentStartedAt: now, currentOperator: myEmail(), currentOperatorName: myName()
  });
  await updateEvent(tractorId, t.currentEventId, {
    startedAt: now, operator: myEmail(), operatorName: myName()
  }, eventTemel(t));
  await log("adim_baslatildi", t.chassisNo, stepCodeOf(t));
}

function stepCodeOf(t) {
  const s = stepById(t.currentStepId);
  return s ? s.code : "";
}

export async function finishStep(tractorId, result, note) {
  const t = tractorById(tractorId);
  if (!t) throw uyari("Traktör bulunamadı.");
  if (!t.currentEventId) throw uyari("Traktör için açık bir adım kaydı yok.");

  const steps = activeSteps();
  const cur = stepById(t.currentStepId);
  if (!cur) throw uyari("Bulunduğu adım tanımlı değil.");

  const maxSeq = steps.reduce(function (m, s) { return Math.max(m, s.seq); }, 0);
  const isLast = cur.seq === maxSeq;

  // Son adım (ya da onay adımı) için iki kontrol
  if (isLast || cur.kind === "onay") {
    const acik = openDefects(tractorId).length;
    if (acik) {
      throw uyari("Bu traktörde kapanmamış " + acik + " hata var. Önce hataların rework ve onayı tamamlanmalı.");
    }
    // YALNIZCA sırası önde olan adımlar aranır. Sonraki adımlar burada
    // aranırsa kilitlenme olur: sonraki adıma ancak bu adım kapanınca
    // geçilebildiği için traktör asla ilerleyemez.
    const done = completedStepCodes(t);
    const missing = steps.filter(function (s) {
      // Rework istasyonları zorunlu değildir: hata yoksa atlanırlar. Açık
      // hata kalmadığı zaten yukarıda kontrol edildi.
      return s.seq < cur.seq && !isReworkStep(s) && done.indexOf(s.code) === -1;
    });
    if (missing.length) {
      const names = missing.slice(0, 6).map(function (s) { return s.seq + ". " + s.name; }).join(", ");
      const more = missing.length > 6 ? " (+" + (missing.length - 6) + " adım daha)" : "";
      throw uyari("Tamamlanmamış " + missing.length + " adım var: " + names + more +
                  ". Traktör sevke hazır sayılamaz.");
    }
  }

  // Kalite adımında onay bekleyen hata varsa adım kapanmaz: rework'ü biten
  // hatayı onaylamak ya da reddetmek bu istasyonun işidir. Aksi halde traktör
  // rework ile kalite arasında gidip gelirdi.
  if (isQualityStep(cur)) {
    const onayBekleyen = data.defects.filter(function (d) {
      return d.tractorId === tractorId && d.status === "rework_tamam";
    }).length;
    if (onayBekleyen) {
      throw uyari("Onayınızı bekleyen " + onayBekleyen + " hata var. " +
                  "Her birini onaylayın ya da reddedin, sonra adımı tamamlayın.");
    }
  }

  const now = new Date().toISOString();
  const started = t.currentStartedAt || now;
  const wait = workMinutes(t.currentEnteredAt, started);
  const work = workMinutes(started, now);

  const stepMap = Object.assign({}, t.steps || {});
  stepMap[cur.code] = {
    result: result || "ok",
    wait: Math.max(0, Math.round(wait)),
    work: Math.max(0, Math.round(work)),
    total: Math.max(0, Math.round(wait + work)),
    operator: t.currentOperator || myEmail(),
    operatorName: t.currentOperatorName || myName(),
    finishedAt: now
  };

  await updateEvent(tractorId, t.currentEventId, {
    startedAt: started, finishedAt: now, result: result || "ok",
    note: note || null,
    operator: t.currentOperator || myEmail(),
    operatorName: t.currentOperatorName || myName()
  }, eventTemel(t));

  // --- traktör nereye gidecek? ---
  let next = null;
  let returnStepId = t.returnStepId || null;
  let returnReady = !!t.returnReady;
  let geriDonus = false;

  if (!isQualityStep(cur) && (returnStepId || returnReady)) {
    // İş adımı bitti ve bu traktör bir yerden geri gönderilmişti: oraya döner.
    // OIL/PAINT gibi araya giren üretim adımları tekrar yapılmaz.
    if (returnStepId) next = stepById(returnStepId) || null;
    geriDonus = true;
    returnStepId = null;
  }

  if (!next && !geriDonus && isQualityStep(cur) && openDefects(tractorId).length) {
    // Kalite adımı açık hatayla kapandı: hatanın giderileceği istasyona gider.
    const hedef = reworkTargetFor(steps, cur);
    if (hedef) {
      next = hedef.step;
      if (hedef.back) returnStepId = cur.id;   // ileride buraya dönecek
    }
  }

  if (!next && !geriDonus) next = steps.find(function (s) { return s.seq > cur.seq; }) || null;
  // İşi olmayan rework istasyonunu atla.
  if (next && !geriDonus) {
    const atla = skipIdleRework(steps, next, tractorId);
    next = atla.step;
    atla.skipped.forEach(function (x) {
      stepMap[x.code] = {
        result: SKIPPED, wait: 0, work: 0, total: 0,
        operator: null, operatorName: null, finishedAt: now
      };
    });
  }

  const patch = {
    steps: stepMap,
    returnStepId: returnStepId,
    returnReady: geriDonus ? false : returnReady
  };

  if (!next) {
    await saveDoc("tractors", tractorId, Object.assign(patch, {
      status: "sevke_hazir", readyAt: now,
      currentStepId: cur.id, currentEnteredAt: null, currentStartedAt: null,
      currentOperator: null, currentOperatorName: null, currentEventId: null
    }));
    await log("adim_tamamlandi", t.chassisNo, cur.code + " -> sevke hazır");
    return { finished: cur.code, next: null, status: "sevke_hazir" };
  }

  const evId = newId("ev");
  await saveDoc("tractors", tractorId, Object.assign(patch, {
    status: "devam",
    currentStepId: next.id, currentEnteredAt: now, currentStartedAt: null,
    currentOperator: null, currentOperatorName: null, currentEventId: evId
  }));
  await addEventDoc(tractorId, evId, next, now);
  await log("adim_tamamlandi", t.chassisNo, cur.code + " -> " + next.code +
            (geriDonus ? " (geri dönüş)" : ""));
  return { finished: cur.code, next: next.code, status: "devam", returned: geriDonus };
}

// opts.returnHere: traktör iş bitince BURAYA geri dönsün. Sevk için bekleyen
// bir traktörde sonradan boya/pas hatası çıkarsa boya istasyonuna iş emri
// açılır, iş bitince traktör yine sevke hazır duruma döner.
export async function moveToStep(tractorId, stepId, note, opts) {
  const t = tractorById(tractorId);
  const target = stepById(stepId);
  if (!t || !target) throw uyari("Traktör veya adım bulunamadı.");

  const now = new Date().toISOString();
  if (t.currentEventId) {
    // Yönlendirme ile kapanan kayıt TAMAMLANMIŞ sayılmaz.
    await updateEvent(tractorId, t.currentEventId, {
      finishedAt: now, result: "yonlendirildi",
      startedAt: t.currentStartedAt || now,
      note: note || (target.code + " adımına yönlendirildi")
    }, eventTemel(t));
  }
  const evId = newId("ev");
  const patch = {
    status: "devam", currentStepId: target.id, currentEnteredAt: now,
    currentStartedAt: null, currentOperator: null, currentOperatorName: null,
    currentEventId: evId
  };
  if (opts && opts.returnHere) {
    if (t.status === "sevke_hazir") { patch.returnReady = true; patch.returnStepId = null; }
    else { patch.returnReady = false; patch.returnStepId = t.currentStepId || null; }
  }
  await saveDoc("tractors", tractorId, patch);
  await addEventDoc(tractorId, evId, target, now);
  await log("yonlendirildi", t.chassisNo, "-> " + target.code + (note ? ": " + note : "") +
            (opts && opts.returnHere ? " | iş bitince geri dönecek" : ""));
}

export async function holdTractor(tractorId, reason) {
  const t = tractorById(tractorId);
  if (!t) throw uyari("Traktör bulunamadı.");
  await saveDoc("tractors", tractorId, { status: "beklemede", holdReason: reason || "" });
  await log("beklemeye_alindi", t.chassisNo, reason || "");
}

export async function releaseTractor(tractorId) {
  const t = tractorById(tractorId);
  if (!t) throw uyari("Traktör bulunamadı.");
  await saveDoc("tractors", tractorId, { status: "devam", holdReason: null });
  await log("beklemeden_cikarildi", t.chassisNo, "");
}

export async function dispatchTractor(tractorId) {
  const t = tractorById(tractorId);
  if (!t) throw uyari("Traktör bulunamadı.");
  if (t.status !== "sevke_hazir") throw uyari("Sadece 'Sevke Hazır' durumundaki traktör sevk edilebilir.");
  await saveDoc("tractors", tractorId, { status: "sevk_edildi", dispatchedAt: new Date().toISOString() });
  await log("sevk_edildi", t.chassisNo, "");
}

// Kayıt sırasında yanlış yazılan şasi numarasını düzeltir. Traktör kaydı aynı
// kalır; adım ve hata geçmişi otomatik olarak yeni numaranın altında görünür.
export async function fixChassis(tractorId, yeniNo, reason) {
  if (!can(["hata_duzenle"])) throw uyari("Bu işlem için yetkiniz yok.");
  const t = tractorById(tractorId);
  if (!t) throw uyari("Traktör bulunamadı.");
  const yeni = normChassis(yeniNo);
  if (yeni.length < 3) throw uyari("Şasi no en az 3 karakter olmalı.");
  if (String(reason || "").trim().length < 3) throw uyari("Düzeltme sebebi yazın.");
  if (yeni === t.chassisNo) return { changed: false, chassisNo: yeni };

  const baskasi = tractorByChassis(yeni);
  if (baskasi && baskasi.id !== tractorId) {
    throw uyari(yeni + " numarası zaten başka bir traktörde kayıtlı. " +
                "İki kayıt aynı traktöre aitse hataları tek tek doğru traktöre taşıyın.");
  }

  const f = await fb();
  const batch = f.writeBatch(f.db);
  batch.update(f.doc(f.db, "tractors", tractorId), { chassisNo: yeni });
  // Hata kayıtlarındaki şasi no kopyası da güncellenir (listeler bunu gösterir).
  const ilgili = data.defects.filter(function (d) { return d.tractorId === tractorId; });
  ilgili.forEach(function (d) {
    batch.update(f.doc(f.db, "defects", d.id), { chassisNo: yeni });
  });
  await batch.commit();

  await log("sasi_duzeltildi", tractorId,
            t.chassisNo + " -> " + yeni + " | sebep: " + String(reason).trim() +
            " | birlikte taşınan: " + ilgili.length + " hata kaydı");
  return { changed: true, chassisNo: yeni, defects: ilgili.length };
}

/* ---------------- hata kaydı ---------------- */

export async function addDefect(tractorId, fields) {
  if (!can(["kontrol", "onay"])) throw uyari("Hata kaydı açma yetkiniz yok.");
  const t = tractorById(tractorId);
  if (!t) throw uyari("Traktör bulunamadı.");
  const category = String(fields.category || "").trim();
  const description = String(fields.description || "").trim();
  if (!category) throw uyari("Hata kategorisi seçin.");
  if (description.length < 2) throw uyari("Hata tanımı yazın.");

  const stepId = fields.detectedStepId || t.currentStepId;
  let step = stepById(stepId);
  if (!step) {
    // Traktörün bulunduğu adım tanımlardan silinmiş olabilir (ya da traktör
    // sevke hazır bekliyordur). Kayıt kaybolmasın diye son aktif adıma yazılır.
    const aktif = activeSteps();
    step = aktif[aktif.length - 1] || null;
  }
  if (!step) throw uyari("Hatanın tespit edildiği istasyon belirlenemedi.");

  const id = newId("d");
  await setDocFull("defects", id, {
    tractorId: tractorId,
    chassisNo: t.chassisNo,
    saleCode: t.saleCode || null,
    detectedStepId: step.id,
    detectedStepCode: step.code,
    detectedBy: myEmail(),
    detectedByName: myName(),
    detectedAt: new Date().toISOString(),
    category: category,
    description: description,
    source: fields.source || null,
    originLocation: fields.originLocation || null,
    partCode: (fields.partCode || "").trim() || null,
    partName: (fields.partName || "").trim() || null,
    note: fields.note || null,
    status: "acik",
    reworkBy: null, reworkByName: null,
    reworkStartedAt: null, reworkFinishedAt: null,
    approvedBy: null, approvedByName: null, approvedAt: null,
    repeatCount: 0, rejectNote: null,
    editCount: 0, editedBy: null, editedAt: null,
    cancelledBy: null, cancelledAt: null, cancelReason: null
  });
  await log("hata_kaydedildi", t.chassisNo, category + " / " + description);

  // Hata belli bir istasyonda giderilecekse traktör oraya gönderilir ve iş
  // bitince bulunduğu yere döner. Boş bırakılırsa normal akış işler.
  if (fields.assignStepId && fields.assignStepId !== t.currentStepId) {
    await moveToStep(tractorId, fields.assignStepId,
                     "hata giderilecek: " + description, { returnHere: true });
  }
  return id;
}

export async function takeDefect(defectId) {
  if (!can(["rework", "kontrol"])) throw uyari("Rework üstlenme yetkiniz yok.");
  const d = defectById(defectId);
  if (!d) throw uyari("Hata kaydı bulunamadı.");
  if (d.status !== "acik") throw uyari("Bu kayıt '" + d.status + "' durumunda, üzerine alınamaz.");
  await saveDoc("defects", defectId, {
    status: "reworkta", reworkBy: myEmail(), reworkByName: myName(),
    reworkStartedAt: new Date().toISOString()
  });
  await log("rework_ustlenildi", d.chassisNo, d.description);
}

// Vardiya değişimi: üzerine alınan iş bitirilemeyecekse geri bırakılır ki
// başkası alabilsin. Yalnızca üzerine alan kişi, kontrol ya da yönetici.
export async function releaseDefect(defectId) {
  const d = defectById(defectId);
  if (!d) throw uyari("Hata kaydı bulunamadı.");
  if (d.status !== "reworkta") throw uyari("Bu kayıt rework'te değil.");
  if (d.reworkBy !== myEmail() && !can(["kontrol"])) throw uyari("Bu kaydı yalnızca üzerine alan kişi bırakabilir.");
  await saveDoc("defects", defectId, {
    status: "acik", reworkBy: null, reworkByName: null, reworkStartedAt: null
  });
  await log("rework_birakildi", d.chassisNo, d.description);
}

export async function completeDefect(defectId) {
  if (!can(["rework", "kontrol"])) throw uyari("Bu işlem için yetkiniz yok.");
  const d = defectById(defectId);
  if (!d) throw uyari("Hata kaydı bulunamadı.");
  if (d.status !== "reworkta") throw uyari("Önce 'Üzerime Al' ile rework başlatılmalı.");
  const now = new Date().toISOString();
  await saveDoc("defects", defectId, { status: "rework_tamam", reworkFinishedAt: now });
  await log("rework_tamamlandi", d.chassisNo,
            Math.round(workMinutes(d.reworkStartedAt, now)) + " dk");

  // Rework istasyonunun işi bitti mi? Bu kayıt dışında açık ya da üzerine
  // alınmış hata kalmadıysa adım kendiliğinden kapanır ve traktör ilerler;
  // operatörün ayrıca "Adımı Tamamla" demesi gerekmez.
  const kalan = data.defects.filter(function (x) {
    return x.tractorId === d.tractorId && x.id !== defectId &&
           (x.status === "acik" || x.status === "reworkta");
  }).length;
  const t = tractorById(d.tractorId);
  const cur = t ? stepById(t.currentStepId) : null;
  if (!kalan && t && isReworkStep(cur) && (t.status === "devam" || t.status === "beklemede")) {
    try {
      if (!t.currentStartedAt) {
        // İşlem süresi ilk "Üzerime Al"dan sayılsın; bekleme süresi traktörün
        // adıma girişinden o ana kadar olan kısım olur.
        const baslangiclar = data.defects
          .filter(function (x) { return x.tractorId === t.id && x.reworkStartedAt; })
          .map(function (x) { return x.reworkStartedAt; }).sort();
        await saveDoc("tractors", t.id, {
          currentStartedAt: baslangiclar[0] || now,
          currentOperator: myEmail(), currentOperatorName: myName()
        });
      }
      const r = await finishStep(d.tractorId, "ok", "hatalar kapandı — adım kendiliğinden tamamlandı");
      return { autoFinished: true, next: r.next, status: r.status };
    } catch (e) {
      // Adım kapanamazsa (ör. eksik önceki adım) hata kaydı yine de tamamlandı.
      console.warn("adım kendiliğinden kapatılamadı", e);
    }
  }
  return { autoFinished: false };
}

export async function approveDefect(defectId) {
  if (!can(["onay", "kontrol"])) throw uyari("Onay yetkiniz yok.");
  const d = defectById(defectId);
  if (!d) throw uyari("Hata kaydı bulunamadı.");
  if (d.status !== "rework_tamam") throw uyari("Sadece rework'ü tamamlanmış hatalar onaylanabilir.");

  // Dört göz kuralı: rework'ü yapan kişi onu onaylayamaz. Yalnızca "tam_onay"
  // yetkisi AÇIKÇA verilmiş kişilerde kalkar; böyle bir onay günlüğe ayrıca yazılır.
  const kendi = d.reworkBy === myEmail();
  if (kendi && !canExact("tam_onay")) {
    throw uyari("Kendi yaptığınız rework'ü onaylayamazsınız.");
  }

  await saveDoc("defects", defectId, {
    status: "onaylandi", approvedBy: myEmail(), approvedByName: myName(),
    approvedAt: new Date().toISOString()
  });
  await log("onaylandi", d.chassisNo,
            kendi ? "kendi rework'ünü onayladı (tam_onay yetkisi)" : d.description);
  return { selfApproved: kendi };
}

export async function rejectDefect(defectId, note) {
  if (!can(["onay", "kontrol"])) throw uyari("Onay yetkiniz yok.");
  const d = defectById(defectId);
  if (!d) throw uyari("Hata kaydı bulunamadı.");
  if (d.status !== "rework_tamam") throw uyari("Sadece rework'ü tamamlanmış hatalar reddedilebilir.");
  if (String(note || "").trim().length < 2) throw uyari("Red sebebi yazın.");
  await saveDoc("defects", defectId, {
    status: "acik", repeatCount: (d.repeatCount || 0) + 1, rejectNote: String(note).trim(),
    reworkStartedAt: null, reworkFinishedAt: null
  });
  await log("reddedildi", d.chassisNo, String(note).trim());
}

/* ---------------- hata kaydı düzeltme / iptal ---------------- */

const EDIT_FIELDS = ["category", "description", "detectedStepId", "source",
                     "originLocation", "partCode", "partName", "note"];

export async function editDefect(defectId, fields) {
  if (!can(["hata_duzenle"])) throw uyari("Hata kaydı düzenleme yetkiniz yok.");
  const d = defectById(defectId);
  if (!d) throw uyari("Hata kaydı bulunamadı.");
  if (d.status === "iptal") throw uyari("İptal edilmiş kayıt düzenlenemez. Önce geri alın.");

  const patch = {};
  const changes = [];

  // Hata yanlış traktöre yazılmışsa doğru traktöre taşınır. Şasi numarası
  // burada DEĞİŞTİRİLMEZ; kayıt mevcut bir başka traktörün altına alınır.
  if (fields.chassisNo != null) {
    const yeni = normChassis(fields.chassisNo);
    const eski = normChassis(d.chassisNo);
    if (yeni && yeni !== eski) {
      const hedef = tractorByChassis(yeni);
      if (!hedef) {
        throw uyari(yeni + " şasi numaralı traktör kayıtlı değil. Önce Traktörler ekranından " +
                    "kaydedin; ya da traktörün kendi şasi numarası yanlış yazıldıysa traktör " +
                    "kartından düzeltin.");
      }
      if (hedef.status === "sevk_edildi") {
        throw uyari(yeni + " sevk edilmiş. Sevk edilmiş traktöre hata taşınamaz.");
      }
      patch.tractorId = hedef.id;
      patch.chassisNo = hedef.chassisNo;
      changes.push("şasi: " + eski + " -> " + yeni + " (kayıt başka traktöre taşındı)");
    }
  }

  EDIT_FIELDS.forEach(function (k) {
    if (!(k in fields)) return;
    let v = fields[k];
    if (typeof v === "string") v = v.trim() || null;
    if (k === "category" || k === "description") {
      if (!v) throw uyari(k === "category" ? "Hata kategorisi seçin." : "Hata tanımı yazın.");
    }
    if (v === d[k]) return;
    if (k === "detectedStepId") {
      const s = stepById(v);
      if (!s) throw uyari("Seçilen istasyon bulunamadı.");
      const eskiS = stepById(d.detectedStepId);
      changes.push("istasyon: " + (eskiS ? eskiS.code : "?") + " -> " + s.code);
      patch.detectedStepCode = s.code;
    } else {
      changes.push(k + ": " + JSON.stringify(d[k]) + " -> " + JSON.stringify(v));
    }
    patch[k] = v;
  });

  if (!changes.length) return { changed: 0, moved: false };

  patch.editedAt = new Date().toISOString();
  patch.editedBy = myEmail();
  patch.editedByName = myName();
  patch.editCount = (d.editCount || 0) + 1;
  await saveDoc("defects", defectId, patch);
  await log("duzenlendi", d.chassisNo, changes.join("; "));
  return { changed: changes.length, moved: !!patch.tractorId };
}

// Kayıt veritabanından SİLİNMEZ; iptal edilir. Kimin, ne zaman, hangi sebeple
// kaldırdığı kayıtta ve günlükte kalır. Excel'deki "kayıt izsiz kayboluyor"
// sorununun çözümü budur.
export async function cancelDefect(defectId, reason) {
  if (!can(["hata_duzenle"])) throw uyari("Hata kaydı silme yetkiniz yok.");
  const d = defectById(defectId);
  if (!d) throw uyari("Hata kaydı bulunamadı.");
  if (d.status === "iptal") throw uyari("Bu kayıt zaten iptal edilmiş.");
  if (String(reason || "").trim().length < 3) throw uyari("Kaldırma sebebi yazın.");
  await saveDoc("defects", defectId, {
    status: "iptal", cancelledAt: new Date().toISOString(),
    cancelledBy: myEmail(), cancelledByName: myName(),
    cancelReason: String(reason).trim(),
    statusBefore: d.status
  });
  await log("iptal_edildi", d.chassisNo, d.description + " | sebep: " + String(reason).trim());
}

export async function restoreDefect(defectId) {
  if (!can(["hata_duzenle"])) throw uyari("Bu işlem için yetkiniz yok.");
  const d = defectById(defectId);
  if (!d) throw uyari("Hata kaydı bulunamadı.");
  if (d.status !== "iptal") throw uyari("Bu kayıt iptal edilmemiş.");

  // İş akışının kaldığı yere göre doğru duruma döndür
  let status = "acik";
  if (d.approvedAt) status = "onaylandi";
  else if (d.reworkFinishedAt) status = "rework_tamam";
  else if (d.reworkStartedAt) status = "reworkta";

  const onceki = d.cancelReason;
  await saveDoc("defects", defectId, {
    status: status, cancelledAt: null, cancelledBy: null,
    cancelledByName: null, cancelReason: null
  });
  await log("iptal_geri_alindi", d.chassisNo, "yeni durum: " + status + " | önceki iptal sebebi: " + onceki);
  return { status: status };
}

function defectById(id) {
  return data.defects.find(function (d) { return d.id === id; }) || null;
}

/* ---------------- hata kaydı fotoğrafları ---------------- */

// Yüklenmiş fotoğrafların künyelerini hata kaydına ekler.
//
// Fotoğrafın kendisi dosya deposunda; burada yalnızca YOLU duruyor. Dosyayı
// Firestore'a gömmek hem 1 MB belge sınırına takılır hem de her okumada
// bedelini ödetirdi.
export async function addDefectPhotos(defectId, kunye) {
  if (!can(["kontrol", "onay", "rework", "operator"])) {
    throw uyari("Fotoğraf ekleme yetkiniz yok.");
  }
  const d = data.defects.find(function (x) { return x.id === defectId; });
  if (!d) throw uyari("Hata kaydı bulunamadı.");
  const liste = (Array.isArray(d.photos) ? d.photos : []).concat(kunye || []);
  await saveDoc("defects", defectId, { photos: liste });
  await log("fotograf_eklendi", d.chassisNo,
            (kunye || []).length + " fotoğraf · " + d.description);
  return liste.length;
}

// Yanlış çekilmiş bir fotoğrafı listeden gizler. Dosya SİLİNMEZ: hata
// fotoğrafı kalite kaydının parçası ve denetim kaydı gibi yok edilemez.
export async function hideDefectPhoto(defectId, yol, reason) {
  if (!can(["hata_duzenle"])) throw uyari("Fotoğraf gizleme yetkiniz yok.");
  const d = data.defects.find(function (x) { return x.id === defectId; });
  if (!d) throw uyari("Hata kaydı bulunamadı.");
  const liste = (Array.isArray(d.photos) ? d.photos : []).map(function (f) {
    return f && f.p === yol ? Object.assign({}, f, { hidden: true }) : f;
  });
  await saveDoc("defects", defectId, { photos: liste });
  await log("fotograf_gizlendi", d.chassisNo, yol + (reason ? " · " + reason : ""));
}
