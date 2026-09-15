# Traktör Takip Sistemi

TAFE Manisa — roll-down sonrası traktörlerin 11 adımlık onay sürecini takip eder.
Excel'in yerini alır: herkes kendi hesabıyla girer, her kayıt kimin yaptığıyla
birlikte saklanır, hiçbir kayıt izsiz kaybolmaz.

**Canlı adres:** https://eatik16-stack.github.io/traktor-takip/
**Giriş:** Google ile ya da kendi şifresiyle — yalnızca yetkilendirilmiş hesaplar

---

## Nasıl çalışıyor

| Katman | Ne | Nerede |
|---|---|---|
| Arayüz | Statik tek sayfa uygulama, çerçeve yok | GitHub Pages |
| Giriş | Firebase Authentication — Google ve e-posta/şifre | `js/auth.js` |
| Roller | Rol → ekran ve işlem kapsamı | `js/roles.js` |
| Veri | Cloud Firestore, gerçek zamanlı | `js/store.js` |
| İş kuralları | Adım akışı, hata akışı, onay kuralları | `js/flow.js` |
| Yetki | `allowed` koleksiyonu + `firestore.rules` | Firestore |

Telefon, tablet ve bilgisayardan açılır. Telefonda alt çubuk, geniş ekranda
kenar çubuğu gelir; dokunma alanları eldivenli kullanım için büyük tutulmuştur.

Fabrika Wi-Fi'si kesilirse uygulama çalışmaya devam eder: kayıtlar cihazda
tutulur, bağlantı gelince kendiliğinden gönderilir; ekranın üstünde sarı bir
şerit durumu söyler. Paylaşılan tabletlerde 45 dakika işlem yapılmazsa oturum
kendiliğinden kapanır ki sonraki kişinin kayıtları öncekinin adına işlenmesin.

## Sahadaki iki akış

**Kontrol istasyonu (İstasyonum):** kuyruktaki traktör kartında *Başla →
Hata → Tamamla*. Traktör kuyrukta görünmüyorsa şasinin son 6 hanesi yazılıp
bulunur; ilk istasyonda (RDC) yeni traktör de buradan eklenir. Aynı sonla
biten bir traktör zaten hattaysa kayıt açılmadan önce uyarılır — biri altı
haneyi, öbürü tamamını yazmış olabilir.

**Rework:** traktör personelin önüne gelir, personel tablette şasinin **son 6
hanesini** yazar; tek sonuç varsa traktör kendiliğinden açılır ve bütün
hataları listelenir (bir traktörde ortalama 9 hata var). *Tümünü üzerime al*
ile hepsi tek dokunuşla alınır, her biri bitince *Bitti*. Vardiya değişiminde
bitirilemeyen iş *Bırak* ile geri verilir ki başkası alabilsin. Arama boşken
açık hatası olan traktörler, en çok hatası olan önde listelenir.

## Hata tanımı: yazdıkça öneri

Excel'deki süzgeç alışkanlığının karşılığı. Hata kaydı açarken kişi tanımı
yazmaya başlar — "oil" yazınca daha önce kaydedilmiş **Oil flashing** önerisi
gelir, dokununca kategori ve kaynak da dolar. Öneriler:

- Türkçe karaktere duyarsızdır: "kacak" yazan "Kaçak" bulur, "masp" yazan
  hem "maşpiyel" hem "maşbiyel" yazımlarını görür.
- Kelime sırasından bağımsızdır: "sol maşpiyel" → "Sol ön maşpiyel yok".
- Sık kaydedilen önce gelir; seçili kategoridekiler diğerlerinden önce.

Listede olmayan bir hata yazılırsa serbestçe kaydedilir ve kataloğa girer —
bir sonraki sefer o da önerilir. Aynı tanım tekrar yazılınca kopya oluşmaz,
sayacı artar. Katalog, Excel'deki 6.851 gerçek kayıttan (Ağu 2025 – Eyl 2026,
752 traktör) çıkarılmış 2.347 tanımla başlar; farklı yazımlar birleştirilmiş,
en sık yazım esas alınmıştır.

Kimin gireceği **kurallarda değil, veride** tutulur: `allowed/<e-posta>` belgesi
olan girer. `firestore.rules` yalnızca yeni bir koleksiyon ya da rol
eklendiğinde yeniden yayınlanır.

## Kim nasıl giriyor

Yeni kişi kendini ekleyemez, **bir kereliğine erişim talebi** bırakır:

