// Column mapping: Account=Creator, Partner=Creator group, Sales=Total earnings. Forecast = (sales/days_elapsed)*daysInMonth.
// ---- COLUMN ALIASES ----
const COL_ALIASES = {
  date: ["date/time", "date", "datetime", "time", "date_time"],
  account: ["creator", "account", "name", "account name"],
  partner: ["creator group", "creatorgroup", "partner", "partner name"],
  // Prefer an explicit "Total earnings net" column if present
  sales: [
    "total earnings net",
    "totalearnings net",
    "totalearningsnet",
    "earnings net",
    "total earnings",
    "totalearnings",
    "sales",
    "revenue",
    "total sales",
    "amount",
    "total earn",
    "totalearn",
    "earnings"
  ],
  lastMonth: ["last month", "lastmonth", "previous month", "last month sales"],
  subsGrowth: ["subs growth", "subsgrowth", "subs Δ", "subscription growth", "creator gr", "creatorgr"],
  reach: ["reach", "followers", "audience", "fans", "active fans"],
  newFans: ["new fans", "newfans"],
  messages: ["message", "messages", "message net", "posts net"],
  subscription: ["subscription", "subscripti", "subs", "recurring", "new subs", "recurring subscriptions"],
  tips: ["tips net", "tips"],
  targetPct: ["target %", "target%", "%", "target pct"]
};

function findColumnIndex(headers, aliases) {
  const h = headers.map(header => String(header || "").trim().toLowerCase());
  for (const alias of aliases) {
    const i = h.findIndex(x => {
      if (alias === "creator group" || alias === "creatorgroup") {
        return x.includes("creator group") || x.includes("creatorgroup");
      }
      return x.includes(alias) || alias.includes(x);
    });
    if (i >= 0) return i;
  }
  return -1;
}

function parseNumber(val) {
  if (val == null || val === "") return null;
  const s = String(val).replace(/[,$\s]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ---- PARSE CSV ----
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const rows = lines.map(line => {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if ((c === "," && !inQuotes) || c === "\t") {
        result.push(current.trim());
        current = "";
      } else {
        current += c;
      }
    }
    result.push(current.trim());
    return result;
  });
  return rows;
}

// ---- PARSE EXCEL (SheetJS) ----
function parseExcel(buffer) {
  const wb = typeof XLSX !== "undefined" ? XLSX.read(buffer, { type: "array" }) : null;
  if (!wb || !wb.SheetNames.length) return [];
  const names = wb.SheetNames.map(s => s.toLowerCase());
  const dailyIdx = names.findIndex(s => s.includes("daily") && s.includes("sales"));
  const sheetName = dailyIdx >= 0 ? wb.SheetNames[dailyIdx] : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const arr = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  return arr;
}

