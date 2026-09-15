// Uçtan uca senaryo. Sahte Firebase üzerinde bütün iş kurallarını koşturur.
//
// Sürücüden bağımsızdır: run.mjs bunu Playwright ile çağırır, Node olmayan bir
// makinede aynı dosya tarayıcı konsolunda da çalıştırılabilir.

export async function runScenario(ctx) {
  const { flow, data, store, seed, mock, sleep, waitFor } = ctx;
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
  check("12 adımın hepsi kapandı", adimSayisi === 12, adimSayisi);

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
      if (cur && cur.code === "RW-1") {
        const dd = await flow.addDefect(tid3, { category: "Diğer", description: "Tek kişi testi", source: "Üretim" });
        await flow.takeDefect(dd);
        await flow.completeDefect(dd);
        const r = await flow.approveDefect(dd);
        check("Tek kişi kendi rework'ünü onayladı", r.selfApproved === true, r);
      }
      await flow.finishStep(tid3, "ok");
      soloAdim++;
    } catch (e) { soloOk = false; check("Tek kişi akışı", false, e.message); break; }
    await sleep(20);
  }
  if (soloOk) check("Tek kişi 11 adımı tamamladı", soloAdim === 11, soloAdim);
  const t3 = data.tractors.find(function (x) { return x.id === tid3; });
  check("Traktör sevke hazır", t3 && t3.status === "sevke_hazir", t3 && t3.status);
  await flow.dispatchTractor(tid3);
  await waitFor(function () {
    return (data.tractors.find(function (x) { return x.id === tid3; }) || {}).status === "sevk_edildi";
  });
  check("Sevk edildi", true);

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

  return results;
}
