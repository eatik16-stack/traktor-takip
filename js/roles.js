// Roller. Bu dosyadaki adlar firestore.rules ile BİREBİR aynı olmalı.
//
// Bir kişide birden fazla rol olabilir (örn. "kontrol" + "onay"). Şirket içi
// sürümdeki rol adları aynen korundu ki kafa karışmasın.

export const ROLES = {
  admin:        "Sistem Yöneticisi",
  yonetim:      "Yönetim (sadece rapor)",
  kontrol:      "Kalite Kontrol Operatörü",
  rework:       "Rework Operatörü",
  onay:         "Onay Yetkilisi",
  operator:     "Üretim / İstasyon Operatörü",
  // Başkasının açtığı hata kaydını düzeltebilen / iptal edebilen yetki.
  // Bilerek ayrı: her kontrolörde olmamalı, yalnızca verilen kişilerde.
  hata_duzenle: "Hata Kaydı Düzenleme / Silme",
  // Dört göz kuralını (kendi rework'ünü onaylayamama) yalnızca verilen kişi
  // için kaldırır. Sistem yöneticisine OTOMATİK gelmez, ayrıca işaretlenir.
  tam_onay:     "Tüm Onayları Verebilme (kendi rework'unu da onaylar)"
};

export const DEFAULT_ROLES = ["operator"];

// Hangi rol hangi ekranı görür. "admin" her ekranı görür.
export const VIEWS = {
  sema:       ["yonetim", "kontrol", "rework", "onay", "operator"],
  istasyon:   ["kontrol", "rework", "onay", "operator"],
  rework:     ["rework", "kontrol"],
  onay:       ["onay", "kontrol"],
  traktorler: ["yonetim", "kontrol", "rework", "onay", "operator"],
  hatalar:    ["yonetim", "kontrol", "rework", "onay", "operator"],
  rapor:      ["yonetim"],
  onaysiz:    ["yonetim", "kontrol", "onay"],
  talepler:   [],          // yalnızca admin
  tanimlar:   []           // yalnızca admin
};

export function roleList(roles) {
  if (Array.isArray(roles)) return roles.filter(Boolean);
  return String(roles || "").split(",").map(function (r) { return r.trim(); }).filter(Boolean);
}

// Sistem yöneticiliği her yetkiyi açar.
export function has(roles, wanted) {
  const mine = roleList(roles);
  if (mine.indexOf("admin") !== -1) return true;
  const want = Array.isArray(wanted) ? wanted : [wanted];
  return want.some(function (w) { return mine.indexOf(w) !== -1; });
}

// Rol AÇIKÇA verilmiş mi? Sistem yöneticiliği burada yeterli DEĞİLDİR.
// Bir kalite kuralını kaldıran yetkiler (tam_onay gibi) farkında olmadan
// herkeste açık kalmamalı — sunucudaki hasExactRole ile aynı mantık.
export function hasExact(roles, wanted) {
  return roleList(roles).indexOf(wanted) !== -1;
}

export function sees(roles, view) {
  const mine = roleList(roles);
  if (mine.indexOf("admin") !== -1) return true;
  const allow = VIEWS[view];
  if (!allow) return false;
  return allow.some(function (r) { return mine.indexOf(r) !== -1; });
}

export function roleLabels(roles) {
  return roleList(roles).map(function (r) { return ROLES[r] || r; });
}
