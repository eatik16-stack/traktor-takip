// Yönlendirme, gezinme ve giriş ekranı.

import { $, $$, esc, el, toast } from "./util.js";
import { APP_VERSION, PLANT_NAME } from "./config.js";
import { session, watchSession, refreshSession, signIn, signInWithPassword, signOutNow,
         resetPassword, registerAndRequest, submitRequest, resendVerification,
         myName, myEmail, canSee, isAdmin, can } from "./auth.js";
import { roleLabels } from "./roles.js";
import { data, onData, startWatching, stopWatching, watchRequests } from "./store.js";
import * as V from "./views.js";
import * as A from "./views-admin.js";
import * as flow from "./flow.js";

/* ---------------- ekranlar ---------------- */

const NAV = [
  { id: "sema",       label: "Canlı Şema",        icon: "🗺️", tab: true },
  { id: "istasyon",   label: "İstasyonum",        icon: "🎯", tab: true },
  { id: "rework",     label: "Rework",            icon: "🔧", tab: true, badge: "rework" },
  { id: "onay",       label: "Onay Bekleyenler",  icon: "✅", tab: true, badge: "onay" },
  { id: "traktorler", label: "Traktörler",        icon: "🚜" },
  { id: "hatalar",    label: "Hata Kayıtları",    icon: "⚠️" },
  { id: "rapor",      label: "Yönetim Raporu",    icon: "📊", sec: "Raporlama" },
  { id: "onaysiz",    label: "Onaysız Traktörler",icon: "⏳" },
  { id: "talepler",   label: "Erişim Talepleri",  icon: "📬", sec: "Sistem", badge: "talep" },
  { id: "tanimlar",   label: "Tanımlar",          icon: "⚙️" }
];

const ROUTES = {
  sema: V.sema, istasyon: V.istasyon, rework: V.rework, onay: V.onay,
  traktorler: V.traktorler, traktor: V.traktor, hatalar: V.hatalar,
  onaysiz: V.onaysiz, rapor: A.rapor, talepler: A.talepler, tanimlar: A.tanimlar
};

function visibleNav() {
  return NAV.filter(function (n) { return canSee(n.id); });
}

function badgeCount(kind) {
  if (kind === "rework") {
    return data.defects.filter(function (d) { return d.status === "acik"; }).length;
  }
  if (kind === "onay") {
    return data.defects.filter(function (d) { return d.status === "rework_tamam"; }).length;
  }
  if (kind === "talep") {
    return data.requests.filter(function (r) { return r.status === "bekliyor"; }).length;
  }
  return 0;
}

/* ---------------- gezinme ---------------- */

function currentRoute() {
  const h = (location.hash || "").replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  return { name: parts[0] || "", params: parts.slice(1) };
}

function defaultRoute() {
  const nav = visibleNav();
  return nav.length ? nav[0].id : "";
}

function renderNav() {
  const cur = currentRoute().name;
  const nav = visibleNav();

  // Kenar çubuğu (geniş ekran)
  const side = $("#sidebar");
  let lastSec = null;
  side.innerHTML = nav.map(function (n) {
    let out = "";
    if (n.sec && n.sec !== lastSec) { out += '<div class="sec">' + esc(n.sec) + "</div>"; lastSec = n.sec; }
    const c = n.badge ? badgeCount(n.badge) : 0;
    out += '<button data-nav="' + n.id + '" class="' + (n.id === cur ? "on" : "") + '">' +
      "<span>" + n.icon + "</span><span>" + esc(n.label) + "</span>" +
      (c ? '<span class="nav-count">' + c + "</span>" : "") + "</button>";
    return out;
  }).join("") + '<div class="nav-version">Sürüm ' + esc(APP_VERSION) + "</div>";

  // Alt çubuk (telefon): ilk 4 ekran + "Daha fazla"
  const tabs = nav.filter(function (n) { return n.tab; }).slice(0, 4);
  const rest = nav.filter(function (n) { return tabs.indexOf(n) === -1; });
  const bar = $("#tabbar");
  bar.innerHTML = tabs.map(function (n) {
    const c = n.badge ? badgeCount(n.badge) : 0;
    return '<button data-nav="' + n.id + '" class="' + (n.id === cur ? "on" : "") + '">' +
      '<span class="ic">' + n.icon + "</span><span>" + esc(n.label.split(" ")[0]) + "</span>" +
      (c ? '<span class="badge">' + c + "</span>" : "") + "</button>";
  }).join("") + (rest.length
    ? '<button id="more-btn" class="' + (rest.some(function (n) { return n.id === cur; }) ? "on" : "") + '">' +
      '<span class="ic">☰</span><span>Daha</span>' +
      (rest.some(function (n) { return n.badge && badgeCount(n.badge); })
        ? '<span class="badge">!</span>' : "") + "</button>"
    : "");

  $$("[data-nav]").forEach(function (b) {
    b.onclick = function () { location.hash = "#/" + b.dataset.nav; };
  });
  const more = $("#more-btn");
  if (more) more.onclick = function () { openMore(rest); };
}

