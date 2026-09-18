// Operasyon ekranları: canlı şema, istasyon, rework, onay, traktörler, hatalar.

import { $, $$, esc, el, fmtDate, fmtMin, fmtNum, toast, normChassis, shortChassis } from "./util.js";
import { modal, confirmDialog, kpi, emptyBox, statusChip, defectChip } from "./ui.js";
import { data, stepById, stepByCode, activeSteps, tractorById, tractorByChassis,
         findTractors, searchCatalog, catalogFind, catalogRemember,
         ensureHistory, RECENT_DAYS } from "./store.js";
import { myStepCode, can, canExact, myEmail } from "./auth.js";
import * as flow from "./flow.js";
import { scanText, cameraSupported, extractLabel, sasiUyari } from "./scan.js";
import { photoPicker, yukleVeBagla, photoStrip, bindPhotos } from "./photo-ui.js";

export function go(hash) { location.hash = hash; }

function err(e) { toast((e && e.message) || "İşlem tamamlanamadı.", "err"); }

/* ================= ortak parçalar ================= */

function tractorCard(t, actions) {
  const step = stepById(t.currentStepId);
  const open = flow.openDefects(t.id).length;
  const late = flow.isOverdue(t);
  const cls = open ? "danger" : (late ? "warn" : "");
  return '<div class="tcard ' + cls + '" data-t="' + esc(t.id) + '">' +
    '<div class="tcard-head">' +
      '<span class="tcard-chassis">' + esc(t.chassisNo) + "</span>" +
      (t.currentStartedAt ? '<span class="chip chip-blue">İşlemde</span>'
                          : '<span class="chip">Bekliyor</span>') +
      (open ? '<span class="chip chip-red">' + open + " açık hata</span>" : "") +
    "</div>" +
    '<div class="tcard-meta">' +
      "<span>" + esc(t.saleCode || "—") + "</span>" +
      (step ? "<span>" + esc(step.code) + "</span>" : "") +
      '<span style="' + (late ? "color:var(--amber);font-weight:650" : "") + '">⏱ ' +
        fmtMin(flow.minutesHere(t)) +
        (step && step.targetMinutes ? " / hedef " + step.targetMinutes + " dk" : "") + "</span>" +
    "</div>" +
    '<div class="tcard-actions">' + (actions || "") + "</div></div>";
}

function bindTractorCards(root, refresh) {
  $$("[data-t]", root).forEach(function (cardEl) {
    const id = cardEl.dataset.t;
    $$("[data-act]", cardEl).forEach(function (btn) {
      btn.onclick = async function (ev) {
        ev.stopPropagation();
        const act = btn.dataset.act;
        btn.disabled = true;
        try {
          if (act === "open")   { go("#/traktor/" + id); return; }
          if (act === "start")  { await flow.startWork(id); toast("Adım başlatıldı.", "ok"); }
          if (act === "finish") {
            const r = await flow.finishStep(id, "ok");
            toast(r.next ? "Tamamlandı → sıradaki adım: " + r.next
                         : "Tüm adımlar bitti — traktör sevke hazır!", "ok");
          }
          if (act === "defect") { openDefectDialog(id, refresh); return; }
          if (refresh) refresh();
        } catch (e) { err(e); } finally { btn.disabled = false; }
      };
    });
    cardEl.onclick = function (ev) {
      if (ev.target.closest("[data-act]")) return;
      go("#/traktor/" + id);
    };
  });
}

/* ================= 1. Canlı Şema ================= */

export function sema(view) {
  const steps = activeSteps();
  const inFlight = data.tractors.filter(function (t) {
    return t.status === "devam" || t.status === "beklemede";
  });
  const ready = data.tractors.filter(function (t) { return t.status === "sevke_hazir"; }).length;
  const late = inFlight.filter(flow.isOverdue).length;
  const withDefects = inFlight.filter(function (t) { return flow.openDefects(t.id).length; }).length;

  const byStep = {};
  steps.forEach(function (s) { byStep[s.id] = []; });
  inFlight.forEach(function (t) { if (byStep[t.currentStepId]) byStep[t.currentStepId].push(t); });

  view.innerHTML =
    '<div class="page-head"><div><h2>Canlı Şema</h2>' +
      "<p>Hattaki traktörlerin şu anda hangi adımda olduğu</p></div></div>" +
    '<div class="kpi-grid">' +
      kpi("Hatta", fmtNum(inFlight.length), "işlem görüyor") +
      kpi("Sevke Hazır", fmtNum(ready), "tüm adımlar tamam", "k-green") +
      kpi("Açık Hatalı", fmtNum(withDefects), "traktör", withDefects ? "k-red" : "k-green") +
      kpi("Hedefi Aşan", fmtNum(late), "traktör", late ? "k-amber" : "k-green") +
    "</div>" +
    '<div class="board">' + steps.map(function (s) {
      const list = byStep[s.id] || [];
      return '<div class="bstep">' +
        '<div class="bstep-head" style="background:' + esc(s.color || "#2563eb") + '">' +
          '<span class="seq">' + s.seq + "</span>" +
          '<span class="nm">' + esc(s.name) + "</span>" +
          '<span class="ct">' + list.length + "</span></div>" +
        '<div class="bstep-body">' +
          (list.length ? list.map(function (t) {
            const open = flow.openDefects(t.id).length;
            const cls = open ? "bad" : (flow.isOverdue(t) ? "late" : "");
            return '<div class="bchip ' + cls + '" data-go="' + esc(t.id) + '">' +
              '<span class="ch">' + esc(t.chassisNo) + "</span>" +
              (open ? '<span class="chip chip-red">' + open + "</span>" : "") +
              '<span class="tm">' + fmtMin(flow.minutesHere(t)) + "</span></div>";
          }).join("") : '<div class="bstep-empty">boş</div>') +
        "</div></div>";
    }).join("") + "</div>";

  $$("[data-go]", view).forEach(function (n) {
    n.onclick = function () { go("#/traktor/" + n.dataset.go); };
  });
}

/* ================= 2. İstasyonum ================= */
//
// Üretim personelinin (rework, oil, boya…) bakması gereken TEK ekran burası.
// İstasyona düşen traktör, o traktörün hataları ve adımı başlat/tamamla
// düğmeleri aynı ekranda; kimse Traktörler listesine gidip kart açmak zorunda
// kalmasın. İstasyonda geçen süre de bu ekrandan girilen başlat/tamamla
// kayıtlarıyla ölçülüyor.

let stQ = "";
let stSel = null;
let stStation = null;   // yönetici başka bir istasyona geçtiğinde

