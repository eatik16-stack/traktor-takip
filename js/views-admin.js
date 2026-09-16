// Yönetim raporu, erişim talepleri ve tanımlar.

import { $, $$, esc, el, fmtDate, fmtMin, fmtNum, toast } from "./util.js";
import { modal, confirmDialog, kpi, emptyBox, barChart, statusChip } from "./ui.js";
import { data, activeSteps, stepByCode, saveDoc, setDocFull, removeDoc,
         grantAccess, revokeAccess, decideRequest, readLog, log,
         ensureHistory, RECENT_DAYS } from "./store.js";
import { ROLES, roleLabels } from "./roles.js";
import { myEmail, isAdmin } from "./auth.js";
import { STEPS as SEED_STEPS, LOOKUPS as SEED_LOOKUPS, CATALOG_ITEMS as SEED_CATALOG,
         PEOPLE as SEED_PEOPLE, KIND_COLOR, KIND_LABEL } from "./seed.js";
import * as flow from "./flow.js";
import { newId } from "./util.js";

function err(e) { toast((e && e.message) || "İşlem tamamlanamadı.", "err"); }

/* ================= Yönetim raporu ================= */

let repDays = 30;

function buildReport(days) {
  const d1 = new Date(); d1.setHours(23, 59, 59, 999);
  const d0 = new Date(d1); d0.setDate(d0.getDate() - (days - 1)); d0.setHours(0, 0, 0, 0);
  const inRange = function (v) {
    const t = new Date(v || 0).getTime();
    return t >= d0.getTime() && t <= d1.getTime();
  };

  // Göstergelerin HEPSİ aynı kümeyi anlatır: dönemde roll-down olan traktörler.
  // Böylece kartlar birbirini tutar: Üretilen = Hatta + Sevke Hazır + Sevk Edilen.
  const cohort = data.tractors.filter(function (t) { return inRange(t.rollDownAt); });
  const produced = cohort.length;
  const count = function (arr, fn) { return arr.filter(fn).length; };

  const wip = count(cohort, function (t) { return t.status === "devam" || t.status === "beklemede"; });
  const ready = count(cohort, function (t) { return t.status === "sevke_hazir"; });
  const dispatched = count(cohort, function (t) { return t.status === "sevk_edildi"; });
  const onHold = count(cohort, function (t) { return t.status === "beklemede"; });

  // Fabrikanın ŞU ANKİ durumu — dönemden bağımsız, kartların alt satırında.
  const plantWip = count(data.tractors, function (t) { return t.status === "devam" || t.status === "beklemede"; });
  const plantReady = count(data.tractors, function (t) { return t.status === "sevke_hazir"; });
  const dispatchedInPeriod = count(data.tractors, function (t) { return inRange(t.dispatchedAt); });

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const producedToday = count(data.tractors, function (t) {
    return new Date(t.rollDownAt || 0).getTime() >= today0.getTime();
  });

  // İptal edilen kayıtlar hiçbir rapora girmez.
  const defects = data.defects.filter(function (d) {
    return d.status !== "iptal" && inRange(d.detectedAt);
  });
  const openInRange = defects.filter(function (d) { return flow.OPEN_STATES.indexOf(d.status) !== -1; });
  const plantOpen = data.defects.filter(function (d) {
    return d.status !== "iptal" && flow.OPEN_STATES.indexOf(d.status) !== -1;
  }).length;

  const cohortIds = {};
  cohort.forEach(function (t) { cohortIds[t.id] = true; });
  const withDefect = {};
  data.defects.forEach(function (d) {
    if (d.status !== "iptal" && cohortIds[d.tractorId]) withDefect[d.tractorId] = true;
  });
  const clean = produced - Object.keys(withDefect).length;
  const ftt = produced ? Math.round(1000 * clean / produced) / 10 : null;

  // İstasyon süreleri — traktör belgesindeki özetten (adım olaylarını taramadan).
  const perStep = {};
  cohort.forEach(function (t) {
    const m = t.steps || {};
    Object.keys(m).forEach(function (code) {
      const r = m[code];
      if (flow.COMPLETED_RESULTS.indexOf(r.result) === -1) return;
      if (!perStep[code]) perStep[code] = { wait: [], work: [] };
      perStep[code].wait.push(r.wait || 0);
      perStep[code].work.push(r.work || 0);
    });
  });
  const avg = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; };
  const stationTimes = activeSteps().map(function (s) {
    const p = perStep[s.code] || { wait: [], work: [] };
    return { code: s.code, name: s.name, samples: p.wait.length,
             wait: Math.round(avg(p.wait)), work: Math.round(avg(p.work)),
             target: s.targetMinutes || 0 };
  });

  const tally = function (rows, key) {
    const m = {};
    rows.forEach(function (r) { const k = r[key] || "—"; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map(function (k) { return { label: k, a: m[k] }; })
      .sort(function (x, y) { return y.a - x.a; });
  };

  // Kim hangi hatayı buldu / kim rework yaptı.
  const inspectors = tally(defects, "detectedByName");
  const reworkers = tally(defects.filter(function (d) { return d.reworkByName; }), "reworkByName");

  return {
    range: { start: d0, end: d1 },
    kpi: {
      produced: produced, producedToday: producedToday,
      wip: wip, ready: ready, dispatched: dispatched, onHold: onHold,
      plantWip: plantWip, plantReady: plantReady, dispatchedInPeriod: dispatchedInPeriod,
      defectsTotal: defects.length, defectsOpen: openInRange.length,
      withOpenDefects: Object.keys(openInRange.reduce(function (m, d) { m[d.tractorId] = 1; return m; }, {})).length,
      plantDefectsOpen: plantOpen,
      perTractor: produced ? Math.round(100 * defects.length / produced) / 100 : 0,
      ftt: ftt
    },
    stationTimes: stationTimes,
    byCategory: tally(defects, "category"),
    bySource: tally(defects, "source"),
    byOrigin: tally(defects, "originLocation"),
    byStation: tally(defects, "detectedStepCode"),
    inspectors: inspectors,
    reworkers: reworkers
  };
}

// Testler rapor hesabını ekran çizmeden doğrulayabilsin diye dışa açılır.
export const REPORT_FOR_TEST = buildReport;

export function rapor(view, _p, rerender) {
  // Geniş dönem istendiyse eski kayıtlar bir kez çekilir, gelince ekran tazelenir.
  if (repDays > RECENT_DAYS) {
    ensureHistory(repDays).then(function (loaded) { if (loaded) rerender(); }).catch(function () {});
  }
  const d = buildReport(repDays);
  const k = d.kpi;

  view.innerHTML =
    '<div class="page-head"><div><h2>Yönetim Raporu</h2>' +
      "<p>" + fmtDate(d.range.start, false) + " – " + fmtDate(d.range.end, false) +
      " · " + fmtDate(new Date()) + " itibarıyla</p></div>" +
      '<div class="spacer"></div>' +
      '<label class="field" style="margin:0;min-width:150px"><span>Dönem</span>' +
      '<select class="input" id="r-days">' + [7, 30, 90, 180, 365].map(function (x) {
        return '<option value="' + x + '"' + (x === repDays ? " selected" : "") + ">Son " + x + " gün</option>";
      }).join("") + "</select></label>" +
      '<button class="btn" id="r-print">🖨 Yazdır</button></div>' +

    '<p class="card-sub" style="margin:0 0 10px">Kartlardaki rakamlar <strong>bu dönemde roll-down olan ' +
      fmtNum(k.produced) + ' traktörü</strong> anlatır: Hatta + Sevke Hazır + Sevk Edilen = Üretilen. ' +
      'Alt satırlardaki "fabrikada şu an" değerleri dönemden bağımsız, anlık toplamlardır.</p>' +

    '<div class="kpi-grid">' +
      kpi("Üretilen Traktör", fmtNum(k.produced), "bugün " + k.producedToday + " adet") +
      kpi("Hatta (Onaysız)", fmtNum(k.wip), "fabrikada şu an " + fmtNum(k.plantWip), k.wip ? "k-amber" : "k-green") +
      kpi("Sevke Hazır", fmtNum(k.ready), "fabrikada şu an " + fmtNum(k.plantReady), "k-green") +
      kpi("Sevk Edilen", fmtNum(k.dispatched), "dönemde sevk edilen " + fmtNum(k.dispatchedInPeriod), "k-slate") +
      kpi("Toplam Hata", fmtNum(k.defectsTotal), "traktör başına " + k.perTractor, "k-amber") +
      kpi("Açık Hata", fmtNum(k.defectsOpen),
          k.withOpenDefects + " traktörde · fabrikada " + fmtNum(k.plantDefectsOpen),
          k.defectsOpen ? "k-red" : "k-green") +
      kpi("Hatasız Çıkan", k.ftt === null ? "—" : "%" + fmtNum(k.ftt, 1),
          "ilk seferde doğru (FTT)", k.ftt >= 70 ? "k-green" : "k-amber") +
    "</div>" +

    '<div class="card"><div class="card-head"><h3>İstasyon Süreleri</h3></div>' +
      '<p class="card-sub" style="margin-bottom:10px">Ortalama bekleme ve işlem süresi — hangi istasyonda ne kadar duruyor</p>' +
      barChart(d.stationTimes.map(function (s) {
        return { label: s.code, a: s.wait, b: s.work };
      }), "Bekleme", "İşlem", " dk") + "</div>" +

    '<div class="card"><div class="card-head"><h3>Hata Kategorileri</h3></div>' +
      barChart(d.byCategory.slice(0, 10), "Adet", null, "") + "</div>" +

    '<div class="card"><div class="card-head"><h3>Hata Kaynağı</h3></div>' +
      barChart(d.bySource.slice(0, 10), "Adet", null, "") + "</div>" +

    '<div class="card"><div class="card-head"><h3>Oluşum Yeri</h3></div>' +
      barChart(d.byOrigin.slice(0, 10), "Adet", null, "") + "</div>" +

    '<div class="card"><div class="card-head"><h3>Hatayı Tespit Eden</h3></div>' +
      barChart(d.inspectors.slice(0, 12), "Adet", null, "") + "</div>" +

    '<div class="card"><div class="card-head"><h3>Rework Yapan</h3></div>' +
      barChart(d.reworkers.slice(0, 12), "Adet", null, "") + "</div>" +

    '<div class="card"><div class="card-head"><h3>Hangi İstasyonda Tespit Edildi</h3></div>' +
      barChart(d.byStation.slice(0, 12), "Adet", null, "") + "</div>";

  $("#r-days", view).onchange = function (e) { repDays = Number(e.target.value); rerender(); };
  $("#r-print", view).onclick = function () { window.print(); };
}

/* ================= Erişim talepleri ================= */

export function talepler(view, _p, rerender) {
  const rows = data.requests.slice().sort(function (a, b) {
    return new Date(b.at || 0) - new Date(a.at || 0);
  });
  const bekleyen = rows.filter(function (r) { return r.status === "bekliyor"; });

  view.innerHTML =
    '<div class="page-head"><div><h2>Erişim Talepleri</h2>' +
      "<p>" + bekleyen.length + " bekleyen talep</p></div></div>" +
    (rows.length ? '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>Ad Soyad</th><th>E-posta</th><th>Görevi</th><th>Tarih</th><th>Durum</th><th></th></tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr>" +
          "<td><strong>" + esc(r.name || "") + "</strong></td>" +
          "<td>" + esc(r.email || r.id) + "</td>" +
          "<td>" + esc(r.gorev || "—") + "</td>" +
          "<td>" + fmtDate(r.at) + "</td>" +
          "<td>" + (r.status === "bekliyor"
            ? '<span class="chip chip-amber">Bekliyor</span>'
            : '<span class="chip chip-slate">Reddedildi</span>') + "</td>" +
          '<td><div class="btn-row">' +
            (r.status === "bekliyor"
              ? '<button class="btn btn-primary btn-sm" data-ok="' + esc(r.email || r.id) + '">Onayla</button>' +
                '<button class="btn btn-sm" data-no="' + esc(r.email || r.id) + '">Reddet</button>'
              : "") + "</div></td></tr>";
      }).join("") + "</tbody></table></div>"
      : emptyBox("Bekleyen erişim talebi yok.", "📬"));

  $$("[data-ok]", view).forEach(function (b) {
    b.onclick = function () {
      const r = rows.find(function (x) { return (x.email || x.id) === b.dataset.ok; });
      approveDialog(r, rerender);
    };
  });
  $$("[data-no]", view).forEach(function (b) {
    b.onclick = async function () {
      if (!(await confirmDialog("Talebi Reddet",
        "Bu kişi uygulamaya giremeyecek ve aynı e-postayla tekrar talep bırakamayacak. Devam edilsin mi?",
        "Reddet", "btn-danger"))) return;
      try { await decideRequest(b.dataset.no, false); toast("Talep reddedildi.", "ok"); rerender(); }
      catch (e) { err(e); }
    };
  });
}

