// Hata kaydı fotoğrafları: çek, küçült, yükle, göster.
//
// Neden küçültme bu kadar önemli?
//   Telefonun çektiği fotoğraf 3–5 MB. Uzun kenarı 1600 piksele indirip
//   JPEG'e çevirince ~250 KB'a iniyor — bir boya akıntısını ya da eksik
//   cıvatayı göstermek için fazlasıyla yeterli, ama depolama ve indirme
//   maliyetinin ON BEŞTE BİRİ. Bu işlem tamamen tarayıcıda yapılır, hiçbir
//   sunucu maliyeti yoktur.
//
//   Yeniden kodlarken EXIF verisi de silinir. Yani personelin telefonunun
//   KONUM bilgisi kayda hiç girmez; bu bilerek yapılmış bir gizlilik
//   kararıdır, yan etki değil.
//
// Her fotoğraf İKİ dosya olarak saklanır: listede görünen küçük önizleme
// (~18 KB) ve dokununca açılan asıl fotoğraf. Listeler yalnız küçüğü
// indirir — indirme trafiği böylece on kata yakın azalır.

import { fbStorage } from "./fb.js";
import { myEmail, myName } from "./auth.js";
import { newId } from "./util.js";

export const UZUN_KENAR = 1600;      // asıl fotoğrafın uzun kenarı
export const ONIZLEME_KENAR = 320;   // küçük önizlemenin uzun kenarı
export const KALITE = 0.72;          // JPEG kalitesi
export const ONIZLEME_KALITE = 0.6;
export const AZAMI_BOYUT = 2 * 1024 * 1024;   // storage.rules ile aynı sert tavan

/* ---------------- küçültme ---------------- */

// Hedef ölçüyü hesaplar: uzun kenar sınıra iner, oran korunur, küçük
// fotoğraf büyütülmez (büyütmek bilgi eklemez, yalnız dosyayı şişirir).
export function hedefOlcu(w, h, uzunKenar) {
  if (!w || !h) return { w: 0, h: 0 };
  const uzun = Math.max(w, h);
  if (uzun <= uzunKenar) return { w: w, h: h };
  const k = uzunKenar / uzun;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function dosyadanGoruntu(file) {
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = function () { resolve({ im: im, url: url }); };
    im.onerror = function () { URL.revokeObjectURL(url); reject(new Error("fotoğraf açılamadı")); };
    im.src = url;
  });
}

function tuvaleCiz(im, w, h) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const cx = cv.getContext("2d");
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  cx.drawImage(im, 0, 0, w, h);
  return cv;
}

function tuvaldenBlob(cv, kalite) {
  return new Promise(function (resolve, reject) {
    cv.toBlob(function (b) {
      b ? resolve(b) : reject(new Error("görüntü kodlanamadı"));
    }, "image/jpeg", kalite);
  });
}

// Bir fotoğraftan yüklenecek iki dosyayı üretir.
// Dönen değer: { full, thumb, w, h, hamBoyut }
export async function hazirla(file) {
  const g = await dosyadanGoruntu(file);
  try {
    const gw = g.im.naturalWidth, gh = g.im.naturalHeight;
    const b = hedefOlcu(gw, gh, UZUN_KENAR);
    const k = hedefOlcu(gw, gh, ONIZLEME_KENAR);
    const full = await tuvaldenBlob(tuvaleCiz(g.im, b.w, b.h), KALITE);
    const thumb = await tuvaldenBlob(tuvaleCiz(g.im, k.w, k.h), ONIZLEME_KALITE);
    return { full: full, thumb: thumb, w: b.w, h: b.h, hamBoyut: file.size };
  } finally { URL.revokeObjectURL(g.url); }
}

/* ---------------- yükleme ---------------- */

// Yolu tek yerden üretiriz ki kurallardaki desenle her zaman uyuşsun.
export function yolUret(defectId, id) {
  return {
    p: "defects/" + defectId + "/" + id + ".jpg",
    t: "defects/" + defectId + "/" + id + "_k.jpg"
  };
}

function yukle(S, yol, blob, onProgress) {
  return new Promise(function (resolve, reject) {
    const gorev = S.uploadBytesResumable(S.ref(S.storage, yol), blob, {
      contentType: "image/jpeg",
      // Fotoğraf hiç değişmez: tarayıcı bir kez indirsin, bir daha inmesin.
      // İndirme maliyetini asıl düşüren ayar bu.
      cacheControl: "public, max-age=31536000, immutable"
    });
    gorev.on("state_changed",
      function (s) {
        if (onProgress && s.totalBytes) onProgress(s.bytesTransferred / s.totalBytes);
      },
      reject,
      function () { resolve(true); });
  });
}

