// Barkod çözücünün gerçekten çözdüğünü doğrular (Node tarafı).
//
// Neden ayrı bir dosya? Sahadaki telefonların bir kısmında cihazın YERLEŞİK
// barkod okuyucusu yok; o cihazlarda barkodu sayfaya inen çözücü okuyor.
// Kamerayı testte açamayız, ama kameradan sonraki yol (gri tonlama → çözme →
// alan ayıklama) burada birebir koşturulur: testte üretilmiş bir Code 39
// barkod görüntüsü, uygulamanın kullandığı decodeLuminance'a verilir.
//
// Tuval (canvas) gerektiren kırpma/çevirme yolu tarayıcı testinde sınanır.
//
// ZXing burada node_modules'ten gelir; tarayıcıda aynı sürüm CDN'den iner.

import { createRequire } from "node:module";
import { decodeLuminance, toLuminance, classifyCodes } from "../js/scan.js";
import { barkodGri, barkodRGBA } from "./code39.mjs";

const require = createRequire(import.meta.url);

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
  const kod = "GX721F1";

  const g = barkodGri(sasi);
  check("Şasi barkodu çözülüyor", decodeLuminance(ZX, g.lum, g.w, g.h) === sasi,
        decodeLuminance(ZX, g.lum, g.w, g.h));

  const g2 = barkodGri(kod);
  check("Satış kodu barkodu çözülüyor", decodeLuminance(ZX, g2.lum, g2.w, g2.h) === kod,
        decodeLuminance(ZX, g2.lum, g2.w, g2.h));

  // Kameradan gelen kare RGBA'dır; gri tonlamaya çevirme yolu da sınanır.
  const r = barkodRGBA(sasi);
  check("Kamera karesi (RGBA) gri tonlamadan sonra çözülüyor",
        decodeLuminance(ZX, toLuminance(r.rgba, r.w, r.h), r.w, r.h) === sasi);

  // Barkod yoksa uydurmamalı.
  const bos = new Uint8ClampedArray(400 * 200).fill(255);
  check("Boş görüntüden barkod uydurulmuyor", decodeLuminance(ZX, bos, 400, 200) === null,
        decodeLuminance(ZX, bos, 400, 200));

  // Çözünürlük eşiği. Telefonda okunamama sebebi buydu: barkod karenin küçük
  // bir kısmını kaplayınca ince çizgiye 1 pikselden az düşüyor. Burada ince
  // çizgi 2 piksel olduğunda okunabildiğini sabitliyoruz — uygulamanın
  // "yaklaşın" uyarısı ve fotoğraf seçeneği bu eşik yüzünden var.
  const ince = barkodGri(sasi, 2);
  check("İnce çizgi 2 piksel iken şasi okunuyor",
        decodeLuminance(ZX, ince.lum, ince.w, ince.h) === sasi,
        "genişlik " + ince.w);

  // Uzun şasi barkodu tek pikselde okunamaz; bu BEKLENEN davranış, yanlış
  // okumaktansa okumamalı.
  const cokInce = barkodGri(sasi, 1);
  const cokInceSonuc = decodeLuminance(ZX, cokInce.lum, cokInce.w, cokInce.h);
  check("Çok küçük görüntüde yanlış numara üretilmiyor",
        cokInceSonuc === null || cokInceSonuc === sasi, cokInceSonuc);

  // Çözülen iki barkod doğru alanlara gidiyor mu?
  const c = classifyCodes([sasi, kod], []);
  check("Çözülen barkodlar doğru alanlara yazılıyor",
        c.chassis === sasi && c.saleCode === kod, c);

  return results;
}