function rolePickGrid(id, selected) {
  return '<div class="pick-grid" id="' + id + '">' + Object.keys(ROLES).map(function (r) {
    return '<button type="button" class="pick' + (selected.indexOf(r) !== -1 ? " selected" : "") +
      '" data-r="' + r + '">' + esc(ROLES[r]) + "</button>";
  }).join("") + "</div>";
}

function bindRolePick(body, id, selected) {
  $("#" + id, body).onclick = function (e) {
    const b = e.target.closest(".pick");
    if (!b) return;
    const r = b.dataset.r;
    const i = selected.indexOf(r);
    if (i === -1) { selected.push(r); b.classList.add("selected"); }
    else { selected.splice(i, 1); b.classList.remove("selected"); }
  };
}

function approveDialog(req, onDone) {
  if (!req) return;
  const mail = req.email || req.id;
  // Beklenen kişiler listesinde varsa roller ve istasyon hazır gelsin.
  const match = SEED_PEOPLE.concat(data.people || []).find(function (p) {
    return String(p.name || "").toLocaleLowerCase("tr") === String(req.name || "").toLocaleLowerCase("tr");
  });
  const selected = (match && match.roles ? match.roles.slice() : ["operator"]);
  const steps = activeSteps();

  const body = el('<div>' +
    '<div class="banner info" style="margin-top:0"><strong>' + esc(req.name || "") + "</strong> — " +
      esc(mail) + "<br><small>Görevi: " + esc(req.gorev || "—") + "</small>" +
      (match ? "<br><small>Beklenen kişiler listesinde bulundu, roller dolduruldu.</small>" : "") + "</div>" +
    '<label class="field"><span>Ad Soyad</span><input class="input" id="ap-name" value="' + esc(req.name || "") + '"></label>' +
    '<div class="field"><span>Roller (birden fazla seçilebilir)</span>' + rolePickGrid("ap-roles", selected) + "</div>" +
    '<label class="field"><span>Varsayılan İstasyon</span><select class="input" id="ap-step"><option value="">—</option>' +
      steps.map(function (s) {
        return '<option value="' + esc(s.code) + '"' + (match && match.stepCode === s.code ? " selected" : "") +
               ">" + esc(s.code + " — " + s.name) + "</option>";
      }).join("") + "</select></label></div>");

  bindRolePick(body, "ap-roles", selected);

  modal({
    title: "Erişimi Onayla", body: body,
    buttons: [{ label: "Vazgeç" }, {
      label: "Onayla ve Yetki Ver", cls: "btn-primary",
      onClick: async function () {
        if (!selected.length) { toast("En az bir rol seçin.", "err"); return "keep"; }
        try {
          await decideRequest(mail, true, selected, $("#ap-step", body).value,
                              $("#ap-name", body).value);
          toast("Erişim verildi.", "ok");
          if (onDone) onDone();
        } catch (e) { err(e); return "keep"; }
      }
    }]
  });
}

