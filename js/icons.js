// Simgeler — satır içi SVG, tek kaynak.
//
// Neden emoji değil? Emoji her cihazda başka çizilir: Android'de renkli,
// eski bir tablette kutu, iOS'ta bambaşka. Parlamada da seçilmez — renkli
// küçük bir resim, tek renk kalın bir çizgi kadar okunmaz. Buradaki simgeler
// metnin rengini alır (currentColor), böylece seçili/pasif durumu yazıyla
// birlikte değişir ve kontrastı yazıyla aynı kalır.
//
// Harici dosya ya da yazı tipi yok: derleme adımı olmayan, çevrimdışı da
// açılabilen bir sayfada simge için ağa çıkmak istemiyoruz.

const P = {
  // Canlı Şema: birbirine bağlı üç istasyon
  sema: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/>' +
        '<path d="M7.5 6h9M17.7 8.2l-4.4 7.6M6.3 8.2l4.4 7.6"/>',
  istasyon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  rework: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  onay: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 9.5"/>',
  traktorler: '<circle cx="7.5" cy="16.5" r="4"/><circle cx="18.5" cy="18" r="2.5"/>' +
              '<path d="M11.5 16.5H16M4 12.6V5.5h6.5l2 5.5H18a2 2 0 0 1 2 2v2.6M10.5 5.5V11"/>',
  hatalar: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  rapor: '<path d="M4 4v16h16M8.5 16v-5M13 16V7.5M17.5 16v-3"/>',
  onaysiz: '<path d="M6 3h12M6 21h12M7.5 3v3.5a4.5 4.5 0 0 0 9 0V3M7.5 21v-3.5a4.5 4.5 0 0 1 9 0V21"/>',
  talepler: '<path d="M3 13h5l1.5 3h5l1.5-3h5"/>' +
            '<path d="M5.6 5h12.8L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5l2.6-8z"/>',
  tanimlar: '<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2"/>' +
            '<circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  daha: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  cikis: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4"/>',
  yenile: '<path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3L20 15.5M20 20v-4.5h-4.5"/>',
  ok: '<path d="m9 6 6 6-6 6"/>',
  // Durum işaretleri — renk tek başına durum taşımasın diye yazının yanında.
  uyari: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  saat: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  oynat: '<path d="M8 5.5v13l10.5-6.5L8 5.5z"/>',
  duraklat: '<path d="M8.5 5v14M15.5 5v14"/>'
};

// icon("rework") -> '<svg …>'. Bilinmeyen ad boş döner; ekran çökmez.
export function icon(name, size) {
  const p = P[name];
  if (!p) return "";
  const s = size || 20;
  return '<svg class="ic-svg" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false">' + p + "</svg>";
}

export const ICON_NAMES = Object.keys(P);

// Uygulama işareti: lacivert zemin üzerinde beyaz traktör. Giriş ekranı,
// üst çubuk ve ana ekran simgesi (assets/icon.svg) aynı çizimi kullanır.
export function logo(size) {
  const s = size || 32;
  return '<svg class="logo-svg" width="' + s + '" height="' + s + '" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
    '<rect width="48" height="48" rx="11" fill="#16306b"/>' +
    '<g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="17" cy="31" r="7.5"/><circle cx="36" cy="34" r="4.5"/>' +
    '<path d="M24.5 31H31M10 24V12h12l3.5 9.5H35a4 4 0 0 1 4 4V29M22 12v9.5"/></g></svg>';
}
