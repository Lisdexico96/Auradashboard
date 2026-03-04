"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  parseCSV,
  extractAccounts,
  aggregateRawData,
  buildViewRows,
  getThroughDay,
  sortAccounts,
  getTableCell,
  DEFAULT_ACCOUNTS,
  TABLE_COLUMNS,
  type Account,
  type RawDataState,
  type SortKey,
} from "@/lib/dashboard-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FilterSelect } from "./FilterSelect";
import { cn } from "@/lib/utils";
import { FolderOpen, Download, ChevronDown } from "lucide-react";

const STORAGE_KEY = "qaDashboardData";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Settings {
  thisMonth: number;
  thisYear: number;
  dateFrom: string;
  dateTo: string;
  daysInMonth: number;
  messages: number;
  subs: number;
  lastMonthSameDays: number;
}

const defaultSettings = (): Settings => ({
  thisMonth: new Date().getMonth() + 1,
  thisYear: new Date().getFullYear(),
  dateFrom: "",
  dateTo: "",
  daysInMonth: 30,
  messages: 42000,
  subs: 18000,
  lastMonthSameDays: 52000,
});

function formatPct(value: string): string {
  if (value === "—") return value;
  const n = parseFloat(value);
  return `${n >= 0 ? "+" : ""}${value}%`;
}