/* ================= Tanımlar ================= */

let admTab = "kullanicilar";

export function tanimlar(view, _p, rerender) {
  const tabs = [["kullanicilar", "👤 Kullanıcılar"], ["adimlar", "🗺️ Adımlar"],
                ["listeler", "📋 Listeler"], ["kayit", "🔍 Denetim Kaydı"]];
  view.innerHTML =
    '<div class="page-head"><div><h2>Tanımlar</h2><p>Adım, kullanıcı ve liste tanımları</p></div></div>' +
    '<div class="btn-row" style="margin-bottom:14px">' + tabs.map(function (t) {
      return '<button class="btn btn-sm ' + (t[0] === admTab ? "btn-primary" : "") +
             '" data-tab="' + t[0] + '">' + esc(t[1]) + "</button>";
    }).join("") + "</div><div id=\"adm-body\"></div>";

  $$("[data-tab]", view).forEach(function (b) {
    b.onclick = function () { admTab = b.dataset.tab; rerender(); };
  });

  const body = $("#adm-body", view);
  if (admTab === "kullanicilar") drawUsers(body, rerender);
  if (admTab === "adimlar") drawSteps(body, rerender);
  if (admTab === "listeler") drawLookups(body, rerender);
  if (admTab === "kayit") drawAudit(body);
}

