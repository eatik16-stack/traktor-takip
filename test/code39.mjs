// Test için Code 39 barkod üretici. Hem Node testinde hem tarayıcı testinde
// kullanılır, bu yüzden hiçbir ortama özel şey içermez.
//
// Code 39: her karakter 9 öğedir (5 çizgi + 4 boşluk); 3'ü geniştir.
// Etiketlerdeki şasi barkodu bu biçimdedir.

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

// Barkodun tek satırını üretir: 0 = siyah, 255 = beyaz.
// dar = ince çizginin kaç piksel olduğu. Sahadaki okunabilirlik buna bağlı.
export function code39Row(text, dar = 3) {
  const genis = dar * 3;
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

// Gri tonlama görüntü (uygulamada bu veri kameradan gelir).
export function barkodGri(text, dar = 3, yukseklik = 120, bosluk = 40) {
  const row = code39Row(text, dar);
  const w = bosluk + row.length + bosluk;
  const h = yukseklik;
  const lum = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      lum[y * w + x] = (x >= bosluk && x < bosluk + row.length) ? row[x - bosluk] : 255;
    }
  }
  return { lum: lum, w: w, h: h };
}

// Aynı barkod RGBA olarak: kameradan gelen kare bu biçimdedir.
export function barkodRGBA(text, dar = 3, yukseklik = 120, bosluk = 40) {
  const g = barkodGri(text, dar, yukseklik, bosluk);
  const rgba = new Uint8ClampedArray(g.w * g.h * 4);
  for (let i = 0; i < g.lum.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g.lum[i];
    rgba[i * 4 + 3] = 255;
  }
  return { rgba: rgba, w: g.w, h: g.h };
}
