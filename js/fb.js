// Firebase bağlantısı. Tek giriş noktası — SDK sürümü sadece burada geçer.
//
// Test için: sayfa yüklenmeden önce window.__TT_MOCK__ tanımlanmışsa gerçek
// Firebase yerine o kullanılır. Üretimde bu değişken hiç tanımlanmaz.

import { firebaseConfig } from "./config.js";

const V = "12.19.0";
const BASE = "https://www.gstatic.com/firebasejs/" + V + "/";

let bundle = null;

// Dosya deposu AYRI ve GEÇ yüklenir: fotoğraf kullanılmayan bir vardiyada
// tarayıcı bu SDK'yı hiç indirmez. Normal kayıt akışı hızlanmasın diye değil,
// yavaşlamasın diye.
let storeBundle = null;

export async function fbStorage() {
  if (storeBundle) return storeBundle;

  if (typeof window !== "undefined" && window.__TT_MOCK_STORAGE__) {
    storeBundle = window.__TT_MOCK_STORAGE__;
    return storeBundle;
  }

  const base = await fb();
  const stMod = await import(BASE + "firebase-storage.js");
  storeBundle = {
    storage: stMod.getStorage(base.app),
    ref: stMod.ref,
    uploadBytesResumable: stMod.uploadBytesResumable,
    getBytes: stMod.getBytes,
    getDownloadURL: stMod.getDownloadURL
  };
  return storeBundle;
}

export async function fb() {
  if (bundle) return bundle;

  if (typeof window !== "undefined" && window.__TT_MOCK__) {
    bundle = window.__TT_MOCK__;
    return bundle;
  }

  const [appMod, authMod, fsMod] = await Promise.all([
    import(BASE + "firebase-app.js"),
    import(BASE + "firebase-auth.js"),
    import(BASE + "firebase-firestore.js")
  ]);

  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);

  // Fabrika Wi-Fi'si kesilebilir: veriler cihazda önbelleklenir, kesintide
  // yapılan kayıtlar bağlantı gelince kendiliğinden gönderilir. Aynı tablette
  // birden çok sekme açıksa da çakışmasın diye çoklu sekme yöneticisi.
  let db;
  try {
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() })
    });
  } catch (e) {
    db = fsMod.getFirestore(app);
  }

  try { await authMod.setPersistence(auth, authMod.browserLocalPersistence); } catch (e) {}

  bundle = {
    app, auth, db,
    // auth
    GoogleAuthProvider: authMod.GoogleAuthProvider,
    signInWithPopup: authMod.signInWithPopup,
    signOut: authMod.signOut,
    onAuthStateChanged: authMod.onAuthStateChanged,
    createUserWithEmailAndPassword: authMod.createUserWithEmailAndPassword,
    signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
    sendEmailVerification: authMod.sendEmailVerification,
    sendPasswordResetEmail: authMod.sendPasswordResetEmail,
    updateProfile: authMod.updateProfile,
    reload: authMod.reload,
    // firestore
    doc: fsMod.doc,
    collection: fsMod.collection,
    getDoc: fsMod.getDoc,
    getDocs: fsMod.getDocs,
    setDoc: fsMod.setDoc,
    updateDoc: fsMod.updateDoc,
    deleteDoc: fsMod.deleteDoc,
    addDoc: fsMod.addDoc,
    onSnapshot: fsMod.onSnapshot,
    query: fsMod.query,
    where: fsMod.where,
    orderBy: fsMod.orderBy,
    limit: fsMod.limit,
    writeBatch: fsMod.writeBatch,
    runTransaction: fsMod.runTransaction,
    serverTimestamp: fsMod.serverTimestamp
  };
  return bundle;
}