export function istasyon(view, _p, rerender) {
  const steps = activeSteps();
  // Yönetim ve sistem yöneticisi istasyon değiştirebilir (vekalet, test).
  // Operatör yalnızca kendi istasyonunu görür.
  const digerleri = can(["yonetim"]);
  if (stStation && !stepByCode(stStation)) stStation = null;
  const code = (digerleri && stStation) || myStepCode();
  const step = code ? stepByCode(code) : null;
  if (!step) {
    view.innerHTML = '<div class="page-head"><div><h2>İstasyonum</h2></div></div>' +
      '<div class="banner">Hesabınıza varsayılan istasyon tanımlanmamış. ' +
      "Yöneticiden Tanımlar → Kullanıcılar ekranından istasyon atamasını isteyin.</div>" +
      (digerleri ? '<div class="card"><label class="field" style="margin:0"><span>İstasyon seçin</span>' +
        '<select class="input input-lg" id="st-pick"><option value="">—</option>' +
        steps.map(function (x) {
          return '<option value="' + esc(x.code) + '">' + esc(x.code + " — " + x.name) + "</option>";
        }).join("") + "</select></label></div>" : "");
    const pk0 = $("#st-pick", view);
    if (pk0) pk0.onchange = function () { stStation = pk0.value || null; stSel = null; rerender(); };
    return;
  }
  const isFirst = steps.length && steps[0].id === step.id;
  const q = stQ.trim();

  const here = function (t) {
    return t.currentStepId === step.id && (t.status === "devam" || t.status === "beklemede");
  };
  const queue = data.tractors.filter(here).sort(function (a, b) {
    return new Date(a.currentEnteredAt || 0) - new Date(b.currentEnteredAt || 0);
  });
  const hits = q ? findTractors(q, 8) : [];

  // Açılır açılmaz iş görünsün: seçim yoksa kuyruğun ilki açılır.
  if (stSel && !tractorById(stSel)) stSel = null;
  let sel = stSel ? tractorById(stSel) : null;
  if (!sel && queue.length) { sel = queue[0]; }

  const openOf = function (t) {
    return data.defects.filter(function (d) {
      return d.tractorId === t.id && (d.status === "acik" || d.status === "reworkta");
    });
  };
  const mineOf = function (t) {
    return data.defects.filter(function (d) {
      return d.tractorId === t.id && d.status === "reworkta" && d.reworkBy === myEmail();
    });
  };

  // Panelin üstündeki adım düğmeleri. Traktör bu istasyonda değilse
  // (aramayla bulunmuşsa) adım düğmesi gösterilmez, yanlış adım kapanmasın.
  let stepButtons = "";
  if (sel && here(sel)) {
    const acikSayi = openOf(sel).length;
    // Alt alta ve büyük: eldivenli başparmakla, ayakta, traktöre bakarken
    // basılıyor. Yan yana dururken hem hedef küçülüyor hem de yanlış olana
    // basma ihtimali artıyordu.
    stepButtons =
      '<div class="step-acts">' +
      (!sel.currentStartedAt
        ? '<button class="btn btn-primary" id="stp-start">▶ Adımı Başlat</button>'
        : '<button class="btn btn-success" id="stp-finish">✓ Adımı Tamamla</button>') +
      (step.allowsDefect ? '<button class="btn btn-danger" id="stp-defect">⚠ Hata Ekle</button>' : "") +
      "</div>" +
      (acikSayi ? '<span class="chip chip-red" style="align-self:center">' + acikSayi +
                  " hata kapanmadı</span>" : "");
  }

  view.innerHTML =
    '<div class="page-head"><div><h2>' + esc(step.name) + "</h2>" +
      "<p>" + esc(step.code) + " · kuyrukta " + queue.length + " traktör" +
        (digerleri && stStation ? " · kendi istasyonunuz değil" : "") + "</p></div>" +
      '<div class="spacer"></div>' +
      (digerleri
        ? '<label class="field" style="margin:0;min-width:190px"><span>İstasyon</span>' +
          '<select class="input" id="st-pick">' + steps.map(function (x) {
            return '<option value="' + esc(x.code) + '"' + (x.code === step.code ? " selected" : "") +
                   ">" + esc(x.code + " — " + x.name) + "</option>";
          }).join("") + "</select></label>" : "") +
      (isFirst && can(["operator", "kontrol", "onay"])
        ? '<button class="btn btn-primary" id="st-new">+ Traktör Ekle</button>' : "") + "</div>" +
    '<div class="card search-card">' +
      '<input class="input input-lg" id="st-q" inputmode="numeric" autocomplete="off" ' +
        'placeholder="Traktör bul — şasinin son 6 hanesi" value="' + esc(stQ) + '">' +
      (q ? '<button class="btn btn-ghost" id="st-clear" aria-label="Temizle">✕</button>' : "") +
    "</div>" +

    (sel ? reworkPanel(sel, openOf(sel), mineOf(sel), stepButtons) : "") +

    (q ? '<div class="card"><div class="card-head"><h3>' + hits.length + " sonuç</h3></div>" +
         (hits.length ? '<div class="rw-list">' + hits.map(function (t) {
           return stationRow(t, sel, step);
         }).join("") + "</div>"
         : emptyBox("Bu numarayla traktör bulunamadı." +
                    (isFirst ? " Yeni traktörse \"+ Traktör Ekle\" ile kaydedin." : ""), "🔍")) +
       "</div>" : "") +

    '<div class="card"><div class="card-head"><h3>İstasyon kuyruğu</h3></div>' +
      (queue.length ? '<div class="rw-list">' + queue.map(function (t) {
        return stationRow(t, sel, step);
      }).join("") + "</div>"
      : emptyBox("Bu istasyonda bekleyen traktör yok.", "✅")) + "</div>";

  const qi = $("#st-q", view);
  let tmr = null;
  qi.oninput = function () {
    clearTimeout(tmr);
    tmr = setTimeout(function () {
      stQ = qi.value;
      // Tek sonuç varsa hemen aç — operatör ikinci bir dokunuş yapmasın.
      const h = findTractors(qi.value.trim(), 2);
      if (qi.value.trim().length >= 4 && h.length === 1) stSel = h[0].id;
      rerender();
    }, 200);
  };
  qi.onkeydown = function (e) { if (e.key === "Enter") qi.blur(); };
  const clr = $("#st-clear", view);
  if (clr) clr.onclick = function () { stQ = ""; rerender(); };
  const nb = $("#st-new", view);
  if (nb) nb.onclick = function () { newTractorDialog(rerender, q); };
  const pk = $("#st-pick", view);
  if (pk) pk.onchange = function () {
    stStation = pk.value === myStepCode() ? null : pk.value;
    stSel = null; rerender();
  };

  $$("[data-sel]", view).forEach(function (b) {
    b.onclick = function () { stSel = b.dataset.sel; rerender(); };
  });

  bindPhotoThumbs(view);

  const selId = sel ? sel.id : null;
  const s1 = $("#stp-start", view);
  if (s1) s1.onclick = async function () {
    s1.disabled = true;
    try { await flow.startWork(selId); toast("Adım başlatıldı.", "ok"); rerender(); }
    catch (e) { err(e); s1.disabled = false; }
  };
  const s2 = $("#stp-finish", view);
  if (s2) s2.onclick = async function () {
    const acik = openOf(sel).length;
    // Rework istasyonunda açık hata varken adımı kapatmak neredeyse her zaman
    // yanlışlıktır; engellemiyoruz ama sormadan geçmiyoruz.
    if (acik && !(await confirmDialog("Açık hata var",
      "Bu traktörde kapanmamış " + acik + " hata var. Adımı yine de tamamlansın mı?",
      "Yine de tamamla", "btn-warn"))) return;
    s2.disabled = true;
    try {
      const r = await flow.finishStep(selId, "ok");
      toast(r.next ? "Tamamlandı → sıradaki adım: " + r.next
                   : "Tüm adımlar bitti — traktör sevke hazır!", "ok");
      stSel = null;
      rerender();
    } catch (e) { err(e); s2.disabled = false; }
  };
  const s3 = $("#stp-defect", view);
  if (s3) s3.onclick = function () { openDefectDialog(selId, rerender); };

  bindDefectCards(view, rerender);
  const all = $("#rw-take-all", view);
  if (all) all.onclick = async function () {
    all.disabled = true;
    const targets = data.defects.filter(function (d) {
      return d.tractorId === selId && d.status === "acik";
    });
    let n = 0;
    try {
      for (const d of targets) { await flow.takeDefect(d.id); n++; }
      toast(n + " hata üzerinize alındı.", "ok");
    } catch (e) { err(e); }
    rerender();
  };
}

// İstasyon listelerindeki tek satır — seçiliyi vurgular, açık hata sayısını
// ve bu adımda geçen süreyi gösterir.
function stationRow(t, sel, step) {
  const open = data.defects.filter(function (d) {
    return d.tractorId === t.id && (d.status === "acik" || d.status === "reworkta");
  }).length;
  const st = stepById(t.currentStepId);
  const atHere = st && step && st.id === step.id;
  return '<button class="rw-row' + (sel && sel.id === t.id ? " on" : "") +
    '" data-sel="' + esc(t.id) + '">' +
    '<span class="rw-ch"><strong>' + esc(shortChassis(t.chassisNo)) + "</strong>" +
      (shortChassis(t.chassisNo) !== t.chassisNo ? "<small>" + esc(t.chassisNo) + "</small>" : "") + "</span>" +
    '<span class="rw-meta">' + esc(t.saleCode || "") + (st ? " · " + esc(st.code) : "") +
      (atHere ? " · " + fmtMin(flow.minutesHere(t)) : "") +
      (t.status === "sevk_edildi" ? " · sevk edildi" : "") + "</span>" +
    '<span class="rw-cnt">' +
      (open ? '<span class="chip chip-red">' + open + " açık</span>"
            : '<span class="chip chip-green">hata yok</span>') +
      (atHere && t.currentStartedAt ? '<span class="chip chip-blue">işlemde</span>' : "") +
    "</span></button>";
}

/* ================= 3. Rework ================= */
//
// Sahadaki akış: traktör rework personelinin önüne gelir, personel tablette
// şasinin SON 6 HANESİNİ yazar, traktörü bulur, o traktörün bütün hataları
// listelenir; teker teker üzerine alır ve bitirir. Kuyruk traktör bazlıdır,
// hata bazlı değil — bir traktörde ortalama 9 hata var.

let rwSel = { q: "", tractorId: null };