// ---- PARSE DATE (Excel serial, ISO, or D/M/Y) ----
function parseDate(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number") {
    // Excel serial date (days since 1899-12-30)
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  const s = String(val).trim();
  // Explicit ISO-like YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) {
    const year = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const dIso = new Date(year, mon, day);
    if (!isNaN(dIso.getTime())) return dIso;
  }
  // Handle day/month/year vs month/day/year, prefer day/month when ambiguous
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const a = parseInt(m[1], 10); // first number
    const b = parseInt(m[2], 10); // second number
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    let day, mon;
    if (a > 12 && b <= 12) {
      // clearly D/M/Y (e.g. 25/2/2026)
      day = a;
      mon = b - 1;
    } else if (b > 12 && a <= 12) {
      // clearly M/D/Y (e.g. 2/25/2026)
      mon = a - 1;
      day = b;
    } else {
      // both <= 12 → ambiguous, default to D/M/Y for this dashboard
      day = a;
      mon = b - 1;
    }
    const d2 = new Date(year, mon, day);
    if (!isNaN(d2.getTime())) return d2;
  }
  // Fallback: let JS try to parse other formats
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ---- AGGREGATE RAW TIME-SERIES DATA ----
function aggregateRawData(rows, headerRowIndex, idx, thisMonth, thisYear, throughDay, dateRange) {
  let thisFrom, thisTo, lastFrom, lastTo;
  if (dateRange && dateRange.from && dateRange.to) {
    thisFrom = new Date(dateRange.from);
    thisTo = new Date(dateRange.to);
    thisFrom.setHours(0, 0, 0, 0);
    thisTo.setHours(23, 59, 59, 999);
    lastFrom = new Date(thisFrom);
    lastFrom.setMonth(lastFrom.getMonth() - 1);
    lastTo = new Date(thisTo);
    lastTo.setMonth(lastTo.getMonth() - 1);
  } else {
    const prevMonth = thisMonth === 1 ? 12 : thisMonth - 1;
    const prevYear = thisMonth === 1 ? thisYear - 1 : thisYear;
    // Same number of days: 1 → throughDay this month vs 1 → throughDay last month
    thisFrom = new Date(thisYear, thisMonth - 1, 1);
    thisTo = new Date(thisYear, thisMonth - 1, throughDay, 23, 59, 59, 999);
    lastFrom = new Date(prevYear, prevMonth - 1, 1);
    lastTo = new Date(prevYear, prevMonth - 1, throughDay, 23, 59, 59, 999);
  }

  const thisPeriod = {};
  const lastPeriod = {};
  const reach = {};
  const creatorGrowth = {};
  const creatorGroup = {};

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseDate(r[idx.date]);
    if (!date) continue;

    const creator = idx.account >= 0 ? String(r[idx.account] || "").trim() : "";
    if (!creator) continue;

    const partner = idx.partner >= 0 ? String(r[idx.partner] || "").trim() : "—";
    if (partner) creatorGroup[creator] = partner;

    const totalEarn = idx.sales >= 0 ? (parseNumber(r[idx.sales]) ?? 0) : 0;
    const msg = idx.messages >= 0 ? (parseNumber(r[idx.messages]) ?? 0) : 0;
    let sub = idx.subscription >= 0 ? (parseNumber(r[idx.subscription]) ?? 0) : 0;
    const tips = idx.tips >= 0 ? (parseNumber(r[idx.tips]) ?? 0) : 0;
    if (sub === 0 && tips > 0) sub = tips;
    const fans = idx.reach >= 0 ? (parseNumber(r[idx.reach]) ?? null) : null;
    const newFans = idx.newFans >= 0 ? (parseNumber(r[idx.newFans]) ?? 0) : 0;
    const growth = idx.subsGrowth >= 0 ? (parseNumber(r[idx.subsGrowth]) ?? null) : null;

    const t = date.getTime();
    if (t >= thisFrom.getTime() && t <= thisTo.getTime()) {
      if (!thisPeriod[creator]) thisPeriod[creator] = { sales: 0, messages: 0, subs: 0, newFans: 0 };
      thisPeriod[creator].sales += totalEarn;
      thisPeriod[creator].messages += msg;
      thisPeriod[creator].subs += sub;
      thisPeriod[creator].newFans += newFans;
      if (fans != null) reach[creator] = fans;
      if (growth != null) creatorGrowth[creator] = growth;
    } else if (t >= lastFrom.getTime() && t <= lastTo.getTime()) {
      if (!lastPeriod[creator]) lastPeriod[creator] = { sales: 0 };
      lastPeriod[creator].sales += totalEarn;
    }
  }

  const creators = new Set([...Object.keys(thisPeriod), ...Object.keys(lastPeriod)]);
  const accounts = [];
  let totalMessages = 0;
  let totalSubs = 0;
  let totalLastMonth = 0;

  creators.forEach(name => {
    const t = thisPeriod[name] || { sales: 0, messages: 0, subs: 0, newFans: 0 };
    const l = lastPeriod[name] || { sales: 0 };
    accounts.push({
      name: name || "—",
      partner: creatorGroup[name] || "—",
      messages: t.messages ?? null,
      subs: t.subs ?? null,
      newFans: t.newFans || null,
      sales: Math.round(t.sales),
      lastMonth: Math.round(l.sales),
      subsGrowth: creatorGrowth[name] ?? 0,
      reach: reach[name] ?? null
    });
    totalMessages += t.messages;
    totalSubs += t.subs;
    totalLastMonth += l.sales;
  });

  const totalThisMonth = accounts.reduce((s, a) => s + a.sales, 0);
  if (totalMessages === 0 && totalSubs === 0 && totalThisMonth > 0) {
    totalSubs = totalThisMonth;
  }

  return {
    accounts,
    totals: {
      messages: Math.round(totalMessages),
      subs: Math.round(totalSubs),
      lastMonthSameDays: Math.round(totalLastMonth)
    }
  };
}

// ---- EXTRACT ACCOUNTS FROM PARSED ROWS ----
function extractAccounts(rows, opts = {}) {
  if (!rows.length) return { accounts: [], rawMode: false, rawRows: null };

  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const row = (rows[i] || []).map(c => String(c || "").toLowerCase());
    const hasCreator = row.some(c => c.includes("creator"));
    const hasDate = row.some(c => c.includes("date") || c.includes("datetime"));
    const hasAccount = row.some(c => c.includes("account") || c.includes("name"));
    if (hasCreator || hasDate || hasAccount) {
      headerRowIndex = i;
      break;
    }
  }

  const headers = rows[headerRowIndex].map(h => String(h || "").trim());
  const idx = {
    date: findColumnIndex(headers, COL_ALIASES.date),
    account: findColumnIndex(headers, COL_ALIASES.account),
    partner: findColumnIndex(headers, COL_ALIASES.partner),
    sales: findColumnIndex(headers, COL_ALIASES.sales),
    lastMonth: findColumnIndex(headers, COL_ALIASES.lastMonth),
    subsGrowth: findColumnIndex(headers, COL_ALIASES.subsGrowth),
    reach: findColumnIndex(headers, COL_ALIASES.reach),
    messages: findColumnIndex(headers, COL_ALIASES.messages),
    subscription: findColumnIndex(headers, COL_ALIASES.subscription),
    tips: findColumnIndex(headers, COL_ALIASES.tips),
    targetPct: findColumnIndex(headers, COL_ALIASES.targetPct),
    newFans: findColumnIndex(headers, COL_ALIASES.newFans)
  };

  // Raw time-series format: has Date/Time + Creator
  if (idx.date >= 0 && idx.account >= 0 && idx.sales >= 0) {
    const thisMonth = opts.thisMonth ?? new Date().getMonth() + 1;
    const thisYear = opts.thisYear ?? new Date().getFullYear();
    const throughDay = opts.throughDay ?? new Date().getDate();
    const aggregated = aggregateRawData(rows, headerRowIndex, idx, thisMonth, thisYear, throughDay, opts.dateRange);
    return {
      accounts: aggregated.accounts,
      totals: aggregated.totals,
      rawMode: true,
      rawRows: rows,
      rawIdx: idx,
      rawHeaderRow: headerRowIndex
    };
  }

  // Simple format: one row per account
  if (idx.account < 0 && idx.sales < 0) return { accounts: [], rawMode: false, rawRows: null };

  const accounts = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const sales = idx.sales >= 0 ? parseNumber(r[idx.sales]) : null;
    const name = idx.account >= 0 ? String(r[idx.account] || "").trim() : `Account ${i + 1}`;
    if (!name && (sales == null || sales === 0)) continue;

    const tp = idx.targetPct >= 0 ? parseNumber(r[idx.targetPct]) : null;
    const nf = idx.newFans >= 0 ? (parseNumber(r[idx.newFans]) ?? null) : null;
    accounts.push({
      name: name || "—",
      partner: idx.partner >= 0 ? String(r[idx.partner] || "").trim() : "—",
      sales: sales != null ? Math.round(sales) : 0,
      lastMonth: idx.lastMonth >= 0 ? (parseNumber(r[idx.lastMonth]) ?? 0) : 0,
      subsGrowth: idx.subsGrowth >= 0 ? (parseNumber(r[idx.subsGrowth]) ?? 0) : 0,
      reach: idx.reach >= 0 ? (parseNumber(r[idx.reach]) ?? null) : null,
      newFans: nf,
      targetPct: tp != null && tp > 0 ? tp : null
    });
  }
  return { accounts, rawMode: false, rawRows: null };
}