function drawUsers(body, rerender) {
  const rows = data.allowed.slice().sort(function (a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""), "tr");
  });
  body.innerHTML =
    '<div class="card"><div class="card-head"><h3>Giriş Yetkisi Olanlar</h3>' +
      '<div class="spacer"></div><button class="btn btn-primary btn-sm" id="u-add">+ Kullanıcı Ekle</button></div>' +
    '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>Ad Soyad</th><th>E-posta</th><th>Roller</th><th>İstasyon</th><th></th></tr></thead><tbody>" +
      rows.map(function (u) {
        return "<tr><td><strong>" + esc(u.name || "") + "</strong></td>" +
          "<td>" + esc(u.email) + "</td>" +
          "<td>" + roleLabels(u.roles).map(function (r) {
            return '<span class="chip">' + esc(r) + "</span>";
          }).join(" ") + "</td>" +
          "<td>" + esc(u.stepCode || "—") + "</td>" +
          '<td><div class="btn-row">' +
            '<button class="btn btn-sm" data-edit="' + esc(u.email) + '">Düzenle</button>' +
            (u.email === myEmail() ? ""
              : '<button class="btn btn-danger btn-sm" data-del="' + esc(u.email) + '">Kaldır</button>') +
          "</div></td></tr>";
      }).join("") + "</tbody></table></div></div>";

  $("#u-add", body).onclick = function () { userDialog(null, rerender); };
  $$("[data-edit]", body).forEach(function (b) {
    b.onclick = function () {
      userDialog(rows.find(function (u) { return u.email === b.dataset.edit; }), rerender);
    };
  });
  $$("[data-del]", body).forEach(function (b) {
    b.onclick = async function () {
      if (!(await confirmDialog("Yetkiyi Kaldır",
        b.dataset.del + " artık uygulamaya giremeyecek. Geçmiş kayıtları olduğu gibi kalır. Devam edilsin mi?",
        "Kaldır", "btn-danger"))) return;
      try { await revokeAccess(b.dataset.del); toast("Yetki kaldırıldı.", "ok"); rerender(); }
      catch (e) { err(e); }
    };
  });
}

