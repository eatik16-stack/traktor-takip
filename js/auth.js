// Giriş ve yetki kapısı.
//
// İki yoldan girilir: e-posta + şifre ya da Google. Hangisi olursa olsun
// girmek yetmez — kişinin e-postası Firestore'daki "allowed" koleksiyonunda
// kayıtlı olmalı. Kayıtlı değilse bir kereliğine erişim talebi bırakır;
// yöneticinin verdiği roller hangi ekranları göreceğini belirler.

import { fb } from "./fb.js";
import { lsGet, lsSet } from "./util.js";
import { DEFAULT_ROLES, has, hasExact, sees, roleList } from "./roles.js";

// Doğrulanmamış hesap Firestore'a yazamaz (kurallar email_verified istiyor),
// bu yüzden talep bilgisi doğrulama tamamlanana kadar tarayıcıda bekler.
const DRAFT_KEY = "traktor.talep";

export const session = {
  // loading | anon | unverified | denied | pending | rejected | ready | error
  state: "loading",
  user: null,       // { email, name, photo, verified }
  member: null,     // allowed/<e-posta>: { name, roles[], stepCode }
  request: null,    // requests/<e-posta>
  error: ""
};

/* ---------------- rol ---------------- */

export function myRoles() {
  return (session.member && roleList(session.member.roles)) || DEFAULT_ROLES;
}
export function can(wanted)      { return !!session.member && has(myRoles(), wanted); }
// Sistem yöneticiliğinin yetmediği yetkiler için (tam_onay gibi).
export function canExact(wanted) { return !!session.member && hasExact(myRoles(), wanted); }
export function isAdmin()        { return can("admin") && myRoles().indexOf("admin") !== -1; }
export function canSee(view)     { return !!session.member && sees(myRoles(), view); }

export function myEmail() {
  return session.user ? String(session.user.email || "").toLowerCase() : "";
}
export function myName() {
  if (session.member && session.member.name) return session.member.name;
  if (session.user && session.user.name) return session.user.name;
  return myEmail();
}
// Kişinin varsayılan istasyonu — "İstasyonum" ekranı bunu kullanır.
export function myStepCode() {
  return (session.member && session.member.stepCode) || "";
}

/* ---------------- oturum ---------------- */

function readDraft() {
  try { return JSON.parse(lsGet(DRAFT_KEY) || "null"); } catch (e) { return null; }
}
function writeDraft(v) { lsSet(DRAFT_KEY, v ? JSON.stringify(v) : ""); }

let notify = function () {};

async function evaluate(user) {
  if (!user) {
    session.state = "anon"; session.user = null;
    session.member = null; session.request = null;
    return;
  }

  session.user = {
    email: String(user.email || "").toLowerCase(),
    name: user.displayName || "",
    photo: user.photoURL || "",
    verified: user.emailVerified !== false
  };

  if (!session.user.verified) {
    session.state = "unverified";
    session.member = null; session.request = null;
    return;
  }

  const f = await fb();

  try {
    const snap = await f.getDoc(f.doc(f.db, "allowed", session.user.email));
    if (snap.exists()) {
      const data = snap.data() || {};
      session.member = Object.assign({}, data, { roles: roleList(data.roles) });
      if (!session.member.roles.length) session.member.roles = DEFAULT_ROLES.slice();
      session.request = null;
      session.state = "ready";
      return;
    }
  } catch (e) {
    // Kurallar okumayı engellediğinde de sonuç aynı: yetki yok.
    session.error = (e && e.message) || "";
  }

  session.member = null;

  // Doğrulama beklerken bırakılmış talep varsa şimdi yazılır.
  const draft = readDraft();
  if (draft && draft.email === session.user.email) {
    try { await writeRequest(draft.name, draft.gorev); writeDraft(null); }
    catch (e) { session.error = (e && e.message) || ""; }
  }

  try {
    const rs = await f.getDoc(f.doc(f.db, "requests", session.user.email));
    if (rs.exists()) {
      session.request = Object.assign({}, rs.data());
      session.state = session.request.status === "reddedildi" ? "rejected" : "pending";
      return;
    }
  } catch (e) {
    session.error = (e && e.message) || "";
  }

  session.request = null;
  session.state = "denied";
}

export async function watchSession(onChange) {
  notify = onChange;
  let f;
  try {
    f = await fb();
  } catch (e) {
    session.state = "error";
    session.error = (e && e.message) || "Firebase başlatılamadı.";
    onChange(session);
    return;
  }
  f.onAuthStateChanged(f.auth, async function (user) {
    await evaluate(user);
    onChange(session);
  });
}