// Bir fotoğrafı yükler ve Firestore'a yazılacak künyesini döndürür.
// Alan adları kısa tutulur: her hata kaydında birkaç tane duracak.
export async function yukleFotograf(defectId, file, onProgress) {
  const hazir = await hazirla(file);
  if (hazir.full.size > AZAMI_BOYUT) {
    // Kurallar da reddederdi; buradan söylemek daha anlaşılır bir hata verir.
    throw new Error("Fotoğraf küçültmeye rağmen çok büyük. Başka bir kare deneyin.");
  }
  const S = await fbStorage();
  const id = newId("f");
  const yol = yolUret(defectId, id);

  // Önce küçük önizleme: yükleme yarıda kesilirse listede kırık kayıt kalmasın
  // diye asıl dosya en son yazılır.
  await yukle(S, yol.t, hazir.thumb, null);
  await yukle(S, yol.p, hazir.full, onProgress);

  return {
    p: yol.p, t: yol.t,
    w: hazir.w, h: hazir.h,
    b: hazir.full.size,
    at: new Date().toISOString(),
    by: myEmail(),
    byName: myName()
  };
}

/* ---------------- gösterme ---------------- */

// Aynı fotoğraf ekranda birkaç kez görünebilir; bir kez indirilir.
const onbellek = {};

// Hangi yolun işe yaradığını tanı satırında gösterebilmek için saklanır.
export let sonYol = "";

// Sıkı mod: dosyayı getBytes ile indirir, yani güvenlik kurallarından geçer
// ve ortaya paylaşılabilir bir adres çıkmaz. Bunun çalışması için deponun
// CORS ayarı gerekir; ayar yoksa tarayıcı isteği ENGELLER ve bazı
// tarayıcılarda hata bile vermeden ASILI KALIR. Bu yüzden varsayılan
// KAPALIDIR — CORS kurulduktan sonra açılır.
export let sikiMod = false;
export function setSikiMod(v) { sikiMod = !!v; }

// Hiçbir isteğin sonsuza kadar asılı kalmamasını garanti eder. Asılı kalan
// bir istek kullanıcıya "yükleniyor…" yazıp susan bir ekran bırakır; hata
// vermek her zaman daha iyidir.
function zamanAsimi(sozVerilen, ms, mesaj) {
  return new Promise(function (resolve, reject) {
    let bitti = false;
    const t = setTimeout(function () {
      if (!bitti) { bitti = true; reject(new Error(mesaj)); }
    }, ms);
    sozVerilen.then(function (v) {
      if (!bitti) { bitti = true; clearTimeout(t); resolve(v); }
    }, function (e) {
      if (!bitti) { bitti = true; clearTimeout(t); reject(e); }
    });
  });
}

// Bir dosyanın görüntülenebilir adresini verir.
export async function adres(yol) {
  if (onbellek[yol]) return onbellek[yol];
  const S = await zamanAsimi(fbStorage(), 20000, "depo bağlantısı kurulamadı");
  const r = S.ref(S.storage, yol);

  if (sikiMod) {
    try {
      const buf = await zamanAsimi(S.getBytes(r, AZAMI_BOYUT), 20000, "dosya indirilemedi (CORS?)");
      const url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      sonYol = "kurallı";
      onbellek[yol] = url;
      return url;
    } catch (e) {
      // Sıkı mod bu depoda çalışmıyor; bir daha denemeyip normal yola geçeriz.
      sikiMod = false;
    }
  }

  const url = await zamanAsimi(S.getDownloadURL(r), 20000, "dosya adresi alınamadı");
  sonYol = "jetonlu";
  onbellek[yol] = url;
  return url;
}

// Pencere kapanınca bellekteki görüntüleri bırakır.
export function onbellegiBosalt() {
  Object.keys(onbellek).forEach(function (k) {
    if (String(onbellek[k]).indexOf("blob:") === 0) {
      try { URL.revokeObjectURL(onbellek[k]); } catch (e) {}
    }
    delete onbellek[k];
  });
}

/* ---------------- yardımcılar ---------------- */

export function okunurBoyut(bayt) {
  const n = Number(bayt) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

// Görünür fotoğraflar: gizlenmiş olanlar listede çıkmaz ama dosya durur.
// Silme yok — hata fotoğrafı kalite kaydının parçası, denetim kaydı gibi
// sonradan yok edilemez.
export function gorunur(liste) {
  return (liste || []).filter(function (f) { return f && !f.hidden; });
}
