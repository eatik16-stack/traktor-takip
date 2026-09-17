// Ortak arayüz parçaları: pencere, onay, KPI kartı, durum rozeti, çubuk grafik.

import { $, esc, el, fmtNum } from "./util.js";

/* ---------------- pencere ---------------- */

// Yarım kalan pencere içerikleri. Sayfa yenilenince silinir; kalıcı olması
// istenmiyor — amaç ıskalanan bir dokunuşu kurtarmak, eski bir kaydı
// günler sonra diriltmek değil.
const TASLAKLAR = {};

// buttons: [{label, cls, onClick}] — onClick "keep" döndürürse pencere kapanmaz.
//
// opts.dirty: () => bool — doluysa perdeye dokunmak ya da Escape pencereyi
// KAPATMAZ, önce sorar. Eldivenle, tek elle çalışan biri için hedefi ıskalayan
// bir dokunuş olağan bir olay; yarım kalmış hata kaydı öyle kaybolmamalı.
export function modal(opts) {
  const host = $("#modal-host");
  const back = el('<div class="modal-back"><div class="modal">' +
    '<div class="modal-head"><h3></h3><button class="modal-close" aria-label="Kapat">&times;</button></div>' +
    '<div class="modal-body"></div><div class="modal-foot"></div></div></div>');
  $(".modal-head h3", back).textContent = opts.title || "";
  const body = $(".modal-body", back);
  if (typeof opts.body === "string") body.innerHTML = opts.body;
  else if (opts.body) body.appendChild(opts.body);

  const foot = $(".modal-foot", back);
  (opts.buttons || [{ label: "Kapat" }]).forEach(function (b) {
    const btn = el('<button class="btn ' + (b.cls || "") + '">' + esc(b.label) + "</button>");
    btn.onclick = async function () {
      if (!b.onClick) return close();
      btn.disabled = true;
      try {
        const r = await b.onClick();
        if (r !== "keep") close();
      } finally { btn.disabled = false; }
    };
    foot.appendChild(btn);
  });

  // Pencerenin doldurulmuş hâlini tek bir metne çevirir. Hem "yazdı mı?"
  // sorusunu hem de taslağı saklamayı bu yürütür; böylece her pencere için
  // ayrı ayrı kod yazmak gerekmez.
  function anlikDurum() {
    const alanlar = Array.prototype.map.call(
      body.querySelectorAll("input, select, textarea"),
      function (f) {
        return (f.type === "checkbox" || f.type === "radio") ? (f.checked ? "1" : "") : f.value;
      });
    // Kategori gibi düğmeyle seçilen alanlar form alanı değil; seçili
    // olanların işaretini de duruma katarız.
    const secimler = Array.prototype.map.call(
      body.querySelectorAll(".pick"),
      function (p) { return p.classList.contains("selected") ? "1" : "0"; });
    return alanlar.join("") + "" + secimler.join("");
  }
  function durumuUygula(kayit) {
    const p = String(kayit).split("");
    const alanlar = p[0].split("");
    const hedef = body.querySelectorAll("input, select, textarea");
    if (alanlar.length !== hedef.length) return false;
    for (let i = 0; i < hedef.length; i++) {
      const f = hedef[i];
      if (f.type === "checkbox" || f.type === "radio") f.checked = alanlar[i] === "1";
      else f.value = alanlar[i];
      f.dispatchEvent(new Event("input", { bubbles: true }));
      f.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  function close() {
    document.removeEventListener("keydown", onKey, true);
    back.remove();
  }
  // Kapatma isteği: kayıt yarım kaldıysa önce sorar.
  let soruluyor = false;
  async function tryClose() {
    if (soruluyor) return;
    const kirli = opts.dirty ? opts.dirty() : anlikDurum() !== baslangic;
    if (kirli) {
      soruluyor = true;
      const bitsin = await confirmDialog("Yarım kalan kayıt",
        opts.draftKey
          ? "Bu pencerede yazdıklarınız kaydedilmedi. Kapatırsanız saklanır, " +
            "pencereyi tekrar açtığınızda geri gelir."
          : "Bu pencerede yazdıklarınız kaydedilmedi. Kapatırsanız kaybolur.",
        "Kapat");
      soruluyor = false;
      if (!bitsin) return;
      if (opts.draftKey) TASLAKLAR[opts.draftKey] = anlikDurum();
    } else if (opts.draftKey) {
      delete TASLAKLAR[opts.draftKey];
    }
    close();
  }
  function onKey(e) {
    if (e.key !== "Escape") return;
    // En üstteki pencere kapanır; alttakiler açık kalır.
    if (back !== host.lastElementChild) return;
    e.stopPropagation();
    tryClose();
  }
  $(".modal-close", back).onclick = tryClose;
  back.addEventListener("click", function (e) { if (e.target === back) tryClose(); });
  document.addEventListener("keydown", onKey, true);
  host.appendChild(back);

  let baslangic = anlikDurum();
  // Yarım kalmış kayıt varsa geri yükle ve söyle — sessizce doldurmak,
  // kişinin yazdığını sandığı şeyle karşılaştığı bir tuzak olur.
  if (opts.draftKey && TASLAKLAR[opts.draftKey]) {
    if (durumuUygula(TASLAKLAR[opts.draftKey])) {
      delete TASLAKLAR[opts.draftKey];
      const not = el('<p class="field-hint hint-ok" style="margin:0 0 10px">' +
        "Yarım kalan kayıt geri yüklendi.</p>");
      body.insertBefore(not, body.firstChild);
      baslangic = "";   // geri yüklenen içerik "dolu" sayılır
    }
  }

  // Odak her genişlikte ilk alana gider. Telefonda da: odaklanmamış bir pencere
  // ekran okuyucuda ve klavyeli tablette kayıp bir başlangıç demek.
  const first = body.querySelector("input, select, textarea");
  if (first) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
  return { close: close, body: body };
}

export function confirmDialog(title, message, okLabel, cls) {
  return new Promise(function (resolve) {
    let done = false;
    const m = modal({
      title: title,
      body: '<p style="margin:0">' + esc(message) + "</p>",
      buttons: [
        { label: "Vazgeç", onClick: function () { done = true; resolve(false); } },
        { label: okLabel || "Evet", cls: cls || "btn-primary",
          onClick: function () { done = true; resolve(true); } }
      ]
    });
    const back = m.body.closest(".modal-back");
    back.addEventListener("click", function (e) {
      if (e.target === back && !done) { done = true; resolve(false); }
    });
    $(".modal-close", back).addEventListener("click", function () {
      if (!done) { done = true; resolve(false); }
    });
  });
}

/* ---------------- gösterge parçaları ---------------- */

export function kpi(label, value, sub, cls) {
  return '<div class="kpi ' + (cls || "") + '">' +
    '<div class="k-label">' + esc(label) + "</div>" +
    '<div class="k-value">' + esc(value) + "</div>" +
    '<div class="k-sub">' + esc(sub || "") + "</div></div>";
}

export function emptyBox(text, icon) {
  return '<div class="empty"><span class="ic">' + (icon || "📭") + "</span>" + esc(text) + "</div>";
}

export const STATUS_LABEL = {
  devam: "Hatta / İşlemde", beklemede: "Beklemede (UNAP)",
  sevke_hazir: "Sevke Hazır", sevk_edildi: "Sevk Edildi"
};
export const STATUS_CLS = {
  devam: "chip-blue", beklemede: "chip-amber",
  sevke_hazir: "chip-green", sevk_edildi: "chip-slate"
};
export function statusChip(s) {
  return '<span class="chip ' + (STATUS_CLS[s] || "") + '">' + esc(STATUS_LABEL[s] || s || "—") + "</span>";
}

export const DEFECT_LABEL = {
  acik: "Açık", reworkta: "Rework Yapılıyor", rework_tamam: "Onay Bekliyor",
  onaylandi: "Onaylandı", iptal: "İptal"
};
export const DEFECT_CLS = {
  acik: "chip-red", reworkta: "chip-amber", rework_tamam: "chip-blue",
  onaylandi: "chip-green", iptal: "chip-slate"
};
export function defectChip(s) {
  return '<span class="chip ' + (DEFECT_CLS[s] || "") + '">' + esc(DEFECT_LABEL[s] || s || "—") + "</span>";
}

/* ---------------- çubuk grafik ---------------- */

// rows: [{label, a, b}] — a bekleme, b işlem (iki seri aynı çubukta).
export function barChart(rows, labelA, labelB, unit) {
  if (!rows.length) return emptyBox("Veri yok.", "📊");
  const max = rows.reduce(function (m, r) { return Math.max(m, (r.a || 0) + (r.b || 0)); }, 0) || 1;
  const legend = labelB
    ? '<div class="legend"><span><i style="background:var(--blue)"></i>' + esc(labelA) + "</span>" +
      '<span><i style="background:var(--orange)"></i>' + esc(labelB) + "</span></div>"
    : "";
  const bars = rows.map(function (r) {
    const a = r.a || 0, b = r.b || 0;
    const total = a + b;
    return '<div class="bar-row"><span title="' + esc(r.label) + '">' + esc(r.label) + "</span>" +
      '<span class="bar-track">' +
      '<span class="bar-fill" style="width:' + (100 * a / max) + '%"></span>' +
      (b ? '<span class="bar-fill two" style="width:' + (100 * b / max) + '%"></span>' : "") +
      "</span>" +
      '<span class="bar-val">' + fmtNum(Math.round(total)) + (unit || "") + "</span></div>";
  }).join("");
  return legend + '<div class="bars">' + bars + "</div>";
}
