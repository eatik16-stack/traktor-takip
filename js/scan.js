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
      '<p class="scan-diag"></p>' +
      '<div class="scan-foot"></div>' +
    "</div>";
  wrap.querySelector(".scan-hint").textContent = hint || "";
  document.body.appendChild(wrap);
  return wrap;
}

// Barkodun okunabilmesi ÇÖZÜNÜRLÜĞE bağlı: 17 haneli şasi barkodunda ~990
// ince çizgi var, her birine en az 2 piksel düşmezse çözülemez. Bu yüzden
// kameradan olabilecek en büyük kareyi isteriz; cihaz veremezse kademeli
// olarak daha küçüğünü deneriz.
const CAM_TRY = [
  { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  { facingMode: { ideal: "environment" } },
  true
];

async function startCamera(video) {
  let son = null;
  for (let i = 0; i < CAM_TRY.length; i++) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: CAM_TRY[i], audio: false });
      video.srcObject = stream;
      await video.play();
      return stream;
    } catch (e) { son = e; }
  }
  throw son || new Error("kamera açılamadı");
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
// dondur=true: etiket dik tutulduysa görüntüyü 90° çevirip dener.
export function decodeLuminance(ZX, lum, w, h, dondur) {
  try {
    const src = new ZX.RGBLuminanceSource(lum, w, h);
    let bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
    if (dondur) {
      if (!bmp.isRotateSupported || !bmp.isRotateSupported()) return null;
      bmp = bmp.rotateCounterClockwise();
    }
    const reader = new ZX.MultiFormatReader();
    reader.setHints(zxHints(ZX));
    const res = reader.decode(bmp);
    return res ? String(res.getText() || "").trim() || null : null;
  } catch (e) { return null; }
}

/* ---------------- görüntüden barkod ---------------- */

// TEK bir çalışma tuvali. Her kare için yeni tuval AÇILMAZ: iOS'ta tuval
// belleği sınırlıdır, saniyede birkaç tane açılınca sınır birkaç saniyede
// dolar ve o andan sonra drawImage/getImageData sessizce BOŞ görüntü verir —
// kamera görüntüsü ekranda dururken okuma hiç çalışmaz. Hatanın sebebi buydu.
let scratch = null, scratchCx = null;

function scratchCanvas(w, h) {
  if (!scratch) {
    scratch = document.createElement("canvas");
    scratchCx = scratch.getContext("2d", { willReadFrequently: true });
  }
  if (scratch.width !== w) scratch.width = w;
  if (scratch.height !== h) scratch.height = h;
  return scratch;
}

// Pencere kapanınca tuvali küçültüp belleği bırakırız.
function releaseScratch() {
  if (scratch) { scratch.width = 1; scratch.height = 1; }
}

// Görüntünün bir bölgesini çalışma tuvaline alır. oranY=0.5 → ortadaki yatay
// bant. enBoy sınırı hem hız hem de iOS bellek sınırı için vardır; barkod
// çözmede çözünürlük kritik olduğundan sınır geniş tutulur.
function drawCrop(kaynak, gw, gh, oranY, enBoy) {
  const ch = Math.max(1, Math.round(gh * oranY));
  const sy = Math.round((gh - ch) / 2);
  const k = enBoy && gw > enBoy ? enBoy / gw : 1;
  const w = Math.max(1, Math.round(gw * k));
  const h = Math.max(1, Math.round(ch * k));
  const cv = scratchCanvas(w, h);
  scratchCx.drawImage(kaynak, 0, sy, gw, ch, 0, 0, w, h);
  return cv;
}

// Son okunan karenin ortalama parlaklığı. 0 veya 255'e yapışık kalıyorsa
// tuvale hiçbir şey çizilmiyor demektir — tanı satırında görünür.
export let lastFrameMean = -1;

