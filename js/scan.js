// Etiket okuma: barkoddan şasi numarası, fotoğraftan satış kodu.
//
// Neden iki ayrı yöntem?
//   Şasi barkodu Android Chrome'un YERLEŞİK okuyucusuyla (BarcodeDetector)
//   okunur: ek bir şey inmez, sonuç birebirdir, yazım hatası ihtimali yoktur.
//   Satış kodu barkodda olmadığı için fotoğraftaki yazıdan okunur (OCR). OCR
//   harf karıştırabilir; bu yüzden sonuç alana YAZILIR ama kişi görüp onaylar.
//   Kütüphane yalnızca fotoğraf okuma istendiğinde indirilir — normal kayıt
//   akışı hiçbir şey indirmez.
//
// Kamera yalnızca HTTPS'te açılır (uygulama zaten HTTPS) ve kullanıcı izin
// verdiğinde çalışır. İzin verilmezse akış elle girişle devam eder.

const OCR_URL = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/4.1.1/tesseract.min.js";

// Sayfa içi barkod çözücü. Yerleşik okuyucusu OLMAYAN telefonlarda
// (iPhone'un tamamı, bazı Android sürümleri) devreye girer. İki adres:
// biri kapalıysa öbürü denenir — fabrika ağı birini engelleyebilir.
const ZXING_URLS = [
  "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js",
  "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js"
];

// Cihazın YERLEŞİK okuyucusu var mı? (Android Chrome'da vardır; iPhone'da yok.)
export function nativeBarcodeSupported() {
  return typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
}

// Bu cihazda barkod okutulabilir mi? Kamera varsa evet: yerleşik okuyucu yoksa
// okuyucu sayfaya indirilir. Yani "uygulama indirin" durumu yok.
export function barcodeSupported() {
  return cameraSupported();
}

export function cameraSupported() {
  return typeof navigator !== "undefined" && !!(navigator.mediaDevices &&
         navigator.mediaDevices.getUserMedia);
}

/* ---------------- kamera penceresi ---------------- */

function overlay(title, hint) {
  const wrap = document.createElement("div");
  wrap.className = "scan-back";
  wrap.innerHTML =
    '<div class="scan-box">' +
      '<div class="scan-head"><strong>' + title + "</strong>" +
        '<button class="scan-x" aria-label="Kapat">&#10005;</button></div>' +
      '<div class="scan-stage"><video playsinline muted></video><div class="scan-aim"></div></div>' +
      '<p class="scan-hint"></p>' +
      '<div class="scan-foot"></div>' +
    "</div>";
  wrap.querySelector(".scan-hint").textContent = hint || "";
  document.body.appendChild(wrap);
  return wrap;
}

async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

function stopCamera(stream) {
  if (!stream) return;
  stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
}

/* ---------------- barkod çözücü ---------------- */

let zxLoading = null;

function loadZxing() {
  if (typeof window !== "undefined" && window.ZXing) return Promise.resolve(window.ZXing);
  if (zxLoading) return zxLoading;
  zxLoading = new Promise(function (resolve, reject) {
    let i = 0;
    const dene = function () {
      if (i >= ZXING_URLS.length) {
        zxLoading = null;
        reject(new Error("barkod okuyucu indirilemedi (internet?)"));
        return;
      }
      const sc = document.createElement("script");
      sc.src = ZXING_URLS[i++];
      sc.onload = function () { window.ZXing ? resolve(window.ZXing) : dene(); };
      sc.onerror = function () { sc.remove(); dene(); };
      document.head.appendChild(sc);
    };
    dene();
  });
  return zxLoading;
}

function zxHints(ZX) {
  const m = new Map();
  m.set(ZX.DecodeHintType.TRY_HARDER, true);
  m.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
    ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.CODE_93,
    ZX.BarcodeFormat.ITF, ZX.BarcodeFormat.CODABAR, ZX.BarcodeFormat.EAN_13,
    ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.QR_CODE,
    ZX.BarcodeFormat.DATA_MATRIX, ZX.BarcodeFormat.PDF_417
  ]);
  return m;
}

