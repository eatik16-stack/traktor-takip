// Küçük yardımcılar. Çerçeve yok — hepsi burada.

import { WORK } from "./config.js";

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

// Üst başlıkta görünen bugünün tarihi: "15 Eylül 2026 · Salı".
// Tarayıcının dil ayarına bağlı kalmasın diye adlar burada sabit.
const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
               "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const GUNLER = ["Pazar", "Pazartesi", "Salı", "Çarşamba",
                "Perşembe", "Cuma", "Cumartesi"];

export function todayLabel(v) {
  const d = toDate(v) || new Date();
  return d.getDate() + " " + AYLAR[d.getMonth()] + " " + d.getFullYear() +
         " · " + GUNLER[d.getDay()];
}

export function minutesBetween(a, b) {
  const d0 = toDate(a), d1 = toDate(b);
  if (!d0 || !d1) return 0;
  return (d1.getTime() - d0.getTime()) / 60000;
}

/* ---------------- mesai süresi ---------------- */

// Duvar saati yanıltır: 17:30'da adıma giren traktör ertesi sabah 08:30'da
// "15 saattir bekliyor" görünürdü, oysa fiilen 1 saat beklemiştir. Aşağıdaki
// hesap yalnızca MESAİ dakikalarını sayar — mesai dışı, hafta sonu ve molalar
// düşülür. Vardiya düzeni config.js'teki WORK içinde.
function hm(s) {
  const p = String(s || "0:0").split(":");
  return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
}
const W_DAYS   = WORK.days && WORK.days.length ? WORK.days : [1, 2, 3, 4, 5];
const W_START  = hm(WORK.start);
const W_END    = hm(WORK.end);
const W_BREAKS = (WORK.breaks || []).map(function (b) { return [hm(b[0]), hm(b[1])]; });

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

// Bir çalışma gününün [from, to] diliminde kaç mesai dakikası var
// (from/to: gün başından itibaren dakika, 0–1440).
function dayWork(from, to) {
  let m = overlap(from, to, W_START, W_END);
  if (m <= 0) return 0;
  const lo = Math.max(from, W_START), hi = Math.min(to, W_END);
  W_BREAKS.forEach(function (b) { m -= overlap(lo, hi, b[0], b[1]); });
  return Math.max(0, m);
}

// Tam bir mesai gününün dakikası (molalar düşülmüş).
export const DAILY_WORK_MINUTES = dayWork(0, 1440);

function isWorkDay(d) { return W_DAYS.indexOf(d.getDay()) !== -1; }

// Gün başından itibaren dakika. Yaz saati uygulansa bile doğru kalsın diye
// milisaniye farkı yerine saatin kendisi okunur.
function minuteOfDay(d) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function midnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

// n gün boyunca kaç tanesi çalışma günü — gün gün dolaşmadan.
function workDayCount(start, n) {
  if (n <= 0) return 0;
  let c = Math.floor(n / 7) * W_DAYS.length;
  const dow = start.getDay();
  for (let i = 0; i < n % 7; i++) {
    if (W_DAYS.indexOf((dow + i) % 7) !== -1) c++;
  }
  return c;
}

export function workMinutes(a, b) {
  const s = toDate(a), e = toDate(b);
  if (!s || !e || e <= s) return 0;

  const d0 = midnight(s), dN = midnight(e);
  if (d0.getTime() === dN.getTime()) {
    return isWorkDay(s) ? dayWork(minuteOfDay(s), minuteOfDay(e)) : 0;
  }

  let total = 0;
  if (isWorkDay(d0)) total += dayWork(minuteOfDay(s), 1440);
  if (isWorkDay(dN)) total += dayWork(0, minuteOfDay(e));

  const between = Math.round((dN.getTime() - d0.getTime()) / 86400000) - 1;
  if (between > 0) {
    const first = new Date(d0); first.setDate(first.getDate() + 1);
    total += workDayCount(first, between) * DAILY_WORK_MINUTES;
  }
  return total;
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