export function rework(view, _p, rerender) {
  const openOf = function (t) {
    return data.defects.filter(function (d) {
      return d.tractorId === t.id && (d.status === "acik" || d.status === "reworkta");
    });
  };
  const mineOf = function (t) {
    return data.defects.filter(function (d) {
      return d.tractorId === t.id && d.status === "reworkta" && d.reworkBy === myEmail();
    });
  };

  const q = rwSel.q.trim();
  let list;
  if (q) {
    list = findTractors(q, 12);
  } else {
    // Açık hatası olan traktörler, en çok hatası olan önce; üzerimde iş olan en önde
    list = data.tractors.filter(function (t) { return openOf(t).length; })
      .sort(function (a, b) {
        const ma = mineOf(a).length, mb = mineOf(b).length;
        if (ma !== mb) return mb - ma;
        return openOf(b).length - openOf(a).length;
      }).slice(0, 40);
  }
  const sel = rwSel.tractorId ? tractorById(rwSel.tractorId) : null;

  view.innerHTML =
    '<div class="page-head"><div><h2>Rework</h2>' +
      "<p>Şasi numarasını yazın, traktörün hatalarını üzerinize alıp bitirin</p></div></div>" +
    '<div class="card search-card">' +
      '<input class="input input-lg" id="rw-q" inputmode="numeric" autocomplete="off" ' +
        'placeholder="Şasi no — son 6 hane yeter" value="' + esc(rwSel.q) + '">' +
      (q ? '<button class="btn btn-ghost" id="rw-clear" aria-label="Temizle">✕</button>' : "") +
    "</div>" +
    (sel ? reworkPanel(sel, openOf(sel), mineOf(sel)) : "") +
    '<div class="card"><div class="card-head"><h3>' +
      (q ? '"' + esc(q) + '" için ' + list.length + " sonuç" : "Açık hatası olan traktörler") +
      "</h3></div>" +
      (list.length ? '<div class="rw-list">' + list.map(function (t) {
        const open = openOf(t), mine = mineOf(t);
        const step = stepById(t.currentStepId);
        return '<button class="rw-row' + (sel && sel.id === t.id ? " on" : "") + '" data-sel="' + esc(t.id) + '">' +
          '<span class="rw-ch"><strong>' + esc(shortChassis(t.chassisNo)) + "</strong>" +
            (shortChassis(t.chassisNo) !== t.chassisNo ? '<small>' + esc(t.chassisNo) + "</small>" : "") + "</span>" +
          '<span class="rw-meta">' + esc(t.saleCode || "") + (step ? " · " + esc(step.code) : "") +
            (t.status === "sevk_edildi" ? " · sevk edildi" : "") + "</span>" +
          '<span class="rw-cnt">' +
            (open.length ? '<span class="chip chip-red">' + open.length + " açık</span>" : '<span class="chip chip-green">hata yok</span>') +
            (mine.length ? '<span class="chip chip-amber">' + mine.length + " üzerimde</span>" : "") +
          "</span></button>";
      }).join("") + "</div>"
      : emptyBox(q ? "Bu numarayla traktör bulunamadı. Son 6 haneyi kontrol edin." : "Açık hatası olan traktör yok.", q ? "🔍" : "✅")) +
    "</div>";

  const qi = $("#rw-q", view);
  let tmr = null;
  qi.oninput = function () {
    clearTimeout(tmr);
    tmr = setTimeout(function () {
      rwSel.q = qi.value;
      // Tek sonuç varsa hemen seç — operatör bir dokunuş daha yapmasın
      const hits = findTractors(qi.value.trim(), 2);
      if (qi.value.trim().length >= 4 && hits.length === 1) rwSel.tractorId = hits[0].id;
      rerender();
    }, 200);
  };
  qi.onkeydown = function (e) { if (e.key === "Enter") { qi.blur(); } };
  const clr = $("#rw-clear", view);
  if (clr) clr.onclick = function () { rwSel = { q: "", tractorId: null }; rerender(); };
  $$("[data-sel]", view).forEach(function (b) {
    b.onclick = function () {
      rwSel.tractorId = rwSel.tractorId === b.dataset.sel ? null : b.dataset.sel;
      rerender();
      const p = $("#rw-panel");
      if (p) p.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });

  bindDefectCards(view, rerender);
  const all = $("#rw-take-all", view);
  if (all) all.onclick = async function () {
    all.disabled = true;
    const targets = data.defects.filter(function (d) { return d.tractorId === sel.id && d.status === "acik"; });
    let n = 0;
    try {
      for (const d of targets) { await flow.takeDefect(d.id); n++; }
      toast(n + " hata üzerinize alındı.", "ok");
    } catch (e) { err(e); }
    rerender();
  };
  if (!q && !sel && window.matchMedia("(min-width:900px)").matches) qi.focus();
}

function reworkPanel(t, open, mine, extraButtons) {
  const step = stepById(t.currentStepId);
  const all = data.defects.filter(function (d) { return d.tractorId === t.id && d.status !== "iptal"; })
    .sort(function (a, b) {
      const order = { acik: 0, reworkta: 1, rework_tamam: 2, onaylandi: 3 };
      const oa = order[a.status] != null ? order[a.status] : 9, ob = order[b.status] != null ? order[b.status] : 9;
      if (oa !== ob) return oa - ob;
      return new Date(a.detectedAt) - new Date(b.detectedAt);
    });
  const acik = all.filter(function (d) { return d.status === "acik"; }).length;
  const bekleyen = all.filter(function (d) { return d.status === "rework_tamam"; }).length;
  const bitti = all.filter(function (d) { return d.status === "onaylandi"; }).length;

  return '<div class="card rw-panel" id="rw-panel">' +
    '<div class="card-head"><div><h3 style="font-size:19px">' + esc(t.chassisNo) + "</h3>" +
      '<p class="card-sub">' + esc(t.saleCode || "") + (t.family ? " · " + esc(t.family) : "") +
        (step ? " · " + esc(step.code) + " — " + esc(step.name) : "") + "</p></div>" +
      '<div class="spacer"></div>' + statusChip(t.status) + "</div>" +
    '<div class="rw-summary">' +
      '<span class="chip chip-red">' + acik + " açık</span>" +
      '<span class="chip chip-amber">' + mine.length + " üzerimde</span>" +
      '<span class="chip chip-blue">' + bekleyen + " onay bekliyor</span>" +
      '<span class="chip chip-green">' + bitti + " tamamlandı</span>" +
    "</div>" +
    '<div class="btn-row" style="margin:10px 0 12px">' +
      (extraButtons || "") +
      (acik && can(["rework", "kontrol"]) ? '<button class="btn btn-primary" id="rw-take-all">Tümünü üzerime al (' + acik + ")</button>" : "") +
      '<button class="btn" data-go-tractor="' + esc(t.id) + '" onclick="location.hash=\'#/traktor/' + esc(t.id) + '\'">Traktör kartı</button>' +
    "</div>" +
    (all.length ? '<div class="rw-defects">' + all.map(function (d) {
      const mineOne = d.status === "reworkta" && d.reworkBy === myEmail();
      const other = d.status === "reworkta" && !mineOne;
      return '<div class="rw-def ' + (d.status === "acik" ? "is-open" : mineOne ? "is-mine" : "") + '" data-d="' + esc(d.id) + '">' +
        '<div class="rw-def-main"><div class="rw-def-title">' + esc(d.description) + "</div>" +
          '<div class="rw-def-meta">' + esc(d.category) +
            (d.source ? " · " + esc(d.source) : "") +
            " · " + esc(d.detectedStepCode || "") + " · " + esc(d.detectedByName || "") +
            (d.repeatCount ? ' · <span style="color:var(--amber);font-weight:650">' + d.repeatCount + ". tekrar</span>" : "") +
            (d.rejectNote ? ' · <span style="color:var(--red)">red: ' + esc(d.rejectNote) + "</span>" : "") +
          "</div>" + photoStrip(d) + "</div>" +
        '<div class="rw-def-act">' +
          (d.status === "acik" ? '<button class="btn btn-primary btn-sm" data-dact="take">Üzerime Al</button>' :
           mineOne ? '<button class="btn btn-success btn-sm" data-dact="complete">✓ Bitti</button>' +
                     '<button class="btn btn-sm" data-dact="release" title="Başkası alabilsin diye geri bırak">Bırak</button>' :
           other ? '<span class="chip chip-amber">' + esc(d.reworkByName || "") + " yapıyor</span>" :
           d.status === "rework_tamam"
             ? (can(["onay", "kontrol"])
                 ? '<button class="btn btn-success btn-sm" data-dact="approve">✓ Onayla</button>' +
                   '<button class="btn btn-danger btn-sm" data-dact="reject">✗ Reddet</button>'
                 : '<span class="chip chip-blue">Onay bekliyor</span>') :
           d.status === "onaylandi" ? '<span class="chip chip-green">Tamam</span>' : defectChip(d.status)) +
        "</div></div>";
    }).join("") + "</div>" : emptyBox("Bu traktörde hata kaydı yok.", "✅")) +
  "</div>";
}

/* ================= 4. Onay bekleyenler ================= */

export function onay(view, _p, rerender) {
  const rows = data.defects.filter(function (d) { return d.status === "rework_tamam"; })
    .sort(function (a, b) { return new Date(a.reworkFinishedAt || 0) - new Date(b.reworkFinishedAt || 0); });

  view.innerHTML =
    '<div class="page-head"><div><h2>Onay Bekleyen Hatalar</h2>' +
      "<p>" + rows.length + " kayıt · rework tamamlandı, onayınız bekleniyor</p></div></div>" +
    (canExact("tam_onay")
      ? '<div class="banner">⚠ Hesabınızda <strong>tüm onayları verebilme</strong> yetkisi var: ' +
        "kendi yaptığınız rework'ü de onaylayabilirsiniz. Böyle onaylar denetim kaydına " +
        '<em>"kendi rework\'ünü onayladı"</em> notuyla yazılır.</div>'
      : '<div class="banner info">Kendi yaptığınız rework\'ü onaylayamazsınız — ' +
        "kontrol başka bir kişi tarafından yapılmalıdır.</div>") +
    (rows.length ? '<div class="tlist">' + rows.map(function (d) {
      return defectCard(d,
        '<button class="btn btn-success btn-sm" data-dact="approve">✓ Onayla</button>' +
        '<button class="btn btn-danger btn-sm" data-dact="reject">✗ Reddet</button>');
    }).join("") + "</div>" : emptyBox("Onay bekleyen hata yok.", "✅"));

  bindDefectCards(view, rerender);
}

/* ================= hata kartı ================= */

function defectCard(d, actions) {
  const step = stepById(d.detectedStepId);
  return '<div class="tcard ' + (d.status === "acik" ? "danger" : "") + '" data-d="' + esc(d.id) + '">' +
    '<div class="tcard-head">' +
      '<span class="tcard-chassis">' + esc(d.chassisNo || "") + "</span>" +
      defectChip(d.status) +
      (d.repeatCount ? '<span class="chip chip-amber">' + d.repeatCount + ". tekrar</span>" : "") +
    "</div>" +
    '<div style="font-weight:600;margin-bottom:3px">' + esc(d.description) + "</div>" +
    '<div class="tcard-meta">' +
      "<span>" + esc(d.category) + "</span>" +
      (d.source ? "<span>Kaynak: " + esc(d.source) + "</span>" : "") +
      (step ? "<span>" + esc(step.code) + "</span>" : "") +
      "<span>" + esc(d.detectedByName || "") + " · " + fmtDate(d.detectedAt) + "</span>" +
      (d.reworkByName ? "<span>🔧 " + esc(d.reworkByName) + "</span>" : "") +
    "</div>" +
    '<div class="tcard-actions">' + (actions || "") +
      '<button class="btn btn-sm" data-dact="tractor">Traktör</button>' +
    "</div></div>";
}

// Fotoğraf önizlemelerini bağlar. Her ekranda ayrı ayrı çağırmak yerine tek
// yardımcı: yeni bir liste ekranı eklendiğinde unutulmasın.
export function bindPhotoThumbs(root) {
  bindPhotos(root, function (id) {
    return data.defects.find(function (x) { return x.id === id; });
  });
}

function bindDefectCards(root, refresh) {
  bindPhotoThumbs(root);
  $$("[data-d]", root).forEach(function (cardEl) {
    const id = cardEl.dataset.d;
    $$("[data-dact]", cardEl).forEach(function (btn) {
      btn.onclick = async function (ev) {
        ev.stopPropagation();
        const act = btn.dataset.dact;
        const d = data.defects.find(function (x) { return x.id === id; });
        if (!d) return;
        if (act === "tractor") { go("#/traktor/" + d.tractorId); return; }
        if (act === "reject")  { rejectDialog(id, refresh); return; }
        if (act === "edit")    { openDefectEditDialog(d, refresh); return; }
        if (act === "cancel")  { openDefectCancelDialog(d, refresh); return; }
        if (act === "restore") {
          if (!(await confirmDialog("Geri Al",
                "Bu kayıt tekrar listelere ve raporlara girecek. Devam edilsin mi?", "Geri Al"))) return;
          try { const r = await flow.restoreDefect(id); toast("Geri alındı → " + r.status, "ok"); if (refresh) refresh(); }
          catch (e) { err(e); }
          return;
        }
        btn.disabled = true;
        try {
          if (act === "take")     { await flow.takeDefect(id); toast("Üzerinize alındı.", "ok"); }
          if (act === "complete") { await flow.completeDefect(id); toast("Rework tamamlandı, onaya gönderildi.", "ok"); }
          if (act === "release")  { await flow.releaseDefect(id); toast("Bırakıldı — başkası üzerine alabilir.", "ok"); }
          if (act === "approve")  {
            const r = await flow.approveDefect(id);
            toast(r.selfApproved
              ? "Onaylandı — kendi rework'ünüzdü, denetim kaydına not düşüldü."
              : "Onaylandı.", "ok");
          }
          if (refresh) refresh();
        } catch (e) { err(e); } finally { btn.disabled = false; }
      };
    });
  });
}

function rejectDialog(defectId, refresh) {
  const body = el('<div><label class="field"><span>Red sebebi (zorunlu)</span>' +
    '<textarea class="input" id="rj-note" rows="3" placeholder="Neden yeterli değil?"></textarea></label></div>');
  modal({
    title: "Rework'ü Reddet", body: body,
    buttons: [{ label: "Vazgeç" }, {
      label: "Reddet", cls: "btn-danger",
      onClick: async function () {
        try {
          await flow.rejectDefect(defectId, $("#rj-note", body).value);
          toast("Reddedildi, tekrar rework kuyruğunda.", "ok");
          if (refresh) refresh();
        } catch (e) { err(e); return "keep"; }
      }
    }]
  });
}

/* ================= hata tanımı seçici ================= */
//
// Excel'deki süzgeç alışkanlığının karşılığı: kişi "oil" yazar, daha önce
// kaydedilmiş "Oil flashing" öneri olarak gelir, dokununca kategori ve kaynak
// da dolar. Listede olmayan bir hata yazılırsa serbestçe kaydedilir ve bir
// sonraki sefer o da önerilir — sistem kullandıkça öğrenir.
//
// Döndürdüğü nesne: { el, getDescription(), getCategory(), getSource(), setCategory() }

function descriptionPicker(initial) {
  const cats = data.lookups.hata_kodu || [];
  let category = (initial && initial.category) || "";
  let source = (initial && initial.source) || null;
  let pickedExact = false;

  const root = el('<div>' +
    '<div class="field"><span>1. Hata Tanımı — yazın, listeden seçin</span>' +
      '<input class="input input-lg" id="p-desc" autocomplete="off" autocorrect="off" ' +
        'placeholder="Örn. oil, maşpiyel, dörtlü…" value="' + esc((initial && initial.description) || "") + '">' +
      '<div class="suggest" id="p-sug"></div>' +
      '<small class="field-hint" id="p-hint"></small></div>' +
    '<div class="field"><span>2. Hata Kategorisi</span><div class="pick-grid" id="p-cats">' +
      cats.map(function (c) {
        return '<button type="button" class="pick' + (c === category ? " selected" : "") +
               '" data-v="' + esc(c) + '">' + esc(c) + "</button>";
      }).join("") + "</div></div></div>");

  const input = $("#p-desc", root), sug = $("#p-sug", root), hint = $("#p-hint", root);

  function markCategory() {
    $$("#p-cats .pick", root).forEach(function (b) {
      b.classList.toggle("selected", b.dataset.v === category);
    });
  }

  function renderSuggestions() {
    const q = input.value.trim();
    const items = searchCatalog(q, category, 12);
    const exact = q ? catalogFind(q) : null;
    pickedExact = !!exact;
    if (!items.length) {
      sug.innerHTML = "";
      sug.hidden = true;
    } else {
      sug.hidden = false;
      sug.innerHTML = (q ? "" : '<div class="suggest-title">Sık kaydedilenler</div>') +
        items.map(function (i, idx) {
          return '<button type="button" class="suggest-item" data-i="' + idx + '">' +
            '<span class="s-desc">' + esc(i.d) + "</span>" +
            '<span class="s-meta"><span class="chip">' + esc(i.c) + "</span>" +
            (i.n > 1 ? '<span class="s-n">' + i.n + " kez</span>" : "") + "</span></button>";
        }).join("");
      $$(".suggest-item", sug).forEach(function (b) {
        b.onclick = function () {
          const it = items[Number(b.dataset.i)];
          input.value = it.d;
          category = it.c; source = it.s || source; pickedExact = true;
          markCategory();
          sug.hidden = true; sug.innerHTML = "";
          hint.textContent = "Listeden seçildi: " + it.c + (it.n > 1 ? " · daha önce " + it.n + " kez kaydedildi" : "");
          hint.className = "field-hint hint-ok";
          if (onPick) onPick(it);
        };
      });
    }
    if (!q) { hint.textContent = ""; hint.className = "field-hint"; return; }
    if (exact) {
      hint.textContent = "Listede var — kategori: " + exact.c;
      hint.className = "field-hint hint-ok";
      if (!category) { category = exact.c; markCategory(); }
      if (!source) source = exact.s || null;
    } else {
      hint.textContent = items.length
        ? "Benzer kayıtlar yukarıda. Farklı bir hataysa böyle bırakın — yeni tanım olarak kaydedilir."
        : "Daha önce kaydedilmemiş bir hata. Kaydedilince bir sonraki sefer önerilecek.";
      hint.className = "field-hint";
    }
  }

  let timer = null, onPick = null;
  input.oninput = function () { clearTimeout(timer); timer = setTimeout(renderSuggestions, 120); };
  input.onfocus = function () { renderSuggestions(); };
  // Enter ilk öneriyi seçer (tablette klavyeyi kapatmanın hızlı yolu)
  input.onkeydown = function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = $(".suggest-item", sug);
      if (first && !sug.hidden) first.click(); else input.blur();
    }
  };
  $("#p-cats", root).onclick = function (e) {
    const b = e.target.closest(".pick");
    if (!b) return;
    category = b.dataset.v; markCategory(); renderSuggestions();
  };
  renderSuggestions();

  return {
    el: root,
    focus: function () { if (window.matchMedia("(min-width:900px)").matches) input.focus(); },
    getDescription: function () { return input.value.trim(); },
    getCategory: function () { return category; },
    getSource: function () { return source; },
    isNew: function () { return !pickedExact && !catalogFind(input.value); },
    onPick: function (fn) { onPick = fn; }
  };
}

