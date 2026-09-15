// Küçük yardımcılar. Çerçeve yok — hepsi burada.

export const $ = function (sel, root) { return (root || document).querySelector(sel); };
export const $$ = function (sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
};

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function el(html) {
  const d = document.createElement("div");
  d.innerHTML = String(html).trim();
  return d.firstElementChild;
}

export function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

/* ---------------- tarih / süre ---------------- */

// Firestore Timestamp, ISO metin ve Date — hepsi Date'e çevrilir.
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === "function") { try { return v.toDate(); } catch (e) { return null; } }
  if (typeof v === "number") return new Date(v);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtDate(v, withTime) {
  const d = toDate(v);
  if (!d) return "—";
  const p = function (n) { return String(n).padStart(2, "0"); };
  const day = p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear();
  if (withTime === false) return day;
  return day + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

export function minutesBetween(a, b) {
  const d0 = toDate(a), d1 = toDate(b);
  if (!d0 || !d1) return 0;
  return (d1.getTime() - d0.getTime()) / 60000;
}

// 95 dakika -> "1 sa 35 dk"
export function fmtMin(m) {
  if (m == null || isNaN(m)) return "—";
  const t = Math.max(0, Math.round(m));
  if (t < 60) return t + " dk";
  const h = Math.floor(t / 60), r = t % 60;
  return r ? h + " sa " + r + " dk" : h + " sa";
}

export function fmtNum(n, dec) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("tr-TR", {
    minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0
  });
}

export function nowISO() { return new Date().toISOString(); }

/* ---------------- kimlik ---------------- */

// Firestore belge kimliği: sıralanabilir olsun diye zaman önde.
export function newId(prefix) {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return (prefix ? prefix + "-" : "") + t + r;
}

export function normChassis(s) {
  return String(s || "").trim().toUpperCase();
}

// Şasi numarasının son 6 hanesi — sahada traktör bu numarayla anılır
// (MEA98449TM1501492 → 501492; 941489 → 941489).
export function shortChassis(s) {
  const v = normChassis(s);
  return v.length > 6 ? v.slice(-6) : v;
}

/* ---------------- Türkçe'ye duyarsız arama ---------------- */

// "Kaçak" ile "kacak", "İş" ile "is" eşleşsin diye: Türkçe küçük harfe çevirir,
// ı/ğ/ş/ç/ö/ü'yü sade harfe indirger, noktalama ve fazla boşluğu temizler.
// Python tarafındaki (seed üretimi) fold ile aynı sonucu verir.
const TR_MAP = { "ı": "i", "ğ": "g", "ş": "s", "ç": "c", "ö": "o", "ü": "u", "â": "a", "î": "i", "û": "u" };
export function fold(s) {
  let t = String(s || "").replace(/I/g, "ı").replace(/İ/g, "i").toLowerCase();
  t = t.replace(/[ığşçöüâîû]/g, function (ch) { return TR_MAP[ch] || ch; });
  t = t.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  t = t.replace(/[\s\-_/,.;:!?()\[\]"']+/g, " ").trim();
  return t;
}

// Aranan kelimelerin HEPSİ metinde geçiyorsa eşleşir (sıra önemsiz):
// "sol maşpiyel" → "Sol ön maşpiyel yok" bulunur.
export function matchesAll(text, query) {
  const t = fold(text);
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  return words.every(function (w) { return t.indexOf(w) !== -1; });
}

/* ---------------- bildirim ---------------- */

export function toast(msg, kind) {
  const host = $("#toast-host");
  if (!host) return;
  const t = el('<div class="toast ' + (kind === "err" ? "toast-err" : kind === "ok" ? "toast-ok" : "") +
               '">' + esc(msg) + "</div>");
  host.appendChild(t);
  setTimeout(function () { t.classList.add("out"); }, kind === "err" ? 5200 : 3200);
  setTimeout(function () { t.remove(); }, kind === "err" ? 5600 : 3600);
}
