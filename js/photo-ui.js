// Fotoğraf arayüzü: seçme şeridi, küçük önizlemeler, tam ekran görüntüleyici.
//
// Ayrı bir dosyada duruyor ki views.js şişmesin ve fotoğraf mantığı tek
// yerde kalsın.

import { $, esc, el, toast } from "./util.js";
import { addDefectPhotos } from "./flow.js";
import * as P from "./photos.js";

/* ================= kayıt açarken: fotoğraf seçme şeridi ================= */

// Hata penceresinde kullanılır. Fotoğraflar HENÜZ yüklenmez — hata kaydı
// oluşmadan dosya yolu belli olmaz. Seçilenler bellekte bekler, kayıt
// açıldıktan sonra yüklenir.
export function photoPicker(slot) {
  const secilen = [];   // { file, url }
  const wrap = el(
    '<div class="ph-pick">' +
      '<div class="ph-strip"></div>' +
      '<button type="button" class="btn ph-add">📷 Fotoğraf Ekle</button>' +
      '<small class="field-hint">İsteğe bağlı. Telefonda kamerayı açar; ' +
        "fotoğraf küçültülerek yüklenir, konum bilgisi silinir.</small>" +
    "</div>");
  slot.appendChild(wrap);

  const strip = $(".ph-strip", wrap);

  function ciz() {
    strip.innerHTML = secilen.map(function (s, i) {
      return '<div class="ph-item"><img src="' + s.url + '" alt="">' +
        '<button type="button" class="ph-x" data-i="' + i + '" aria-label="Kaldır">&#10005;</button></div>';
    }).join("");
    Array.prototype.forEach.call(strip.querySelectorAll(".ph-x"), function (b) {
      b.onclick = function () {
        const i = +b.getAttribute("data-i");
        try { URL.revokeObjectURL(secilen[i].url); } catch (e) {}
        secilen.splice(i, 1);
        ciz();
      };
    });
  }

  $(".ph-add", wrap).onclick = function () {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.multiple = true;
    inp.setAttribute("capture", "environment");
    inp.style.position = "fixed";
    inp.style.left = "-9999px";
    document.body.appendChild(inp);
    inp.onchange = function () {
      Array.prototype.forEach.call(inp.files || [], function (f) {
        if (secilen.length >= 5) return;      // bir hataya beş fotoğraf yeter
        secilen.push({ file: f, url: URL.createObjectURL(f) });
      });
      if ((inp.files || []).length && secilen.length >= 5) {
        toast("Bir hata kaydına en fazla 5 fotoğraf eklenebilir.", "err");
      }
      inp.remove();
      ciz();
    };
    inp.click();
  };

  return {
    // Seçilen dosyalar; kayıt açıldıktan sonra yüklenir.
    files: function () { return secilen.map(function (s) { return s.file; }); },
    count: function () { return secilen.length; },
    temizle: function () {
      secilen.forEach(function (s) { try { URL.revokeObjectURL(s.url); } catch (e) {} });
      secilen.length = 0;
      ciz();
    }
  };
}

// Seçilenleri yükler ve hata kaydına künyelerini yazar.
// Yükleme başarısız olursa hata kaydı YERİNDE KALIR — fotoğraf yüzünden
// kalite kaydı kaybolmaz; kişiye söylenir, sonradan tekrar eklenebilir.
export async function yukleVeBagla(defectId, files, onDurum) {
  const kunye = [];
  for (let i = 0; i < files.length; i++) {
    if (onDurum) onDurum((i + 1) + "/" + files.length + " yükleniyor…", 0);
    try {
      const k = await P.yukleFotograf(defectId, files[i], function (oran) {
        if (onDurum) onDurum((i + 1) + "/" + files.length + " yükleniyor…", oran);
      });
      kunye.push(k);
    } catch (e) {
      throw new Error((i + 1) + ". fotoğraf yüklenemedi: " + ((e && e.message) || e));
    }
  }
  if (kunye.length) await addDefectPhotos(defectId, kunye);
  return kunye;
}

/* ================= kayıtta: küçük önizlemeler ================= */

// Hata satırında görünen şerit. Görüntüler HEMEN indirilmez; ekrana girince
// yüklenir — listede yirmi hata varsa yirmi fotoğraf boşuna inmesin.
export function photoStrip(d) {
  const foto = P.gorunur(d.photos);
  if (!foto.length) return "";
  return '<div class="ph-thumbs" data-ph="' + esc(d.id) + '">' +
    foto.map(function (f, i) {
      return '<button type="button" class="ph-thumb" data-p="' + esc(f.t) +
             '" data-i="' + i + '" aria-label="Fotoğraf ' + (i + 1) + '"></button>';
    }).join("") + "</div>";
}