/* ================= hata kaydı açma ================= */

export function openDefectDialog(tractorId, onDone) {
  const t = tractorById(tractorId);
  if (!t) return;
  const srcs = data.lookups.hata_kaynagi || [];
  const orgs = data.lookups.olusum_yeri || [];
  // İş yapılan istasyonlar: hata bunlardan birinde giderilir.
  const isSteps = activeSteps().filter(function (x) {
    return x.kind === "rework" || x.kind === "islem";
  });
  const picker = descriptionPicker(null);

  const body = el('<div>' +
    '<div class="banner info" style="margin-top:0"><strong>' + esc(t.chassisNo) + "</strong>" +
      (t.saleCode ? " · " + esc(t.saleCode) : "") +
      "<br><small>Kayıt sizin adınıza işlenecek.</small></div>" +
    '<div id="p-slot"></div>' +
    '<div class="form-grid">' +
      '<label class="field"><span>3. Hata Kaynağı</span><select class="input" id="d-src">' +
        '<option value="">— seçiniz —</option>' +
        srcs.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join("") + "</select></label>" +
      '<label class="field"><span>Oluşum Yeri (isteğe bağlı)</span><select class="input" id="d-org">' +
        '<option value="">—</option>' +
        orgs.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join("") + "</select></label>" +
      '<label class="field"><span>Parça Kodu (varsa)</span><input class="input" id="d-pcode"></label>' +
      '<label class="field"><span>Parça Adı (varsa)</span><input class="input" id="d-pname"></label>' +
      '<label class="field field-wide"><span>Nerede giderilecek?</span>' +
        '<select class="input" id="d-assign"><option value="">Normal akış — sıradaki rework istasyonu</option>' +
        isSteps.map(function (x) {
          return '<option value="' + esc(x.id) + '">' + esc(x.code + " — " + x.name) + "</option>";
        }).join("") + "</select>" +
        '<small class="field-hint">Belirli bir istasyon seçerseniz traktör oraya iş emri olarak düşer ' +
        've iş bitince buraya geri döner. Sevke hazır bekleyen traktörde çıkan boya/pas ' +
        "hataları için bunu kullanın.</small></label>" +
    "</div>" +
    '<div id="d-photos"></div></div>');
  $("#p-slot", body).appendChild(picker.el);
  // Fotoğraf isteğe bağlı: eldivenli biri hızlıca kaydetmek isteyebilir,
  // yolunu kesmeyiz. Seçerse kayıt açıldıktan sonra yüklenir.
  const fotoSecici = photoPicker($("#d-photos", body));

  // Öneri seçilince kaynak alanı da dolar (Excel'de aynı hata hep aynı kaynaktan)
  picker.onPick(function (it) {
    const sel = $("#d-src", body);
    if (it.s && !sel.value && srcs.indexOf(it.s) !== -1) sel.value = it.s;
  });

  modal({
    title: "Hata Kaydı Aç", body: body,
    // Yedi alanlık bir kayıt: ıskalanan bir dokunuşla kaybolmasın.
    draftKey: "hata:" + tractorId,
    buttons: [{ label: "Vazgeç" }, {
      label: "⚠ Hatayı Kaydet", cls: "btn-danger",
      onClick: async function () {
        const desc = picker.getDescription();
        const cat = picker.getCategory();
        if (desc.length < 2) { toast("Hata tanımı yazın veya listeden seçin.", "err"); return "keep"; }
        if (!cat) { toast("Hata kategorisi seçin.", "err"); return "keep"; }
        try {
          const src = $("#d-src", body).value || picker.getSource() || null;
          const defectId = await flow.addDefect(tractorId, {
            category: cat, description: desc, detectedStepId: t.currentStepId,
            source: src, originLocation: $("#d-org", body).value || null,
            partCode: $("#d-pcode", body).value, partName: $("#d-pname", body).value,
            assignStepId: $("#d-assign", body).value || null
          });
          const yeni = picker.isNew();
          await catalogRemember(desc, cat, src);
          toast(yeni ? "Hata kaydedildi — yeni tanım olarak listeye eklendi." : "Hata kaydedildi.", "ok");
          // Fotoğraflar kayıt AÇILDIKTAN sonra yüklenir: dosya yolu hata
          // kimliğini içeriyor. Yükleme başarısız olursa kalite kaydı yerinde
          // kalır — fotoğraf yüzünden hata kaydı kaybolmaz.
          const fotolar = fotoSecici ? fotoSecici.files() : [];
          if (fotolar.length && defectId) {
            try {
              await yukleVeBagla(defectId, fotolar, function (mesaj) { toast(mesaj, "ok"); });
              toast(fotolar.length + " fotoğraf eklendi.", "ok");
            } catch (e) {
              toast("Hata kaydedildi ama fotoğraf yüklenemedi: " +
                    ((e && e.message) || "") + " Kayıttan tekrar deneyebilirsiniz.", "err");
            }
          }
          if (onDone) onDone();
        } catch (e) { err(e); return "keep"; }
      }
    }]
  });
  picker.focus();
}

