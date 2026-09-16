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
export const APP_VERSION = "2026.09.16k";

export const PLANT_NAME = "TAFE Manisa";

// Mesai düzeni. Bütün süre hesapları bunun DIŞINDAKİ saatleri saymaz: bir
// traktör 17:30'da adıma girdiyse ertesi sabah 08:30'da "1 sa" görünür,
// "15 sa" değil. Vardiya değişirse yalnızca burası düzenlenir.
export const WORK = {
  days: [1, 2, 3, 4, 5],          // Pazartesi–Cuma (0 = Pazar)
  start: "08:00",
  end: "18:00",
  breaks: [["10:15", "10:30"], ["12:30", "13:45"], ["15:30", "15:45"]]
};