// Ekrana giren önizlemeleri yükler ve tıklamayı bağlar.
export function bindPhotos(root, defectById) {
  const seritler = root.querySelectorAll(".ph-thumbs");
  if (!seritler.length) return;

  const yukle = function (btn) {
    if (btn.dataset.yuklendi) return;
    btn.dataset.yuklendi = "1";
    P.adres(btn.getAttribute("data-p")).then(function (url) {
      btn.style.backgroundImage = 'url("' + url + '")';
      btn.classList.add("on");
    }).catch(function (e) {
      try { console.warn("[foto] önizleme açılamadı", btn.getAttribute("data-p"), e); } catch (x) {}
      btn.classList.add("ph-err");
      btn.textContent = "!";
      btn.title = "Önizleme açılamadı: " + ((e && e.message) || "");
    });
  };

  const gozlemci = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(function (girenler, o) {
        girenler.forEach(function (g) {
          if (g.isIntersecting) { yukle(g.target); o.unobserve(g.target); }
        });
      }, { rootMargin: "200px" })
    : null;

  Array.prototype.forEach.call(seritler, function (s) {
    const d = defectById(s.getAttribute("data-ph"));
    Array.prototype.forEach.call(s.querySelectorAll(".ph-thumb"), function (btn) {
      gozlemci ? gozlemci.observe(btn) : yukle(btn);
      btn.onclick = function (e) {
        e.stopPropagation();
        if (d) openViewer(P.gorunur(d.photos), +btn.getAttribute("data-i"), d);
      };
    });
  });
}

/* ================= tam ekran görüntüleyici ================= */

export function openViewer(foto, index, d) {
  if (!foto || !foto.length) return;
  let i = Math.max(0, Math.min(index || 0, foto.length - 1));

  const wrap = el(
    '<div class="ph-view">' +
      '<div class="ph-view-head">' +
        "<strong></strong>" +
        '<button class="ph-view-x" aria-label="Kapat">&#10005;</button>' +
      "</div>" +
      '<div class="ph-view-stage"><img alt=""></div>' +
      '<div class="ph-view-foot">' +
        '<button class="btn ph-prev">‹ Önceki</button>' +
        '<span class="ph-view-no"></span>' +
        '<button class="btn ph-next">Sonraki ›</button>' +
      "</div>" +
      '<p class="ph-view-diag"></p>' +
    "</div>");
  document.body.appendChild(wrap);

  const img = wrap.querySelector("img");
  const bas = wrap.querySelector(".ph-view-head strong");
  const no = wrap.querySelector(".ph-view-no");
  const diag = wrap.querySelector(".ph-view-diag");
  const tekli = foto.length < 2;
  wrap.querySelector(".ph-prev").hidden = tekli;
  wrap.querySelector(".ph-next").hidden = tekli;

  function goster() {
    const f = foto[i];
    bas.textContent = (d && d.chassisNo ? d.chassisNo + " · " : "") + (d ? d.description || "" : "");
    no.textContent = (i + 1) + " / " + foto.length;
    img.removeAttribute("src");
    diag.textContent = "yükleniyor…";
    P.adres(f.p).then(function (url) {
      img.src = url;
      diag.textContent = [
        f.w && f.h ? f.w + "×" + f.h : "",
        P.okunurBoyut(f.b),
        f.byName || "",
        P.sonYol ? "erişim: " + P.sonYol : ""
      ].filter(Boolean).join(" · ");
    }).catch(function (e) {
      // Sessizce asılı kalmaktansa sebebini söylemek her zaman iyidir.
      try { console.warn("[foto] açılamadı", f.p, e); } catch (x) {}
      diag.textContent = "Fotoğraf açılamadı: " + ((e && e.message) || "bilinmeyen hata");
      diag.className = "ph-view-diag scan-err";
    });
  }

  function kapat() {
    document.removeEventListener("keydown", tus, true);
    wrap.remove();
  }
  function tus(e) {
    if (e.key === "Escape") { e.stopPropagation(); kapat(); }
    else if (e.key === "ArrowLeft" && i > 0) { i--; goster(); }
    else if (e.key === "ArrowRight" && i < foto.length - 1) { i++; goster(); }
  }
  document.addEventListener("keydown", tus, true);
  wrap.querySelector(".ph-view-x").onclick = kapat;
  wrap.onclick = function (e) { if (e.target === wrap) kapat(); };
  wrap.querySelector(".ph-prev").onclick = function () { if (i > 0) { i--; goster(); } };
  wrap.querySelector(".ph-next").onclick = function () { if (i < foto.length - 1) { i++; goster(); } };

  goster();
  return { close: kapat };
}