1. Giriş ekranında "Erişim izni isteyin" — ad soyad, e-posta, görevi ve kendi
   belirlediği şifre. (Google ile giren kişi yalnızca ad soyad ve görev yazar.)
2. Firebase doğrulama e-postası yollar. Talep, kişi e-postasını doğrulayana
   kadar Firestore'a **yazılmaz**; doğrulama tamamlanınca yöneticiye düşer.
3. Yönetici **Erişim Talepleri** ekranında görevi görür, rolleri ve varsayılan
   istasyonu seçip onaylar. Kişi ekipte beklenen isimlerden biriyse roller
   kendiliğinden dolu gelir.
4. Kişi bundan sonra e-postası ve şifresiyle ya da Google ile girer.

Talep belgesi e-posta başına tektir ve kurallarda yalnızca *create* açıktır —
reddedilen bir talep kişi tarafından tekrar açılamaz.

## Roller

Bir kişide birden fazla rol olabilir (örn. `kontrol` + `onay`).

| Rol | Ne yapar |
|---|---|
| Sistem Yöneticisi | Hepsi; kullanıcı ve tanım yönetimi |
| Yönetim (sadece rapor) | Yönetim raporu, canlı şema, listeler — kayıt girmez |
| Kalite Kontrol Operatörü | Adım işletir, hata kaydı açar, onaylar |
| Rework Operatörü | Rework üstlenir ve tamamlar |
| Onay Yetkilisi | Hata onaylar/reddeder, sevk eder |
| Üretim / İstasyon Operatörü | Traktör ekler, adım işletir |
| Hata Kaydı Düzenleme / Silme | Başkasının açtığı kaydı düzeltir, iptal eder, şasi düzeltir |
| Tüm Onayları Verebilme | Dört göz kuralını yalnızca o kişi için kaldırır |

Son iki rol bilerek ayrıdır: her kontrolörde olmamalı.

**"Tüm Onayları Verebilme" sistem yöneticisine otomatik gelmez.** Diğer bütün
yetkiler yöneticide açıktır, bu değildir — bir kalite kuralını kaldıran yetki
farkında olmadan herkeste açık kalmasın diye tek tek işaretlenir.

## Değişmeyen kurallar

Bunlar ekranda da, `firestore.rules` içinde de yazılıdır:

- **Dört göz:** rework'ü yapan kişi onu onaylayamaz. Yalnızca *Tüm Onayları
  Verebilme* yetkisi açıkça verilmiş kişilerde kalkar ve böyle bir onay denetim
  kaydına *"kendi rework'ünü onayladı"* notuyla yazılır.
- **Hata kaydı silinmez, iptal edilir.** Kimin, ne zaman, hangi sebeple
  kaldırdığı kayıtta durur; yanlışlıkla kaldırılan kayıt geri alınabilir.
  Excel'deki "kayıt izsiz kayboluyor" sorununun çözümü budur.
- **Denetim kaydı salt eklemedir.** Kurallar update ve delete işlemlerini
  kapatır: geçmiş hiç kimse tarafından değiştirilemez. Kayıt başkası adına ya da
  başka bir tarihle de yazılamaz.
- **Atlanan adım sevke hazır saymaz.** Onay adımı kapatılırken *önceki* adımların
  tamamlanmış olması aranır. Sonraki adımlar aranmaz — aranırsa akışın sonuna
  yeni bir istasyon eklendiğinde son adımdaki bütün traktörler kilitlenirdi.
- **Başka adıma yönlendirme tamamlama sayılmaz** (`result = "yonlendirildi"`).

## Şasi numarası iki şekilde düzeltilir

İkisi farklı şeydir:

- **Hata yanlış traktöre yazılmışsa** → hata satırındaki *Düzenle* ekranındaki
  **Şasi No** alanı. Kayıt o traktörden çıkar, doğru traktöre eklenir. Numara
  yazdıkça kayıtlı traktörler önerilir; kayıtlı olmayan numaraya taşınamaz.
- **Traktörün kendi numarası yanlış girilmişse** → traktör kartındaki
  **✎ Şasi No**. Traktör kaydı bölünmez: adım geçmişi ve bütün hata kayıtları
  yeni numaranın altında kalır.

İkisi de *Hata Kaydı Düzenleme / Silme* yetkisi ister ve sebep yazmak zorunludur.

## Yönetim raporu tutarlıdır

Kartlardaki rakamların hepsi **aynı kümeyi** anlatır: seçilen dönemde roll-down
olan traktörler. Her dönemde geçerli kural:

```
Üretilen = Hatta + Sevke Hazır + Sevk Edilen
```

