// Adım türleri — tek kaynak.
//
// Başlangıç verileriyle (seed.js) birlikte durmuyor: seed.js 2000 satırlık hata
// kataloğunu taşıdığı için çok büyük ve ona her dokunuşta bütün dosyanın yeniden
// yüklenmesi gerekiyor. Tür listesi ise zaman zaman değişiyor. Ayrı dosyada.
//
// Sıra önemlidir: Tanımlar → Adımlar ekranındaki "Tür" listesi bu sırayla çizilir.

export const KIND_LABEL = {
  kontrol: "Kalite Kontrol",
  islem: "Üretim / İşlem",
  kayit: "Kayıt Noktası",
  rework: "Rework",
  onay: "Onay",
  sevk: "Sevkiyat",
};

// Şema üzerindeki kutu rengi.
export const KIND_COLOR = {
  kontrol: "#2563eb",
  islem: "#64748b",
  kayit: "#7c3aed",
  rework: "#d97706",
  onay: "#16a34a",
  sevk: "#0891b2",
};