/* ================= hata düzenleme / iptal ================= */

export function openDefectEditDialog(d, onDone) {
  const srcs = data.lookups.hata_kaynagi || [];
  const orgs = data.lookups.olusum_yeri || [];
  const steps = activeSteps();
  const picker = descriptionPicker({ description: d.description, category: d.category, source: d.source });

  const body = el('<div>' +
    '<div class="banner info" style="margin-top:0"><strong>' + esc(d.chassisNo || "") + "</strong> · " +
      esc(d.detectedStepCode || "") + "<br><small>Kaydı açan: " + esc(d.detectedByName || "—") +
      " · " + fmtDate(d.detectedAt) +
      (d.editCount ? " · " + d.editCount + " kez düzenlendi" : "") +
      "<br>Yaptığınız değişiklik eski ve yeni değeriyle denetim kaydına yazılacak.</small></div>" +
    '<div id="p-slot"></div>' +
    '<div class="form-grid">' +
      '<label class="field"><span>Şasi No</span>' +
        '<input class="input" id="e-chassis" list="e-chassis-list" autocomplete="off" value="' +
          esc(d.chassisNo || "") + '"><datalist id="e-chassis-list"></datalist>' +
        '<small class="field-hint" id="e-chassis-hint">Değiştirirseniz bu hata kaydı o traktöre taşınır.</small></label>' +
      '<label class="field"><span>Tespit Edilen İstasyon</span><select class="input" id="e-step">' +
        steps.map(function (s) {
          return '<option value="' + esc(s.id) + '"' + (s.id === d.detectedStepId ? " selected" : "") +
                 ">" + esc(s.code + " — " + s.name) + "</option>";
        }).join("") + "</select></label>" +
      '<label class="field"><span>Hata Kaynağı</span><select class="input" id="e-src">' +
        '<option value="">— seçiniz —</option>' +
        srcs.map(function (s) {
          return "<option" + (s === d.source ? " selected" : "") + ">" + esc(s) + "</option>";
        }).join("") + "</select></label>" +
      '<label class="field"><span>Oluşum Yeri</span><select class="input" id="e-org">' +
        '<option value="">—</option>' +
        orgs.map(function (s) {
          return "<option" + (s === d.originLocation ? " selected" : "") + ">" + esc(s) + "</option>";
        }).join("") + "</select></label>" +
      '<label class="field"><span>Parça Kodu</span><input class="input" id="e-pcode" value="' + esc(d.partCode || "") + '"></label>' +
      '<label class="field"><span>Parça Adı</span><input class="input" id="e-pname" value="' + esc(d.partName || "") + '"></label>' +
      '<label class="field field-wide"><span>Not</span><input class="input" id="e-note" value="' + esc(d.note || "") + '"></label>' +
    "</div></div>");
  $("#p-slot", body).appendChild(picker.el);

  // Şasi alanı: yazdıkça kayıtlı traktörleri önerir, sistemde yoksa uyarır.
  const chIn = $("#e-chassis", body), chHint = $("#e-chassis-hint", body), chList = $("#e-chassis-list", body);
  chIn.oninput = function () {
    const v = normChassis(chIn.value);
    chHint.classList.remove("hint-ok", "hint-err");
    chList.innerHTML = findTractors(v, 10).map(function (t) {
      return '<option value="' + esc(t.chassisNo) + '">';
    }).join("");
    if (!v || v === normChassis(d.chassisNo)) {
      chHint.textContent = "Değiştirirseniz bu hata kaydı o traktöre taşınır."; return;
    }
    if (tractorByChassis(v)) {
      chHint.textContent = "Kayıt " + v + " traktörüne taşınacak.";
      chHint.classList.add("hint-ok");
    } else {
      chHint.textContent = v + " kayıtlı değil. Traktörün kendi numarası yanlışsa traktör kartından düzeltin.";
      chHint.classList.add("hint-err");
    }
  };

  modal({
    title: "Hata Kaydını Düzenle", body: body,
    buttons: [{ label: "Vazgeç" }, {
      label: "Değişikliği Kaydet", cls: "btn-primary",
      onClick: async function () {
        const chassis = normChassis(chIn.value);
        if (!chassis) { toast("Şasi no boş olamaz.", "err"); return "keep"; }
        if (!picker.getCategory()) { toast("Hata kategorisi seçin.", "err"); return "keep"; }
        if (chassis !== normChassis(d.chassisNo)) {
          const ok = await confirmDialog("Kayıt başka traktöre taşınacak",
            "Bu hata kaydı " + d.chassisNo + " traktöründen çıkarılıp " + chassis +
            " traktörüne eklenecek. Devam edilsin mi?", "Evet, taşı");
          if (!ok) return "keep";
        }
        try {
          const r = await flow.editDefect(d.id, {
            category: picker.getCategory(),
            description: picker.getDescription(),
            chassisNo: chassis,
            detectedStepId: $("#e-step", body).value,
            source: $("#e-src", body).value || null,
            originLocation: $("#e-org", body).value || null,
            partCode: $("#e-pcode", body).value,
            partName: $("#e-pname", body).value,
            note: $("#e-note", body).value
          });
          if (r.changed) await catalogRemember(picker.getDescription(), picker.getCategory(), $("#e-src", body).value || null);
          toast(r.changed ? r.changed + " alan güncellendi." : "Değişiklik yok.", "ok");
          if (onDone) onDone();
        } catch (e) { err(e); return "keep"; }
      }
    }]
  });
}

export function openDefectCancelDialog(d, onDone) {
  const body = el('<div>' +
    '<div class="banner" style="margin-top:0"><strong>Kayıt listelerden ve raporlardan çıkarılacak.</strong><br>' +
      "Veritabanından tamamen silinmez: kimin, ne zaman, hangi sebeple kaldırdığı kayıtta ve " +
      "denetim kaydında kalır. Yanlışlıkla kaldırırsanız <em>Hata Kayıtları → İptal edilenler</em> " +
      "görünümünden geri alabilirsiniz.</div>" +
    '<p style="margin:0 0 10px"><strong>' + esc(d.chassisNo || "") + "</strong> — " + esc(d.description || "") + "</p>" +
    '<label class="field"><span>Kaldırma sebebi (zorunlu)</span>' +
      '<textarea class="input" id="c-reason" rows="3" placeholder="Örn: yanlış traktöre açılmış, aynı hata iki kez girilmiş…"></textarea></label></div>');
  modal({
    title: "Hata Kaydını Sil", body: body,
    buttons: [{ label: "Vazgeç" }, {
      label: "Sil", cls: "btn-danger",
      onClick: async function () {
        try {
          await flow.cancelDefect(d.id, $("#c-reason", body).value);
          toast("Kayıt kaldırıldı.", "ok");
          if (onDone) onDone();
        } catch (e) { err(e); return "keep"; }
      }
    }]
  });
}

function defectActionButtons(d) {
  if (!can(["hata_duzenle"])) return "";
  if (d.status === "iptal") return '<button class="btn btn-sm" data-dact="restore">↩ Geri Al</button>';
  return '<button class="btn btn-sm" data-dact="edit">Düzenle</button>' +
         '<button class="btn btn-danger btn-sm" data-dact="cancel">Sil</button>';
}

