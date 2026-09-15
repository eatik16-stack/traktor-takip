// Firebase bağlantı değerleri.
//
// Firebase Console → Project settings → Your apps → Web bölümündeki
// firebaseConfig değerleri buraya yazılır. Bu değerlerin herkese açık olması
// normaldir ve güvenlik sorunu değildir: kimin ne görebileceği sunucudaki
// firestore.rules dosyasında belirlenir, bu dosyada değil.

export const firebaseConfig = {
  apiKey: "AIzaSyCQNaahDD5k5A-_qSGsuOwF9Ehtn9y9V7c",
  authDomain: "traktor-takip.firebaseapp.com",
  projectId: "traktor-takip",
  storageBucket: "traktor-takip.firebasestorage.app",
  messagingSenderId: "201291058539",
  appId: "1:201291058539:web:35c8d621c44ffd1768d02e"
};

// Sürüm damgası — her güncellemede değişir. Ekranın sol alt köşesinde görünür;
// "güncelleme bu tablete ulaştı mı?" sorusunu tek bakışta cevaplar.
export const APP_VERSION = "2026.09.15b";

export const PLANT_NAME = "TAFE Manisa";