function userDialog(u, onDone) {
  const selected = u ? (u.roles || []).slice() : ["operator"];
  const steps = activeSteps();
  const body = el('<div>' +
    '<label class="field"><span>Ad Soyad *</span><input class="input" id="u-name" value="' + esc(u ? u.name : "") + '"></label>' +
    '<label class="field"><span>E-posta (Google hesabı) *</span><input class="input" id="u-mail" ' +
      (u ? "disabled " : "") + 'value="' + esc(u ? u.email : "") + '" placeholder="ad.soyad@gmail.com"></label>' +
    '<div class="field"><span>Roller *</span>' + rolePickGrid("u-roles", selected) + "</div>" +
    '<label class="field"><span>Varsayılan İstasyon</span><select class="input" id="u-step"><option value="">—</option>' +
      steps.map(function (s) {
        return '<option value="' + esc(s.code) + '"' + (u && u.stepCode === s.code ? " selected" : "") +
               ">" + esc(s.code + " — " + s.name) + "</option>";
      }).join("") + "</select></label>" +
    '<p class="card-sub">Kişi bu e-postayla Google ile ya da kendi şifresiyle giriş yapar. ' +
      "Şifreyi siz belirlemezsiniz — ilk girişte kendisi oluşturur.</p></div>");

  bindRolePick(body, "u-roles", selected);

  modal({
    title: u ? "Kullanıcı Düzenle — " + u.name : "Yeni Kullanıcı", body: body,
    buttons: [{ label: "Vazgeç" }, {
      label: "Kaydet", cls: "btn-primary",
      onClick: async function () {
        const mail = String($("#u-mail", body).value || "").trim().toLowerCase();
        const name = String($("#u-name", body).value || "").trim();
        if (!name) { toast("Ad soyad gerekli.", "err"); return "keep"; }
        if (!mail || mail.indexOf("@") === -1) { toast("Geçerli bir e-posta yazın.", "err"); return "keep"; }
        if (!selected.length) { toast("En az bir rol seçin.", "err"); return "keep"; }
        try {
          await grantAccess(mail, name, selected, $("#u-step", body).value);
          toast("Kaydedildi.", "ok");
          if (onDone) onDone();
        } catch (e) { err(e); return "keep"; }
      }
    }]
  });
}