// Traktör kartından da iş akışı yürütülebilsin: kuyruğa gitmeden üzerine al,
// bitir, onayla. Kişinin rolüne göre yalnızca yapabileceği düğme görünür.
function defectWorkflowButtons(d) {
  if (d.status === "acik" && can(["rework", "kontrol"]))
    return '<button class="btn btn-primary btn-sm" data-dact="take">Üzerime Al</button>';
  if (d.status === "reworkta" && d.reworkBy === myEmail())
    return '<button class="btn btn-success btn-sm" data-dact="complete">✓ Bitti</button>';
  if (d.status === "rework_tamam" && can(["onay", "kontrol"]))
    return '<button class="btn btn-success btn-sm" data-dact="approve">✓ Onayla</button>' +
           '<button class="btn btn-danger btn-sm" data-dact="reject">✗ Reddet</button>';
  return "";
}

/* ================= 5. Traktörler ================= */

let trFilter = { q: "", status: "" };

export function traktorler(view, _p, rerender) {
  const q = trFilter.q.toUpperCase();
  let rows = data.tractors.slice();
  if (q) {
    rows = rows.filter(function (t) {
      return [t.chassisNo, t.saleCode, t.engineNo, t.cabinKeyNo]
        .some(function (v) { return String(v || "").toUpperCase().indexOf(q) !== -1; });
    });
  }
  if (trFilter.status) rows = rows.filter(function (t) { return t.status === trFilter.status; });
  rows.sort(function (a, b) { return new Date(b.rollDownAt || 0) - new Date(a.rollDownAt || 0); });

  view.innerHTML =
    '<div class="page-head"><div><h2>Traktörler</h2><p>' + rows.length + " kayıt</p></div>" +
      '<div class="spacer"></div>' +
      (can(["operator", "kontrol", "onay"])
        ? '<button class="btn btn-primary" id="tr-new">+ Traktör Ekle</button>' : "") + "</div>" +
    '<div class="card"><div class="form-grid">' +
      '<label class="field"><span>Ara</span><input class="input" id="tr-q" placeholder="Şasi, satış kodu, motor no…" value="' + esc(trFilter.q) + '"></label>' +
      '<label class="field"><span>Durum</span><select class="input" id="tr-st">' +
        '<option value="">Tümü</option>' +
        ["devam", "beklemede", "sevke_hazir", "sevk_edildi"].map(function (s) {
          return '<option value="' + s + '"' + (trFilter.status === s ? " selected" : "") + ">" +
                 esc({ devam: "Hatta / İşlemde", beklemede: "Beklemede", sevke_hazir: "Sevke Hazır", sevk_edildi: "Sevk Edildi" }[s]) +
                 "</option>";
        }).join("") + "</select></label>" +
    "</div></div>" +
    (rows.length ? '<div class="tlist">' + rows.slice(0, 300).map(function (t) {
      return tractorCard(t, '<button class="btn btn-sm" data-act="open">Detay</button>');
    }).join("") + "</div>" : emptyBox("Kayıt bulunamadı.", "🚜"));

  const qi = $("#tr-q", view);
  if (qi) {
    let tmr = null;
    qi.oninput = function () {
      clearTimeout(tmr);
      tmr = setTimeout(function () { trFilter.q = qi.value; rerender(); }, 250);
    };
  }
  const st = $("#tr-st", view);
  if (st) st.onchange = function () { trFilter.status = st.value; rerender(); };
  const nb = $("#tr-new", view);
  if (nb) nb.onclick = function () { newTractorDialog(rerender); };
  bindTractorCards(view, rerender);
}

function newTractorDialog(onDone, presetChassis) {
  // Şasi ve satış kodu kritik: yanlış yazılırsa traktörün bütün geçmişi
  // yanlış kayda işlenir. Bu yüzden ikisi de elle yazılmak zorunda değil —
  // şasi barkoddan birebir gelir, satış kodu etiket fotoğrafından okunur ve
  // daha önce kullanılmış kodlarla karşılaştırılır. İkisi de düzenlenebilir.
  const bilinenKodlar = [];
  data.tractors.forEach(function (t) {
    const c = String(t.saleCode || "").trim().toUpperCase();
    if (c && bilinenKodlar.indexOf(c) === -1) bilinenKodlar.push(c);
  });
  bilinenKodlar.sort();

  const body = el('<div>' +
    (cameraSupported()
      ? '<button type="button" class="btn btn-primary btn-lg btn-block" id="n-read">' +
          "📷 Etiketi Oku</button>" +
        '<small class="field-hint" id="n-read-hint" style="display:block;margin:6px 0 14px">' +
          "Tek fotoğraf yeter: şasi ve satış kodu birlikte okunur. Üç satırın " +
          "üçü de kadraja girsin.</small>"
      : "") +
    '<div class="form-grid">' +
      '<label class="field field-wide"><span>Şasi No *</span>' +
        '<input class="input input-lg" id="n-ch" autocomplete="off" autocapitalize="characters" ' +
          'inputmode="latin" value="' + esc(presetChassis || "") + '">' +
        '<small class="field-hint" id="n-ch-hint">17 hane, MEA ile başlar. ' +
          "Okunduktan sonra etiketle karşılaştırın.</small></label>" +
      '<label class="field"><span>Satış Kodu</span>' +
        '<input class="input" id="n-sc" list="n-sc-list" autocomplete="off" autocapitalize="characters">' +
        '<datalist id="n-sc-list">' + bilinenKodlar.map(function (c) {
          return '<option value="' + esc(c) + '">';
        }).join("") + "</datalist>" +
        '<small class="field-hint" id="n-sc-hint">Fotoğraftan okunursa kontrol edin.</small></label>' +
      '<label class="field"><span>Kabin Anahtar No</span><input class="input" id="n-ck" autocomplete="off"></label>' +
    "</div></div>");

  const chIn = $("#n-ch", body), scIn = $("#n-sc", body);
  const chHint = $("#n-ch-hint", body), scHint = $("#n-sc-hint", body);

  // TEK fotoğraf, iki alan. Etiketteki barkod fabrikada silik basılıyor ve
  // güvenilir okunmuyordu; yazıdan okumak (OCR) daha sağlam çıktı.
  const readBtn = $("#n-read", body);
  if (readBtn) readBtn.onclick = async function () {
    readBtn.disabled = true;
    const rHint = $("#n-read-hint", body);
    rHint.textContent = "Okunuyor…";
    rHint.className = "field-hint";
    try {
      const text = await scanText();
      if (text == null) { rHint.textContent = "Okuma iptal edildi."; return; }
      const r = extractLabel(text, bilinenKodlar, "MEA");

      if (r.chassis) {
        chIn.value = r.chassis;
        const uyari = sasiUyari(r.chassis, "MEA");
        chHint.textContent = uyari
          ? "Okundu: " + r.chassis + " — " + uyari
          : "Okundu: " + r.chassis + " — etiketle bir kez karşılaştırın.";
        chHint.className = "field-hint " + (uyari ? "hint-err" : "hint-ok");
      } else {
        // Motor numarasından parça kesip şasi uydurmaktansa boş bırakırız.
        chHint.textContent = "Şasi okunamadı — 17 haneyi elle yazın. " +
          "(Etiketteki 22 haneli numara motor numarasıdır, şasi değil.)";
        chHint.className = "field-hint hint-err";
      }

      if (r.saleCode) {
        scIn.value = r.saleCode;
        const tanidik = bilinenKodlar.indexOf(r.saleCode) !== -1;
        scHint.textContent = tanidik
          ? "Okundu: " + r.saleCode + " — daha önce kullanılmış bir kod."
          : "Okundu: " + r.saleCode + " — bu kod ilk kez kullanılıyor, kontrol edin.";
        scHint.className = "field-hint " + (tanidik ? "hint-ok" : "");
      } else if (!scIn.value) {
        scHint.textContent = "Satış kodu okunamadı, elle yazın.";
        scHint.className = "field-hint hint-err";
      }

      rHint.textContent = (r.chassis && r.saleCode)
        ? "İkisi de okundu. Kontrol edip kaydedin."
        : "Eksik kalan alanı elle tamamlayın ya da daha yakından tekrar çekin.";
      if (!r.chassis) chIn.focus();
    } catch (e) { err(e); rHint.textContent = "Okunamadı: " + ((e && e.message) || ""); }
    finally { readBtn.disabled = false; }
  };

  modal({
    title: "Yeni Traktör", body: body,
    buttons: [{ label: "Vazgeç" }, {
      label: "Kaydet", cls: "btn-primary",
      onClick: async function () {
        // Aynı sonla biten bir traktör zaten hattaysa büyük ihtimalle aynı
        // traktör: operatör 6 haneyi, öbürü tamamını yazmış olabilir.
        const ch = normChassis(chIn.value);
        const benzer = findTractors(ch.length > 6 ? ch.slice(-6) : ch, 3).filter(function (t) {
          return t.chassisNo !== ch && t.status !== "sevk_edildi";
        });
        if (ch.length >= 4 && benzer.length) {
          const ok = await confirmDialog("Benzer numara kayıtlı",
            benzer.map(function (t) { return t.chassisNo; }).join(", ") +
            " numaralı traktör zaten hatta. Bu YENİ bir traktörse devam edin; aynı traktörse vazgeçip listeden açın.",
            "Yeni traktör olarak ekle");
          if (!ok) return "keep";
        }
        try {
          const id = await flow.createTractor({
            chassisNo: chIn.value,
            saleCode: scIn.value,
            cabinKeyNo: $("#n-ck", body).value
          });
          toast("Traktör eklendi.", "ok");
          if (onDone) onDone();
          go("#/traktor/" + id);
        } catch (e) { err(e); return "keep"; }
      }
    }]
  });
}

/* ================= 6. Traktör detayı ================= */