export async function refreshSession() {
  const f = await fb();
  const u = f.auth.currentUser;
  if (u && f.reload) { try { await f.reload(u); } catch (e) {} }
  await evaluate(f.auth.currentUser);
  notify(session);
}

/* ---------------- giriş ---------------- */

function authError(e, fallback) {
  const code = (e && e.code) || "";
  const map = {
    "auth/invalid-email": "E-posta adresi geçersiz.",
    "auth/user-disabled": "Bu hesap devre dışı bırakılmış.",
    "auth/user-not-found": "Bu e-postayla kayıtlı hesap yok.",
    "auth/wrong-password": "Şifre hatalı.",
    "auth/invalid-credential": "E-posta veya şifre hatalı.",
    "auth/too-many-requests": "Çok fazla deneme yapıldı. Bir süre sonra tekrar deneyin.",
    "auth/email-already-in-use": "Bu e-postayla zaten bir hesap var. Şifrenizle giriş yapın.",
    "auth/weak-password": "Şifre en az 6 karakter olmalı.",
    "auth/network-request-failed": "İnternet bağlantısı kurulamadı.",
    "auth/unauthorized-domain": "Bu adres Firebase'de yetkili değil. Authentication → Settings → Authorized domains listesine eklenmeli.",
    "auth/operation-not-allowed": "Bu giriş yöntemi Firebase'de açık değil. Authentication → Sign-in method bölümünden açılmalı."
  };
  return new Error(map[code] || (e && e.message) || fallback || "İşlem tamamlanamadı.");
}

export async function signIn() {
  const f = await fb();
  const provider = new f.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await f.signInWithPopup(f.auth, provider);
  } catch (e) {
    const code = (e && e.code) || "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
    throw authError(e, "Google ile giriş yapılamadı.");
  }
}

export async function signInWithPassword(email, password) {
  const f = await fb();
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || !password) throw new Error("E-posta ve şifre gerekli.");
  try { await f.signInWithEmailAndPassword(f.auth, mail, password); }
  catch (e) { throw authError(e, "Giriş yapılamadı."); }
}

export async function signOutNow() {
  const f = await fb();
  await f.signOut(f.auth);
}

export async function resetPassword(email) {
  const f = await fb();
  const mail = String(email || "").trim().toLowerCase();
  if (!mail) throw new Error("Önce e-posta adresinizi yazın.");
  try { await f.sendPasswordResetEmail(f.auth, mail); }
  catch (e) { throw authError(e, "Şifre sıfırlama e-postası gönderilemedi."); }
}

/* ---------------- erişim talebi ---------------- */

async function writeRequest(name, gorev) {
  const f = await fb();
  await f.setDoc(f.doc(f.db, "requests", myEmail()), {
    email: myEmail(),
    name: String(name || "").trim(),
    gorev: String(gorev || "").trim(),
    status: "bekliyor",
    at: new Date().toISOString()
  });
}

export async function registerAndRequest(name, email, password, gorev) {
  const f = await fb();
  const mail = String(email || "").trim().toLowerCase();
  if (!String(name || "").trim()) throw new Error("Ad soyad gerekli.");
  if (!mail) throw new Error("E-posta gerekli.");
  if (!gorev || !String(gorev).trim()) throw new Error("Görevinizi yazın (örn. RDC kontrolörü).");
  if (!password || password.length < 6) throw new Error("Şifre en az 6 karakter olmalı.");

  writeDraft({ email: mail, name: String(name).trim(), gorev: String(gorev).trim() });

  try {
    const cred = await f.createUserWithEmailAndPassword(f.auth, mail, password);
    if (f.updateProfile && cred && cred.user) {
      try { await f.updateProfile(cred.user, { displayName: String(name).trim() }); } catch (e) {}
    }
    if (f.sendEmailVerification && cred && cred.user) await f.sendEmailVerification(cred.user);
  } catch (e) {
    writeDraft(null);
    throw authError(e, "Hesap oluşturulamadı.");
  }
}

export async function submitRequest(name, gorev) {
  if (!String(name || "").trim()) throw new Error("Ad soyad gerekli.");
  if (!String(gorev || "").trim()) throw new Error("Görevinizi yazın.");
  try {
    await writeRequest(name, gorev);
  } catch (e) {
    const msg = (e && e.message) || "";
    if (/permission|insufficient/i.test(msg)) {
      throw new Error("Talep gönderilemedi. Bu e-postayla daha önce talep bırakılmış olabilir.");
    }
    throw e;
  }
  await refreshSession();
}

export async function resendVerification() {
  const f = await fb();
  const u = f.auth.currentUser;
  if (!u) throw new Error("Önce giriş yapın.");
  try { await f.sendEmailVerification(u); }
  catch (e) { throw authError(e, "Doğrulama e-postası gönderilemedi."); }
}