// ---- ORDINAL HELPER ----
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---- BUILD RAWDATA FROM UI + FILE ----
function getRawDataFromUI(accounts, totalsOverride = null) {
  const dateFromEl = document.getElementById("dateFrom");
  const dateToEl = document.getElementById("dateTo");
  const daysInMonthVal = parseInt(document.getElementById("daysInMonth").value, 10) || 30;
  const thisMonthEl = document.getElementById("thisMonth");
  const thisYearEl = document.getElementById("thisYear");
  const thisMonth = thisMonthEl ? parseInt(thisMonthEl.value, 10) : new Date().getMonth() + 1;
  const thisYear = thisYearEl ? parseInt(thisYearEl.value, 10) : new Date().getFullYear();

  let daysElapsed;
  if (dateFromEl?.value && dateToEl?.value) {
    const from = new Date(dateFromEl.value);
    const to = new Date(dateToEl.value);
    daysElapsed = Math.max(1, Math.ceil((to - from) / (24 * 60 * 60 * 1000)) + 1);
  } else {
    const today = new Date();
    if (thisYear === today.getFullYear() && thisMonth === today.getMonth() + 1) {
      // Use today - 1 days when looking at the current month
      daysElapsed = Math.max(1, today.getDate() - 1);
    } else {
      daysElapsed = daysInMonthVal;
    }
  }

  let totals;
  if (totalsOverride) {
    totals = totalsOverride;
  } else {
    totals = {
      messages: parseInt(document.getElementById("messages").value, 10) || 0,
      subs: parseInt(document.getElementById("subs").value, 10) || 0,
      lastMonthSameDays: parseInt(document.getElementById("lastMonthSameDays").value, 10) || 0
    };
  }

  return {
    daysElapsed,
    daysInMonth: daysInMonthVal,
    totals,
    accounts,
    thisMonth,
    thisYear
  };
}

// ---- UPDATE COMPARE LABELS ----
function updateCompareLabels(day) {
  const lastLabel = document.getElementById("lastMonthLabel");
  if (!lastLabel) return;
  const dateFromVal = document.getElementById("dateFrom")?.value;
  const dateToVal = document.getElementById("dateTo")?.value;
  if (dateFromVal && dateToVal) {
    lastLabel.textContent = "Last period (same range last month) ($)";
  } else {
    lastLabel.textContent = `Last month (through ${ordinal(day || 1)}) ($)`;
  }
}