function openMore(items) {
  const sheet = el('<div class="more-sheet"><div class="sheet">' + items.map(function (n) {
    const c = n.badge ? badgeCount(n.badge) : 0;
    return '<button data-nav="' + n.id + '"><span>' + n.icon + "</span><span>" + esc(n.label) + "</span>" +
      (c ? '<span class="nav-count" style="margin-left:auto">' + c + "</span>" : "") + "</button>";
  }).join("") + "</div></div>");
  sheet.addEventListener("click", function (e) { if (e.target === sheet) sheet.remove(); });
  $$("[data-nav]", sheet).forEach(function (b) {
    b.onclick = function () { sheet.remove(); location.hash = "#/" + b.dataset.nav; };
  });
  document.body.appendChild(sheet);
}

/* ---------------- çizim ---------------- */

let drawing = false;

async function render() {
  if (session.state !== "ready") return;
  const view = $("#view");

  // Tanımlar hiç yüklenmemişse önce kurulum ekranı.
  if (!data.steps.length) {
    renderNav();
    if (isAdmin()) A.seedScreen(view, [], render);
    else view.innerHTML = '<div class="empty"><span class="ic">⏳</span>' +
      "Sistem henüz kurulmadı. Yöneticinin başlangıç verilerini yüklemesi gerekiyor.</div>";
    return;
  }

  let r = currentRoute();
  if (!r.name || (!ROUTES[r.name])) {
    location.replace("#/" + defaultRoute());
    r = currentRoute();
    if (!ROUTES[r.name]) return;
  }
  // Görme yetkisi olmayan ekran istenirse ilk ekrana düşer.
  if (r.name !== "traktor" && !canSee(r.name)) {
    location.replace("#/" + defaultRoute());
    return;
  }

  renderNav();
  if (drawing) return;
  drawing = true;
  try {
    await ROUTES[r.name](view, r.params, render);
  } catch (e) {
    console.error(e);
    view.innerHTML = '<div class="banner bad">Ekran çizilemedi: ' + esc((e && e.message) || "") + "</div>";
  } finally { drawing = false; }
}

/* ---------------- giriş ekranı ---------------- */

function loginSlot(html) { $("#login-slot").innerHTML = html; }