function drawSteps(body, rerender) {
  const steps = data.steps.slice().sort(function (a, b) { return a.seq - b.seq; });
  body.innerHTML =
    '<div class="card"><div class="card-head"><h3>Adımlar</h3>' +
      '<div class="spacer"></div><button class="btn btn-sm" id="s-add">+ Adım Ekle</button></div>' +
    '<p class="card-sub" style="margin-bottom:10px">Hedef süre 0 ise gecikme uyarısı çıkmaz. ' +
      "Uygulama bir süre çalıştıktan sonra gerçek verilerden belirleyebilirsiniz.</p>" +
    '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>#</th><th>Kod</th><th>Ad</th><th>Tür</th><th>Hedef</th><th>Hata girilir</th><th>Durum</th><th></th>" +
      "</tr></thead><tbody>" + steps.map(function (s) {
        return "<tr><td>" + s.seq + "</td><td><strong>" + esc(s.code) + "</strong></td>" +
          "<td>" + esc(s.name) + "</td>" +
          '<td><span class="chip" style="background:' + esc((KIND_COLOR[s.kind] || "#64748b") + "22") + '">' +
            esc(KIND_LABEL[s.kind] || s.kind) + "</span></td>" +
          "<td>" + (s.targetMinutes ? s.targetMinutes + " dk" : "—") + "</td>" +
          "<td>" + (s.allowsDefect ? "✓" : "—") + "</td>" +
          "<td>" + (s.active === false ? '<span class="chip chip-slate">Pasif</span>'
                                       : '<span class="chip chip-green">Aktif</span>') + "</td>" +
          '<td><div class="btn-row"><button class="btn btn-sm" data-s="' + esc(s.id) + '">Düzenle</button>' +
            '<button class="btn btn-danger btn-sm" data-sdel="' + esc(s.id) + '">Sil</button></div></td></tr>';
      }).join("") + "</tbody></table></div></div>";

  $("#s-add", body).onclick = function () { stepDialog(null, rerender); };
  $$("[data-s]", body).forEach(function (b) {
    b.onclick = function () {
      stepDialog(steps.find(function (s) { return s.id === b.dataset.s; }), rerender);
    };
  });
  $$("[data-sdel]", body).forEach(function (b) {
    b.onclick = function () {
      deleteStepFlow(steps.find(function (s) { return s.id === b.dataset.sdel; }), rerender);
    };
  });
}

// Bir adım kullanılmış mı? Silinip silinemeyeceğini bu belirler.
export function stepUsage(s) {
  if (!s) return { hatta: 0, gecmis: 0, hata: 0, total: 0 };
  const hatta = data.tractors.filter(function (t) { return t.currentStepId === s.id; }).length;
  const gecmis = data.tractors.filter(function (t) { return t.steps && t.steps[s.code]; }).length;
  const hata = data.defects.filter(function (d) {
    return d.detectedStepId === s.id || d.detectedStepCode === s.code;
  }).length;
  return { hatta: hatta, gecmis: gecmis, hata: hata, total: hatta + gecmis + hata };
}

// Adım silme. "Pasif" akıştan çıkarır ama geçmişi okunur bırakır; silme ise
// tanımı büsbütün yok eder. Bu yüzden yalnızca HİÇ KULLANILMAMIŞ adım silinir:
// bir traktörün geçmişinde ya da bir hata kaydında geçen adım silinirse o
// kayıtlar "hangi istasyon?" sorusuna cevap veremez hâle gelir.
// Sunucu tarafında config yazma zaten yalnızca yöneticide (firestore.rules).
async function deleteStepFlow(s, onDone) {
  if (!s) return;
  if (!isAdmin()) { toast("Adım silme yetkisi yalnızca sistem yöneticisinde.", "err"); return; }

  // Kullanım taraması geçmişin TAMAMINDA yapılır; ekranda yalnızca son
  // aylar yüklü olabilir.
  try { await ensureHistory(3650); } catch (e) { /* eski kayıtlar okunamadıysa aşağıdaki tarama yine de çalışır */ }

  const u = stepUsage(s);

  if (u.total) {
    const parcalar = [];
    if (u.hatta) parcalar.push(u.hatta + " traktör şu anda bu adımda");
    if (u.gecmis) parcalar.push(u.gecmis + " traktörün geçmişinde var");
    if (u.hata) parcalar.push(u.hata + " hata kaydı bu istasyona yazılmış");
    await confirmDialog(s.code + " silinemez",
      "Bu adım kullanılmış: " + parcalar.join(", ") + ". Silinirse bu kayıtlar hangi " +
      "istasyona ait olduğunu gösteremez. Akıştan çıkarmak için Düzenle → Durum → " +
      "Pasif yapın; geçmiş olduğu gibi kalır.", "Anladım");
    return;
  }

  if (!(await confirmDialog("Adımı Sil — " + s.code,
    '"' + s.name + '" adımı tanımlardan tamamen kaldırılacak. Bu adım hiç kullanılmamış, ' +
    "bu yüzden hiçbir kayıt etkilenmiyor. Geri alınamaz.", "Sil", "btn-danger"))) return;

  const items = data.steps.filter(function (x) { return x.id !== s.id; })
    .sort(function (a, b) { return a.seq - b.seq; });
  try {
    await setDocFull("config", "steps", { items: items });
    await log("adim_silindi", s.code, s.name + " (sıra " + s.seq + ")");
    toast(s.code + " silindi.", "ok");
    if (onDone) onDone();
  } catch (e) { err(e); }
}

