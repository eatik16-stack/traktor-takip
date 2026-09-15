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
import { minutesBetween, newId, normChassis } from "./util.js";

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
  const done = completedStepCodes(t);
  return activeSteps().filter(function (s) { return done.indexOf(s.code) === -1; });
}

export function minutesHere(t) {
  if (!t || !t.currentEnteredAt) return 0;
  return minutesBetween(t.currentEnteredAt, new Date());
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
  if (tractorByChassis(chassis)) throw uyari(chassis + " şasi numarası zaten kayıtlı.");

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
  });
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
      return s.seq < cur.seq && done.indexOf(s.code) === -1;
    });
    if (missing.length) {
      const names = missing.slice(0, 6).map(function (s) { return s.seq + ". " + s.name; }).join(", ");
      const more = missing.length > 6 ? " (+" + (missing.length - 6) + " adım daha)" : "";
      throw uyari("Tamamlanmamış " + missing.length + " adım var: " + names + more +
                  ". Traktör sevke hazır sayılamaz.");
    }
  }

  const now = new Date().toISOString();
  const started = t.currentStartedAt || now;
  const wait = minutesBetween(t.currentEnteredAt, started);
  const work = minutesBetween(started, now);

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
  });

  const next = steps.find(function (s) { return s.seq > cur.seq; }) || null;

  if (!next) {
    await saveDoc("tractors", tractorId, {
      steps: stepMap, status: "sevke_hazir", readyAt: now,
      currentStepId: cur.id, currentEnteredAt: null, currentStartedAt: null,
      currentOperator: null, currentOperatorName: null, currentEventId: null
    });
    await log("adim_tamamlandi", t.chassisNo, cur.code + " -> sevke hazır");
    return { finished: cur.code, next: null, status: "sevke_hazir" };
  }

  const evId = newId("ev");
  await saveDoc("tractors", tractorId, {
    steps: stepMap, status: "devam",
    currentStepId: next.id, currentEnteredAt: now, currentStartedAt: null,
    currentOperator: null, currentOperatorName: null, currentEventId: evId
  });
  await addEventDoc(tractorId, evId, next, now);
  await log("adim_tamamlandi", t.chassisNo, cur.code + " -> " + next.code);
  return { finished: cur.code, next: next.code, status: "devam" };
}

export async function moveToStep(tractorId, stepId, note) {
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
    });
  }
  const evId = newId("ev");
  await saveDoc("tractors", tractorId, {
    status: "devam", currentStepId: target.id, currentEnteredAt: now,
    currentStartedAt: null, currentOperator: null, currentOperatorName: null,
    currentEventId: evId
  });
  await addEventDoc(tractorId, evId, target, now);
  await log("yonlendirildi", t.chassisNo, "-> " + target.code + (note ? ": " + note : ""));
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
  const step = stepById(stepId);
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
            Math.round(minutesBetween(d.reworkStartedAt, now)) + " dk");
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