// RGBA piksellerden gri tonlama. Saf işlev — testten doğrudan çağrılır.
export function toLuminance(rgba, w, h) {
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (rgba[p] * 306 + rgba[p + 1] * 601 + rgba[p + 2] * 117) >> 10;
  }
  return lum;
}

// Gri tonlama veriden barkod metni. Bulunamazsa null (hata fırlatmaz).
// Saf işlev: ZXing dışarıdan verilir, kamera veya DOM gerekmez — testte
// üretilmiş bir barkod görüntüsüyle aynı yol koşturulur.
export function decodeLuminance(ZX, lum, w, h) {
  try {
    const src = new ZX.RGBLuminanceSource(lum, w, h);
    const bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
    const reader = new ZX.MultiFormatReader();
    reader.setHints(zxHints(ZX));
    const res = reader.decode(bmp);
    return res ? String(res.getText() || "").trim() || null : null;
  } catch (e) { return null; }
}

// Okuyucuyu seçer: önce cihazın yerleşik okuyucusu (hiçbir şey inmez),
// yoksa sayfa içi çözücü. Dönen nesnenin read(video) işlevi o karedeki
// barkod metinlerini dizi olarak verir.
async function makeDecoder(bilgi) {
  if (nativeBarcodeSupported()) {
    try {
      // Bazı Android'lerde sınıf vardır ama hiçbir biçimi desteklemez.
      const fmts = await window.BarcodeDetector.getSupportedFormats();
      if (fmts && fmts.length) {
        const d = new window.BarcodeDetector();
        return {
          kind: "native",
          read: async function (video) {
            const found = await d.detect(video);
            return (found || []).map(function (b) { return String(b.rawValue || "").trim(); });
          }
        };
      }
    } catch (e) { /* yerleşik okuyucu kullanılamadı, sayfa içi çözücüye geç */ }
  }
  if (bilgi) bilgi("Okuyucu hazırlanıyor…");
  const ZX = await loadZxing();
  return {
    kind: "zxing",
    read: async function (video) {
      const cv = grabFrame(video, 900);
      const img = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
      const txt = decodeLuminance(ZX, toLuminance(img.data, cv.width, cv.height), cv.width, cv.height);
      return txt ? [txt] : [];
    }
  };
}

/* ---------------- barkod ---------------- */

// Etikette birden fazla barkod var. Hangisinin ne olduğunu uzunluğundan ve
// kalıbından anlarız: 17 hane VIN kalıbı şasidir, "GX721F1" biçimindeki kısa
// kod satış kodudur. Geri kalanlar (V02M…, V05S… gibi) şimdilik kullanılmıyor
// ama saklanır — ileride bir alan gerekirse ne olduklarını görebilelim diye.
//
// Bu işlev saf: kamera kullanmaz, testten doğrudan çağrılır.
export function classifyCodes(values, known) {
  const out = { chassis: null, saleCode: null, other: [] };
  const bilinen = (known || []).map(function (k) { return String(k).toUpperCase(); });
  (values || []).forEach(function (v) {
    const t = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!t) return;
    if (!out.chassis && /^[A-HJ-NPR-Z0-9]{17}$/.test(t)) { out.chassis = t; return; }
    if (!out.saleCode && /^[A-Z]{2}[0-9]{3}[A-Z][0-9]{0,2}$/.test(t)) { out.saleCode = t; return; }
    if (!out.saleCode && bilinen.indexOf(t) !== -1) { out.saleCode = t; return; }
    if (out.other.indexOf(t) === -1) out.other.push(t);
  });
  return out;
}

