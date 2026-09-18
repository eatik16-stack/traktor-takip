// Uçtan uca senaryo. Sahte Firebase üzerinde bütün iş kurallarını koşturur.
//
// Sürücüden bağımsızdır: run.mjs bunu Playwright ile çağırır, Node olmayan bir
// makinede aynı dosya tarayıcı konsolunda da çalıştırılabilir.

export async function runScenario(ctx) {
  const { flow, data, store, util, V, scan, ui, photos, stepUsage, renumberSteps, seed, mock, sleep, waitFor } = ctx;
  const results = [];
  const check = function (name, cond, extra) {
    results.push({ name: name, ok: !!cond, extra: cond ? "" : String(extra == null ? "" : extra) });
  };
  const fail = function (name, e) { results.push({ name: name, ok: false, extra: (e && e.message) || String(e) }); };
  const expectThrow = async function (name, fn, mustContain) {
    try { await fn(); check(name, false, "hata bekleniyordu ama geçti"); }
    catch (e) {
      const m = (e && e.message) || "";
      check(name, !mustContain || m.indexOf(mustContain) !== -1, m);
    }
  };

  /* ---------- 1. Başlangıç verileri ---------- */
  await seed();
  await waitFor(function () { return data.steps.length > 0; });
  check("11 adım yüklendi", data.steps.length === 11, data.steps.length);
  check("Adımlar sıralı",
        data.steps.map(function (s) { return s.seq; }).join(",") === "1,2,3,4,5,6,7,8,9,10,11");
  check("Hata kataloğu Excel'den dolu (2000+ tanım)", data.catalog.length >= 2000, data.catalog.length);
  check("Katalog sık kullanılan önce sıralı", data.catalog[0].d === "Oil flashing", data.catalog[0]);

  /* ---------- 1b. Yazdıkça öneri (Excel süzgeci gibi) ---------- */
  const { searchCatalog, catalogFind, catalogRemember, findTractors } = store;
  const oil = searchCatalog("oil", null, 5);
  check("'oil' yazınca Oil flashing önerilir", oil.length && oil[0].d === "Oil flashing", oil.map(function (i) { return i.d; }));
  const kacak = searchCatalog("kacak", null, 5);
  check("Türkçe karaktersiz arama eşleşir (kacak → kaçak)",
        kacak.length > 0 && kacak.every(function (i) { return /ka[çc]ak/i.test(i.d); }), kacak.map(function (i) { return i.d; }));
  const cok = searchCatalog("sol maspiyel", null, 5);
  check("Birden çok kelime sırasız eşleşir", cok.length > 0 && /ma[şs][bp]iyel/i.test(cok[0].d), cok.map(function (i) { return i.d; }));
  const kat = searchCatalog("yok", "Etiket Hataları", 6);
  check("Seçili kategori önce gelir", kat.length && kat[0].c === "Etiket Hataları", kat.map(function (i) { return i.c; }));
  check("Boş aramada sık kaydedilenler gelir", searchCatalog("", null, 3).length === 3);
  check("Kayıtlı tanım bulunuyor (büyük/küçük harf fark etmez)", !!catalogFind("OİL FLASHİNG"));
  check("Kayıtsız tanım bulunmuyor", !catalogFind("böyle bir hata yok xyz"));
  check("Seçim listeleri dolu", (data.lookups.hata_kodu || []).length >= 10);
  check("Beklenen kişiler listesi var", (data.people || []).length >= 10);
  const rdc = data.steps[0], pdi = data.steps[10];
  check("İlk adım RDC", rdc.code === "RDC", rdc.code);
  check("Son adım PDI ve onay türünde", pdi.code === "PDI" && pdi.kind === "onay", pdi.kind);

  /* ---------- 1c. Mesai süresi (duvar saati değil) ---------- */
  // 17:30'da adıma giren traktör ertesi sabah 08:30'da 1 saat beklemiş
  // sayılmalı, 15 saat değil. Mesai dışı, hafta sonu ve molalar düşülür.
  const W = function (a, b) { return Math.round(util.workMinutes(a, b)); };
  check("Tam mesai günü 495 dk (10 sa − 1 sa 45 dk mola)", util.DAILY_WORK_MINUTES === 495, util.DAILY_WORK_MINUTES);
  check("Salı 08:00→18:00 = tam gün", W("2026-09-15T08:00", "2026-09-15T18:00") === 495, W("2026-09-15T08:00", "2026-09-15T18:00"));
  check("17:30 → ertesi 08:30 = 1 sa", W("2026-09-15T17:30", "2026-09-16T08:30") === 60, W("2026-09-15T17:30", "2026-09-16T08:30"));
  check("Sabah molası düşülüyor (10:00→11:00 = 45 dk)", W("2026-09-15T10:00", "2026-09-15T11:00") === 45);
  check("Öğle molası düşülüyor (12:00→14:00 = 45 dk)", W("2026-09-15T12:00", "2026-09-15T14:00") === 45, W("2026-09-15T12:00", "2026-09-15T14:00"));
  check("Öğleden sonra molası düşülüyor (15:00→16:00 = 45 dk)", W("2026-09-15T15:00", "2026-09-15T16:00") === 45);
  check("Mesai dışı saat sayılmıyor", W("2026-09-15T20:00", "2026-09-15T23:00") === 0);
  check("Mesai öncesi sayılmıyor (07:00→09:00 = 1 sa)", W("2026-09-15T07:00", "2026-09-15T09:00") === 60);
  check("Hafta sonu sayılmıyor", W("2026-09-12T09:00", "2026-09-13T17:00") === 0);
  check("Cuma 17:30 → Pazartesi 09:00 = 1,5 sa", W("2026-09-11T17:30", "2026-09-14T09:00") === 90, W("2026-09-11T17:30", "2026-09-14T09:00"));
  check("Bir hafta = 5 tam mesai günü", W("2026-09-08T08:00", "2026-09-15T08:00") === 5 * 495);
  check("Ters/sıfır aralık 0", W("2026-09-15T10:00", "2026-09-15T09:00") === 0 && W("2026-09-15T09:00", "2026-09-15T09:00") === 0);

  /* ---------- 2. Traktör oluşturma ---------- */
  const CH = "TESTMEA0001";
  let tid;
  try { tid = await flow.createTractor({ chassisNo: CH, saleCode: "GX626B", family: "EU CAB" }); }
  catch (e) { fail("Traktör oluşturuldu", e); }
  await waitFor(function () { return data.tractors.length > 0; });
  check("Traktör oluşturuldu", !!tid);
  const t0 = data.tractors.find(function (t) { return t.id === tid; });
  check("1. adıma alındı", t0 && t0.currentStepId === rdc.id, t0 && t0.currentStepId);
  check("Durumu 'devam'", t0 && t0.status === "devam", t0 && t0.status);

  await expectThrow("Aynı şasi tekrar eklenemez",
    function () { return flow.createTractor({ chassisNo: CH }); }, "zaten kayıtlı");
  await expectThrow("Mükerrer uyarısı traktörün nerede olduğunu söylüyor",
    function () { return flow.createTractor({ chassisNo: CH }); }, "listeden o traktörü açın");
  await expectThrow("Küçük/büyük harf ve boşluk farkı mükerreri gizlemiyor",
    function () { return flow.createTractor({ chassisNo: " testmea0001 " }); }, "zaten kayıtlı");
  await expectThrow("Kısa şasi reddediliyor",
    function () { return flow.createTractor({ chassisNo: "AB" }); }, "en az 3");

  /* ---------- 3. Adım akışı ---------- */
  await flow.startWork(tid);
  await waitFor(function () { return (data.tractors.find(function (t) { return t.id === tid; }) || {}).currentStartedAt; });
  check("Adım başlatıldı", true);
  await expectThrow("İkinci kez başlatılamaz", function () { return flow.startWork(tid); }, "zaten başlatılmış");

  /* ---------- 4. Hata kaydı ---------- */
  let did;
  try {
    did = await flow.addDefect(tid, {
      category: "Parça Eksiklikleri", description: "Test hatası - konsol cıvatası eksik",
      source: "Tedarikçi (TR)", originLocation: "CELL2"
    });
  } catch (e) { fail("Hata kaydedildi", e); }
  await waitFor(function () { return data.defects.length > 0; });
  check("Hata kaydedildi", !!did);
  check("Traktörde 1 açık hata", flow.openDefects(tid).length === 1, flow.openDefects(tid).length);

  /* ---------- 4b. Yeni yazılan hata kataloğa girer, bir sonrakinde önerilir ---------- */
  const before = data.catalog.length;
  await catalogRemember("Şasi altı yeni bir hata denemesi", "Diğer", "Üretim");
  await waitFor(function () { return data.catalog.length === before + 1; });
  check("Yeni tanım kataloğa eklendi", data.catalog.length === before + 1, data.catalog.length);
  check("Yeni tanım aramada çıkıyor", searchCatalog("sasi alti yeni", null, 3).length === 1);
  const n0 = (catalogFind("Oil flashing") || {}).n;
  await catalogRemember("oil flashing", "Tanımlı İş", null);
  await waitFor(function () { return (catalogFind("Oil flashing") || {}).n === n0 + 1; });
  check("Var olan tanım tekrar yazılınca sayaç artar (kopya oluşmaz)",
        (catalogFind("Oil flashing") || {}).n === n0 + 1 && data.catalog.length === before + 1);

  /* ---------- 4c. Şasi arama: son 6 hane ---------- */
  const hitS = findTractors("EA0001", 5);
  check("Son 6 hane ile traktör bulunur", hitS.length === 1 && hitS[0].chassisNo === CH, hitS.map(function (t) { return t.chassisNo; }));
  check("Şasinin ortasıyla da bulunur", findTractors("TMEA", 5).length >= 1);
  check("Olmayan numara boş döner", findTractors("999999", 5).length === 0);

  /* ---------- 5. Açık hatalı traktör son adımı kapatamaz ---------- */
  await flow.moveToStep(tid, pdi.id, "test");
  await waitFor(function () {
    return (data.tractors.find(function (t) { return t.id === tid; }) || {}).currentStepId === pdi.id;
  });
  await expectThrow("Açık hatalı traktör onay adımını kapatamaz",
    function () { return flow.finishStep(tid, "ok"); }, "kapanmamış");

  /* ---------- 6. Rework akışı ve dört göz kuralı ---------- */
  await expectThrow("Üstlenmeden tamamlanamaz",
    function () { return flow.completeDefect(did); }, "Üzerime Al");

  mock.signInAs("rework@test.local", "Rework Kişi");
  await sleep(60);
  await flow.takeDefect(did);
  await waitFor(function () { return (data.defects.find(function (d) { return d.id === did; }) || {}).status === "reworkta"; });
  check("Rework üstlenildi", true);
  await expectThrow("İkinci kez üstlenilemez", function () { return flow.takeDefect(did); }, "durumunda");
  // Vardiya değişimi: bırak → başkası alabilsin
  await flow.releaseDefect(did);
  await waitFor(function () { return (data.defects.find(function (d) { return d.id === did; }) || {}).status === "acik"; });
  check("Üzerine alınan iş geri bırakılabiliyor", true);
  await flow.takeDefect(did);
  await waitFor(function () { return (data.defects.find(function (d) { return d.id === did; }) || {}).status === "reworkta"; });
  await flow.completeDefect(did);
  await waitFor(function () { return (data.defects.find(function (d) { return d.id === did; }) || {}).status === "rework_tamam"; });
  check("Rework tamamlandı", true);

  // Aynı kişi kendi rework'ünü onaylayamaz — yetkisi olsa bile.
  await expectThrow("Kendi rework'ünü onaylayamaz",
    function () { return flow.approveDefect(did); }, "Kendi yaptığınız");

  mock.signInAs("onay@test.local", "Onay Kişi");
  await sleep(60);
  let ap;
  try { ap = await flow.approveDefect(did); } catch (e) { fail("Başka onaycı kapatabiliyor", e); }
  await waitFor(function () { return (data.defects.find(function (d) { return d.id === did; }) || {}).status === "onaylandi"; });
  check("Başka onaycı kapatabiliyor", !!ap);
  check("Kendi onayı değil işareti", ap && ap.selfApproved === false, ap);

  /* ---------- 7. tam_onay yetkisi ---------- */
  mock.seedAllowed("tamonay@test.local", "Tam Onay", ["kontrol", "rework", "onay", "tam_onay"], "RDC");
  mock.signInAs("tamonay@test.local", "Tam Onay");
  await sleep(120);
  let did2;
  try {
    did2 = await flow.addDefect(tid, { category: "Diğer", description: "Dört göz testi", source: "Üretim" });
    await flow.takeDefect(did2);
    await flow.completeDefect(did2);
  } catch (e) { fail("tam_onay hazırlığı", e); }
  await waitFor(function () { return (data.defects.find(function (d) { return d.id === did2; }) || {}).status === "rework_tamam"; });
  let ap2;
  try { ap2 = await flow.approveDefect(did2); } catch (e) { fail("tam_onay ile kendi rework'ünü onaylıyor", e); }
  check("tam_onay ile kendi rework'ünü onaylıyor", !!ap2);
  check("Kendi onayı olarak işaretlendi", ap2 && ap2.selfApproved === true, ap2);

  /* ---------- 8. Adım atlama koruması ve kilitlenme ---------- */
  mock.signInAs("admin@test.local", "Yönetici");
  await sleep(120);
  await expectThrow("Atlanan önceki adımlar engelliyor",
    function () { return flow.finishStep(tid, "ok"); }, "Tamamlanmamış");

  // Akışın SONUNA bir adım eklenince onay adımı kilitlenmemeli.
  const items = data.steps.slice().concat([{
    id: "step-zz", seq: 12, code: "ZZ-TEST", name: "Test Son Adım", kind: "sevk",
    targetMinutes: 0, posX: 90, posY: 90, color: "#0891b2", allowsDefect: false, active: true
  }]);
  await store.saveDoc("config", "steps", { items: items });
  await waitFor(function () { return data.steps.length === 12; });

  const CH2 = "TESTMEA0002";
  const tid2 = await flow.createTractor({ chassisNo: CH2 });
  await waitFor(function () { return !!data.tractors.find(function (t) { return t.id === tid2; }); });
  let kilit = false, adimSayisi = 0;
  for (let i = 0; i < 14; i++) {
    const t = data.tractors.find(function (x) { return x.id === tid2; });
    if (!t || t.status === "sevke_hazir") break;
    try {
      await flow.startWork(tid2);
      await flow.finishStep(tid2, "ok");
      adimSayisi++;
    } catch (e) { kilit = true; check("Onay adımı kilitlenmeden kapandı", false, e.message); break; }
    await sleep(20);
  }
  if (!kilit) check("Onay adımı kilitlenmeden kapandı", true);
  const t2 = data.tractors.find(function (x) { return x.id === tid2; });
  check("Traktör sonuna kadar ilerledi", t2 && t2.status === "sevke_hazir", t2 && t2.status);
  // Hatası olmayan traktörde rework istasyonları atlanır: RW-1 ve RW-2
  // personeli boş traktör görmez. 12 adımın 10'u kapanır.
  check("Hatasız traktörde rework adımları atlandı", adimSayisi === 10, adimSayisi);
  // Atlanan adım geçmişe "atlandı" diye işlenir: tamamlanmış sayılmaz ama
  // çizelgede boşluk da bırakmaz.
  const rw1 = (t2.steps || {})["RW-1"], rw2 = (t2.steps || {})["RW-2"];
  check("Atlanan adımlar 'atlandı' olarak işaretli",
        rw1 && rw1.result === "atlandi" && rw2 && rw2.result === "atlandi",
        JSON.stringify([rw1 && rw1.result, rw2 && rw2.result]));
  check("Atlanan adım tamamlanmış sayılmıyor",
        flow.completedStepCodes(t2).indexOf("RW-1") === -1,
        flow.completedStepCodes(t2).join(","));
  check("Atlanan adım bekleyenler listesinde de yok",
        !flow.pendingSteps(t2).some(function (x) { return x.code === "RW-1"; }),
        flow.pendingSteps(t2).map(function (x) { return x.code; }).join(","));

  // Test adımını geri al
  await store.saveDoc("config", "steps", { items: data.steps.filter(function (s) { return s.code !== "ZZ-TEST"; }) });
  await waitFor(function () { return data.steps.length === 11; });

  /* ---------- 9. Tek kişi bir traktörü baştan sona götürüyor ---------- */
  mock.seedAllowed("solo@test.local", "Tek Kişi",
                   ["admin", "kontrol", "rework", "onay", "operator", "tam_onay"], "RDC");
  mock.signInAs("solo@test.local", "Tek Kişi");
  await sleep(120);
  const CH3 = "TESTSOLO001";
  const tid3 = await flow.createTractor({ chassisNo: CH3 });
  await waitFor(function () { return !!data.tractors.find(function (t) { return t.id === tid3; }); });
  let soloOk = true, soloAdim = 0;
  for (let i = 0; i < 13; i++) {
    const t = data.tractors.find(function (x) { return x.id === tid3; });
    if (!t || t.status === "sevke_hazir") break;
    const cur = data.steps.find(function (s) { return s.id === t.currentStepId; });
    try {
      await flow.startWork(tid3);
      if (cur && cur.code === "RDC") {
        // Kalite adımında açılan hata traktörü rework istasyonuna düşürür.
        const dd = await flow.addDefect(tid3, { category: "Diğer", description: "Tek kişi testi", source: "Üretim" });
        await flow.finishStep(tid3, "ok");
        soloAdim++;
        await waitFor(function () {
          const x = data.tractors.find(function (y) { return y.id === tid3; });
          const st = x && data.steps.find(function (z) { return z.id === x.currentStepId; });
          return st && st.code === "RW-1";
        });
        check("Hata açılınca traktör rework istasyonuna düştü", true);
        await flow.takeDefect(dd);
        const sonuc = await flow.completeDefect(dd);
        check("Son hata kapanınca rework adımı kendiliğinden kapandı",
              sonuc && sonuc.autoFinished === true, JSON.stringify(sonuc));
        soloAdim++;
        const r = await flow.approveDefect(dd);
        check("Tek kişi kendi rework'ünü onayladı", r.selfApproved === true, r);
        await sleep(20);
        continue;
      }
      await flow.finishStep(tid3, "ok");
      soloAdim++;
    } catch (e) { soloOk = false; check("Tek kişi akışı", false, e.message); break; }
    await sleep(20);
  }
  if (soloOk) check("Tek kişi akışı sonuna kadar gitti", soloAdim >= 9, soloAdim);
  const t3 = data.tractors.find(function (x) { return x.id === tid3; });
  const t3adim = t3 && data.steps.find(function (z) { return z.id === t3.currentStepId; });
  check("Traktör sevke hazır", t3 && t3.status === "sevke_hazir",
        (t3 && t3.status) + " @ " + (t3adim ? t3adim.code : "?") +
        " | kapanan: " + Object.keys((t3 && t3.steps) || {}).join(","));
  if (t3 && t3.status !== "sevke_hazir") { return results; }
  await flow.dispatchTractor(tid3);
  await waitFor(function () {
    return (data.tractors.find(function (x) { return x.id === tid3; }) || {}).status === "sevk_edildi";
  });
  check("Sevk edildi", true);

  /* ---------- 9b. Geri gönderme hafızası ve iş emri atama ---------- */
  // FINAL'de bulunan hata RW-2'de giderilir; iş bitince traktör OIL/PAINT'e
  // değil, geldiği yere — FINAL'e — döner.
  const finalS = data.steps.find(function (x) { return x.code === "FINAL"; });
  const rw2S = data.steps.find(function (x) { return x.code === "RW-2"; });
  const tidF = await flow.createTractor({ chassisNo: "TESTGERI002" });
  await waitFor(function () { return !!data.tractors.find(function (t) { return t.id === tidF; }); });
  await flow.moveToStep(tidF, finalS.id, "test: FINAL'e alındı");
  await waitFor(function () {
    return (data.tractors.find(function (t) { return t.id === tidF; }) || {}).currentStepId === finalS.id;
  });
  const dF = await flow.addDefect(tidF, {
    category: "Diğer", description: "FINAL'de bulunan boya kusuru", source: "Üretim"
  });
  await flow.startWork(tidF);
  await flow.finishStep(tidF, "ok");
  await waitFor(function () {
    return (data.tractors.find(function (t) { return t.id === tidF; }) || {}).currentStepId === rw2S.id;
  });
  const tF1 = data.tractors.find(function (t) { return t.id === tidF; });
  check("FINAL'de açılan hata traktörü RW-2'ye gönderdi", tF1.currentStepId === rw2S.id);
  check("Nereden geldiği kaydedildi", tF1.returnStepId === finalS.id, tF1.returnStepId);

  await flow.takeDefect(dF);
  const rF = await flow.completeDefect(dF);
  check("RW-2'de son hata kapanınca adım kendiliğinden kapandı",
        rF && rF.autoFinished === true, JSON.stringify(rF));
  await waitFor(function () {
    return (data.tractors.find(function (t) { return t.id === tidF; }) || {}).currentStepId === finalS.id;
  });
  const tF2 = data.tractors.find(function (t) { return t.id === tidF; });
  check("Traktör FINAL'e geri döndü (OIL/PAINT tekrar yapılmadı)", tF2.currentStepId === finalS.id);
  // Onay bekleyen hata varken kalite adımı kapanmamalı: yoksa traktör rework
  // ile kalite arasında gidip gelirdi.
  await flow.startWork(tidF);
  await expectThrow("Onay bekleyen hata varken kalite adımı kapanmıyor",
    function () { return flow.finishStep(tidF, "ok"); }, "Onayınızı bekleyen");
  await flow.approveDefect(dF);
  await waitFor(function () {
    return (data.defects.find(function (d) { return d.id === dF; }) || {}).status === "onaylandi";
  });
  await flow.finishStep(tidF, "ok");
  await waitFor(function () {
    const x = data.tractors.find(function (t) { return t.id === tidF; });
    return x && x.currentStepId !== finalS.id;
  });
  const tF3 = data.tractors.find(function (t) { return t.id === tidF; });
  const tF3s = data.steps.find(function (z) { return z.id === tF3.currentStepId; });
  check("Onaydan sonra FINAL kapandı, traktör PDI'ya geçti",
        tF3s && tF3s.code === "PDI", tF3s && tF3s.code);
  check("Geri dönüş işareti temizlendi", !tF2.returnStepId, tF2.returnStepId);
  check("Rework süresi ilk 'üzerime al'dan sayıldı",
        (tF2.steps || {})["RW-2"] && (tF2.steps || {})["RW-2"].result === "ok",
        JSON.stringify((tF2.steps || {})["RW-2"]));

  // Sevke hazır bekleyen traktörde sonradan çıkan hata: seçilen istasyona iş
  // emri düşer, iş bitince traktör yine sevke hazır olur.
  const paintS = data.steps.find(function (x) { return x.code === "PAINT"; });
  const tY0 = data.tractors.find(function (x) { return x.id === tid2; });
  check("Bahçedeki traktör sevke hazır durumda", tY0 && tY0.status === "sevke_hazir", tY0 && tY0.status);
  const dY = await flow.addDefect(tid2, {
    category: "Diğer", description: "Bahçede beklerken pas oluşmuş",
    source: "Üretim", assignStepId: paintS.id
  });
  await waitFor(function () {
    const x = data.tractors.find(function (t) { return t.id === tid2; });
    return x && x.currentStepId === paintS.id && x.status === "devam";
  });
  const tY1 = data.tractors.find(function (x) { return x.id === tid2; });
  check("Sevke hazır traktör seçilen istasyona iş emri olarak düştü", tY1.currentStepId === paintS.id);
  check("İş bitince sevke hazıra dönecek diye işaretlendi", tY1.returnReady === true, tY1.returnReady);
  await flow.startWork(tid2);
  await flow.finishStep(tid2, "ok");
  await waitFor(function () {
    return (data.tractors.find(function (x) { return x.id === tid2; }) || {}).status === "sevke_hazir";
  });
  const tY2 = data.tractors.find(function (x) { return x.id === tid2; });
  check("İş bitince traktör yine sevke hazır", tY2.status === "sevke_hazir", tY2.status);
  check("Sevke hazır işareti temizlendi", !tY2.returnReady, tY2.returnReady);
  await flow.cancelDefect(dY, "test kaydı temizlendi");

  /* ---------- 10. Hata düzenleme / silme yetkisi ---------- */
  const tid4 = await flow.createTractor({ chassisNo: "TESTEDIT001" });
  await waitFor(function () { return !!data.tractors.find(function (t) { return t.id === tid4; }); });
  const did3 = await flow.addDefect(tid4, { category: "Diğer", description: "Düzenleme testi", source: "Üretim" });
  await waitFor(function () { return !!data.defects.find(function (d) { return d.id === did3; }); });

  mock.seedAllowed("kontrol@test.local", "Sadece Kontrol", ["kontrol"], "RDC");
  mock.signInAs("kontrol@test.local", "Sadece Kontrol");
  await sleep(120);
  await expectThrow("Kontrol rolü hata düzenleyemiyor",
    function () { return flow.editDefect(did3, { category: "Diğer", description: "olmaz" }); }, "yetkiniz yok");
  await expectThrow("Kontrol rolü hata silemiyor",
    function () { return flow.cancelDefect(did3, "olmaz olmaz"); }, "yetkiniz yok");

  mock.seedAllowed("duzen@test.local", "Düzenleyici", ["kontrol", "hata_duzenle"], "RDC");
  mock.signInAs("duzen@test.local", "Düzenleyici");
  await sleep(120);
  let ed;
  try { ed = await flow.editDefect(did3, { category: "Diğer", description: "Düzenlendi yeni hali" }); }
  catch (e) { fail("Yetkili hatayı düzenleyebiliyor", e); }
  await waitFor(function () { return (data.defects.find(function (d) { return d.id === did3; }) || {}).editCount === 1; });
  check("Yetkili hatayı düzenleyebiliyor", ed && ed.changed >= 1, ed);
  check("Düzenleme sayacı arttı",
        (data.defects.find(function (d) { return d.id === did3; }) || {}).editCount === 1);

  await expectThrow("Kısa sebeple silinemiyor",
    function () { return flow.cancelDefect(did3, "ab"); }, "sebebi");
  await flow.cancelDefect(did3, "yanlış traktöre açılmış");
  await waitFor(function () { return (data.defects.find(function (d) { return d.id === did3; }) || {}).status === "iptal"; });
  check("Kayıt iptal edildi", true);
  check("Silinen kayıt açık hata sayılmıyor", flow.openDefects(tid4).length === 0, flow.openDefects(tid4).length);
  await expectThrow("Silinmiş kayıt düzenlenemiyor",
    function () { return flow.editDefect(did3, { category: "Diğer", description: "x y z" }); }, "İptal edilmiş");
  const rs = await flow.restoreDefect(did3);
  await waitFor(function () { return (data.defects.find(function (d) { return d.id === did3; }) || {}).status !== "iptal"; });
  check("Geri alındı", rs && rs.status === "acik", rs);

  /* ---------- 11. Hatayı başka traktöre taşıma ---------- */
  await expectThrow("Kayıtlı olmayan şasiye taşınamıyor",
    function () { return flow.editDefect(did3, { category: "Diğer", description: "Düzenlendi yeni hali", chassisNo: "YOKBOYLE" }); },
    "kayıtlı değil");
  const mv = await flow.editDefect(did3, {
    category: "Diğer", description: "Düzenlendi yeni hali", chassisNo: CH
  });
  await waitFor(function () { return (data.defects.find(function (d) { return d.id === did3; }) || {}).tractorId === tid; });
  check("Hata doğru traktöre taşındı", mv && mv.moved === true, mv);
  check("Kayıt eski traktörden çıktı",
        data.defects.filter(function (d) { return d.tractorId === tid4 && d.status !== "iptal"; }).length === 0);

  /* ---------- 12. Şasi numarası düzeltme ---------- */
  await expectThrow("Kısa sebeple şasi düzeltilemiyor",
    function () { return flow.fixChassis(tid4, "YENIMEA0009", "ab"); }, "sebebi");
  await expectThrow("Başkasında olan numara alınamıyor",
    function () { return flow.fixChassis(tid4, CH, "çakışma testi"); }, "zaten başka");
  const fx = await flow.fixChassis(tid4, "TESTEDIT001D", "son hane eksik yazılmış");
  await waitFor(function () {
    return (data.tractors.find(function (t) { return t.id === tid4; }) || {}).chassisNo === "TESTEDIT001D";
  });
  check("Şasi numarası düzeltildi", fx && fx.changed === true, fx);

  /* ---------- 12b. İsim düzeltmesi eski kayıtlara da işlesin ---------- */
  // Kayıtlar kişinin o anki adını içlerine de yazar. Ad sonradan düzeltilince
  // eski kayıtlar eski adı göstermemeli.
  const ESKI = "Yönetici", YENI = "Yonetici Duzeltilmis";
  const oncekiler = data.defects.filter(function (d) { return d.detectedBy === "admin@test.local"; });
  check("İsim testi için kayıt var", oncekiler.length > 0, oncekiler.length);
  check("Kayıtlarda eski ad duruyor",
        oncekiler.some(function (d) { return d.detectedByName === ESKI; }),
        oncekiler.map(function (d) { return d.detectedByName; }).join(","));
  const degisen = await store.renameEverywhere("admin@test.local", YENI);
  check("İsim güncellemesi kayıtlara işledi", degisen > 0, degisen);
  await waitFor(function () {
    return data.defects.filter(function (d) {
      return d.detectedBy === "admin@test.local" && d.detectedByName !== YENI;
    }).length === 0;
  });
  check("Hata kayıtlarında eski ad kalmadı",
        data.defects.filter(function (d) {
          return d.detectedBy === "admin@test.local" && d.detectedByName === ESKI;
        }).length === 0);
  check("Traktör kayıtlarında eski ad kalmadı",
        data.tractors.filter(function (t) {
          return t.createdBy === "admin@test.local" && t.createdByName === ESKI;
        }).length === 0);
  const evsAfter = await store.readEvents(tid);
  check("Adım geçişlerinde eski ad kalmadı",
        evsAfter.filter(function (e) {
          return e.operator === "admin@test.local" && e.operatorName === ESKI;
        }).length === 0,
        evsAfter.map(function (e) { return e.operatorName; }).join(","));
  check("Aynı işlem ikinci kez çalışınca değişecek kayıt kalmıyor",
        (await store.renameEverywhere("admin@test.local", YENI)) === 0);
  // Başkasının adı bundan etkilenmemeli.
  check("Başka kişinin adı değişmedi",
        data.defects.filter(function (d) { return d.reworkByName === YENI && d.reworkBy !== "admin@test.local"; }).length === 0);

  // Kullanıcı ekranından kaydetmek de eski kayıtları eşitlemeli — Firestore'da
  // adı elle düzeltip uygulamadan "Kaydet" demek yeten tek yol olsun.
  const SON = "Yonetici Son Hali";
  await store.grantAccess("admin@test.local", SON, ["admin", "kontrol", "onay", "rework", "hata_duzenle"], "RDC");
  await waitFor(function () {
    return data.defects.filter(function (d) {
      return d.detectedBy === "admin@test.local" && d.detectedByName !== SON;
    }).length === 0;
  });
  check("Kullanıcı kaydetmek eski kayıtlardaki adı da düzeltiyor",
        data.defects.filter(function (d) {
          return d.detectedBy === "admin@test.local" && d.detectedByName === SON;
        }).length > 0);

  /* ---------- 12c. Adım silme koruması ---------- */
  // Kullanılmış adım silinemez: silinirse o kayıtlar hangi istasyona ait
  // olduğunu gösteremez. Kullanılmamış adım silinebilir.
  check("Kullanılmış adım silinemez olarak işaretleniyor", stepUsage(rdc).total > 0, JSON.stringify(stepUsage(rdc)));
  const bos = { id: "s-bos-test", seq: 99, code: "ZZ-BOS", name: "Hiç kullanılmamış adım",
                kind: "islem", targetMinutes: 0, posX: 90, posY: 90, allowsDefect: false, active: true };
  await store.saveDoc("config", "steps", { items: data.steps.concat([bos]) });
  await waitFor(function () { return data.steps.some(function (s) { return s.code === "ZZ-BOS"; }); });
  check("Yeni adım eklendi", data.steps.some(function (s) { return s.code === "ZZ-BOS"; }));
  check("Kullanılmamış adımda kullanım sayısı 0", stepUsage(bos).total === 0, JSON.stringify(stepUsage(bos)));
  await store.setDocFull("config", "steps",
    { items: data.steps.filter(function (s) { return s.id !== bos.id; }) });
  await waitFor(function () { return !data.steps.some(function (s) { return s.code === "ZZ-BOS"; }); });
  check("Kullanılmamış adım silindi", !data.steps.some(function (s) { return s.code === "ZZ-BOS"; }));
  check("Silme diğer adımlara dokunmuyor", data.steps.length === 11, data.steps.length);

  // Silinen adımdan sonra sıra numaraları boşluklu kalmamalı: 1,2,3,5… değil 1,2,3,4…
  const bosluklu = [{ id: "a", seq: 1 }, { id: "b", seq: 2 }, { id: "c", seq: 5 },
                    { id: "d", seq: 11 }, { id: "e", seq: 99 }];
  const duzen = renumberSteps(bosluklu);
  check("Sıra numaraları 1..N olarak sıkışıyor",
        duzen.map(function (x) { return x.seq; }).join(",") === "1,2,3,4,5",
        duzen.map(function (x) { return x.seq; }).join(","));
  check("Sıkıştırma göreli sırayı bozmuyor",
        duzen.map(function (x) { return x.id; }).join("") === "abcde",
        duzen.map(function (x) { return x.id; }).join(""));
  check("Sıkıştırma kaynağı değiştirmiyor", bosluklu[4].seq === 99, bosluklu[4].seq);
  check("Karışık sırada gelen liste de doğru sıkışıyor",
        renumberSteps([{ id: "z", seq: 7 }, { id: "y", seq: 2 }])
          .map(function (x) { return x.id + x.seq; }).join(",") === "y1,z2");

  /* ---------- 12d. Ekran çizimi: geri gönderilen adım ve İstasyonum ---------- */
  // Bir adım tamamlandıktan sonra traktör oraya geri gönderilirse, adım
  // geçmişinde yeşil (tamamlandı) görünmemeli — yeniden yapılacak.
  const CHR = "TESTGERI001";
  const tidR = await flow.createTractor({ chassisNo: CHR, saleCode: "GX626B" });
  await waitFor(function () { return !!data.tractors.find(function (t) { return t.id === tidR; }); });
  await flow.startWork(tidR);
  await flow.finishStep(tidR, "ok");                       // RDC tamamlandı
  await waitFor(function () {
    const t = data.tractors.find(function (x) { return x.id === tidR; });
    return t && t.steps && t.steps.RDC;
  });
  await flow.moveToStep(tidR, rdc.id, "test: geri gönderildi");
  await waitFor(function () {
    const t = data.tractors.find(function (x) { return x.id === tidR; });
    return t && t.currentStepId === rdc.id;
  });

  const viewR = document.createElement("div");
  document.body.appendChild(viewR);
  await V.traktor(viewR, [tidR], function () {});
  const satirlar = Array.prototype.slice.call(viewR.querySelectorAll(".tl-item"));
  const rdcSatir = satirlar.find(function (n) {
    return (n.textContent || "").indexOf("RDC") !== -1;
  });
  check("Geri gönderilen adım çizelgede var", !!rdcSatir);
  check("Geri gönderilen adım yeşil (tamamlandı) görünmüyor",
        rdcSatir && !rdcSatir.classList.contains("done"),
        rdcSatir && rdcSatir.className);
  check("Geri gönderilen adım turuncu (tekrar) işaretli",
        rdcSatir && rdcSatir.classList.contains("redo"),
        rdcSatir && rdcSatir.className);
  check("Tekrar yapılacak adım bekleyenler listesinde",
        (viewR.textContent || "").indexOf("Onay İçin Bekleyen Adımlar") !== -1 &&
        (viewR.textContent || "").match(/Roll-Down Kontrol/g) !== null);

  // İstasyonum tek ekran: traktör, hataları ve adım düğmeleri aynı yerde.
  const viewS = document.createElement("div");
  document.body.appendChild(viewS);
  const ciz = function () { viewS.innerHTML = ""; V.istasyon(viewS, [], function () {}); };
  ciz();
  check("İstasyonum kuyruğu traktörü gösteriyor",
        (viewS.textContent || "").indexOf(util.shortChassis(CHR)) !== -1);
  check("İstasyonum'da hata paneli açık", !!viewS.querySelector("#rw-panel"));

  // Kuyruktan bu traktörü seç; panel ona ait olsun.
  const satir = viewS.querySelector('[data-sel="' + tidR + '"]');
  check("Kuyruk satırı tıklanabilir", !!satir);
  if (satir) satir.click();
  ciz();
  check("İstasyonum'da adım başlatma düğmesi var", !!viewS.querySelector("#stp-start"));

  await flow.startWork(tidR);
  await waitFor(function () {
    const t = data.tractors.find(function (x) { return x.id === tidR; });
    return t && t.currentStartedAt;
  });
  ciz();
  check("Başlatıldıktan sonra tamamla düğmesi geliyor", !!viewS.querySelector("#stp-finish"));
  check("Panel seçili traktöre ait",
        (viewS.querySelector("#rw-panel").textContent || "").indexOf(CHR) !== -1);
  viewR.remove(); viewS.remove();

  /* ---------- 13. Denetim kaydı ---------- */
  const logs = await store.readLog(500);
  const acts = logs.map(function (l) { return l.action; });
  ["traktor_olusturuldu", "hata_kaydedildi", "rework_ustlenildi", "onaylandi",
   "duzenlendi", "iptal_edildi", "iptal_geri_alindi", "sasi_duzeltildi", "sevk_edildi"]
    .forEach(function (a) {
      check("Denetim kaydında: " + a, acts.indexOf(a) !== -1, acts.slice(0, 8).join(","));
    });
  const selfLog = logs.find(function (l) {
    return l.action === "onaylandi" && String(l.detail || "").indexOf("kendi rework") !== -1;
  });
  check("Kendi onayı denetim kaydında ayrıca belirtiliyor", !!selfLog);
  check("Günlükte kim yazdığı var", logs.every(function (l) { return !!l.by; }));

  /* ---------- 14. Rapor tutarlılığı ---------- */
  const rep = ctx.buildReport;
  [7, 30, 90, 180, 365].forEach(function (gun) {
    const k = rep(gun).kpi;
    check("Son " + gun + " gün: Üretilen = Hatta + Sevke Hazır + Sevk Edilen",
          k.wip + k.ready + k.dispatched === k.produced,
          k.produced + " != " + k.wip + "+" + k.ready + "+" + k.dispatched);
  });
  const k30 = rep(30).kpi;
  check("Fabrika geneli dönemden küçük olamaz",
        k30.plantReady >= k30.ready && k30.plantWip >= k30.wip, k30);
  check("Açık hata dönemin hatalarından sayılıyor",
        k30.defectsOpen <= k30.defectsTotal, k30);

  /* ---------- 15. Etiket okuma ----------
     Şasi ve satış kodu hata kaldırmayan iki alan. Kamera burada çalışmaz;
     kameradan ÇIKAN değerleri ayıklayan saf işlevler sınanır. */
  if (scan) {
    const bilinen = ["GX626B", "GX721F1"];

    const c1 = scan.classifyCodes(["*MEACBBBTAS4940949*", "GX721F1", "V02M1234"], bilinen);
    check("Barkodlar arasından şasi seçiliyor", c1.chassis === "MEACBBBTAS4940949", c1.chassis);
    check("Barkodlar arasından satış kodu seçiliyor", c1.saleCode === "GX721F1", c1.saleCode);
    check("Tanınmayan barkod alanlara yazılmıyor",
          c1.other.indexOf("V02M1234") !== -1, c1.other.join(","));

    const c2 = scan.classifyCodes(["MEACBBBTAS4940949"], bilinen);
    check("Satış kodu barkodu yoksa alan boş bırakılır",
          c2.chassis === "MEACBBBTAS4940949" && c2.saleCode === null, c2.saleCode);

    const c3 = scan.classifyCodes(["GX626B", "MEACBBBTAS4940949"], bilinen);
    check("Barkodların okunma sırası önemli değil",
          c3.chassis === "MEACBBBTAS4940949" && c3.saleCode === "GX626B", c3);

    check("Ayraçlı barkod temizleniyor",
          scan.classifyCodes(["*MEACBBBTAS4940949*"], []).chassis === "MEACBBBTAS4940949");

    check("Fotoğraftan satış kodu kalıpla bulunur",
          scan.extractSaleCode("MODEL GX721F1 SERIAL", bilinen) === "GX721F1");
    check("Fotoğrafta harf karışırsa bilinen koda düzeltilir",
          scan.extractSaleCode("MODEL GX72IF1 SERIAL", bilinen) === "GX721F1",
          scan.extractSaleCode("MODEL GX72IF1 SERIAL", bilinen));
    check("Satış kodu yoksa uydurulmaz",
          scan.extractSaleCode("BURADA KOD YOK", []) === null,
          scan.extractSaleCode("BURADA KOD YOK", []));
    check("Fotoğraftan şasi 17 haneden bulunur",
          scan.extractChassis("VIN\nMEACBBBTAS4940949") === "MEACBBBTAS4940949",
          scan.extractChassis("VIN\nMEACBBBTAS4940949"));

    /* --- Gerçek etiket: üç numara alt alta ---
       MEA0T15DGS4940395        şasi          17 hane
       GX706F2                  satış kodu
       SJV326CRE652024K016658   motor no      22 hane
       Sahadaki hata şuydu: şasi okunamayınca motor numarasından 17 hane
       kesilip şasi diye yazılıyordu. Yanlış ama makul görünen bir numara,
       hiç numara olmamasından çok daha tehlikeli. */
    const ETIKET = "TAFE International Trak.\nMEA0T15DGS4940395\nGX706F2\nSJV326CRE652024K016658";
    check("Gerçek etiketten şasi doğru okunuyor",
          scan.extractChassis(ETIKET) === "MEA0T15DGS4940395", scan.extractChassis(ETIKET));
    check("Motor numarası şasi sanılmıyor",
          scan.extractChassis(ETIKET) !== "SJV326CRE652024K01", scan.extractChassis(ETIKET));

    const SASISIZ = "TAFE International Trak.\nGX706F2\nSJV326CRE652024K016658";
    check("Şasi okunamazsa motor numarasından KESİLMİYOR",
          scan.extractChassis(SASISIZ) === null, scan.extractChassis(SASISIZ));
    check("Bozuk uzun kelimeden şasi uydurulmuyor",
          scan.extractChassis("IV326CREG52024K016658\nGX706F2") === null,
          scan.extractChassis("IV326CREG52024K016658\nGX706F2"));

    // VIN'de I, O, Q hiç yoktur; OCR bunları gördüyse kesin yanılmıştır.
    check("O yerine 0 okunursa düzeltiliyor",
          scan.extractChassis("MEAoT15DGS494o395") === "MEA0T15DGS4940395",
          scan.extractChassis("MEAoT15DGS494o395"));

    const L = scan.extractLabel(ETIKET, ["GX706F2"], "MEA");
    check("Tek fotoğraftan iki alan birden geliyor",
          L.chassis === "MEA0T15DGS4940395" && L.saleCode === "GX706F2", L);

    check("Kısa numara uyarı veriyor", scan.sasiUyari("MEA123").indexOf("17 hane") !== -1);
    check("MEA ile başlamayan numara uyarı veriyor",
          scan.sasiUyari("XYZ0T15DGS4940395").indexOf("MEA") !== -1);
    check("Doğru numarada uyarı yok", scan.sasiUyari("MEA0T15DGS4940395") === "");
  }

  /* ---------- 15b. Kameradan gelen görüntünün çözülmesi ----------
     Telefonda takılan yer tam olarak burasıydı: kare doğru kırpılıp doğru
     çözünürlükte çözücüye verilmezse barkod hiç okunmaz. Burada gerçek bir
     tuval kullanılır, yani uygulamanın telefonda koştuğu yolun aynısı. */
  if (scan && typeof document !== "undefined") {
    const ZX = await new Promise(function (res) {
      if (window.ZXing) { res(window.ZXing); return; }
      const sc = document.createElement("script");
      // Testte yerel node_modules'ten; telefonda aynı sürüm CDN'den iner.
      sc.src = "/node_modules/@zxing/library/umd/index.min.js";
      sc.onload = function () { res(window.ZXing || null); };
      sc.onerror = function () { res(null); };
      document.head.appendChild(sc);
    });
    check("Tarayıcı barkod çözücüsü yüklendi", !!ZX, "npm install yapılmamış olabilir");

    if (ZX) {
      const { barkodRGBA } = await import("./code39.mjs");
      const sasi = "MEACBBBTAS4940949";

      // Barkodu bir tuvale çizip uygulamanın decodeImage'ına veriyoruz.
      const tuval = function (text, dar, dolguUst) {
        const b = barkodRGBA(text, dar);
        const cv = document.createElement("canvas");
        cv.width = b.w;
        cv.height = b.h + (dolguUst || 0) * 2;
        const cx = cv.getContext("2d");
        cx.fillStyle = "#fff";
        cx.fillRect(0, 0, cv.width, cv.height);
        const img = new ImageData(b.rgba, b.w, b.h);
        cx.putImageData(img, 0, dolguUst || 0);
        return cv;
      };

      const cv1 = tuval(sasi, 3, 0);
      check("Tuvaldeki barkod çözülüyor",
            scan.decodeImage(ZX, cv1, cv1.width, cv1.height, false) === sasi,
            scan.decodeImage(ZX, cv1, cv1.width, cv1.height, false));

      // Barkod karenin ortasında, üstünde ve altında boşluk varken de
      // bulunmalı: canlı kamerada durum budur.
      const cv2 = tuval(sasi, 3, 200);
      check("Karenin ortasındaki barkod bulunuyor",
            scan.decodeImage(ZX, cv2, cv2.width, cv2.height, false) === sasi,
            scan.decodeImage(ZX, cv2, cv2.width, cv2.height, false));

      // Fotoğraf yolu (geniş deneme listesi) aynı görüntüyü çözebilmeli.
      check("Fotoğraf yolu da aynı barkodu çözüyor",
            scan.decodeImage(ZX, cv2, cv2.width, cv2.height, true) === sasi);

      // iOS'ta tuval belleği sınırlı: her kare için yeni tuval açılırsa sınır
      // birkaç saniyede dolar ve okuma sessizce durur. Tek tuvalin yeniden
      // kullanıldığını burada sabitliyoruz.
      const orijinal = document.createElement.bind(document);
      let acilanTuval = 0;
      document.createElement = function (t) {
        if (String(t).toLowerCase() === "canvas") acilanTuval++;
        return orijinal(t);
      };
      try {
        for (let i = 0; i < 20; i++) scan.decodeImage(ZX, cv2, cv2.width, cv2.height, false);
      } finally { document.createElement = orijinal; }
      check("Tekrarlı okumada yeni tuval açılmıyor (iOS bellek sınırı)",
            acilanTuval <= 1, acilanTuval + " tuval açıldı");

      // Barkod yoksa uydurmuyor.
      const bos = document.createElement("canvas");
      bos.width = 900; bos.height = 400;
      const bcx = bos.getContext("2d");
      bcx.fillStyle = "#fff"; bcx.fillRect(0, 0, bos.width, bos.height);
      check("Boş karede barkod bulunmuyor",
            scan.decodeImage(ZX, bos, bos.width, bos.height, false) === null,
            scan.decodeImage(ZX, bos, bos.width, bos.height, false));
    }
  }

  /* ---------- 16. Yarım kalan kayıt korunuyor ----------
     Eldivenle, tek elle çalışırken perdeye denk gelen bir dokunuş olağan.
     O dokunuş yedi alanlık hata kaydını götürmemeli. */
  if (typeof document !== "undefined" && ui) {
    const { modal } = ui;
    const host = document.getElementById("modal-host");
    const perdeyeDokun = function (back) {
      back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };

    // Boş pencere: perdeye dokununca sorusuz kapanır.
    modal({ title: "Boş", body: '<input class="input" id="t-bos">' });
    let back = host.lastElementChild;
    check("Boş pencere perdeye dokununca kapanır", !!back);
    perdeyeDokun(back);
    await sleep(60);
    check("Boş pencerede soru sorulmuyor", host.children.length === 0,
          host.children.length);

    // Dolu pencere: perdeye dokununca KAPANMAZ, önce sorar.
    modal({ title: "Dolu", body: '<input class="input" id="t-dolu">',
            draftKey: "test:1" });
    back = host.lastElementChild;
    const inp = document.getElementById("t-dolu");
    inp.value = "Sol çamurluk boya akıntısı";
    perdeyeDokun(back);
    await sleep(80);
    check("Dolu pencere perdeye dokununca kapanmıyor",
          host.contains(back), "pencere kayboldu");
    const soru = host.lastElementChild;
    check("Yerine onay soruluyor", soru !== back, "soru penceresi açılmadı");

    // "Kapat" denince taslak saklanıyor.
    const kapatBtn = Array.prototype.filter.call(
      soru.querySelectorAll(".modal-foot .btn"),
      function (b) { return b.textContent.indexOf("Kapat") !== -1; })[0];
    check("Onay penceresinde Kapat düğmesi var", !!kapatBtn);
    if (kapatBtn) {
      kapatBtn.click();
      await sleep(120);
      check("Onaydan sonra pencere kapandı", host.children.length === 0,
            host.children.length);

      // Yeniden açınca yazdığı geri geliyor.
      modal({ title: "Dolu", body: '<input class="input" id="t-dolu">',
              draftKey: "test:1" });
      await sleep(40);
      const geri = document.getElementById("t-dolu");
      check("Yarım kalan kayıt geri yükleniyor",
            geri && geri.value === "Sol çamurluk boya akıntısı",
            geri && geri.value);
      check("Geri yüklendiği kişiye söyleniyor",
            host.lastElementChild.textContent.indexOf("geri yüklendi") !== -1);
      host.lastElementChild.remove();
    }

    // Escape temiz pencereyi kapatır.
    modal({ title: "Escape", body: "<p>boş</p>" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(60);
    check("Escape pencereyi kapatıyor", host.children.length === 0, host.children.length);

    // Telefon genişliğinde de ilk alan odaklanmış olmalı.
    modal({ title: "Odak", body: '<input class="input" id="t-odak">' });
    await sleep(40);
    check("Pencere açılınca ilk alan odaklanıyor",
          document.activeElement && document.activeElement.id === "t-odak",
          document.activeElement && document.activeElement.id);
    host.lastElementChild.remove();
  }

  /* ---------- 17. Hata kaydı fotoğrafları ----------
     Kamera ve yükleme testte koşmaz; küçültme hesabı, dosya yolu deseni ve
     kayda bağlama mantığı koşar. Yol deseni storage.rules ile birebir
     uyuşmazsa fotoğraf sahada hiç yüklenemez — bu yüzden sabitliyoruz. */
  if (photos) {
    const P = photos;
    let r = P.hedefOlcu(4032, 3024, P.UZUN_KENAR);
    check("12MP fotoğraf 1600 piksele iniyor", r.w === 1600 && r.h === 1200, r);
    r = P.hedefOlcu(3024, 4032, P.UZUN_KENAR);
    check("Dikey fotoğrafta uzun kenar yükseklik", r.h === 1600 && r.w === 1200, r);
    r = P.hedefOlcu(800, 600, P.UZUN_KENAR);
    check("Küçük fotoğraf büyütülmüyor", r.w === 800 && r.h === 600, r);
    r = P.hedefOlcu(4032, 3024, P.ONIZLEME_KENAR);
    check("Önizleme 320 pikselde", r.w === 320 && r.h === 240, r);

    const y = P.yolUret("d1", "f2");
    check("Dosya yolu storage.rules deseniyle uyuşuyor",
          y.p === "defects/d1/f2.jpg" && y.t === "defects/d1/f2_k.jpg", y);
    check("Sert tavan kurallardaki ile aynı", P.AZAMI_BOYUT === 2 * 1024 * 1024, P.AZAMI_BOYUT);
    check("Gizlenen fotoğraf listede görünmüyor",
          P.gorunur([{ p: "a" }, { p: "b", hidden: true }]).length === 1);
    check("Boyut okunur yazılıyor", P.okunurBoyut(250000) === "244 KB", P.okunurBoyut(250000));
    // Sıkı mod (getBytes) deponun CORS ayarını ister; ayar yokken istek
    // hata bile vermeden asılı kalıyordu. Varsayılan KAPALI olmalı.
    check("Sıkı erişim modu varsayılan kapalı", P.sikiMod === false, P.sikiMod);

    // Künye hata kaydına yazılıyor ve üzerine eklenerek birikiyor.
    const dAll = data.defects.filter(function (x) { return x.status !== "iptal"; });
    if (dAll.length) {
      const hedef = dAll[0];
      const once = ((hedef.photos || []).length);
      await flow.addDefectPhotos(hedef.id, [{ p: "defects/x/1.jpg", t: "defects/x/1_k.jpg", b: 1000 }]);
      await waitFor(function () {
        const d2 = data.defects.find(function (x) { return x.id === hedef.id; });
        return d2 && (d2.photos || []).length === once + 1;
      });
      const d2 = data.defects.find(function (x) { return x.id === hedef.id; });
      check("Fotoğraf künyesi hata kaydına yazıldı", (d2.photos || []).length === once + 1,
            (d2.photos || []).length);
      await flow.addDefectPhotos(hedef.id, [{ p: "defects/x/2.jpg", t: "defects/x/2_k.jpg", b: 1000 }]);
      await waitFor(function () {
        const d3 = data.defects.find(function (x) { return x.id === hedef.id; });
        return d3 && (d3.photos || []).length === once + 2;
      });
      check("İkinci fotoğraf öncekini silmiyor",
            (data.defects.find(function (x) { return x.id === hedef.id; }).photos || []).length === once + 2);

      await flow.hideDefectPhoto(hedef.id, "defects/x/1.jpg", "yanlış kare");
      await waitFor(function () {
        const d4 = data.defects.find(function (x) { return x.id === hedef.id; });
        return d4 && P.gorunur(d4.photos).length === once + 1;
      });
      const d5 = data.defects.find(function (x) { return x.id === hedef.id; });
      check("Gizlenen fotoğraf listeden çıkıyor ama kayıt duruyor",
            P.gorunur(d5.photos).length === once + 1 && (d5.photos || []).length === once + 2,
            [(d5.photos || []).length, P.gorunur(d5.photos).length]);

      const logs2 = await store.readLog(500);
      const acts2 = logs2.map(function (l) { return l.action; });
      check("Fotoğraf ekleme denetim kaydına yazılıyor", acts2.indexOf("fotograf_eklendi") !== -1);
      check("Fotoğraf gizleme denetim kaydına yazılıyor", acts2.indexOf("fotograf_gizlendi") !== -1);
    }
  }

  return results;
}