function stepDialog(s, onDone) {
  const isNew = !s;
  const maxSeq = data.steps.reduce(function (m, x) { return Math.max(m, x.seq); }, 0);
  s = s || { id: newId("s"), seq: maxSeq + 1, code: "", name: "", kind: "islem",
             targetMinutes: 0, posX: 50, posY: 50, allowsDefect: false, active: true };
  const body = el('<div class="form-grid">' +
    '<label class="field"><span>Sıra *</span><input class="input" id="s-seq" type="number" value="' + s.seq + '"></label>' +
    '<label class="field"><span>Kod *</span><input class="input" id="s-code" value="' + esc(s.code) + '"></label>' +
    '<label class="field field-wide"><span>Ad *</span><input class="input" id="s-name" value="' + esc(s.name) + '"></label>' +
    '<label class="field"><span>Tür</span><select class="input" id="s-kind">' +
      Object.keys(KIND_LABEL).map(function (k) {
        return '<option value="' + k + '"' + (k === s.kind ? " selected" : "") + ">" + esc(KIND_LABEL[k]) + "</option>";
      }).join("") + "</select></label>" +
    '<label class="field"><span>Hedef süre (dk, 0 = yok)</span><input class="input" id="s-target" type="number" value="' + (s.targetMinutes || 0) + '"></label>' +
    '<label class="field"><span>Hata kaydı açılabilir mi?</span><select class="input" id="s-ad">' +
      '<option value="1"' + (s.allowsDefect ? " selected" : "") + ">Evet</option>" +
      '<option value="0"' + (s.allowsDefect ? "" : " selected") + ">Hayır</option></select></label>" +
    '<label class="field"><span>Durum</span><select class="input" id="s-act">' +
      '<option value="1"' + (s.active !== false ? " selected" : "") + ">Aktif</option>" +
      '<option value="0"' + (s.active === false ? " selected" : "") + ">Pasif (akıştan çıkar)</option></select></label>" +
  "</div>");

  modal({
    title: isNew ? "Yeni Adım" : "Adım Düzenle — " + s.code, body: body,
    buttons: [{ label: "Vazgeç" }, {
      label: "Kaydet", cls: "btn-primary",
      onClick: async function () {
        const code = String($("#s-code", body).value || "").trim().toUpperCase();
        const name = String($("#s-name", body).value || "").trim();
        if (!code || !name) { toast("Kod ve ad gerekli.", "err"); return "keep"; }
        const clash = data.steps.find(function (x) { return x.code === code && x.id !== s.id; });
        if (clash) { toast("'" + code + "' kodlu adım zaten var.", "err"); return "keep"; }

        const kind = $("#s-kind", body).value;
        const rec = {
          id: s.id, seq: Number($("#s-seq", body).value) || 1, code: code, name: name,
          kind: kind, targetMinutes: Number($("#s-target", body).value) || 0,
          posX: s.posX, posY: s.posY, color: KIND_COLOR[kind] || "#2563eb",
          allowsDefect: $("#s-ad", body).value === "1",
          active: $("#s-act", body).value === "1"
        };
        const items = data.steps.filter(function (x) { return x.id !== s.id; }).concat([rec])
          .sort(function (a, b) { return a.seq - b.seq; });
        try {
          await saveDoc("config", "steps", { items: items });
          await log(isNew ? "adim_olusturuldu" : "adim_guncellendi", code, name);
          toast("Kaydedildi.", "ok");
          if (onDone) onDone();
        } catch (e) { err(e); return "keep"; }
      }
    }]
  });
}