// Etiketteki BÜTÜN barkodları okur. Şasiyi bulunca hemen kapatmaz: satış kodu
// da barkodlu olabilir, birkaç saniye daha bakar. Satış kodu barkoddan gelirse
// OCR'a hiç gerek kalmaz — okuma birebirdir.
// Dönen değer: { chassis, saleCode, other[] } — vazgeçilirse null.
export function scanLabel(known) {
  return new Promise(function (resolve) {
    if (!cameraSupported()) { resolve(null); return; }

    const wrap = overlay("Etiketi okutun",
      "Etiketin barkodlarını çerçeveye getirin. Okunanlar aşağıda görünür.");
    const video = wrap.querySelector("video");
    const hint = wrap.querySelector(".scan-hint");
    const foot = wrap.querySelector(".scan-foot");
    foot.innerHTML = '<button class="btn btn-block" id="scan-done">Bitir</button>';

    let stream = null, timer = null, grace = null, done = false;
    const seen = [];

    const finish = function (iptal) {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      if (grace) clearTimeout(grace);
      stopCamera(stream);
      wrap.remove();
      resolve(iptal ? null : classifyCodes(seen, known));
    };
    wrap.querySelector(".scan-x").onclick = function () { finish(true); };
    wrap.onclick = function (e) { if (e.target === wrap) finish(true); };
    foot.querySelector("#scan-done").onclick = function () { finish(seen.length === 0); };

    const durum = function () {
      const c = classifyCodes(seen, known);
      const satir = [];
      satir.push(c.chassis ? "Şasi: " + c.chassis : "Şasi bekleniyor…");
      if (c.saleCode) satir.push("Satış kodu: " + c.saleCode);
      hint.textContent = satir.join("  ·  ");
      hint.className = "scan-hint" + (c.chassis ? " hint-ok" : "");
      // Şasi geldiyse satış kodu barkodu için kısa bir süre daha bak; yeni bir
      // barkod göründükçe bu süre yeniden başlar.
      if (grace) clearTimeout(grace);
      if (c.chassis && c.saleCode) { finish(false); return; }
      if (c.chassis) grace = setTimeout(function () { finish(false); }, 2500);
    };

    const bilgi = function (t) { if (!done) hint.textContent = t; };

    // Önce kamera (izin isteği hemen çıksın), sonra okuyucu. Bu sırayla
    // olması önemli: stream değişkeni dolmadan okuyucu indirilmeye başlarsa
    // ve kişi bu sırada pencereyi kapatırsa kamera açık kalırdı.
    startCamera(video).then(function (s) {
      stream = s;
      if (done) { stopCamera(s); return null; }
      return makeDecoder(bilgi);
    }).then(function (decoder) {
      if (!decoder || done) return;
      // Sayfa içi çözücü kareyi kendi işler, biraz daha seyrek bakarız.
      const aralik = decoder.kind === "native" ? 220 : 380;
      let mesgul = false;
      durum();
      timer = setInterval(async function () {
        if (done || mesgul || video.readyState < 2) return;
        mesgul = true;
        try {
          const found = await decoder.read(video);
          let yeni = false;
          (found || []).forEach(function (raw) {
            if (raw && seen.indexOf(raw) === -1) { seen.push(raw); yeni = true; }
          });
          if (yeni) {
            if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
            durum();
          }
        } catch (e) { /* kare okunamadı, bir sonrakini dene */ }
        finally { mesgul = false; }
      }, aralik);
    }).catch(function (e) {
      if (done) return;
      hint.textContent = "Okuyucu açılamadı: " + ((e && e.message) || "izin verilmedi") +
        ". Bilgiyi elle yazabilirsiniz.";
      hint.className = "scan-hint scan-err";
    });
  });
}

/* ---------------- fotoğraf + OCR ---------------- */

let ocrLoading = null;

function loadOcr() {
  if (typeof window.Tesseract !== "undefined") return Promise.resolve(window.Tesseract);
  if (ocrLoading) return ocrLoading;
  ocrLoading = new Promise(function (resolve, reject) {
    const sc = document.createElement("script");
    sc.src = OCR_URL;
    sc.onload = function () {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error("okuyucu yüklenemedi"));
    };
    sc.onerror = function () { reject(new Error("okuyucu indirilemedi (internet?)")); };
    document.head.appendChild(sc);
  });
  return ocrLoading;
}

// Videodan bir kare alır. enBoy verilirse görüntü küçültülür: sayfa içi
// çözücü büyük karelerde yavaşlar, 900 piksel barkod için fazlasıyla yeter.
function grabFrame(video, enBoy) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const k = enBoy && vw > enBoy ? enBoy / vw : 1;
  const cv = document.createElement("canvas");
  cv.width = Math.round(vw * k);
  cv.height = Math.round(vh * k);
  cv.getContext("2d").drawImage(video, 0, 0, cv.width, cv.height);
  return cv;
}