Fabrikanın anlık toplamları kaybolmaz, kartların alt satırında durur
("fabrikada şu an 53"). Böylece hem "bu dönemde ne yaptık" hem "şu an elimizde
ne var" aynı ekranda, karışmadan görünür. İptal edilen hata kayıtları hiçbir
rapora girmez.

## Dosya düzeni

```
index.html              uygulama kabuğu
assets/app.css          tasarım sistemi (renk yalnızca durum için)
js/config.js            Firebase bağlantı değerleri + sürüm damgası
js/fb.js                SDK yükleme — sürüm tek yerde
js/auth.js              giriş, erişim talebi ve yetki kapısı
js/roles.js             roller: hangi rol hangi ekranı görür
js/store.js             Firestore okuma/yazma + denetim kaydı
js/flow.js              iş kuralları: adım akışı, hata akışı, onay
js/seed.js              11 adım, Excel'den 2.347 hazır hata tanımı, listeler, beklenen kişiler
js/ui.js                pencere, onay, KPI kartı, çubuk grafik
js/views.js             operasyon ekranları
js/views-admin.js       rapor, talepler, tanımlar
js/app.js               yönlendirme, gezinme, giriş ekranı
firestore.rules         yetki kuralları (Console'a yapıştırılıp yayınlanır)
test/                   sahte Firebase ile uçtan uca test
```

## Test

Gerçek Firebase'e bağlanmadan, tarayıcıda bütün akışları çalıştırır:

```
npm install
node test/run.mjs
```

Kapsadığı konular: başlangıç verileri, **yazdıkça öneri** (Türkçe'ye duyarsız
arama, kategori önceliği, yeni tanımın kataloğa girmesi, kopya oluşmaması),
**son 6 haneyle traktör bulma**, traktör oluşturma ve şasi tekilliği, adım
akışı, hata kaydı, açık hatalı traktörün onay adımını kapatamaması, rework akışı
ve işi geri bırakma,
**dört göz kuralı ve tam_onay yetkisi**, atlanan adım koruması, **akışın sonuna
adım eklendiğinde kilitlenmeme**, tek kişinin bir traktörü baştan sona
götürmesi, hata düzenleme/iptal/geri alma yetkileri, hatanın başka traktöre
taşınması, şasi numarası düzeltme, denetim kaydının eksiksizliği ve **rapor
kartlarının beş ayrı dönemde birbirini tutması**.

Sahte Firebase `firestore.rules` kurallarını uygulamaz; kural katmanındaki
kilitler bu testlerle değil, Firebase Console → Firestore → Rules →
*Rules Playground* ya da Firestore emülatörüyle doğrulanır.

## Kurulum (bir kez yapılır)

1. Firebase Console → proje oluştur
2. Firestore Database → production mode → `eur3`
3. Authentication → Sign-in method → **Google** ve **Email/Password** → ikisini de etkinleştir
4. Project settings → Your apps → Web → `firebaseConfig` değerlerini `js/config.js` içine yaz
5. Authentication → Settings → Authorized domains → `eatik16-stack.github.io` ekle
6. Firestore → Rules → `firestore.rules` içeriğini yapıştır → Publish
7. Firestore → Data → `allowed` koleksiyonu → belge kimliği = yöneticinin Gmail'i,
   alanlar: `name` (string), `roles` (array: `admin`), `stepCode` (string, boş olabilir)

Uygulamaya ilk girişte **"Başlangıç verilerini yükle"** düğmesi 11 adımı, saha
yerleşimini, Excel'den çıkarılan 2.347 hazır hata tanımını, seçim listelerini
ve beklenen kişiler listesini oluşturur. Traktör ve hata **kayıtları** taşınmaz — sistem temiz başlar.

## Revize akışı

Tek kaynak bu depo.

1. Değişiklik Claude'a yazılır.
2. Claude dosyaları düzenler ve akışları sahte Firebase ile tarayıcıda koşar —
   **testler geçmeden teslim edilmez**.
3. Claude değişiklikleri doğrudan bu depoya yazar; GitHub Pages birkaç dakika
   içinde yayına alır.
4. `firestore.rules` değiştiyse içeriği Firebase Console → Firestore → Rules'a
   yapıştırılıp **Publish** edilir. (Kural değişikliği seyrektir; gerektiğinde
   Claude ayrıca söyler.)

Ekranın sol alt köşesindeki **sürüm damgası** her güncellemede değişir:
"güncelleme bu tablete ulaştı mı?" sorusunun cevabı oradadır.