function decodeCanvas(ZX, cv, dondur, olc) {
  const img = scratchCx.getImageData(0, 0, cv.width, cv.height);
  const lum = toLuminance(img.data, cv.width, cv.height);
  if (olc) {
    let t = 0;
    const adim = Math.max(1, Math.floor(lum.length / 4000));
    let n = 0;
    for (let i = 0; i < lum.length; i += adim) { t += lum[i]; n++; }
    lastFrameMean = n ? Math.round(t / n) : -1;
  }
  return decodeLuminance(ZX, lum, cv.width, cv.height, dondur);
}

// Bir görüntüyü birkaç farklı kırpma ve çevirmeyle dener. Canlı kamerada
// hız için kısa liste, çekilen fotoğrafta daha uzun liste kullanılır.
// kaynak: <video>, <img> veya <canvas> — hepsi drawImage'a verilebilir.
export function decodeImage(ZX, kaynak, gw, gh, genis) {
  if (!gw || !gh) return null;
  // [bandın dikey oranı, küçültme sınırı (0 = küçültme yok)]
  const denemeler = genis
    ? [[0.4, 2000], [1, 2000], [0.4, 1200], [1, 1200], [1, 2800]]
    : [[0.5, 1600], [1, 1400]];
  for (let i = 0; i < denemeler.length; i++) {
    const cv = drawCrop(kaynak, gw, gh, denemeler[i][0], denemeler[i][1]);
    const d = decodeCanvas(ZX, cv, false, i === 0);
    if (d) return d;
    if (genis) { const r = decodeCanvas(ZX, cv, true, false); if (r) return r; }
  }
  return null;
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
    zx: ZX,
    read: async function (video) {
      const txt = decodeImage(ZX, video, video.videoWidth || 0, video.videoHeight || 0, false);
      return txt ? [txt] : [];
    }
  };
}

/* ---------------- çekilen fotoğraftan barkod ---------------- */

// Telefonun kendi kamera uygulamasıyla fotoğraf çektirir. Neden? Canlı video
// karesi 1280 piksel civarındadır; 17 haneli şasi barkodu için bu sınırda
// kalır. Telefonun çektiği fotoğraf 4000 piksel genişliğindedir — üstelik
// kişi netleme ve yakınlaştırma yapabilir. iPhone'da fark belirgindir.
function pickPhoto() {
  return new Promise(function (resolve) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.setAttribute("capture", "environment");
    inp.style.position = "fixed";
    inp.style.left = "-9999px";
    document.body.appendChild(inp);
    inp.onchange = function () {
      const f = inp.files && inp.files[0];
      inp.remove();
      resolve(f || null);
    };
    // Kişi çekmeden vazgeçerse onchange hiç gelmez; pencere kapanınca
    // scanLabel zaten kendini temizler.
    inp.click();
  });
}