function csvEscape(cell: string | number | null): string {
  const v = cell == null ? "" : String(cell);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function DashboardClient() {
  const [accounts, setAccounts] = useState<Account[]>(DEFAULT_ACCOUNTS);
  const [rawData, setRawData] = useState<RawDataState | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [filterModel, setFilterModel] = useState<string>("_all");
  const [filterPartner, setFilterPartner] = useState<string>("_all");
  const [sortColumn, setSortColumn] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = React.useRef<HTMLDivElement>(null);

  const daysElapsed = useMemo(() => getThroughDay(settings), [settings]);

  const filteredAccounts = useMemo(() => {
    let list = accounts.filter(
      (acc) =>
        (filterModel === "_all" || acc.name === filterModel) &&
        (filterPartner === "_all" || acc.partner === filterPartner)
    );
    if (sortColumn) list = sortAccounts(list, sortColumn, sortDirection);
    return list;
  }, [accounts, filterModel, filterPartner, sortColumn, sortDirection]);

  const modelOptions = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.name))).sort(),
    [accounts]
  );
  const partnerOptions = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.partner).filter((p) => p && p !== "—"))).sort(),
    [accounts]
  );

  const sumSales = filteredAccounts.reduce((s, a) => s + (a.sales || 0), 0);
  const sumLastMonth = filteredAccounts.reduce((s, a) => s + (a.lastMonth || 0), 0);
  const partnerSales = useMemo(
    () =>
      filteredAccounts.reduce<Record<string, number>>((out, acc) => {
        out[acc.partner] = (out[acc.partner] || 0) + (acc.sales || 0);
        return out;
      }, {}),
    [filteredAccounts]
  );

  const hasPerAccount = filteredAccounts.some((a) => a.messages != null || a.subs != null);
  const filteredMessages = hasPerAccount
    ? filteredAccounts.reduce((s, a) => s + (a.messages || 0), 0)
    : rawData ? 0 : settings.messages;
  const filteredSubs = hasPerAccount
    ? filteredAccounts.reduce((s, a) => s + (a.subs || 0), 0)
    : rawData ? 0 : settings.subs;

  const forecast = Math.round((sumSales / daysElapsed) * settings.daysInMonth);
  const monthVsLastPct = sumLastMonth ? (((sumSales - sumLastMonth) / sumLastMonth) * 100).toFixed(1) : "—";
  const agencyGrowthPct = sumLastMonth
    ? (
        filteredAccounts.reduce((sum, acc) => {
          const w = (acc.lastMonth / sumLastMonth) * 100;
          const g = acc.lastMonth ? ((acc.sales - acc.lastMonth) / acc.lastMonth) * 100 : 0;
          return sum + g * w;
        }, 0) / 100
      ).toFixed(1)
    : "—";

  const kpis = useMemo(
    () => [
      { label: "Total Sales", value: `$${sumSales.toLocaleString()}`, primary: true },
      { label: "Messages", value: `$${filteredMessages.toLocaleString()}` },
      { label: "Subscriptions", value: `$${filteredSubs.toLocaleString()}` },
      { label: "This month vs last", value: monthVsLastPct, pct: true },
      { label: "Forecast (Month)", value: `$${forecast.toLocaleString()}` },
      { label: "Agency Growth", value: agencyGrowthPct, pct: true },
    ],
    [sumSales, filteredMessages, filteredSubs, monthVsLastPct, forecast, agencyGrowthPct]
  );

  const refreshFromRaw = useCallback(() => {
    if (!rawData) return;
    const throughDay = getThroughDay(settings);
    const dateRange = settings.dateFrom && settings.dateTo ? { from: settings.dateFrom, to: settings.dateTo } : null;
    const agg = aggregateRawData(
      rawData.rows,
      rawData.headerRow,
      rawData.idx,
      settings.thisMonth,
      settings.thisYear,
      throughDay,
      dateRange
    );
    setAccounts(agg.accounts);
  }, [rawData, settings]);

  useEffect(() => {
    refreshFromRaw();
  }, [refreshFromRaw]);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = (file.name || "").split(".").pop()?.toLowerCase() ?? "";
      let rows: string[][] = [];
      if (ext === "csv") {
        rows = parseCSV(await file.text());
      } else if ((ext === "xlsx" || ext === "xls") && typeof window !== "undefined") {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const names = (wb.SheetNames ?? []).map((s) => s.toLowerCase());
        const dailyIdx = names.findIndex((s) => s.includes("daily") && s.includes("sales"));
        const sheetName = dailyIdx >= 0 ? wb.SheetNames![dailyIdx] : wb.SheetNames![0];
        rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 }) as string[][];
      }
      const throughDay = getThroughDay(settings);
      const dateRange = settings.dateFrom && settings.dateTo ? { from: settings.dateFrom, to: settings.dateTo } : null;
      const result = extractAccounts(rows, { throughDay, thisMonth: settings.thisMonth, thisYear: settings.thisYear, dateRange });
      if (result.accounts.length === 0) {
        alert("No account data found. For raw format, ensure columns: Date/Time, Creator, Total earn (or similar).");
        return;
      }
      setAccounts(result.accounts);
      setRawData(
        result.rawMode && result.rawRows && result.rawIdx != null && result.rawHeaderRow != null
          ? { rows: result.rawRows, idx: result.rawIdx, headerRow: result.rawHeaderRow }
          : null
      );
    },
    [settings]
  );

  const saveToStorage = useCallback(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          accounts,
          rawMode: !!rawData,
          rawData: rawData ? { rows: rawData.rows, idx: rawData.idx, headerRow: rawData.headerRow } : null,
          settings: {
            ...settings,
            filterModel,
            filterPartner,
          },
        })
      );
    } catch (e) {
      if (e instanceof Error && e.name === "QuotaExceededError") console.warn("Dashboard data too large to save.");
    }
  }, [accounts, rawData, settings, filterModel, filterPartner]);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (!data.accounts?.length) return;
      setAccounts(data.accounts);
      setRawData(data.rawMode && data.rawData ? data.rawData : null);
      const st = data.settings ?? {};
      setSettings((s) => ({ ...s, ...st }));
      setFilterModel(st.filterModel ?? "_all");
      setFilterPartner(st.filterPartner ?? "_all");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    saveToStorage();
  }, [saveToStorage]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [settingsOpen]);

  const handleSort = (key: SortKey) => {
    setSortColumn(key);
    setSortDirection((d) => (sortColumn === key && d === "asc" ? "desc" : "asc"));
  };

  const downloadView = useCallback(
    async (format: "csv" | "xlsx" | "pdf") => {
      const rows = buildViewRows(filteredAccounts);
      if (!rows.length) {
        alert("Nothing to download yet.");
        return;
      }
      if (format === "csv") {
        const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "dashboard_view.csv";
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      if (format === "xlsx") {
        const XLSX = await import("xlsx");
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "View");
        XLSX.writeFile(wb, "dashboard_view.xlsx");
        return;
      }
      if (format === "pdf") {
        const { jsPDF } = await import("jspdf");
        const doc = new jsPDF();
        let y = 10;
        doc.setFontSize(12);
        doc.text("Aura earnings view", 10, y);
        y += 8;
        doc.setFontSize(8);
        doc.text((rows[0] as string[]).join(" | "), 10, y);
        y += 6;
        rows.slice(1).forEach((r) => {
          if (y > 280) {
            doc.addPage();
            y = 10;
          }
          doc.text((r as (string | number | null)[]).map((c) => (c == null ? "" : String(c))).join(" | "), 10, y);
          y += 4;
        });
        doc.save("dashboard_view.pdf");
      }
    },
    [filteredAccounts]
  );

  const dataUpToText =
    settings.dateFrom && settings.dateTo
      ? `${settings.dateFrom} – ${settings.dateTo}`
      : `${MONTHS[settings.thisMonth - 1]} ${daysElapsed}, ${settings.thisYear}`;

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Aura earnings</h1>
          <p className="text-sm text-muted-foreground">Performance &amp; accounts</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm" title="Period">
            Data up to {dataUpToText}
          </span>
          <div className="relative" ref={settingsRef}>
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setSettingsOpen((o) => !o); }}>
              <FolderOpen className="mr-1.5 h-4 w-4" />
              Data &amp; settings
            </Button>
            {settingsOpen && (
              <Card className="absolute right-0 top-full z-50 mt-2 min-w-[320px]" onClick={(e) => e.stopPropagation()}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Upload &amp; period</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <Input type="file" accept=".csv,.xlsx,.xls" className="max-w-[180px]" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                    <a href="/dashboard_template.csv" download className="text-primary hover:underline">Template</a>
                    <Button variant="outline" size="sm" onClick={() => { setAccounts(DEFAULT_ACCOUNTS); setRawData(null); setSettings(defaultSettings()); }}>Clear</Button>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex items-center gap-2">
                      <Label>Month</Label>
                      <select className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={settings.thisMonth} onChange={(e) => updateSetting("thisMonth", Number(e.target.value))}>
                        {MONTHS.map((m, i) => (
                          <option key={m} value={i + 1}>{m}</option>
                        ))}
                      </select>
                      <select className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={settings.thisYear} onChange={(e) => updateSetting("thisYear", Number(e.target.value))}>
                        {[settings.thisYear, settings.thisYear - 1, settings.thisYear - 2].map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex items-center gap-2">
                      <Label className="w-10">From</Label>
                      <Input type="date" value={settings.dateFrom} onChange={(e) => updateSetting("dateFrom", e.target.value)} className="w-36" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="w-8">To</Label>
                      <Input type="date" value={settings.dateTo} onChange={(e) => updateSetting("dateTo", e.target.value)} className="w-36" />
                    </div>
                  </div>
                  {!rawData && (
                    <div className="grid grid-cols-2 gap-2 border-t border-border pt-2">
                      {(
                        [
                          { key: "messages" as const, label: "Messages" },
                          { key: "subs" as const, label: "Subs" },
                          { key: "lastMonthSameDays" as const, label: "Last month" },
                          { key: "daysInMonth" as const, label: "Days/mo" },
                        ] as const
                      ).map(({ key, label }) => (
                        <div key={key}>
                          <Label className="text-xs">{label}</Label>
                          <Input
                            type="number"
                            value={settings[key]}
                            onChange={(e) => updateSetting(key, (Number(e.target.value) || (key === "daysInMonth" ? 30 : 0)) as Settings[typeof key])}
                            className="h-8"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {rawData && <p className="text-xs text-emerald-500">Totals from raw data.</p>}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Overview</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpis.map(({ label, value, primary, pct }) => (
            <Card key={label} className={cn(primary && "border-primary/30 bg-primary/5")}>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={cn("font-playfair text-xl font-bold", pct && value !== "—" && (parseFloat(value) >= 0 ? "text-emerald-500" : "text-red-400"))}>
                  {pct && value !== "—" ? formatPct(value) : value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Accounts Performance</h2>
        <div className="flex flex-wrap items-end gap-4">
          <FilterSelect label="Model" options={modelOptions} value={filterModel} onChange={setFilterModel} />
          <FilterSelect label="Partner" options={partnerOptions} value={filterPartner} onChange={setFilterPartner} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="mr-1.5 h-4 w-4" />
                Download view
                <ChevronDown className="ml-1.5 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => downloadView("csv")}>CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadView("xlsx")}>Excel</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadView("pdf")}>PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-border bg-card shadow-lg backdrop-blur-md">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {TABLE_COLUMNS.map(({ key, label }) => (
                <th
                  key={key}
                  className="cursor-pointer select-none px-4 py-3 text-left font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => handleSort(key)}
                >
                  {label}{sortColumn === key && (sortDirection === "asc" ? " ↑" : " ↓")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map((acc) => (
              <tr key={`${acc.name}-${acc.partner}`} className="border-b border-border hover:bg-muted/20">
                {TABLE_COLUMNS.map(({ key }) => {
                  const cell = getTableCell(acc, key, sumSales, partnerSales);
                  return (
                    <td
                      key={key}
                      className={cn("px-4 py-3", cell.positive && "text-emerald-500", cell.negative && "text-red-400")}
                    >
                      {cell.content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
