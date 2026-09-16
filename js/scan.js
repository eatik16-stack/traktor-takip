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

export function barcodeSupported() {
  return typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
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

/* ---------------- barkod ---------------- */

// Etiketteki barkodu okur, içindeki metni döndürür. Vazgeçilirse null.
export function scanBarcode() {
  return new Promise(function (resolve) {
    if (!barcodeSupported() || !cameraSupported()) { resolve(null); return; }

    const wrap = overlay("Barkodu okutun",
      "Etiketin üzerindeki barkodu çerçeveye getirin — okunduğunda kendiliğinden kapanır.");
    const video = wrap.querySelector("video");
    const hint = wrap.querySelector(".scan-hint");
    let stream = null, timer = null, done = false;

    const finish = function (value) {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      stopCamera(stream);
      wrap.remove();
      resolve(value);
    };
    wrap.querySelector(".scan-x").onclick = function () { finish(null); };
    wrap.onclick = function (e) { if (e.target === wrap) finish(null); };

    startCamera(video).then(function (s) {
      stream = s;
      const detector = new window.BarcodeDetector();
      timer = setInterval(async function () {
        if (done || video.readyState < 2) return;
        try {
          const found = await detector.detect(video);
          if (found && found.length) {
            const raw = String(found[0].rawValue || "").trim();
            if (raw) {
              if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
              finish(raw);
            }
          }
        } catch (e) { /* kare okunamadı, bir sonrakini dene */ }
      }, 220);
    }).catch(function (e) {
      hint.textContent = "Kamera açılamadı: " + ((e && e.message) || "izin verilmedi") +
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

function grabFrame(video) {
  const cv = document.createElement("canvas");
  cv.width = video.videoWidth || 1280;
  cv.height = video.videoHeight || 720;
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
