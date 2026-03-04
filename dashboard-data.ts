export interface Account {
  name: string;
  partner: string;
  sales: number;
  lastMonth: number;
  messages?: number | null;
  subs?: number | null;
  newFans?: number | null;
  subsGrowth?: number | null;
  reach?: number | null;
}

export interface RawDataState {
  rows: string[][];
  idx: Record<string, number>;
  headerRow: number;
}

const COL_ALIASES: Record<string, string[]> = {
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
  targetPct: ["target %", "target%", "%", "target pct"],
};

function findColumnIndex(headers: string[], aliases: string[]): number {
  const h = headers.map((header) => String(header ?? "").trim().toLowerCase());
  for (const alias of aliases) {
    const i = h.findIndex((x) => {
      if (alias === "creator group" || alias === "creatorgroup")
        return x.includes("creator group") || x.includes("creatorgroup");
      return x.includes(alias) || alias.includes(x);
    });
    if (i >= 0) return i;
  }
  return -1;
}

function parseNumber(val: unknown): number | null {
  if (val == null || val === "") return null;
  const s = String(val).replace(/[,$\s]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export function parseCSV(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  return lines.map((line) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if ((c === "," && !inQuotes) || c === "\t") {
        result.push(current.trim());
        current = "";
      } else current += c;
    }
    result.push(current.trim());
    return result;
  });
}

export function parseDate(val: unknown): Date | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") {
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
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    let day: number;
    let mon: number;
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

export function aggregateRawData(
  rows: string[][],
  headerRowIndex: number,
  idx: Record<string, number>,
  thisMonth: number,
  thisYear: number,
  throughDay: number,
  dateRange: { from: string; to: string } | null
): { accounts: Account[]; totals: { messages: number; subs: number; lastMonthSameDays: number } } {
  let thisFrom: Date; let thisTo: Date; let lastFrom: Date; let lastTo: Date;
  if (dateRange?.from && dateRange?.to) {
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
  const thisPeriod: Record<string, { sales: number; messages: number; subs: number; newFans: number }> = {};
  const lastPeriod: Record<string, { sales: number }> = {};
  const reach: Record<string, number> = {};
  const creatorGrowth: Record<string, number> = {};
  const creatorGroup: Record<string, string> = {};

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseDate(r[idx.date]);
    if (!date) continue;
    const creator = idx.account >= 0 ? String(r[idx.account] ?? "").trim() : "";
    if (!creator) continue;
    const partner = idx.partner >= 0 ? String(r[idx.partner] ?? "").trim() : "—";
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
  const accounts: Account[] = [];
  let totalMessages = 0, totalSubs = 0, totalLastMonth = 0;
  creators.forEach((name) => {
    const t = thisPeriod[name] ?? { sales: 0, messages: 0, subs: 0, newFans: 0 };
    const l = lastPeriod[name] ?? { sales: 0 };
    accounts.push({
      name: name || "—",
      partner: creatorGroup[name] ?? "—",
      messages: t.messages ?? null,
      subs: t.subs ?? null,
      newFans: t.newFans ?? null,
      sales: Math.round(t.sales),
      lastMonth: Math.round(l.sales),
      subsGrowth: creatorGrowth[name] ?? 0,
      reach: reach[name] ?? null,
    });
    totalMessages += t.messages;
    totalSubs += t.subs;
    totalLastMonth += l.sales;
  });
  const totalThisMonth = accounts.reduce((s, a) => s + a.sales, 0);
  let subsTotal = Math.round(totalSubs);
  if (totalMessages === 0 && totalSubs === 0 && totalThisMonth > 0) subsTotal = totalThisMonth;
  return {
    accounts,
    totals: {
      messages: Math.round(totalMessages),
      subs: subsTotal,
      lastMonthSameDays: Math.round(totalLastMonth),
    },
  };
}

export interface ExtractResult {
  accounts: Account[];
  totals?: { messages: number; subs: number; lastMonthSameDays: number };
  rawMode: boolean;
  rawRows?: string[][];
  rawIdx?: Record<string, number>;
  rawHeaderRow?: number;
}

export function extractAccounts(
  rows: string[][],
  opts: {
    throughDay?: number;
    thisMonth?: number;
    thisYear?: number;
    dateRange?: { from: string; to: string } | null;
  } = {}
): ExtractResult {
  if (!rows.length) return { accounts: [], rawMode: false };
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const row = (rows[i] ?? []).map((c) => String(c ?? "").toLowerCase());
    const hasCreator = row.some((c) => c.includes("creator"));
    const hasDate = row.some((c) => c.includes("date") || c.includes("datetime"));
    const hasAccount = row.some((c) => c.includes("account") || c.includes("name"));
    if (hasCreator || hasDate || hasAccount) {
      headerRowIndex = i;
      break;
    }
  }
  const headers = rows[headerRowIndex].map((h) => String(h ?? "").trim());
  const idx: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(COL_ALIASES)) {
    idx[key] = findColumnIndex(headers, aliases);
  }

  if (idx.date >= 0 && idx.account >= 0 && idx.sales >= 0) {
    const thisMonth = opts.thisMonth ?? new Date().getMonth() + 1;
    const thisYear = opts.thisYear ?? new Date().getFullYear();
    const throughDay = opts.throughDay ?? new Date().getDate();
    const aggregated = aggregateRawData(
      rows,
      headerRowIndex,
      idx,
      thisMonth,
      thisYear,
      throughDay,
      opts.dateRange ?? null
    );
    return {
      accounts: aggregated.accounts,
      totals: aggregated.totals,
      rawMode: true,
      rawRows: rows,
      rawIdx: idx,
      rawHeaderRow: headerRowIndex,
    };
  }

  const accounts: Account[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const sales = idx.sales >= 0 ? parseNumber(r[idx.sales]) : null;
    const name = idx.account >= 0 ? String(r[idx.account] ?? "").trim() : `Account ${i + 1}`;
    if (!name && (sales == null || sales === 0)) continue;
    accounts.push({
      name: name || "—",
      partner: idx.partner >= 0 ? String(r[idx.partner] ?? "").trim() : "—",
      sales: sales != null ? Math.round(sales) : 0,
      lastMonth: idx.lastMonth >= 0 ? (parseNumber(r[idx.lastMonth]) ?? 0) : 0,
      subsGrowth: idx.subsGrowth >= 0 ? (parseNumber(r[idx.subsGrowth]) ?? 0) : 0,
      reach: idx.reach >= 0 ? (parseNumber(r[idx.reach]) ?? null) : null,
      newFans: idx.newFans >= 0 ? (parseNumber(r[idx.newFans]) ?? null) : null,
    });
  }
  return { accounts, rawMode: false };
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function getThroughDay(settings: {
  dateFrom: string;
  dateTo: string;
  thisMonth: number;
  thisYear: number;
  daysInMonth: number;
}): number {
  if (settings.dateFrom && settings.dateTo) {
    const to = new Date(settings.dateTo).getTime();
    const from = new Date(settings.dateFrom).getTime();
    return Math.max(1, Math.ceil((to - from) / (24 * 60 * 60 * 1000)) + 1);
  }
  const today = new Date();
  if (settings.thisYear === today.getFullYear() && settings.thisMonth === today.getMonth() + 1) {
    // Use today - 1 days when looking at the current month
    return Math.max(1, today.getDate() - 1);
  }
  return settings.daysInMonth;
}