function drawLookups(body, rerender) {
  const names = { hata_kodu: "Hata Kategorileri", hata_kaynagi: "Hata Kaynağı",
                  olusum_yeri: "Oluşum Yeri", aile: "Traktör Ailesi",
                  hold_reason: "Bekletme Sebebi" };
  const keys = Object.keys(names);
  body.innerHTML = keys.map(function (k) {
    const items = (data.lookups[k] || []);
    return '<div class="card"><div class="card-head"><h3>' + esc(names[k]) + "</h3>" +
      '<div class="spacer"></div><button class="btn btn-sm" data-lk="' + k + '">Düzenle</button></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + items.map(function (v) {
        return '<span class="chip">' + esc(v) + "</span>";
      }).join("") + (items.length ? "" : '<span class="card-sub">Boş</span>') + "</div></div>";
  }).join("");

  $$("[data-lk]", body).forEach(function (b) {
    b.onclick = function () {
      const k = b.dataset.lk;
      const ta = el('<div><p class="card-sub" style="margin-bottom:8px">Her satıra bir değer yazın.</p>' +
        '<textarea class="input" id="lk-t" rows="12">' + esc((data.lookups[k] || []).join("\n")) + "</textarea></div>");
      modal({
        title: names[k], body: ta,
        buttons: [{ label: "Vazgeç" }, {
          label: "Kaydet", cls: "btn-primary",
          onClick: async function () {
            const items = $("#lk-t", ta).value.split("\n").map(function (s) { return s.trim(); })
              .filter(Boolean);
            const next = Object.assign({}, data.lookups);
            next[k] = items;
            try {
              await saveDoc("config", "lookups", next);
              await log("liste_guncellendi", k, items.length + " değer");
              toast("Kaydedildi.", "ok"); rerender();
            } catch (e) { err(e); return "keep"; }
          }
        }]
      });
    };
  });
}

async function drawAudit(body) {
  body.innerHTML = '<div class="card"><p class="card-sub">Yükleniyor…</p></div>';
  let rows = [];
  try { rows = await readLog(300); } catch (e) { err(e); }
  body.innerHTML = '<div class="card"><div class="card-head"><h3>Denetim Kaydı</h3></div>' +
    '<p class="card-sub" style="margin-bottom:10px">Son ' + rows.length + " işlem. " +
      "Bu kayıtlar <strong>değiştirilemez ve silinemez</strong> — kural katmanında kilitlidir.</p>" +
    (rows.length ? '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>Tarih</th><th>Kim</th><th>İşlem</th><th>Nesne</th><th>Ayrıntı</th></tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr><td>" + fmtDate(r.at || r.atISO) + "</td>" +
          "<td>" + esc(r.byName || r.by || "") + "</td>" +
          '<td><span class="chip">' + esc(r.action) + "</span></td>" +
          "<td>" + esc(r.target || "") + "</td>" +
          '<td class="card-sub">' + esc(r.detail || "") + "</td></tr>";
      }).join("") + "</tbody></table></div>" : emptyBox("Kayıt yok.", "🔍")) + "</div>";
}

/* ================= Başlangıç verisi ================= */

// İlk açılışta tanımları yazar. Kayıtlar (traktörler, hatalar) taşınmaz.
export async function seedAll() {
  const steps = SEED_STEPS.map(function (s) {
    return Object.assign({ id: newId("s"), color: KIND_COLOR[s.kind] || "#2563eb" }, s);
  });
  await setDocFull("config", "steps", { items: steps });
  await setDocFull("config", "lookups", SEED_LOOKUPS);
  await setDocFull("config", "catalog", { items: SEED_CATALOG });
  await setDocFull("config", "people", { items: SEED_PEOPLE });
  await log("baslangic_verisi_yuklendi", "config",
            steps.length + " adım, " + SEED_CATALOG.length + " hata tanımı");
}

export function seedScreen(view, _p, rerender) {
  view.innerHTML =
    '<div class="card" style="max-width:620px;margin:30px auto">' +
      "<h2>Kuruluma hoş geldiniz</h2>" +
      '<p class="card-sub" style="margin:10px 0 16px">Uygulama boş. Aşağıdaki düğme 11 adımı, ' +
        "saha yerleşimini, Excel'deki geçmiş kayıtlardan çıkarılan " + SEED_CATALOG.length +
        " hazır hata tanımını ve seçim listelerini yükler. " +
        "Traktör ve hata <strong>kayıtları</strong> taşınmaz — sistem temiz başlar.</p>" +
    "</div>" +
      '<button class="btn btn-primary btn-lg btn-block" id="seed-go">Başlangıç verilerini yükle</button>';
  $("#seed-go", view).onclick = async function (e) {
    e.target.disabled = true;
    try { await seedAll(); toast("Tanımlar yüklendi.", "ok"); rerender(); }
    catch (er) { err(er); e.target.disabled = false; }
  };
}