function showLogin() {
  $("#login").hidden = false;
  $("#app").hidden = true;
  $("#login-plant").textContent = PLANT_NAME;

  const s = session.state;

  if (s === "loading") { loginSlot('<p class="card-sub">Yükleniyor…</p>'); return; }

  if (s === "error") {
    loginSlot('<div class="banner bad">Bağlantı kurulamadı.<br><small>' + esc(session.error) +
      "</small></div>");
    return;
  }

  if (s === "anon") {
    loginSlot(
      '<button class="btn btn-lg btn-block" id="g-btn">Google ile giriş yap</button>' +
      '<div class="login-or">veya</div>' +
      '<label class="field"><span>E-posta</span><input class="input" id="l-mail" type="email" autocomplete="username"></label>' +
      '<label class="field"><span>Şifre</span><input class="input" id="l-pass" type="password" autocomplete="current-password"></label>' +
      '<p class="form-error" id="l-err" hidden></p>' +
      '<button class="btn btn-primary btn-lg btn-block" id="l-btn">Giriş Yap</button>' +
      '<div style="display:flex;justify-content:space-between;margin-top:10px">' +
        '<button class="link-btn" id="l-forgot">Şifremi unuttum</button>' +
        '<button class="link-btn" id="l-req">Erişim izni isteyin</button></div>' +
      '<p class="login-hint">Kendi hesabınızla girin — yaptığınız her kayıt adınıza işlenir.</p>');

    const showErr = function (m) {
      const e = $("#l-err"); e.textContent = m; e.hidden = !m;
    };
    $("#g-btn").onclick = async function () {
      showErr(""); try { await signIn(); } catch (e) { showErr(e.message); }
    };
    $("#l-btn").onclick = async function () {
      showErr("");
      try { await signInWithPassword($("#l-mail").value, $("#l-pass").value); }
      catch (e) { showErr(e.message); }
    };
    $("#l-pass").onkeydown = function (e) { if (e.key === "Enter") $("#l-btn").click(); };
    $("#l-forgot").onclick = async function () {
      showErr("");
      try { await resetPassword($("#l-mail").value); toast("Şifre sıfırlama e-postası gönderildi.", "ok"); }
      catch (e) { showErr(e.message); }
    };
    $("#l-req").onclick = function () { showRequestForm(); };
    return;
  }

  if (s === "unverified") {
    loginSlot('<div class="banner">E-posta adresinizi doğrulayın.<br><small>' +
      esc(myEmail()) + " adresine bir doğrulama bağlantısı gönderdik. " +
      "Bağlantıya tıkladıktan sonra aşağıdaki düğmeye basın.</small></div>" +
      '<button class="btn btn-primary btn-lg btn-block" id="v-ok">Doğruladım, devam et</button>' +
      '<div style="display:flex;justify-content:space-between;margin-top:10px">' +
        '<button class="link-btn" id="v-again">Tekrar gönder</button>' +
        '<button class="link-btn" id="v-out">Çıkış</button></div>');
    $("#v-ok").onclick = function () { refreshSession(); };
    $("#v-again").onclick = async function () {
      try { await resendVerification(); toast("Doğrulama e-postası gönderildi.", "ok"); }
      catch (e) { toast(e.message, "err"); }
    };
    $("#v-out").onclick = function () { signOutNow(); };
    return;
  }

  if (s === "pending") {
    loginSlot('<div class="banner info">Talebiniz yöneticiye iletildi.<br><small>' +
      esc(myEmail()) + " · onaylandığında bu ekrandan girebileceksiniz.</small></div>" +
      '<button class="btn btn-block" id="p-again">Durumu yenile</button>' +
      '<button class="link-btn" id="p-out" style="display:block;margin:10px auto 0">Çıkış</button>');
    $("#p-again").onclick = function () { refreshSession(); };
    $("#p-out").onclick = function () { signOutNow(); };
    return;
  }

  if (s === "rejected") {
    loginSlot('<div class="banner bad">Erişim talebiniz onaylanmadı.<br><small>' +
      "Gerekiyorsa kalite biriminden yetki isteyin.</small></div>" +
      '<button class="link-btn" id="r-out" style="display:block;margin:10px auto 0">Çıkış</button>');
    $("#r-out").onclick = function () { signOutNow(); };
    return;
  }

  // denied
  loginSlot('<div class="banner">Bu hesabın giriş yetkisi yok.<br><small>' + esc(myEmail()) +
    "</small></div>" +
    '<button class="btn btn-primary btn-lg btn-block" id="d-req">Erişim izni isteyin</button>' +
    '<button class="link-btn" id="d-out" style="display:block;margin:10px auto 0">Başka hesapla gir</button>');
  $("#d-req").onclick = function () { showRequestForm(true); };
  $("#d-out").onclick = function () { signOutNow(); };
}