function fileToImage(file) {
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = function () { resolve({ im: im, url: url }); };
    im.onerror = function () { URL.revokeObjectURL(url); reject(new Error("fotoğraf açılamadı")); };
    im.src = url;
  });
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
      "TEK bir barkodu çerçeveye sığdırın ve yaklaşın — bütün etiketi sığdırmaya çalışmayın.");
    const video = wrap.querySelector("video");
    const hint = wrap.querySelector(".scan-hint");
    const diag = wrap.querySelector(".scan-diag");
    const foot = wrap.querySelector(".scan-foot");
    foot.innerHTML =
      '<button class="btn btn-primary btn-block" id="scan-photo">📷 Fotoğraf çek ve oku</button>' +
      '<button class="btn btn-block" id="scan-done">Bitir</button>';

    let stream = null, timer = null, grace = null, done = false, deneme = 0;
    let decoder = null, fotoMod = false;
    const seen = [];

    const finish = function (iptal) {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      if (grace) clearTimeout(grace);
      stopCamera(stream);
      releaseScratch();
      wrap.remove();
      resolve(iptal ? null : classifyCodes(seen, known));
    };
    wrap.querySelector(".scan-x").onclick = function () { finish(true); };
    wrap.onclick = function (e) { if (e.target === wrap) finish(true); };
    foot.querySelector("#scan-done").onclick = function () { finish(seen.length === 0); };

    // Alt satırdaki teknik bilgi: sorun çıkarsa neyin ne olduğunu görelim.
    const tani = function () {
      if (done) return;
      const p = [];
      p.push(decoder ? (decoder.kind === "native" ? "cihaz okuyucusu" : "sayfa içi okuyucu") : "hazırlanıyor");
      if (video.videoWidth) p.push(video.videoWidth + "×" + video.videoHeight);
      if (deneme) p.push(deneme + " kare");
      // Parlaklık: kameradan gerçekten görüntü alınıp alınmadığını gösterir.
      if (lastFrameMean >= 0) p.push("ışık " + lastFrameMean);
      diag.textContent = p.join(" · ");
    };

    // Telefonun kendi kamerasıyla fotoğraf: canlı kareden çok daha yüksek
    // çözünürlük, netleme ve yakınlaştırma imkânı.
    foot.querySelector("#scan-photo").onclick = async function () {
      const btn = foot.querySelector("#scan-photo");
      btn.disabled = true;
      try {
        const f = await pickPhoto();
        if (!f || done) { btn.disabled = false; return; }
        fotoMod = true;
        if (grace) { clearTimeout(grace); grace = null; }
        hint.textContent = "Fotoğraf okunuyor…";
        hint.className = "scan-hint";
        const ZX = (decoder && decoder.zx) || await loadZxing();
        const g = await fileToImage(f);
        let bulunan = null;
        try {
          bulunan = decodeImage(ZX, g.im, g.im.naturalWidth, g.im.naturalHeight, true);
          diag.textContent = "fotoğraf " + g.im.naturalWidth + "×" + g.im.naturalHeight;
        } finally { URL.revokeObjectURL(g.url); }
        if (done) return;
        if (bulunan) {
          if (seen.indexOf(bulunan) === -1) seen.push(bulunan);
          durum();
        } else {
          hint.textContent = "Bu fotoğrafta barkod çözülemedi. Tek barkoda yaklaşıp tekrar çekin.";
          hint.className = "scan-hint scan-err";
        }
      } catch (e) {
        if (!done) {
          hint.textContent = "Okunamadı: " + ((e && e.message) || "") + ". Elle yazabilirsiniz.";
          hint.className = "scan-hint scan-err";
        }
      } finally { btn.disabled = false; }
    };

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
      // Fotoğrafla okumada pencere kendiliğinden kapanmaz: kişi ikinci barkod
      // için bir fotoğraf daha çekmek isteyebilir, "Bitir" ile kendi kapatır.
      if (c.chassis && !fotoMod) grace = setTimeout(function () { finish(false); }, 2500);
      if (c.chassis && fotoMod) {
        hint.textContent += "  ·  Satış kodu için ikinci barkodu çekin ya da Bitir'e basın.";
      }
    };

    const bilgi = function (t) { if (!done) hint.textContent = t; };

    // Önce kamera (izin isteği hemen çıksın), sonra okuyucu. Bu sırayla
    // olması önemli: stream değişkeni dolmadan okuyucu indirilmeye başlarsa
    // ve kişi bu sırada pencereyi kapatırsa kamera açık kalırdı.
    startCamera(video).then(function (s) {
      stream = s;
      if (done) { stopCamera(s); return null; }
      return makeDecoder(bilgi);
    }).then(function (d) {
      if (!d || done) return;
      decoder = d;
      // Sayfa içi çözücü kareyi kendi işler, biraz daha seyrek bakarız.
      const aralik = decoder.kind === "native" ? 220 : 400;
      let mesgul = false;
      durum();
      tani();
      timer = setInterval(async function () {
        if (done || mesgul || video.readyState < 2) return;
        mesgul = true;
        try {
          const found = await decoder.read(video);
          deneme++;
          let yeni = false;
          (found || []).forEach(function (raw) {
            if (raw && seen.indexOf(raw) === -1) { seen.push(raw); yeni = true; }
          });
          if (yeni) {
            if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
            durum();
          }
          if (deneme % 5 === 0) tani();
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

/* ---------------- şasi ---------------- */

// Etikette ÜÇ numara alt alta duruyor ve ikisi birbirine benziyor:
//
//   MEA0T15DGS4940395        şasi          17 hane
//   GX706F2                  satış kodu
//   SJV326CRE652024K016658   motor no      22 hane
//
// Eski sürüm şasiyi okuyamadığında "en uzun kelimeyi" alıyordu ve motor
// numarasından 17 hane kesip şasi diye yazıyordu. Yanlış ama makul görünen
// bir numara üretmek, hiç numara üretmemekten çok daha kötü: kayıt yanlış
// traktöre işlenir ve kimse fark etmez. Bu yüzden artık:
//
//   - yalnızca TAM 17 haneli bir kelime şasi olabilir,
//   - 17'den uzun bir kelimeden ASLA parça kesilmez,
//   - hiçbir aday yoksa null döner ve kişi elle yazar.

// VIN'de I, O, Q hiç kullanılmaz; OCR bu üçünü gördüyse kesinlikle yanılmıştır.
// Bunları düzeltmek tahmin değil, kural gereği.
function vinDuzelt(t) {
  return t.replace(/[IO Q]/g, function (c) { return c === "I" ? "1" : "0"; });
}

const VIN17 = /^[A-HJ-NPR-Z0-9]{17}$/;

// Aday şasileri satır sırasıyla birlikte döndürür.
function sasiAdaylari(text) {
  const satirlar = String(text || "").toUpperCase().split(/[\r\n]+/);
  const out = [];
  satirlar.forEach(function (satir, si) {
    satir.replace(/[^A-Z0-9]/g, " ").split(/\s+/).filter(Boolean).forEach(function (kelime) {
      // 17'den uzun kelime motor numarasıdır; parçalamayız, atlarız.
      if (kelime.length !== 17) return;
      const duzeltilmis = vinDuzelt(kelime);
      if (!VIN17.test(duzeltilmis)) return;
      out.push({ v: duzeltilmis, satir: si, ham: kelime });
    });
  });
  return out;
}

// Şasi numarası. Bulunamazsa null — uydurmaz.
// known: daha önce kaydedilmiş şasilerin ön eki (varsayılan "MEA") tercih
// sebebidir, şart değil: fabrika ön eki değişirse okuma yine çalışır.
export function extractChassis(text, onEk) {
  const ek = String(onEk || "MEA").toUpperCase();
  const adaylar = sasiAdaylari(text);
  if (!adaylar.length) return null;
  if (adaylar.length === 1) return adaylar[0].v;

  // Birden fazla 17 haneli aday varsa fabrika ön ekini taşıyan kazanır;
  // o da yoksa etikette en üstte duran (motor numarasından önce gelen).
  const ekli = adaylar.filter(function (a) { return a.v.indexOf(ek) === 0; });
  const liste = ekli.length ? ekli : adaylar;
  return liste.sort(function (a, b) { return a.satir - b.satir; })[0].v;
}

// Okunan şasinin beklenen biçimde olup olmadığını söyler. Kişiye
// "kontrol et" demek için kullanılır — reddetmek için değil.
export function sasiUyari(deger, onEk) {
  const v = String(deger || "").toUpperCase();
  const ek = String(onEk || "MEA").toUpperCase();
  if (v.length !== 17) return "17 hane olmalı (" + v.length + " hane okundu)";
  if (v.indexOf(ek) !== 0) return ek + " ile başlamıyor — etiketle karşılaştırın";
  return "";
}

// Tek fotoğraftan etiketin tamamını okur: şasi ve satış kodu birlikte.
// Sahada iki ayrı fotoğraf çektirmenin anlamı yok — ikisi de aynı etikette.
export function extractLabel(text, knownCodes, onEk) {
  return {
    chassis: extractChassis(text, onEk),
    saleCode: extractSaleCode(text, knownCodes),
    text: String(text || "")
  };
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
