// Barkod çözücünün gerçekten çözdüğünü doğrular.
//
// Neden ayrı bir dosya? Sahadaki telefonların bir kısmında cihazın YERLEŞİK
// barkod okuyucusu yok; o cihazlarda barkodu sayfaya inen çözücü okuyor.
// Kamerayı testte açamayız, ama kameradan sonraki bütün yol (gri tonlama →
// çözme → alan ayıklama) burada birebir koşturulur: testte üretilmiş bir
// Code 39 barkod görüntüsü, uygulamanın kullandığı decodeLuminance'a verilir.
//
// ZXing burada node_modules'ten gelir; tarayıcıda aynı sürüm CDN'den iner.

import { createRequire } from "node:module";
import { decodeLuminance, toLuminance, classifyCodes } from "../js/scan.js";

const require = createRequire(import.meta.url);

/* ---------- test için Code 39 barkod üretici ---------- */
// Her karakter 9 öğedir (5 çizgi + 4 boşluk); 3'ü geniştir. Etiketlerdeki
// şasi barkodu bu biçimdedir.
const C39 = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  "A": "wnnnnwnnw", "B": "nnwnnwnnw", "C": "wnwnnwnnn", "D": "nnnnwwnnw", "E": "wnnnwwnnn",
  "F": "nnwnwwnnn", "G": "nnnnnwwnw", "H": "wnnnnwwnn", "I": "nnwnnwwnn", "J": "nnnnwwwnn",
  "K": "wnnnnnnww", "L": "nnwnnnnww", "M": "wnwnnnnwn", "N": "nnnnwnnww", "O": "wnnnwnnwn",
  "P": "nnwnwnnwn", "Q": "nnnnnnwww", "R": "wnnnnnwwn", "S": "nnwnnnwwn", "T": "nnnnwnwwn",
  "U": "wwnnnnnnw", "V": "nwwnnnnnw", "W": "wwwnnnnnn", "X": "nwnnwnnnw", "Y": "wwnnwnnnn",
  "Z": "nwwnwnnnn", "*": "nwnnwnwnn"
};

function code39Row(text, dar = 3, genis = 9) {
  const chars = ("*" + String(text).toUpperCase() + "*").split("");
  const row = [];
  chars.forEach(function (c, i) {
    const pat = C39[c];
    if (!pat) throw new Error("Code 39 dışı karakter: " + c);
    for (let k = 0; k < 9; k++) {
      const n = pat[k] === "w" ? genis : dar;
      const koyu = k % 2 === 0;                       // çift sıra = çizgi
      for (let x = 0; x < n; x++) row.push(koyu ? 0 : 255);
    }
    if (i < chars.length - 1) for (let x = 0; x < dar; x++) row.push(255);
  });
  return row;
}

// Barkodu gri tonlama olarak üretir (uygulamada bu veri kameradan gelir).
function barkodGri(text, yukseklik = 120, bosluk = 40) {
  const row = code39Row(text);
  const w = bosluk + row.length + bosluk;
  const h = yukseklik;
  const lum = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      lum[y * w + x] = (x >= bosluk && x < bosluk + row.length) ? row[x - bosluk] : 255;
    }
  }
  return { lum, w, h };
}

// Aynı barkodu RGBA olarak üretir: toLuminance'ı da sınamak için.
function barkodRGBA(text) {
  const g = barkodGri(text);
  const rgba = new Uint8ClampedArray(g.w * g.h * 4);
  for (let i = 0; i < g.lum.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g.lum[i];
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, w: g.w, h: g.h };
}

export function runBarcodeTests() {
  const results = [];
  const check = function (name, ok, extra) {
    results.push({ name: name, ok: !!ok, extra: ok ? "" : String(extra == null ? "" : extra) });
  };

  let ZX;
  try {
    ZX = require("@zxing/library");
  } catch (e) {
    check("Barkod çözücü kurulu (npm i)", false, "@zxing/library bulunamadı — npm install");
    return results;
  }

  const sasi = "MEACBBBTAS4940949";
  const g = barkodGri(sasi);
  check("Şasi barkodu çözülüyor", decodeLuminance(ZX, g.lum, g.w, g.h) === sasi,
        decodeLuminance(ZX, g.lum, g.w, g.h));

  const kod = "GX721F1";
  const g2 = barkodGri(kod);
  check("Satış kodu barkodu çözülüyor", decodeLuminance(ZX, g2.lum, g2.w, g2.h) === kod,
        decodeLuminance(ZX, g2.lum, g2.w, g2.h));

  // Kameradan gelen kare RGBA'dır; gri tonlamaya çevirme yolu da sınanır.
  const r = barkodRGBA(sasi);
  const lum = toLuminance(r.rgba, r.w, r.h);
  check("Kamera karesi (RGBA) gri tonlamadan sonra çözülüyor",
        decodeLuminance(ZX, lum, r.w, r.h) === sasi);

  // Barkod yoksa uydurmamalı: düz beyaz kare.
  const bos = new Uint8ClampedArray(400 * 200).fill(255);
  check("Boş görüntüden barkod uydurulmuyor", decodeLuminance(ZX, bos, 400, 200) === null,
        decodeLuminance(ZX, bos, 400, 200));

  // Çözülen iki barkod doğru alanlara gidiyor mu?
  const c = classifyCodes([sasi, kod], []);
  check("Çözülen barkodlar doğru alanlara yazılıyor",
        c.chassis === sasi && c.saleCode === kod, c);

  return results;
}