export function buildViewRows(accounts: Account[]): (string | number | null)[][] {
  if (!accounts.length) return [];
  const header = [
    "Account",
    "Partner",
    "Current month",
    "Last month",
    "Delta",
    "Weight %",
    "Partner weight %",
    "Target",
    "Growth %",
    "Conversion rate",
    "New fans",
  ];
  const rows: (string | number | null)[][] = [header];
  const sumSales = accounts.reduce((s, a) => s + (a.sales || 0), 0);
  const partnerSales: Record<string, number> = {};
  accounts.forEach((acc) => {
    partnerSales[acc.partner] = (partnerSales[acc.partner] || 0) + (acc.sales || 0);
  });
  accounts.forEach((acc) => {
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
      acc.newFans != null ? acc.newFans : null,
    ]);
  });
  return rows;
}

export const DEFAULT_ACCOUNTS: Account[] = [
  { name: "Peyton", partner: "Partner A", sales: 22000, lastMonth: 18000, subsGrowth: 12, newFans: null, reach: 54000 },
  { name: "Scarlet", partner: "Partner B", sales: 15000, lastMonth: 17000, subsGrowth: -4, newFans: null, reach: 41000 },
];

export type SortKey =
  | "name"
  | "partner"
  | "sales"
  | "lastMonth"
  | "dif"
  | "weight"
  | "partnerWeight"
  | "target"
  | "growth"
  | "conversion"
  | "newFans";

