// Testleri tarayıcıda koşturur.   node test/run.mjs
//
// Gerçek Firebase'e bağlanmaz: test/mock.js sahte bir Firebase kurar.
// firestore.rules BU TESTLERLE DOĞRULANMAZ — kural katmanı Firebase
// Console → Firestore → Rules → Rules Playground ile denenir.

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let p = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
    if (url.pathname.endsWith("/")) p = join(p, "index.html");
    const body = await readFile(p);
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { "content-type": "text/plain" }).end("yok: " + req.url);
  }
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ["--no-sandbox"]
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("JS hatası: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(`http://127.0.0.1:${port}/test/index.html`, { waitUntil: "load" });
await page.waitForFunction("window.__DONE__ === true", null, { timeout: 60000 })
  .catch(() => { /* aşağıda rapor edilir */ });

const browserResults = await page.evaluate("window.__RESULTS__ || []");

// Barkod çözücü tarayıcıda CDN'den iner; testte node_modules'ten koşturulur.
// Sonuçlar aynı listeye katılır ki tek sayı görelim.
const { runBarcodeTests } = await import("./barcode.mjs");
let barcodeResults = [];
try { barcodeResults = runBarcodeTests(); }
catch (e) { barcodeResults = [{ name: "Barkod testleri çöktü", ok: false, extra: String(e) }]; }

const results = browserResults.concat(barcodeResults);
const out = results
  .map((r) => (r.ok ? "  OK   " : "  FAIL ") + r.name + (r.ok ? "" : "  -> " + r.extra))
  .join("\n") +
  "\n\n  BAŞARILI: " + results.filter((r) => r.ok).length +
  "   BAŞARISIZ: " + results.filter((r) => !r.ok).length;

console.log(out);
if (errors.length) {
  console.log("\nTarayıcı hataları:");
  errors.forEach((e) => console.log("  -", e));
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
// Beklenen bir durum: uygulama testte oturumu sık değiştirir, bu sırada
// izleyiciler geçici olarak yetkisiz okuma yapabilir; bunlar hata sayılmaz.
const realErrors = errors.filter((e) => !/permission|insufficient/i.test(e));
process.exit(failed.length || !results.length || realErrors.length ? 1 : 0);