// ---- RENDER DASHBOARD ----
function renderDashboard(rawData) {
  updateCompareLabels(rawData.daysElapsed);

  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const day = rawData.daysElapsed || 1;
  const dateFromVal = document.getElementById("dateFrom")?.value;
  const dateToVal = document.getElementById("dateTo")?.value;
  let dataUpToDate, dataUpToTitle;
  if (dateFromVal && dateToVal) {
    dataUpToDate = dateFromVal + " – " + dateToVal;
    dataUpToTitle = "Custom date range; last period = same length, previous month";
  } else {
    dataUpToDate = monthNames[(rawData.thisMonth || 1) - 1] + " " + day + ", " + (rawData.thisYear || new Date().getFullYear());
    dataUpToTitle = "This month and last month: 1st–" + day + " only (same day range)";
  }
  const dataUpToEl = document.getElementById("dataUpTo");
  if (dataUpToEl) {
    dataUpToEl.textContent = "Data up to " + dataUpToDate;
    dataUpToEl.title = dataUpToTitle;
  }
  const filterModel = document.getElementById("filterModel")?.value || window._filterModel || "_all";
  const filterPartner = document.getElementById("filterPartner")?.value || window._filterPartner || "_all";
  let accountsToShow = rawData.accounts.filter(acc => {
    if (filterModel && filterModel !== "_all" && acc.name !== filterModel) return false;
    if (filterPartner && filterPartner !== "_all" && acc.partner !== filterPartner) return false;
    return true;
  });

  const sumSales = accountsToShow.reduce((s, a) => s + (a.sales || 0), 0);
  const sumLastMonth = accountsToShow.reduce((s, a) => s + (a.lastMonth || 0), 0);
  const totalSales = sumSales;
  const forecast = Math.round(
    (totalSales / rawData.daysElapsed) * rawData.daysInMonth
  );
  const monthVsLastPct = sumLastMonth
    ? (((totalSales - sumLastMonth) / sumLastMonth) * 100).toFixed(1)
    : "—";
  const monthVsLastClass = monthVsLastPct === "—" ? "" : parseFloat(monthVsLastPct) >= 0 ? "positive" : "negative";

  const hasPerAccountMessages = accountsToShow.some(a => a.messages != null);
  const hasPerAccountSubs = accountsToShow.some(a => a.subs != null);
  const filteredMessages = hasPerAccountMessages ? accountsToShow.reduce((s, a) => s + (a.messages || 0), 0) : rawData.totals.messages;
  const filteredSubs = hasPerAccountSubs ? accountsToShow.reduce((s, a) => s + (a.subs || 0), 0) : rawData.totals.subs;

  const partnerSales = {};
  accountsToShow.forEach(acc => {
    partnerSales[acc.partner] = (partnerSales[acc.partner] || 0) + (acc.sales || 0);
  });

  document.getElementById("totalSales").innerText = `$${totalSales.toLocaleString()}`;
  document.getElementById("messageSales").innerText = `$${filteredMessages.toLocaleString()}`;
  document.getElementById("subSales").innerText = `$${filteredSubs.toLocaleString()}`;

  const monthVsLastEl = document.getElementById("monthVsLast");
  monthVsLastEl.innerText = monthVsLastPct === "—" ? "—" : `${parseFloat(monthVsLastPct) >= 0 ? "+" : ""}${monthVsLastPct}%`;
  monthVsLastEl.className = monthVsLastClass;

  const forecastEl = document.getElementById("forecast");
  forecastEl.innerText = `$${forecast.toLocaleString()}`;
  forecastEl.title = `Sum of all accounts × (days in month ÷ ${rawData.daysElapsed} days)`;

  const monthVsLastLabel = document.getElementById("monthVsLastLabel");
  if (monthVsLastLabel) monthVsLastLabel.textContent = `This month vs last (through ${ordinal(rawData.daysElapsed)})`;

  let agencyGrowthSum = 0;
  accountsToShow.forEach(acc => {
    const weightPct = sumLastMonth ? (acc.lastMonth / sumLastMonth) * 100 : 0;
    const growthPct = acc.lastMonth ? ((acc.sales - acc.lastMonth) / acc.lastMonth) * 100 : 0;
    agencyGrowthSum += growthPct * weightPct;
  });
  const agencyGrowthPct = sumLastMonth ? (agencyGrowthSum / 100).toFixed(1) : "—";
  const agencyEl = document.getElementById("agencyGrowth");
  if (agencyEl) {
    agencyEl.innerText = agencyGrowthPct === "—" ? "—" : `${parseFloat(agencyGrowthPct) >= 0 ? "+" : ""}${agencyGrowthPct}%`;
    agencyEl.className = agencyGrowthPct !== "—" ? (parseFloat(agencyGrowthPct) >= 0 ? "positive" : "negative") : "";
  }

  const sortCol = window._sortColumn;
  const sortDir = window._sortDirection === "desc" ? -1 : 1;
  if (sortCol) {
    accountsToShow = [...accountsToShow].sort((a, b) => {
      let va, vb;
      switch (sortCol) {
        case "name": va = (a.name || "").toLowerCase(); vb = (b.name || "").toLowerCase(); return sortDir * (va.localeCompare(vb));
        case "partner": va = (a.partner || "").toLowerCase(); vb = (b.partner || "").toLowerCase(); return sortDir * (va.localeCompare(vb));
        case "sales": va = a.sales || 0; vb = b.sales || 0; return sortDir * (va - vb);
        case "lastMonth": va = a.lastMonth || 0; vb = b.lastMonth || 0; return sortDir * (va - vb);
        case "dif": va = (a.sales || 0) - (a.lastMonth || 0); vb = (b.sales || 0) - (b.lastMonth || 0); return sortDir * (va - vb);
        case "weight": va = sumSales ? ((a.sales || 0) / sumSales) * 100 : 0; vb = sumSales ? ((b.sales || 0) / sumSales) * 100 : 0; return sortDir * (va - vb);
        case "partnerWeight": va = sumSales ? ((partnerSales[a.partner] || 0) / sumSales) * 100 : 0; vb = sumSales ? ((partnerSales[b.partner] || 0) / sumSales) * 100 : 0; return sortDir * (va - vb);
        case "target": va = Math.round((a.lastMonth || 0) * 1.2); vb = Math.round((b.lastMonth || 0) * 1.2); return sortDir * (va - vb);
        case "growth": va = a.lastMonth ? ((a.sales - a.lastMonth) / a.lastMonth) * 100 : -Infinity; vb = b.lastMonth ? ((b.sales - b.lastMonth) / b.lastMonth) * 100 : -Infinity; return sortDir * (va - vb);
        case "conversion":
          va = (a.subs && a.subs > 0) ? (a.sales || 0) / a.subs : -Infinity;
          vb = (b.subs && b.subs > 0) ? (b.sales || 0) / b.subs : -Infinity;
          return sortDir * (va - vb);
        case "newFans": va = a.newFans ?? -Infinity; vb = b.newFans ?? -Infinity; return sortDir * (va - vb);
        default: return 0;
      }
    });
  }

  const table = document.getElementById("accountTable");
  table.innerHTML = "";

  const modelOpts = [...new Set(rawData.accounts.map(a => a.name))].sort();
  const partnerOpts = [...new Set(rawData.accounts.map(a => a.partner))].filter(p => p && p !== "—").sort();
  window._modelOpts = modelOpts;
  window._partnerOpts = partnerOpts;
  window._filterModel = filterModel;
  window._filterPartner = filterPartner;
  const filterModelHidden = document.getElementById("filterModel");
  const filterPartnerHidden = document.getElementById("filterPartner");
  const filterModelInput = document.getElementById("filterModelInput");
  const filterPartnerInput = document.getElementById("filterPartnerInput");
  if (filterModelHidden) filterModelHidden.value = filterModel || "_all";
  if (filterPartnerHidden) filterPartnerHidden.value = filterPartner || "_all";
  if (filterModelInput) filterModelInput.value = filterModel && filterModel !== "_all" ? filterModel : "";
  if (filterPartnerInput) filterPartnerInput.value = filterPartner && filterPartner !== "_all" ? filterPartner : "";

  window._currentView = {
    accounts: accountsToShow,
    totals: {
      totalSales,
      filteredMessages,
      filteredSubs,
      monthVsLastPct: monthVsLastPct === "—" ? null : parseFloat(monthVsLastPct),
      forecast,
      agencyGrowthPct: agencyGrowthPct === "—" ? null : parseFloat(agencyGrowthPct)
    }
  };

  updateSortIndicators(sortCol, sortDir);

  accountsToShow.forEach(acc => {
    const weight = sumSales ? ((acc.sales / sumSales) * 100).toFixed(1) : "0";
    const partnerWeight = sumSales ? ((partnerSales[acc.partner] || 0) / sumSales * 100).toFixed(1) : "0";
    const growth = acc.lastMonth ? (((acc.sales - acc.lastMonth) / acc.lastMonth) * 100).toFixed(1) : "—";
    const growthNum = parseFloat(growth);
    const target = Math.round((acc.lastMonth || 0) * 1.2);
    const dif = (acc.sales || 0) - (acc.lastMonth || 0);
    const subs = acc.subs || 0;
    const conv = subs > 0 ? (acc.sales || 0) / subs : null;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${acc.name}</td>
      <td>${acc.partner}</td>
      <td>$${acc.sales.toLocaleString()}</td>
      <td>$${(acc.lastMonth || 0).toLocaleString()}</td>
      <td class="${dif >= 0 ? "positive" : "negative"}">${dif >= 0 ? "+" : ""}$${dif.toLocaleString()}</td>
      <td>${weight}%</td>
      <td>${partnerWeight}%</td>
      <td>$${target.toLocaleString()}</td>
      <td class="${growth !== "—" && growthNum >= 0 ? "positive" : growth !== "—" ? "negative" : ""}">${growth === "—" ? "—" : `${growthNum >= 0 ? "+" : ""}${growth}%`}</td>
      <td>${conv != null && isFinite(conv) ? (conv.toFixed(2)) : "—"}</td>
      <td>${acc.newFans != null ? acc.newFans.toLocaleString() : "—"}</td>
    `;
    table.appendChild(row);
  });
}

function updateSortIndicators(sortCol, sortDir) {
  document.querySelectorAll("th.sortable").forEach(th => {
    const key = th.getAttribute("data-sort");
    th.classList.remove("sort-asc", "sort-desc");
    if (key === sortCol) th.classList.add(sortDir === 1 ? "sort-asc" : "sort-desc");
  });
}

function initSortHandlers() {
  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (!key) return;
      const prev = window._sortColumn;
      const dir = window._sortDirection;
      if (prev === key) {
        window._sortDirection = dir === "asc" ? "desc" : "asc";
      } else {
        window._sortColumn = key;
        window._sortDirection = "asc";
      }
      refreshFromUI();
    });
  });
}

function openFilterDropdown(inputId, hiddenId, dropdownId, options) {
  const inputEl = document.getElementById(inputId);
  const dropdownEl = document.getElementById(dropdownId);
  if (!inputEl || !dropdownEl || !Array.isArray(options)) return;
  const q = (inputEl.value || "").trim().toLowerCase();
  const filtered = q ? options.filter(o => o.toLowerCase().includes(q)) : [...options];
  dropdownEl.innerHTML = "";
  const allOpt = document.createElement("div");
  allOpt.className = "filter-dropdown-option";
  allOpt.dataset.value = "_all";
  allOpt.dataset.label = "";
  allOpt.textContent = "All";
  allOpt.role = "option";
  dropdownEl.appendChild(allOpt);
  filtered.forEach(opt => {
    const div = document.createElement("div");
    div.className = "filter-dropdown-option";
    div.dataset.value = opt;
    div.dataset.label = opt;
    div.textContent = opt;
    div.role = "option";
    dropdownEl.appendChild(div);
  });
  dropdownEl.classList.add("is-open");
}

function closeFilterDropdown(dropdownId) {
  const el = document.getElementById(dropdownId);
  if (el) el.classList.remove("is-open");
}

function selectFilterOption(value, label, inputEl, hiddenEl, dropdownEl, onSelect) {
  if (hiddenEl) hiddenEl.value = value || "_all";
  if (inputEl) inputEl.value = label || "";
  if (dropdownEl) dropdownEl.classList.remove("is-open");
  if (onSelect) onSelect();
}

function initFilterAutocomplete(inputId, hiddenId, dropdownId, getOptions) {
  const inputEl = document.getElementById(inputId);
  const hiddenEl = document.getElementById(hiddenId);
  const dropdownEl = document.getElementById(dropdownId);
  if (!inputEl || !dropdownEl) return;
  inputEl.addEventListener("focus", () => {
    const opts = getOptions();
    if (opts && opts.length >= 0) openFilterDropdown(inputId, hiddenId, dropdownId, opts);
  });
  inputEl.addEventListener("input", () => {
    const opts = getOptions();
    if (opts && opts.length >= 0) openFilterDropdown(inputId, hiddenId, dropdownId, opts);
  });
  inputEl.addEventListener("blur", () => {
    setTimeout(() => closeFilterDropdown(dropdownId), 150);
  });
  dropdownEl.addEventListener("click", (e) => {
    const opt = e.target.closest(".filter-dropdown-option");
    if (!opt) return;
    const value = opt.dataset.value;
    const label = (opt.dataset.label || "").trim();
    selectFilterOption(value, label, inputEl, hiddenEl, dropdownEl, refreshFromUI);
  });
}

// ---- LOCAL STORAGE ----
const STORAGE_KEY = "qaDashboardData";

function buildCurrentViewRows() {
  const view = window._currentView;
  if (!view || !Array.isArray(view.accounts) || view.accounts.length === 0) return [];
  const header = ["Account", "Partner", "Current month", "Last month", "Delta", "Weight %", "Partner weight %", "Target", "Growth %", "Conversion rate", "New fans"];
  const rows = [header];
  const sumSales = view.accounts.reduce((s, a) => s + (a.sales || 0), 0);
  const partnerSales = {};
  view.accounts.forEach(acc => {
    partnerSales[acc.partner] = (partnerSales[acc.partner] || 0) + (acc.sales || 0);
  });
  view.accounts.forEach(acc => {
    const current = acc.sales || 0;
    const last = acc.lastMonth || 0;
    const delta = current - last;
    const weight = sumSales ? (current / sumSales) * 100 : 0;
    const pWeight = sumSales ? ((partnerSales[acc.partner] || 0) / sumSales) * 100 : 0;
    const target = Math.round(last * 1.2);
    const growth = last ? ((current - last) / last) * 100 : null;
     const subs = acc.subs || 0;
     const conv = subs > 0 ? current / subs : null;
    rows.push([
      acc.name || "",
      acc.partner || "",
      current,
      last,
      delta,
      Number.isFinite(weight) ? Number(weight.toFixed(1)) : 0,
      Number.isFinite(pWeight) ? Number(pWeight.toFixed(1)) : 0,
      target,
      growth != null && Number.isFinite(growth) ? Number(growth.toFixed(1)) : null,
      conv != null && Number.isFinite(conv) ? Number(conv.toFixed(2)) : null,
      acc.newFans != null ? acc.newFans : null
    ]);
  });
  return rows;
}

function downloadCurrentView(format) {
  const rows = buildCurrentViewRows();
  if (!rows.length) {
    alert("Nothing to download yet.");
    return;
  }
  if (format === "csv") {
    const csv = rows.map(r => r.map(c => (c == null ? "" : String(c))).map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dashboard_view.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  if (format === "xlsx" && typeof XLSX !== "undefined") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "View");
    XLSX.writeFile(wb, "dashboard_view.xlsx");
    return;
  }
  if (format === "pdf" && window.jspdf?.jsPDF) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 10;
    doc.setFontSize(12);
    doc.text("Aura earnings view", 10, y);
    y += 8;
    doc.setFontSize(8);
    doc.text(rows[0].join(" | "), 10, y);
    y += 6;
    rows.slice(1).forEach(r => {
      if (y > 280) { doc.addPage(); y = 10; }
      doc.text(r.map(c => (c == null ? "" : String(c))).join(" | "), 10, y);
      y += 4;
    });
    doc.save("dashboard_view.pdf");
  }
}

function saveToStorage() {
  try {
    const accounts = window._lastAccounts || [];
    const raw = window._rawData;
    const payload = {
      accounts,
      rawMode: !!raw,
      rawData: raw ? { rows: raw.rows, idx: raw.idx, headerRow: raw.headerRow } : null,
      settings: {
        thisMonth: document.getElementById("thisMonth")?.value || new Date().getMonth() + 1,
        thisYear: document.getElementById("thisYear")?.value || new Date().getFullYear(),
        daysInMonth: document.getElementById("daysInMonth")?.value || 30,
        messages: document.getElementById("messages")?.value || 0,
        subs: document.getElementById("subs")?.value || 0,
        lastMonthSameDays: document.getElementById("lastMonthSameDays")?.value || 0,
        filterModel: document.getElementById("filterModel")?.value || "_all",
        filterPartner: document.getElementById("filterPartner")?.value || "_all",
        dateFrom: document.getElementById("dateFrom")?.value || "",
        dateTo: document.getElementById("dateTo")?.value || ""
      }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    if (e.name === "QuotaExceededError") {
      console.warn("Dashboard data too large to save. Consider using a smaller dataset.");
    }
  }
}

function loadFromStorage() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return false;
    const data = JSON.parse(s);
    if (!data.accounts || !Array.isArray(data.accounts) || data.accounts.length === 0) return false;

    const st = data.settings || {};
    const monthEl = document.getElementById("thisMonth");
    const yearEl = document.getElementById("thisYear");
    if (monthEl && st.thisMonth) monthEl.value = st.thisMonth;
    if (yearEl && st.thisYear) yearEl.value = st.thisYear;
    const daysEl = document.getElementById("daysInMonth");
    const msgEl = document.getElementById("messages");
    const subsEl = document.getElementById("subs");
    const lastEl = document.getElementById("lastMonthSameDays");
    if (daysEl && st.daysInMonth != null) daysEl.value = st.daysInMonth;
    if (msgEl && st.messages != null) msgEl.value = st.messages;
    if (subsEl && st.subs != null) subsEl.value = st.subs;
    if (lastEl && st.lastMonthSameDays != null) lastEl.value = st.lastMonthSameDays;

    window._filterModel = st.filterModel || "_all";
    window._filterPartner = st.filterPartner || "_all";
    const dateFromEl = document.getElementById("dateFrom");
    const dateToEl = document.getElementById("dateTo");
    if (dateFromEl && st.dateFrom != null) dateFromEl.value = st.dateFrom;
    if (dateToEl && st.dateTo != null) dateToEl.value = st.dateTo;

    window._lastAccounts = data.accounts;
    if (data.rawMode && data.rawData) {
      window._rawData = data.rawData;
      document.getElementById("manualTotalsRow").style.display = "none";
      const hint = document.getElementById("rawModeHint");
      if (hint) hint.style.display = "block";
    } else {
      window._rawData = null;
      document.getElementById("manualTotalsRow").style.display = "";
      const hint = document.getElementById("rawModeHint");
      if (hint) hint.style.display = "none";
    }

    refreshFromUI();
    return true;
  } catch (e) {
    return false;
  }
}

function clearStorage() {
  localStorage.removeItem(STORAGE_KEY);
  window._lastAccounts = defaultAccounts;
  window._rawData = null;
  document.getElementById("manualTotalsRow").style.display = "";
  const hint = document.getElementById("rawModeHint");
  if (hint) hint.style.display = "none";
  refreshFromUI();
}

// ---- DEFAULT DATA ----
const defaultAccounts = [
  { name: "Peyton", partner: "Partner A", sales: 22000, lastMonth: 18000, subsGrowth: 12, newFans: null, reach: 54000 },
  { name: "Scarlet", partner: "Partner B", sales: 15000, lastMonth: 17000, subsGrowth: -4, newFans: null, reach: 41000 }
];

// ---- INIT + FILE HANDLER ----
function handleFile(file) {
  const ext = (file.name || "").split(".").pop().toLowerCase();
  const reader = new FileReader();

  reader.onload = (e) => {
    let rows = [];
    if (ext === "csv") {
      rows = parseCSV(e.target.result);
    } else if ((ext === "xlsx" || ext === "xls") && typeof XLSX !== "undefined") {
      const buf = e.target.result;
      rows = parseExcel(buf);
    }
    const thisMonth = parseInt(document.getElementById("thisMonth").value, 10) || new Date().getMonth() + 1;
    const thisYear = parseInt(document.getElementById("thisYear").value, 10) || new Date().getFullYear();
    const dateFromEl = document.getElementById("dateFrom");
    const dateToEl = document.getElementById("dateTo");
    let dateRange = null;
    let throughDay;
    if (dateFromEl?.value && dateToEl?.value) {
      dateRange = { from: dateFromEl.value, to: dateToEl.value };
      const from = new Date(dateRange.from);
      const to = new Date(dateRange.to);
      throughDay = Math.max(1, Math.ceil((to - from) / (24 * 60 * 60 * 1000)) + 1);
    } else {
      const daysInMonthVal = parseInt(document.getElementById("daysInMonth").value, 10) || 30;
      const today = new Date();
      if (thisYear === today.getFullYear() && thisMonth === today.getMonth() + 1) {
        // Use today - 1 days for the current month
        throughDay = Math.max(1, today.getDate() - 1);
      } else {
        throughDay = daysInMonthVal;
      }
    }

    const result = extractAccounts(rows, { throughDay, thisMonth, thisYear, dateRange });
    if (result.accounts.length === 0) {
      alert("No account data found. For raw format, ensure columns: Date/Time, Creator, Total earn (or similar).");
      return;
    }
    window._lastAccounts = result.accounts;
    window._rawData = result.rawMode ? { rows, idx: result.rawIdx, headerRow: result.rawHeaderRow } : null;

    let rawData;
    if (result.rawMode && result.totals) {
      document.getElementById("manualTotalsRow").style.display = "none";
      const hint = document.getElementById("rawModeHint");
      if (hint) hint.style.display = "block";
      rawData = getRawDataFromUI(result.accounts, result.totals);
    } else {
      document.getElementById("manualTotalsRow").style.display = "";
      const hint = document.getElementById("rawModeHint");
      if (hint) hint.style.display = "none";
      rawData = getRawDataFromUI(result.accounts);
    }
    renderDashboard(rawData);
    saveToStorage();
  };

  if (ext === "csv") {
    reader.readAsText(file);
  } else {
    reader.readAsArrayBuffer(file);
  }
}

document.getElementById("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
  e.target.value = "";
});

// Populate month dropdown
const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const thisMonthSelect = document.getElementById("thisMonth");
const thisYearSelect = document.getElementById("thisYear");
const now = new Date();
if (thisMonthSelect) {
  monthNames.forEach((name, i) => {
    const opt = document.createElement("option");
    opt.value = i + 1;
    opt.textContent = name;
    if (i + 1 === now.getMonth() + 1) opt.selected = true;
    thisMonthSelect.appendChild(opt);
  });
}
if (thisYearSelect) {
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    if (y === now.getFullYear()) opt.selected = true;
    thisYearSelect.appendChild(opt);
  }
}

function refreshFromUI() {
  const raw = window._rawData;
  if (raw) {
    const thisMonth = parseInt(document.getElementById("thisMonth").value, 10) || now.getMonth() + 1;
    const thisYear = parseInt(document.getElementById("thisYear").value, 10) || now.getFullYear();
    const dateFromEl = document.getElementById("dateFrom");
    const dateToEl = document.getElementById("dateTo");
    let dateRange = null;
    if (dateFromEl?.value && dateToEl?.value) {
      dateRange = { from: dateFromEl.value, to: dateToEl.value };
    }
    let throughDay;
    if (dateRange) {
      const from = new Date(dateRange.from);
      const to = new Date(dateRange.to);
      throughDay = Math.max(1, Math.ceil((to - from) / (24 * 60 * 60 * 1000)) + 1);
    } else {
      const daysInMonthVal = parseInt(document.getElementById("daysInMonth").value, 10) || 30;
      const today = new Date();
      if (thisYear === today.getFullYear() && thisMonth === today.getMonth() + 1) {
        // Use today - 1 days for the current month
        throughDay = Math.max(1, today.getDate() - 1);
      } else {
        throughDay = daysInMonthVal;
      }
    }
    const agg = aggregateRawData(raw.rows, raw.headerRow, raw.idx, thisMonth, thisYear, throughDay, dateRange);
    window._lastAccounts = agg.accounts;
    const rawData = getRawDataFromUI(agg.accounts, agg.totals);
    document.getElementById("manualTotalsRow").style.display = "none";
    const hint = document.getElementById("rawModeHint");
    if (hint) hint.style.display = "block";
    renderDashboard(rawData);
  } else {
    const rawData = getRawDataFromUI(window._lastAccounts || defaultAccounts);
    renderDashboard(rawData);
  }
  saveToStorage();
}

if (thisMonthSelect) thisMonthSelect.addEventListener("change", refreshFromUI);
if (thisYearSelect) thisYearSelect.addEventListener("change", refreshFromUI);

["daysInMonth", "messages", "subs", "lastMonthSameDays"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", refreshFromUI);
});

initFilterAutocomplete("filterModelInput", "filterModel", "filterModelDropdown", () => window._modelOpts || []);
initFilterAutocomplete("filterPartnerInput", "filterPartner", "filterPartnerDropdown", () => window._partnerOpts || []);

document.addEventListener("click", (e) => {
  if (!e.target.closest(".filter-autocomplete")) {
    closeFilterDropdown("filterModelDropdown");
    closeFilterDropdown("filterPartnerDropdown");
  }
});

const downloadBtn = document.getElementById("downloadViewBtn");
const downloadMenu = document.getElementById("downloadMenu");
if (downloadBtn && downloadMenu) {
  downloadBtn.addEventListener("click", () => {
    downloadMenu.classList.toggle("is-open");
  });
  downloadMenu.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-format]");
    if (!btn) return;
    const format = btn.getAttribute("data-format");
    downloadMenu.classList.remove("is-open");
    downloadCurrentView(format);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".filters-actions")) {
      downloadMenu.classList.remove("is-open");
    }
  });
}

["dateFrom", "dateTo"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", refreshFromUI);
});

// Initial render: load saved data or use defaults
window._lastAccounts = defaultAccounts;
window._rawData = null;
if (!loadFromStorage()) {
  renderDashboard(getRawDataFromUI(defaultAccounts));
}

document.getElementById("clearDataBtn")?.addEventListener("click", () => {
  if (confirm("Clear all saved data and reset to defaults?")) {
    clearStorage();
  }
});

initSortHandlers();