export async function traktor(view, params, rerender) {
  const id = params[0];
  const t = tractorById(id);
  if (!t) { view.innerHTML = emptyBox("Traktör bulunamadı.", "🚜"); return; }

  const steps = activeSteps();
  const defects = data.defects.filter(function (d) { return d.tractorId === id; })
    .sort(function (a, b) { return new Date(b.detectedAt) - new Date(a.detectedAt); });
  const open = defects.filter(function (d) { return flow.OPEN_STATES.indexOf(d.status) !== -1; }).length;
  const cur = stepById(t.currentStepId);
  let pending = flow.pendingSteps(t);
  // Traktör daha önce tamamlanmış bir adıma geri gönderildiyse o adım yeniden
  // yapılacak; listede görünmezse "her şey bitti" izlenimi verir.
  if (cur && (t.status === "devam" || t.status === "beklemede") &&
      !pending.some(function (s) { return s.code === cur.code; })) {
    pending = pending.concat([cur]).sort(function (a, b) { return a.seq - b.seq; });
  }
  const canEdit = can(["hata_duzenle"]);

  view.innerHTML =
    '<div class="page-head"><div><h2>' + esc(t.chassisNo) +
      (canEdit ? ' <button class="btn btn-ghost btn-sm" id="fix-chassis" title="Şasi numarası yanlış yazıldıysa düzeltin">✎ Şasi No</button>' : "") +
      "</h2><p>" + esc(t.saleCode || "") + (t.family ? " · " + esc(t.family) : "") +
      " · Roll Down " + fmtDate(t.rollDownAt) + "</p></div>" +
      '<div class="spacer"></div>' + statusChip(t.status) +
      '<button class="btn btn-sm" id="back-btn">← Geri</button></div>' +
    (t.holdReason ? '<div class="banner">⏸ Beklemede: ' + esc(t.holdReason) + "</div>" : "") +
    '<div class="kpi-grid">' +
      kpi("Bulunduğu Adım", cur ? cur.code : "—", cur ? cur.name : "") +
      kpi("Bu Adımda", fmtMin(flow.minutesHere(t)),
          cur && cur.targetMinutes ? "hedef " + cur.targetMinutes + " dk" : "",
          flow.isOverdue(t) ? "k-amber" : "") +
      kpi("Açık Hata", open, "kapanmamış", open ? "k-red" : "k-green") +
      kpi("Toplam Hata", defects.length, "tüm süreçte", "k-slate") +
    "</div>" +

    (t.status === "devam" || t.status === "beklemede"
      ? '<div class="card"><div class="card-head"><h3>Bulunduğu Adım — ' + esc(cur ? cur.name : "") + "</h3></div>" +
        '<div class="btn-row">' +
          (!t.currentStartedAt
            ? '<button class="btn btn-primary" id="st-start">▶ Adımı Başlat</button>'
            : '<button class="btn btn-success" id="st-finish">✓ Adımı Tamamla</button>') +
          (cur && cur.allowsDefect ? '<button class="btn btn-danger" id="add-def">⚠ Hata Ekle</button>' : "") +
          '<button class="btn" id="act-move">↪ Başka Adıma Gönder</button>' +
          (t.status === "beklemede"
            ? '<button class="btn" id="act-release">▶ Beklemeden Çıkar</button>'
            : '<button class="btn btn-warn" id="act-hold">⏸ Beklemeye Al</button>') +
        "</div></div>"
      : t.status === "sevke_hazir"
        ? '<div class="card"><div class="card-head"><h3>Sevke Hazır</h3></div>' +
          '<p class="card-sub" style="margin-bottom:10px">Bahçede beklerken boya, pas gibi bir kusur ' +
            "çıkarsa buradan hata açın; traktör seçtiğiniz istasyona iş emri olarak düşer ve iş " +
            "bitince yine sevke hazır duruma döner.</p>" +
          '<div class="btn-row">' +
            (can(["kontrol", "onay"]) ? '<button class="btn btn-danger" id="add-def">⚠ Hata Ekle</button>' : "") +
            (can(["onay"]) ? '<button class="btn btn-primary" id="act-dispatch">🚚 Sevk Edildi</button>' : "") +
          "</div></div>"
        : "") +

    (pending.length ? '<div class="card"><div class="card-head"><h3>Onay İçin Bekleyen Adımlar</h3></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + pending.map(function (s) {
        return '<span class="chip chip-amber">' + s.seq + ". " + esc(s.name) + "</span>";
      }).join("") + "</div></div>" : "") +

    '<div class="card"><div class="card-head"><h3>Adım Geçmişi</h3></div><div class="timeline">' +
      steps.map(function (s) {
        const rec = (t.steps || {})[s.code];
        const wasDone = !!rec && flow.COMPLETED_RESULTS.indexOf(rec.result) !== -1;
        // Hatası olmayan rework istasyonu atlanır; çizelgede "bekliyor" gibi
        // durmasın, neden uğranmadığı yazsın.
        const atlandi = !!rec && rec.result === flow.SKIPPED;
        // Traktör ŞU AN bu adımdaysa, daha önce tamamlanmış olsa bile yeniden
        // yapılacak demektir. Yeşil göstermek "burada işim bitti" anlamına
        // gelirdi; geri gönderilen adım turuncu, ilk kez gelinen adım mavi.
        const isCur = !!cur && cur.code === s.code &&
                      (t.status === "devam" || t.status === "beklemede");
        const redo = isCur && wasDone;
        const done = wasDone && !isCur;
        return '<div class="tl-item ' + (done ? "done" : "") + (atlandi ? " skipped" : "") +
          (isCur ? (redo ? " redo" : " current") : "") + '">' +
          '<div class="tl-title">' + s.seq + ". " + esc(s.name) +
            ' <span style="color:var(--muted);font-weight:500">' + esc(s.code) + "</span>" +
            (redo ? ' <span class="chip chip-amber">tekrar yapılacak</span>' : "") + "</div>" +
          '<div class="tl-meta">' +
            (done ? fmtDate(rec.finishedAt) + " · " + esc(rec.operatorName || "—") +
                    " · bekleme " + fmtMin(rec.wait) + ", işlem " + fmtMin(rec.work)
                  : isCur ? '<span style="color:' + (redo ? "var(--amber)" : "var(--blue)") +
                            ';font-weight:600">Şu an burada — ' + fmtMin(flow.minutesHere(t)) + "</span>" +
                            (redo ? "<br>önceki tamamlanma: " + fmtDate(rec.finishedAt) +
                                    " · " + esc(rec.operatorName || "—") : "")
                  : atlandi ? "Atlandı — bu traktörde giderilecek hata yoktu"
                          : "Bekliyor") +
          "</div></div>";
      }).join("") + "</div></div>" +

    '<div class="card"><div class="card-head"><h3>Hata Kayıtları</h3><div class="spacer"></div>' +
      (cur && cur.allowsDefect && can(["kontrol", "onay"])
        ? '<button class="btn btn-danger btn-sm" id="add-def2">⚠ Hata Ekle</button>' : "") + "</div>" +
      (defects.length ? '<div class="table-wrap"><table class="data"><thead><tr>' +
        "<th>Tanım</th><th>Durum</th><th>Tespit</th><th>Rework</th><th></th></tr></thead><tbody>" +
        defects.map(function (d) {
          return '<tr data-d="' + esc(d.id) + '">' +
            "<td><strong>" + esc(d.description) + "</strong><br>" +
              '<span class="card-sub">' + esc(d.category) + "</span>" +
              (d.editCount ? '<br><span class="card-sub">✎ ' + d.editCount + " kez düzenlendi</span>" : "") +
              (d.status === "iptal" ? '<br><span class="card-sub">🗑 ' + esc(d.cancelledByName || "") +
                                      " sildi: " + esc(d.cancelReason || "") + "</span>" : "") +
              photoStrip(d) + "</td>" +
            "<td>" + defectChip(d.status) + "</td>" +
            "<td>" + esc(d.detectedByName || "—") + "<br><span class='card-sub'>" +
              esc(d.detectedStepCode || "") + " · " + fmtDate(d.detectedAt, false) + "</span></td>" +
            "<td>" + esc(d.reworkByName || "—") + "</td>" +
            '<td><div class="btn-row">' + defectWorkflowButtons(d) + defectActionButtons(d) + "</div></td></tr>";
        }).join("") + "</tbody></table></div>"
        : emptyBox("Hata kaydı yok — hatasız üretim.", "✅")) +
    "</div>";

  $("#back-btn", view).onclick = function () {
    if (window.history.length > 1) window.history.back(); else go("#/traktorler");
  };
  bindDefectCards(view, rerender);

  const fix = $("#fix-chassis", view);
  if (fix) fix.onclick = function () { chassisFixDialog(t, defects.length, rerender); };

  [["#add-def", 0], ["#add-def2", 0]].forEach(function (pair) {
    const n = $(pair[0], view);
    if (n) n.onclick = function () { openDefectDialog(id, rerender); };
  });

  const s1 = $("#st-start", view);
  if (s1) s1.onclick = async function () {
    try { await flow.startWork(id); toast("Adım başlatıldı.", "ok"); rerender(); } catch (e) { err(e); }
  };
  const s2 = $("#st-finish", view);
  if (s2) s2.onclick = async function () {
    try {
      const r = await flow.finishStep(id, "ok");
      toast(r.next ? "Tamamlandı → sıradaki adım: " + r.next
                   : "Tüm adımlar bitti — traktör sevke hazır!", "ok");
      rerender();
    } catch (e) { err(e); }
  };
  const hold = $("#act-hold", view);
  if (hold) hold.onclick = function () {
    const reasons = data.lookups.hold_reason || [];
    const b = el('<label class="field"><span>Bekletme sebebi</span><select class="input" id="h-r">' +
      reasons.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select></label>");
    modal({ title: "Beklemeye Al", body: b, buttons: [{ label: "Vazgeç" }, {
      label: "Beklemeye Al", cls: "btn-warn",
      onClick: async function () {
        try { await flow.holdTractor(id, $("#h-r", b).value); toast("Beklemeye alındı.", "ok"); rerender(); }
        catch (e) { err(e); return "keep"; }
      } }] });
  };
  const rel = $("#act-release", view);
  if (rel) rel.onclick = async function () {
    try { await flow.releaseTractor(id); toast("Beklemeden çıkarıldı.", "ok"); rerender(); } catch (e) { err(e); }
  };
  const mv = $("#act-move", view);
  if (mv) mv.onclick = function () {
    const b = el('<div><label class="field"><span>Hangi adıma gönderilsin?</span>' +
      '<select class="input" id="m-s">' + steps.map(function (s) {
        return '<option value="' + esc(s.id) + '">' + s.seq + ". " + esc(s.code) + " — " + esc(s.name) + "</option>";
      }).join("") + "</select></label>" +
      '<label class="field"><span>Açıklama</span><input class="input" id="m-n" placeholder="Sebep"></label></div>');
    modal({ title: "Başka Adıma Gönder", body: b, buttons: [{ label: "Vazgeç" }, {
      label: "Gönder", cls: "btn-primary",
      onClick: async function () {
        try {
          await flow.moveToStep(id, $("#m-s", b).value, $("#m-n", b).value || null);
          toast("Yönlendirildi.", "ok"); rerender();
        } catch (e) { err(e); return "keep"; }
      } }] });
  };
  const dis = $("#act-dispatch", view);
  if (dis) dis.onclick = async function () {
    if (await confirmDialog("Sevk Onayı", "Bu traktör sevk edildi olarak işaretlensin mi?", "Sevk Et")) {
      try { await flow.dispatchTractor(id); toast("Sevk edildi.", "ok"); rerender(); } catch (e) { err(e); }
    }
  };
}

