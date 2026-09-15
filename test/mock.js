// Sahte Firebase. Gerçek sunucuya bağlanmadan bütün akışları koşturur.
//
// index.html'den ÖNCE yüklenir ve window.__TT_MOCK__ değişkenini kurar;
// js/fb.js bu değişkeni görürse gerçek SDK'yı hiç indirmez.
//
// Kapsam: uygulamanın kullandığı işlemler. firestore.rules BURADA
// UYGULANMAZ — kural katmanı Firebase Console'daki Rules Playground ya da
// emülatörle ayrıca denenir.

(function () {
  const store = new Map();          // "yol/parca" -> veri nesnesi
  const watchers = [];              // {key, isCollection, cb}

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function pathOf(ref) { return ref.__path; }

  function makeRef(segments) {
    const path = segments.join("/");
    return { __path: path, __segs: segments, id: segments[segments.length - 1] };
  }

  function snapOfDoc(key) {
    const v = store.get(key);
    return {
      exists: function () { return v !== undefined; },
      data: function () { return clone(v); },
      id: key.split("/").pop()
    };
  }

  function docsUnder(collectionPath) {
    const depth = collectionPath.split("/").length + 1;
    const out = [];
    store.forEach(function (v, k) {
      if (k.indexOf(collectionPath + "/") !== 0) return;
      if (k.split("/").length !== depth) return;
      out.push({ id: k.split("/").pop(), __key: k, data: function () { return clone(v); } });
    });
    return out;
  }

  function snapOfCollection(collectionPath, constraints) {
    let rows = docsUnder(collectionPath);
    (constraints || []).forEach(function (c) {
      if (c.type === "where") {
        rows = rows.filter(function (r) {
          const val = r.data()[c.field];
          if (c.op === "==") return val === c.value;
          if (c.op === "!=") return val !== c.value;
          if (c.op === "in") return (c.value || []).indexOf(val) !== -1;
          if (c.op === ">=") return val >= c.value;
          if (c.op === "<=") return val <= c.value;
          return true;
        });
      }
      if (c.type === "orderBy") {
        rows.sort(function (a, b) {
          const x = a.data()[c.field], y = b.data()[c.field];
          const r = x === y ? 0 : (x > y ? 1 : -1);
          return c.dir === "desc" ? -r : r;
        });
      }
      if (c.type === "limit") rows = rows.slice(0, c.n);
    });
    return {
      forEach: function (fn) { rows.forEach(fn); },
      size: rows.length,
      docs: rows
    };
  }

  function notify(changedKey) {
    watchers.forEach(function (w) {
      if (w.isCollection) {
        const depth = w.key.split("/").length + 1;
        if (changedKey.indexOf(w.key + "/") !== 0) return;
        if (changedKey.split("/").length !== depth) return;
        w.cb(snapOfCollection(w.key, w.constraints));
      } else if (w.key === changedKey) {
        w.cb(snapOfDoc(w.key));
      }
    });
  }

  function writeDoc(key, value, merge) {
    const prev = store.get(key);
    let next = clone(value);
    // serverTimestamp yer tutucusunu gerçek zamana çevir
    Object.keys(next).forEach(function (k) {
      if (next[k] && next[k].__serverTimestamp) next[k] = new Date().toISOString();
    });
    if (merge && prev) next = Object.assign({}, prev, next);
    store.set(key, next);
    notify(key);
  }

  /* ---------------- auth ---------------- */

  const users = new Map();          // e-posta -> {password, verified, displayName}
  let current = null;
  const authWatchers = [];
  const mails = [];

  function fireAuth() {
    authWatchers.forEach(function (cb) { cb(current); });
  }

  function authErr(code) { const e = new Error(code); e.code = code; return e; }

  const auth = {
    get currentUser() { return current; }
  };

  const api = {
    app: {}, auth: auth, db: {},

    /* --- auth --- */
    GoogleAuthProvider: function () { this.setCustomParameters = function () {}; },
    signInWithPopup: async function () {
      // Test sürücüsü window.__MOCK_GOOGLE__ ile hangi hesabın geleceğini söyler.
      const mail = (window.__MOCK_GOOGLE__ || "").toLowerCase();
      if (!mail) throw authErr("auth/popup-closed-by-user");
      current = { email: mail, emailVerified: true, displayName: window.__MOCK_GOOGLE_NAME__ || mail };
      fireAuth();
      return { user: current };
    },
    signOut: async function () { current = null; fireAuth(); },
    onAuthStateChanged: function (a, cb) {
      authWatchers.push(cb);
      setTimeout(function () { cb(current); }, 0);
      return function () {};
    },
    createUserWithEmailAndPassword: async function (a, mail, pass) {
      mail = String(mail).toLowerCase();
      if (users.has(mail)) throw authErr("auth/email-already-in-use");
      if (!pass || pass.length < 6) throw authErr("auth/weak-password");
      users.set(mail, { password: pass, verified: false, displayName: "" });
      current = { email: mail, emailVerified: false, displayName: "" };
      fireAuth();
      return { user: current };
    },
    signInWithEmailAndPassword: async function (a, mail, pass) {
      mail = String(mail).toLowerCase();
      const u = users.get(mail);
      if (!u) throw authErr("auth/user-not-found");
      if (u.password !== pass) throw authErr("auth/invalid-credential");
      current = { email: mail, emailVerified: u.verified, displayName: u.displayName || "" };
      fireAuth();
      return { user: current };
    },
    sendEmailVerification: async function (u) { mails.push({ to: u.email, kind: "verify" }); },
    sendPasswordResetEmail: async function (a, mail) { mails.push({ to: mail, kind: "reset" }); },
    updateProfile: async function (u, p) {
      const rec = users.get(u.email);
      if (rec) rec.displayName = p.displayName || "";
      u.displayName = p.displayName || "";
    },
    reload: async function (u) {
      const rec = users.get(u.email);
      if (rec) { u.emailVerified = rec.verified; u.displayName = rec.displayName || u.displayName; }
      if (current && rec) { current.emailVerified = rec.verified; }
    },

    /* --- firestore --- */
    doc: function (db) {
      const segs = Array.prototype.slice.call(arguments, 1);
      return makeRef(segs);
    },
    collection: function (db) {
      const segs = Array.prototype.slice.call(arguments, 1);
      const ref = makeRef(segs);
      ref.__isCollection = true;
      return ref;
    },
    getDoc: async function (ref) { return snapOfDoc(pathOf(ref)); },
    getDocs: async function (refOrQuery) {
      if (refOrQuery.__query) {
        return snapOfCollection(pathOf(refOrQuery.__ref), refOrQuery.__constraints);
      }
      return snapOfCollection(pathOf(refOrQuery), []);
    },
    setDoc: async function (ref, value, opts) {
      writeDoc(pathOf(ref), value, !!(opts && opts.merge));
    },
    updateDoc: async function (ref, patch) { writeDoc(pathOf(ref), patch, true); },
    deleteDoc: async function (ref) {
      const k = pathOf(ref);
      store.delete(k); notify(k);
    },
    addDoc: async function (ref, value) {
      const id = "auto" + Math.random().toString(36).slice(2, 10);
      writeDoc(pathOf(ref) + "/" + id, value, false);
      return makeRef(ref.__segs.concat([id]));
    },
    onSnapshot: function (refOrQuery, cb, errCb) {
      const isQuery = !!refOrQuery.__query;
      const ref = isQuery ? refOrQuery.__ref : refOrQuery;
      const w = {
        key: pathOf(ref),
        isCollection: !!ref.__isCollection,
        constraints: isQuery ? refOrQuery.__constraints : [],
        cb: cb
      };
      watchers.push(w);
      setTimeout(function () {
        w.cb(w.isCollection ? snapOfCollection(w.key, w.constraints) : snapOfDoc(w.key));
      }, 0);
      return function () {
        const i = watchers.indexOf(w);
        if (i !== -1) watchers.splice(i, 1);
      };
    },
    query: function (ref) {
      return { __query: true, __ref: ref,
               __constraints: Array.prototype.slice.call(arguments, 1) };
    },
    where: function (field, op, value) { return { type: "where", field: field, op: op, value: value }; },
    orderBy: function (field, dir) { return { type: "orderBy", field: field, dir: dir || "asc" }; },
    limit: function (n) { return { type: "limit", n: n }; },
    writeBatch: function () {
      const ops = [];
      return {
        set: function (ref, v, o) { ops.push(function () { writeDoc(pathOf(ref), v, !!(o && o.merge)); }); },
        update: function (ref, v) { ops.push(function () { writeDoc(pathOf(ref), v, true); }); },
        delete: function (ref) { ops.push(function () { const k = pathOf(ref); store.delete(k); notify(k); }); },
        commit: async function () { ops.forEach(function (f) { f(); }); }
      };
    },
    runTransaction: async function (db, fn) {
      return fn({
        get: async function (ref) { return snapOfDoc(pathOf(ref)); },
        set: function (ref, v, o) { writeDoc(pathOf(ref), v, !!(o && o.merge)); },
        update: function (ref, v) { writeDoc(pathOf(ref), v, true); },
        delete: function (ref) { const k = pathOf(ref); store.delete(k); notify(k); }
      });
    },
    serverTimestamp: function () { return { __serverTimestamp: true }; }
  };

  window.__TT_MOCK__ = api;

  /* ---------------- test yardımcıları ---------------- */

  window.__MOCK__ = {
    store: store,
    users: users,
    mails: mails,
    // Doğrulama bağlantısına tıklamayı taklit eder.
    verify: function (mail) {
      const u = users.get(String(mail).toLowerCase());
      if (u) u.verified = true;
      if (current && current.email === String(mail).toLowerCase()) current.emailVerified = true;
    },
    // Testte hesap değiştirmek için.
    signInAs: function (mail, name) {
      current = { email: String(mail).toLowerCase(), emailVerified: true, displayName: name || mail };
      fireAuth();
    },
    signOut: function () { current = null; fireAuth(); },
    seedAllowed: function (mail, name, roles, stepCode) {
      writeDoc("allowed/" + String(mail).toLowerCase(),
        { name: name, roles: roles, stepCode: stepCode || "", active: true }, false);
    },
    get: function (key) { return clone(store.get(key)); },
    keys: function (prefix) {
      const out = [];
      store.forEach(function (v, k) { if (!prefix || k.indexOf(prefix) === 0) out.push(k); });
      return out.sort();
    },
    reset: function () { store.clear(); users.clear(); current = null; mails.length = 0; }
  };
})();