export const TABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Account" },
  { key: "partner", label: "Partner" },
  { key: "sales", label: "Current month" },
  { key: "lastMonth", label: "Last month" },
  { key: "dif", label: "Delta" },
  { key: "weight", label: "Weight" },
  { key: "partnerWeight", label: "Partner Weight" },
  { key: "target", label: "Target" },
  { key: "growth", label: "Growth" },
  { key: "conversion", label: "Conversion rate" },
  { key: "newFans", label: "New Fans" },
];

export function sortAccounts(
  accounts: Account[],
  sortKey: SortKey,
  direction: "asc" | "desc"
): Account[] {
  const dir = direction === "asc" ? 1 : -1;
  const sumSales = accounts.reduce((s, a) => s + (a.sales || 0), 0);
  const partnerSales: Record<string, number> = {};
  accounts.forEach((a) => {
    partnerSales[a.partner] = (partnerSales[a.partner] || 0) + (a.sales || 0);
  });
  return [...accounts].sort((a, b) => {
    let va: string | number;
    let vb: string | number;
    switch (sortKey) {
      case "name":
        va = (a.name || "").toLowerCase();
        vb = (b.name || "").toLowerCase();
        return dir * (va as string).localeCompare(vb as string);
      case "partner":
        va = (a.partner || "").toLowerCase();
        vb = (b.partner || "").toLowerCase();
        return dir * (va as string).localeCompare(vb as string);
      case "sales":
        return dir * ((a.sales || 0) - (b.sales || 0));
      case "lastMonth":
        return dir * ((a.lastMonth || 0) - (b.lastMonth || 0));
      case "dif":
        return dir * (((a.sales || 0) - (a.lastMonth || 0)) - ((b.sales || 0) - (b.lastMonth || 0)));
      case "weight":
        return dir * (sumSales ? ((a.sales || 0) / sumSales) * 100 - ((b.sales || 0) / sumSales) * 100 : 0);
      case "partnerWeight":
        return dir * (sumSales ? ((partnerSales[a.partner] || 0) / sumSales) * 100 - ((partnerSales[b.partner] || 0) / sumSales) * 100 : 0);
      case "target":
        return dir * (Math.round((a.lastMonth || 0) * 1.2) - Math.round((b.lastMonth || 0) * 1.2));
      case "growth":
        va = a.lastMonth ? ((a.sales - a.lastMonth) / a.lastMonth) * 100 : -Infinity;
        vb = b.lastMonth ? ((b.sales - b.lastMonth) / b.lastMonth) * 100 : -Infinity;
        return dir * ((va as number) - (vb as number));
      case "conversion": {
        const convA = a.subs && a.subs > 0 ? (a.sales || 0) / a.subs : -Infinity;
        const convB = b.subs && b.subs > 0 ? (b.sales || 0) / b.subs : -Infinity;
        return dir * (convA - convB);
      }
      case "newFans":
        return dir * ((a.newFans ?? -Infinity) - (b.newFans ?? -Infinity));
      default:
        return 0;
    }
  });
}

export function getTableCell(
  acc: Account,
  key: SortKey,
  sumSales: number,
  partnerSales: Record<string, number>
): { content: string; positive?: boolean; negative?: boolean } {
  const sales = acc.sales || 0;
  const last = acc.lastMonth || 0;
  const weight = sumSales ? (sales / sumSales) * 100 : 0;
  const pWeight = sumSales ? ((partnerSales[acc.partner] || 0) / sumSales) * 100 : 0;
  const dif = sales - last;
  const growth = last ? ((sales - last) / last) * 100 : null;
  const subs = acc.subs || 0;
  const conv = subs > 0 ? sales / subs : null;
  switch (key) {
    case "name":
      return { content: acc.name };
    case "partner":
      return { content: acc.partner };
    case "sales":
      return { content: `$${sales.toLocaleString()}` };
    case "lastMonth":
      return { content: `$${last.toLocaleString()}` };
    case "dif":
      return { content: `${dif >= 0 ? "+" : ""}$${dif.toLocaleString()}`, positive: dif >= 0, negative: dif < 0 };
    case "weight":
      return { content: `${weight.toFixed(1)}%` };
    case "partnerWeight":
      return { content: `${pWeight.toFixed(1)}%` };
    case "target":
      return { content: `$${Math.round(last * 1.2).toLocaleString()}` };
    case "growth":
      return {
        content: growth == null ? "—" : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`,
        positive: growth != null && growth >= 0,
        negative: growth != null && growth < 0,
      };
    case "conversion":
      return { content: conv != null && isFinite(conv) ? conv.toFixed(2) : "—" };
    case "newFans":
      return { content: acc.newFans != null ? acc.newFans.toLocaleString() : "—" };
    default:
      return { content: "" };
  }
}