function chassisFixDialog(t, defectCount, onDone) {
  const body = el('<div>' +
    '<div class="banner" style="margin-top:0"><strong>Bu traktörün numarası değişecek — kayıt bölünmez.</strong><br>' +
      "Adım geçmişi ve " + defectCount + " hata kaydı olduğu gibi yeni numaranın altında kalır. " +
      "Hata YANLIŞ traktöre yazıldıysa burası değil, hata satırındaki <em>Düzenle</em> ekranındaki " +
      "şasi alanı kullanılır.</div>" +
    '<p style="margin:0 0 10px">Şu anki numara: <strong>' + esc(t.chassisNo) + "</strong></p>" +
    '<label class="field"><span>Doğru şasi no</span><input class="input" id="fc-no" value="' + esc(t.chassisNo) + '"></label>' +
    '<label class="field"><span>Düzeltme sebebi (zorunlu)</span>' +
      '<input class="input" id="fc-reason" placeholder="Örn: kayıt sırasında son hane eksik yazılmış"></label></div>');
  modal({
    title: "Şasi Numarasını Düzelt", body: body,
    buttons: [{ label: "Vazgeç" }, {
      label: "Düzelt", cls: "btn-primary",
      onClick: async function () {
        try {
          const r = await flow.fixChassis(t.id, $("#fc-no", body).value, $("#fc-reason", body).value);
          toast(r.changed
            ? "Şasi no " + r.chassisNo + " olarak düzeltildi (" + r.defects + " hata kaydı birlikte taşındı)."
            : "Numara aynı — değişiklik yok.", "ok");
          if (onDone) onDone();
        } catch (e) { err(e); return "keep"; }
      }
    }]
  });
}

/* ================= 7. Hata Kayıtları ================= */

let dfFilter = { status: "", days: 30, cancelled: false };

export function hatalar(view, _p, rerender) {
  if (dfFilter.days > RECENT_DAYS) {
    ensureHistory(dfFilter.days).then(function (loaded) { if (loaded) rerender(); }).catch(function () {});
  }
  const since = Date.now() - dfFilter.days * 86400000;
  let rows = data.defects.filter(function (d) {
    return new Date(d.detectedAt || 0).getTime() >= since;
  });
  rows = dfFilter.cancelled
    ? rows.filter(function (d) { return d.status === "iptal"; })
    : rows.filter(function (d) { return d.status !== "iptal"; });
  if (dfFilter.status) {
    rows = dfFilter.status === "acik_tumu"
      ? rows.filter(function (d) { return flow.OPEN_STATES.indexOf(d.status) !== -1; })
      : rows.filter(function (d) { return d.status === dfFilter.status; });
  }
  rows.sort(function (a, b) { return new Date(b.detectedAt) - new Date(a.detectedAt); });

  view.innerHTML =
    '<div class="page-head"><div><h2>Hata Kayıtları</h2><p>' + rows.length + " kayıt</p></div></div>" +
    '<div class="card"><div class="form-grid">' +
      '<label class="field"><span>Durum</span><select class="input" id="f-st">' +
        [["", "Tümü"], ["acik_tumu", "Açık (tüm aşamalar)"], ["acik", "Açık"],
         ["reworkta", "Rework Yapılıyor"], ["rework_tamam", "Onay Bekliyor"], ["onaylandi", "Onaylandı"]]
        .map(function (o) {
          return '<option value="' + o[0] + '"' + (dfFilter.status === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
        }).join("") + "</select></label>" +
      '<label class="field"><span>Dönem</span><select class="input" id="f-dy">' +
        [7, 30, 90, 180, 365].map(function (d) {
          return '<option value="' + d + '"' + (dfFilter.days === d ? " selected" : "") + ">Son " + d + " gün</option>";
        }).join("") + "</select></label>" +
      '<label class="field"><span>Görünüm</span><select class="input" id="f-cancel">' +
        '<option value="0"' + (dfFilter.cancelled ? "" : " selected") + ">Geçerli kayıtlar</option>" +
        '<option value="1"' + (dfFilter.cancelled ? " selected" : "") + ">İptal edilenler</option></select></label>" +
    "</div></div>" +
    (rows.length ? '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>Tarih</th><th>Şasi</th><th>Tanım</th><th>Kategori</th><th>İstasyon</th>" +
      "<th>Yazan</th><th>Rework</th><th>Durum</th><th></th></tr></thead><tbody>" +
      rows.slice(0, 400).map(function (d) {
        return '<tr class="clickable" data-d="' + esc(d.id) + '">' +
          "<td>" + fmtDate(d.detectedAt) + "</td>" +
          "<td><strong>" + esc(d.chassisNo || "") + "</strong></td>" +
          "<td>" + esc(d.description) +
            (d.editCount ? ' <span class="card-sub">✎ ' + d.editCount + "</span>" : "") +
            photoStrip(d) + "</td>" +
          "<td>" + esc(d.category) + "</td>" +
          "<td>" + esc(d.detectedStepCode || "") + "</td>" +
          "<td>" + esc(d.detectedByName || "") + "</td>" +
          "<td>" + esc(d.reworkByName || "—") + "</td>" +
          "<td>" + defectChip(d.status) +
            (d.status === "iptal" ? '<br><span class="card-sub">' + esc(d.cancelReason || "") + "</span>" : "") + "</td>" +
          '<td><div class="btn-row">' + defectActionButtons(d) + "</div></td></tr>";
      }).join("") + "</tbody></table></div>"
      : emptyBox("Kayıt bulunamadı.", "🔍"));

  $("#f-st", view).onchange = function (e) { dfFilter.status = e.target.value; rerender(); };
  $("#f-dy", view).onchange = function (e) { dfFilter.days = Number(e.target.value); rerender(); };
  $("#f-cancel", view).onchange = function (e) { dfFilter.cancelled = e.target.value === "1"; rerender(); };
  bindDefectCards(view, rerender);
  $$("tr[data-d]", view).forEach(function (tr) {
    tr.onclick = function (ev) {
      if (ev.target.closest("[data-dact]")) return;
      const d = data.defects.find(function (x) { return x.id === tr.dataset.d; });
      if (d) go("#/traktor/" + d.tractorId);
    };
  });
}

/* ================= 8. Onaysız traktörler ================= */

export function onaysiz(view, _p, rerender) {
  const rows = data.tractors.filter(function (t) {
    return t.status === "devam" || t.status === "beklemede";
  }).sort(function (a, b) { return new Date(a.rollDownAt || 0) - new Date(b.rollDownAt || 0); });

  view.innerHTML =
    '<div class="page-head"><div><h2>Onaysız Traktörler</h2>' +
      "<p>" + rows.length + " traktör hatta — tüm adımları tamamlanmadı</p></div></div>" +
    (rows.length ? '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>Şasi</th><th>Roll Down</th><th>Bulunduğu Adım</th><th>Bekleyen Adımlar</th>" +
      "<th>Açık Hata</th><th>Durum</th></tr></thead><tbody>" +
      rows.map(function (t) {
        const cur = stepById(t.currentStepId);
        const pend = flow.pendingSteps(t);
        const open = flow.openDefects(t.id).length;
        return '<tr class="clickable" data-go="' + esc(t.id) + '">' +
          "<td><strong>" + esc(t.chassisNo) + "</strong></td>" +
          "<td>" + fmtDate(t.rollDownAt, false) + "</td>" +
          "<td>" + esc(cur ? cur.code : "—") + "</td>" +
          "<td>" + pend.slice(0, 4).map(function (s) {
            return '<span class="chip chip-amber">' + s.seq + ". " + esc(s.code) + "</span>";
          }).join(" ") + (pend.length > 4 ? " +" + (pend.length - 4) : "") + "</td>" +
          "<td>" + (open ? '<span class="chip chip-red">' + open + "</span>" : "—") + "</td>" +
          "<td>" + statusChip(t.status) + "</td></tr>";
      }).join("") + "</tbody></table></div>"
      : emptyBox("Hatta onaysız traktör yok.", "✅"));

  $$("[data-go]", view).forEach(function (n) {
    n.onclick = function () { go("#/traktor/" + n.dataset.go); };
  });
}