// Etiketin fotoğrafını çeker ve üzerindeki yazıyı döndürür (ham metin).
// Okunamazsa null döner — çağıran taraf elle girişe düşer.
export function scanText() {
  return new Promise(function (resolve) {
    if (!cameraSupported()) { resolve(null); return; }

    const wrap = overlay("Etiketi fotoğraflayın",
      "Yazılar net görünecek şekilde yaklaşın, sonra Çek düğmesine basın.");
    const video = wrap.querySelector("video");
    const hint = wrap.querySelector(".scan-hint");
    const foot = wrap.querySelector(".scan-foot");
    foot.innerHTML = '<button class="btn btn-primary btn-block" id="scan-shot">Çek ve Oku</button>';
    let stream = null, done = false;

    const finish = function (value) {
      if (done) return;
      done = true;
      stopCamera(stream);
      wrap.remove();
      resolve(value);
    };
    wrap.querySelector(".scan-x").onclick = function () { finish(null); };
    wrap.onclick = function (e) { if (e.target === wrap) finish(null); };

    startCamera(video).then(function (s) { stream = s; }).catch(function (e) {
      hint.textContent = "Kamera açılamadı: " + ((e && e.message) || "izin verilmedi") +
        ". Bilgiyi elle yazabilirsiniz.";
      hint.className = "scan-hint scan-err";
    });

    foot.querySelector("#scan-shot").onclick = async function () {
      const btn = foot.querySelector("#scan-shot");
      btn.disabled = true;
      hint.className = "scan-hint";
      hint.textContent = "Okuyucu hazırlanıyor…";
      try {
        const T = await loadOcr();
        const cv = grabFrame(video);
        hint.textContent = "Okunuyor…";
        const res = await T.recognize(cv, "eng");
        finish((res && res.data && res.data.text) || "");
      } catch (e) {
        hint.textContent = "Okunamadı: " + ((e && e.message) || "") + ". Elle yazabilirsiniz.";
        hint.className = "scan-hint scan-err";
        btn.disabled = false;
      }
    };
  });
}

/* ---------------- metinden alan ayıklama ---------------- */

// OCR çıktısı satır satır gelir ve harf karıştırabilir. Satış kodu
// TAFE'de "GX626B" / "GX721F1" biçiminde: iki harf, üç rakam, bir harf,
// bazen bir rakam daha. Önce bu kalıp aranır; bulunamazsa daha önce
// kaydedilmiş kodlara en yakın olan seçilir.
const SALE_RE = /\b[A-Z]{2}[0-9]{3}[A-Z][0-9]{0,2}\b/g;

export function extractSaleCode(text, known) {
  const up = String(text || "").toUpperCase().replace(/[^A-Z0-9\n ]/g, " ");
  const hits = up.match(SALE_RE) || [];
  if (hits.length) {
    // Bilinen bir kodla birebir eşleşen varsa onu tercih et.
    const bilinen = (known || []).map(function (k) { return String(k).toUpperCase(); });
    const tam = hits.find(function (h) { return bilinen.indexOf(h) !== -1; });
    return tam || hits[0];
  }
  if (!known || !known.length) return null;
  // Kalıp tutmadıysa: bilinen kodlara en az harf farkıyla benzeyen kelime.
  const kelimeler = up.split(/[\s\n]+/).filter(function (w) { return w.length >= 5 && w.length <= 9; });
  let best = null, bestD = 3;
  kelimeler.forEach(function (w) {
    known.forEach(function (k) {
      const d = distance(w, String(k).toUpperCase());
      if (d < bestD) { bestD = d; best = String(k).toUpperCase(); }
    });
  });
  return best;
}

// Şasi: 17 haneli VIN kalıbı (I, O, Q kullanılmaz). Barkod bazen başına/sonuna
// ayraç koyar, onları temizleriz.
export function extractChassis(text) {
  const up = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, " ");
  const vin = up.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  if (vin) return vin[0];
  const uzun = up.split(/\s+/).filter(Boolean).sort(function (a, b) { return b.length - a.length; })[0];
  return uzun && uzun.length >= 6 ? uzun : null;
}

// İki kelime arasındaki harf farkı (Levenshtein) — kısa kodlar için yeterli.
function distance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = [];
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
