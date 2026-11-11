// Servis çalışanı — uygulama kabuğunu çevrimdışı açılabilir kılar.
//
// Firestore verileri cihazda zaten saklanıyor; ama sayfanın KENDİSİ (HTML, CSS,
// JS) saklanmıyordu. Wi-Fi yokken tablet yeniden başlarsa ya da sekme
// yenilenirse uygulama hiç açılmıyor, cihazda bekleyen kayıtlara da
// ulaşılamıyordu. Bu dosya o boşluğu kapatır.
//
// Kural basit ve bilerek temkinli:
//   - Kendi dosyalarımız: ÖNCE AĞ. Bağlantı varken her zaman sunucudaki son
//     sürüm gelir (eski sürümde takılı kalan tablet olmaz); yalnızca ağ
//     yokken son saklanan kopya kullanılır.
//   - Sürüm numarası adresinde yazan kütüphaneler (Firebase SDK, barkod ve
//     OCR kütüphaneleri): ÖNCE SAKLANAN. Adres değişmeden içerik değişmez.
//   - Geri kalan her şey (Firestore, giriş, dosya deposu): DOKUNULMAZ.
//
// Sürüm adı değişirse eski saklananlar silinir.
const CACHE = "tt-kabuk-v1";

const KUTUPHANE = [
  "https://www.gstatic.com/firebasejs/",
  "https://cdn.jsdelivr.net/npm/@zxing/",
  "https://unpkg.com/@zxing/",
  "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/"
];

self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k.indexOf("tt-kabuk-") === 0; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function sakla(req, res) {
  // Yalnızca başarılı (ya da kaynağı kapalı, "opaque") yanıtlar saklanır;
  // hata sayfasını saklarsak çevrimdışıyken onu gösterirdik.
  if (!res || !(res.ok || res.type === "opaque")) return;
  const kopya = res.clone();
  caches.open(CACHE).then(function (c) { return c.put(req, kopya); }).catch(function () {});
}

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Sürümü adresinde yazan kütüphaneler: önce saklanan.
  if (KUTUPHANE.some(function (p) { return req.url.indexOf(p) === 0; })) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { sakla(req, res); return res; });
    }));
    return;
  }

  // Başka sitelere giden istekler (Firestore, giriş, dosya deposu) bizim işimiz değil.
  if (url.origin !== self.location.origin) return;
  // Sürüm denetimi ve test sayfaları her zaman ağdan gelmeli.
  if (url.search.indexOf("surum-denetimi") !== -1 || url.pathname.indexOf("/test/") !== -1) return;

  // Kendi dosyalarımız: önce ağ ("no-cache": tarayıcı önbelleği sunucuya
  // sormadan eski dosyayı vermesin), olmazsa saklanan.
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then(function (res) { sakla(req, res); return res; })
      .catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          if (hit) return hit;
          // Sayfa gezinmesi ise kabuğun kendisini ver.
          if (req.mode === "navigate") return caches.match("./index.html", { ignoreSearch: true })
            .then(function (h) { return h || caches.match("./", { ignoreSearch: true }); })
            .then(function (h) { return h || Response.error(); });
          return Response.error();
        });
      })
  );
});