function showRequestForm(signedIn) {
  loginSlot('<h3 style="margin-bottom:10px">Erişim izni isteyin</h3>' +
    '<p class="card-sub" style="margin-bottom:12px">Talebiniz yöneticiye düşer; ' +
      "onaylandığında hangi ekranları göreceğiniz belirlenir.</p>" +
    '<label class="field"><span>Ad Soyad *</span><input class="input" id="q-name"></label>' +
    (signedIn ? "" :
      '<label class="field"><span>E-posta *</span><input class="input" id="q-mail" type="email"></label>' +
      '<label class="field"><span>Şifre belirleyin *</span><input class="input" id="q-pass" type="password" autocomplete="new-password"></label>') +
    '<label class="field"><span>Görevi­niz *</span><input class="input" id="q-gorev" placeholder="Örn. RDC kontrolörü, rework operatörü"></label>' +
    '<p class="form-error" id="q-err" hidden></p>' +
    '<button class="btn btn-primary btn-lg btn-block" id="q-btn">Talebi Gönder</button>' +
    '<button class="link-btn" id="q-back" style="display:block;margin:10px auto 0">← Geri</button>');

  const showErr = function (m) { const e = $("#q-err"); e.textContent = m; e.hidden = !m; };
  $("#q-btn").onclick = async function () {
    showErr("");
    const btn = $("#q-btn"); btn.disabled = true;
    try {
      if (signedIn) {
        await submitRequest($("#q-name").value, $("#q-gorev").value);
      } else {
        await registerAndRequest($("#q-name").value, $("#q-mail").value,
                                 $("#q-pass").value, $("#q-gorev").value);
        toast("Doğrulama e-postası gönderildi.", "ok");
      }
    } catch (e) { showErr(e.message); btn.disabled = false; }
  };
  $("#q-back").onclick = function () { showLogin(); };
}

/* ---------------- oturum akışı ---------------- */

let watching = false;

async function onSession() {
  if (session.state === "ready") {
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#user-name").textContent = myName();
    $("#user-roles").textContent = roleLabels(
      (session.member && session.member.roles) || []).join(" · ");
    $("#topbar-sub").textContent = PLANT_NAME;

    if (!watching) {
      watching = true;
      await startWatching();
      if (isAdmin()) await watchRequests();
      onData(function () { render(); });
    }
    render();
  } else {
    if (watching) { stopWatching(); watching = false; }
    showLogin();
  }
}

$("#logout-btn").onclick = async function () {
  stopWatching(); watching = false;
  await signOutNow();
};

/* ---------------- ortak tablet: boşta kalınca çıkış ---------------- */
// İstasyon tabletleri paylaşılır. Bir önceki kişi çıkış yapmayı unutursa
// sonraki kayıtlar onun adına işlenir; bu yüzden IDLE_MINUTES hareketsizlikten
// sonra oturum kendiliğinden kapanır. Süre app'in sol altında yazılmaz,
// kişi ekrana dokunduğu sürece sayaç sıfırlanır.
const IDLE_MINUTES = 45;
let lastActivity = Date.now();
["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
  document.addEventListener(ev, function () { lastActivity = Date.now(); }, { passive: true });
});
async function idleCheck() {
  if (session.state !== "ready") return;
  if (Date.now() - lastActivity < IDLE_MINUTES * 60000) return;
  stopWatching(); watching = false;
  await signOutNow();
  toast("Uzun süre işlem yapılmadığı için çıkış yapıldı.", "");
}
setInterval(idleCheck, 60000);
document.addEventListener("visibilitychange", function () { if (!document.hidden) idleCheck(); });

/* ---------------- çevrimdışı göstergesi ---------------- */
// Kayıtlar cihazda tutulur ve bağlantı gelince gönderilir; kişi bunu bilsin.
function netBar() {
  let bar = $("#net-bar");
  if (navigator.onLine) { if (bar) bar.remove(); return; }
  if (bar) return;
  bar = el('<div id="net-bar" class="net-bar">Bağlantı yok — yaptığınız kayıtlar cihazda tutuluyor, bağlantı gelince gönderilecek.</div>');
  document.body.appendChild(bar);
}
window.addEventListener("online", netBar);
window.addEventListener("offline", netBar);
netBar();

window.addEventListener("hashchange", function () { render(); });

showLogin();
watchSession(onSession);

// Süreler ekranda akmaya devam etsin (dakika göstergeleri).
setInterval(function () {
  if (session.state !== "ready") return;
  const r = currentRoute().name;
  if (r === "sema" || r === "istasyon") render();
}, 60000);

// Testlerin içeriye ulaşması için.
if (typeof window !== "undefined") {
  window.__TT__ = { session: session, data: data, flow: flow, render: render, V: V, A: A };
}
