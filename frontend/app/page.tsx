"use client";

import React, { useEffect, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import dynamic from "next/dynamic";
import { python } from "@codemirror/lang-python";

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

const CodeEditor = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });

type BacktestStats = {
  total_return: number;
  annualized_return: number;
  volatility: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  max_drawdown: number;
  equity_curve: number[];
  drawdown_curve: number[];
};

type TradeStats = {
  total_pnl: number;
  net_pnl: number;
  total_commission: number;
  total_slippage: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  num_trades: number;
  turnover: number;
};

type Trade = {
  order_id?: number;
  timestamp: string;
  symbol?: string;
  side: string;
  qty: number;
  price: number;
  commission?: number;
  slippage?: number;
  realized_pnl?: number;
};

type OrderResponse = {
  id: number;
  symbol: string;
  side: string;
  qty: number;
  order_type: string;
  status: string;
  limit_price?: number | null;
  stop_price?: number | null;
  filled_qty: number;
  avg_fill_price: number;
};

type BacktestResponse = {
  config: Record<string, any>;
  stats: BacktestStats;
  trade_stats: TradeStats;
  trades: Trade[];
  orders: OrderResponse[];
};

type HistoryEntry = {
  savedAt: string;
  result: BacktestResponse;
  form: {
    symbol: string;
    csvPath: string;
    initialCash: number;
    maxBars: number | null;
    commission: number;
    slippageBps: number;
  };
};

type DatasetInfo = {
  name: string;
  path: string;
  rows?: number;
  start?: number;
  end?: number;
  columns?: string[];
};

const DEFAULT_STRATEGY = `from relaytrader.core.strategy import Strategy
from relaytrader.core.types import Bar, OrderType


class UserStrategy(Strategy):
    def on_bar(self, bar: Bar):
        z = self.zscore(bar.symbol, "close", 50)
        if z is None:
            return

        pos = self.context.get_position_qty(bar.symbol)

        if z > 2 and pos > 0:
            # exit long
            self.sell(bar.symbol, pos, OrderType.MARKET)
        elif z < -2 and pos >= 0:
            # go (or stay) long 1 unit
            self.buy(bar.symbol, 1, OrderType.MARKET)
`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-50">{value}</span>
    </div>
  );
}

export default function Page() {
  const [strategyCode, setStrategyCode] = useState(DEFAULT_STRATEGY);
  const [symbol, setSymbol] = useState("AAPL");
  const [csvPath, setCsvPath] = useState(
    "/home/danyul/relay-trader/backend/data/AAPL_3000bars.csv",
  );
  const [initialCash, setInitialCash] = useState(100000);
  const [maxBars, setMaxBars] = useState<number | undefined>(2000);
  const [commission, setCommission] = useState(0);
  const [slippageBps, setSlippageBps] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";
  const STORAGE_KEY = "relaytrader:backtest-form";

  // hydrate from local storage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.symbol) setSymbol(saved.symbol);
      if (saved.csvPath) setCsvPath(saved.csvPath);
      if (typeof saved.initialCash === "number") setInitialCash(saved.initialCash);
      if (typeof saved.maxBars === "number" || saved.maxBars === null) {
        setMaxBars(saved.maxBars ?? undefined);
      }
      if (typeof saved.commission === "number") setCommission(saved.commission);
      if (typeof saved.slippageBps === "number") setSlippageBps(saved.slippageBps);
      if (typeof saved.strategyCode === "string" && saved.strategyCode.length > 0) {
        setStrategyCode(saved.strategyCode);
      }
    } catch (e) {
      console.warn("Failed to load saved config", e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // hydrate history
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("relaytrader:history");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHistory(parsed);
      }
    } catch (e) {
      console.warn("Failed to load history", e);
    }
  }, []);

  // load datasets from backend
  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        const res = await fetch(`${apiBase}/datasets`);
        if (!res.ok) return;
        const json = (await res.json()) as { datasets: DatasetInfo[] };
        setDatasets(json.datasets || []);
      } catch (e) {
        console.warn("Dataset fetch failed", e);
      }
    };
    fetchDatasets();
  }, [apiBase]);

  // persist form inputs
  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload = {
      symbol,
      csvPath,
      initialCash,
      maxBars: maxBars ?? null,
      commission,
      slippageBps,
      strategyCode,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [symbol, csvPath, initialCash, maxBars, commission, slippageBps, strategyCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body = {
        strategy_code: strategyCode,
        strategy_class_name: "UserStrategy",
        csv_path: csvPath,
        symbol,
        initial_cash: initialCash,
        commission_per_trade: commission,
        slippage_bps: slippageBps,
        max_bars: maxBars ?? null,
        strategy_params: null,
      };

      const res = await fetch(`${apiBase}/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const json = (await res.json()) as BacktestResponse;
      setResult(json);
      const entry: HistoryEntry = {
        savedAt: new Date().toISOString(),
        result: json,
        form: {
          symbol,
          csvPath,
          initialCash,
          maxBars: maxBars ?? null,
          commission,
          slippageBps,
        },
      };
      const nextHistory = [entry, ...history].slice(0, 5);
      setHistory(nextHistory);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("relaytrader:history", JSON.stringify(nextHistory));
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${apiBase}/upload-dataset`, { method: "POST", body: formData });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upload failed: ${text}`);
      }
      const json = (await res.json()) as { name: string; path: string };
      setCsvPath(json.path);
      // refresh list
      const listRes = await fetch(`${apiBase}/datasets`);
      if (listRes.ok) {
        const listJson = (await listRes.json()) as { datasets: DatasetInfo[] };
        setDatasets(listJson.datasets || []);
      }
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const equityData =
    result?.stats.equity_curve && result.stats.equity_curve.length > 0
      ? {
          labels: result.stats.equity_curve.map((_, i) => i),
          datasets: [
            {
              label: "Equity",
              data: result.stats.equity_curve,
              borderWidth: 2,
              borderColor: "#0ea5e9",
              fill: true,
              backgroundColor: (ctx: any) => {
                const chart = ctx.chart;
                const { ctx: canvas, chartArea } = chart;
                if (!chartArea) return "rgba(14,165,233,0.25)";
                const gradient = canvas.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                gradient.addColorStop(0, "rgba(14,165,233,0.35)");
                gradient.addColorStop(1, "rgba(14,165,233,0.04)");
                return gradient;
              },
              tension: 0.2,
              pointRadius: 0,
            },
          ],
        }
      : null;

  const drawdownData =
    result?.stats.drawdown_curve && result.stats.drawdown_curve.length > 0
      ? {
          labels: result.stats.drawdown_curve.map((_, i) => i),
          datasets: [
            {
              label: "Drawdown (%)",
              data: result.stats.drawdown_curve.map((dd) => dd * 100),
              borderWidth: 2,
              borderColor: "#f97316",
              fill: true,
              backgroundColor: (ctx: any) => {
                const chart = ctx.chart;
                const { ctx: canvas, chartArea } = chart;
                if (!chartArea) return "rgba(249,115,22,0.2)";
                const gradient = canvas.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                gradient.addColorStop(0, "rgba(249,115,22,0.35)");
                gradient.addColorStop(1, "rgba(249,115,22,0.05)");
                return gradient;
              },
              tension: 0.25,
              pointRadius: 0,
            },
          ],
        }
      : null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/70 px-6 py-5 shadow-xl shadow-slate-950/60 backdrop-blur">
          <div className="flex flex-col gap-2">
            <div className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-800/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
              RelayTrader · Backtest
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
              Run and visualize your Python strategies
            </h1>
            <p className="max-w-3xl text-sm text-slate-400">
              Paste a strategy, point to data, and iterate quickly. Config persists locally so you can tweak parameters and rerun without retyping.
            </p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
          {/* Left: config + code */}
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-slate-950/60 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-50">Backtest Configuration</h2>
                <span className="text-[11px] text-slate-400">Saved locally</span>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                      Symbol
                    </label>
                    <input
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50"
                      value={symbol}
                      placeholder="AAPL"
                      onChange={(e) => setSymbol(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                      Initial Cash
                    </label>
                    <input
                      type="number"
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50"
                      value={initialCash}
                      min={0}
                      step={1000}
                      onChange={(e) => setInitialCash(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                      Max Bars
                    </label>
                    <input
                      type="number"
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50"
                      value={maxBars ?? ""}
                      min={0}
                      onChange={(e) =>
                        setMaxBars(
                          e.target.value === "" ? undefined : Number(e.target.value) || undefined,
                        )
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                      Commission / Trade
                    </label>
                    <input
                      type="number"
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50"
                      value={commission}
                      min={0}
                      step={0.01}
                      onChange={(e) => setCommission(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                      Slippage (bps)
                    </label>
                    <input
                      type="number"
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50"
                      value={slippageBps}
                      min={0}
                      step={0.1}
                      onChange={(e) => setSlippageBps(Number(e.target.value) || 0)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                        Dataset
                      </label>
                      {datasets.length > 0 && (
                        <span className="text-[11px] text-slate-500">{datasets.length} found</span>
                      )}
                    </div>
                    <select
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50"
                      value={csvPath}
                      onChange={(e) => {
                        const path = e.target.value;
                        if (path) setCsvPath(path);
                      }}
                    >
                      <option value="">Select dataset</option>
                      {datasets.map((d) => (
                        <option key={d.path} value={d.path}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs md:text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50"
                      value={csvPath}
                      onChange={(e) => setCsvPath(e.target.value)}
                      placeholder="/home/you/data/AAPL.csv"
                    />
                    <p className="text-[10px] text-slate-500">
                      Pick an uploaded dataset or paste an absolute path readable by FastAPI.
                    </p>
                    {csvPath && (
                      <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[11px] text-slate-400">
                        {(() => {
                          const ds = datasets.find((d) => d.path === csvPath || csvPath.endsWith(d.name));
                          if (!ds) return <span className="text-amber-400">Path not in uploaded datasets.</span>;
                          if (ds.rows == null || ds.start == null || ds.end == null) {
                            return <span className="text-amber-400">Metadata unavailable for this dataset.</span>;
                          }
                          return (
                            <div className="space-y-1">
                              <div className="flex justify-between text-slate-300">
                                <span>Rows</span>
                                <span>{ds.rows}</span>
                              </div>
                              <div className="flex justify-between text-slate-300">
                                <span>Range</span>
                                <span>
                                  {ds.start} → {ds.end}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500">
                                Columns: {ds.columns?.join(", ") || "unknown"}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-950/60 px-4 py-3 text-xs text-slate-300 transition hover:border-sky-500 hover:bg-slate-900/80">
                      <span className="font-semibold">Upload CSV</span>
                      <span className="text-[10px] text-slate-500">
                        Stored on the backend in /data
                      </span>
                      <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
                        disabled={uploading}
                      />
                    </label>
                    {uploading && (
                      <p className="text-[11px] text-sky-400">Uploading...</p>
                    )}
                    {error && (
                      <p className="text-[11px] text-rose-400">
                        {error}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                      Backend
                    </label>
                    <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[11px] text-slate-400">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-200">API Base</span>
                        <code className="text-slate-300 break-all">{apiBase}</code>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Ensure the server is running and reachable from this browser.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                    Strategy Code (Python)
                  </label>
                  <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                    <CodeEditor
                      value={strategyCode}
                      height="280px"
                      theme="dark"
                      extensions={[python()]}
                      onChange={(val) => setStrategyCode(val)}
                      basicSetup={{
                        lineNumbers: true,
                        foldGutter: true,
                        highlightActiveLine: true,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">Subclass Strategy and implement hooks; your code runs server-side.</p>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex items-center justify-center rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/40 transition hover:bg-sky-400 disabled:opacity-60 disabled:hover:bg-sky-500"
                  >
                    {loading ? "Running Backtest..." : "Run Backtest"}
                  </button>
                  <div className="text-[11px] text-slate-500">
                    Config persists locally; reset by clearing browser storage.
                  </div>
                </div>

                {error && (
                  <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
              </form>
            </div>
          </section>

          {/* Right: results */}
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-slate-950/60 backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-50">Performance</h2>
                <span className="text-[11px] text-slate-400">Deterministic backtests</span>
              </div>
              {result ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    <Stat
                      label="Total Return"
                      value={(result.stats.total_return * 100).toFixed(2) + "%"}
                    />
                    <Stat
                      label="Annualized Return"
                      value={(result.stats.annualized_return * 100).toFixed(2) + "%"}
                    />
                    <Stat
                      label="Volatility"
                      value={(result.stats.volatility * 100).toFixed(2) + "%"}
                    />
                    <Stat label="Sharpe" value={result.stats.sharpe.toFixed(2)} />
                    <Stat label="Sortino" value={result.stats.sortino.toFixed(2)} />
                    <Stat label="Calmar" value={result.stats.calmar.toFixed(2)} />
                    <Stat
                      label="Max Drawdown"
                      value={(result.stats.max_drawdown * 100).toFixed(2) + "%"}
                    />
                    <Stat
                      label="Bars"
                      value={result.stats.equity_curve.length.toString()}
                    />
                    <Stat
                      label="Win Rate"
                      value={(result.trade_stats.win_rate * 100).toFixed(1) + "%"}
                    />
                    <Stat
                      label="Avg Win"
                      value={result.trade_stats.avg_win.toFixed(2)}
                    />
                    <Stat
                      label="Avg Loss"
                      value={result.trade_stats.avg_loss.toFixed(2)}
                    />
                    <Stat
                      label="Turnover"
                      value={result.trade_stats.turnover.toFixed(2)}
                    />
                    <Stat
                      label="Net PnL"
                      value={result.trade_stats.net_pnl.toFixed(2)}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {equityData && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2 shadow-inner shadow-slate-950/40">
                        <div className="flex items-center justify-between px-1 pb-2 text-xs text-slate-400">
                          <span>Equity Curve</span>
                          <span className="text-[11px] text-slate-500">Cash + positions</span>
                        </div>
                        <Line
                          data={equityData}
                          options={{
                            responsive: true,
                            plugins: { legend: { display: false } },
                            interaction: { intersect: false, mode: "index" },
                            scales: {
                              x: { ticks: { display: false }, grid: { display: false } },
                              y: {
                                grid: { color: "rgba(30,64,175,0.25)" },
                                ticks: { color: "#cbd5e1" },
                              },
                            },
                          }}
                        />
                      </div>
                    )}
                    {drawdownData && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2 shadow-inner shadow-slate-950/40">
                        <div className="flex items-center justify-between px-1 pb-2 text-xs text-slate-400">
                          <span>Drawdown Curve</span>
                          <span className="text-[11px] text-slate-500">Peak-to-trough (%)</span>
                        </div>
                        <Line
                          data={drawdownData}
                          options={{
                            responsive: true,
                            plugins: { legend: { display: false } },
                            interaction: { intersect: false, mode: "index" },
                            scales: {
                              x: { ticks: { display: false }, grid: { display: false } },
                              y: {
                                grid: { color: "rgba(248,113,113,0.25)" },
                                ticks: {
                                  color: "#cbd5e1",
                                  callback: (value) => `${value}%`,
                                },
                              },
                            },
                          }}
                        />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-400">
                  Run a backtest to see performance metrics and equity/drawdown curves.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/60 backdrop-blur max-h-[320px] overflow-auto">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-50">Recent Trades</h2>
                <span className="text-[11px] text-slate-400">Last 50 fills</span>
              </div>
              {result && result.trades.length > 0 ? (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-slate-400">
                      <th className="py-1 pr-2 text-left">Time</th>
                      <th className="py-1 pr-2 text-left">Side</th>
                      <th className="py-1 pr-2 text-right">Qty</th>
                      <th className="py-1 pr-2 text-right">Price</th>
                      <th className="py-1 pr-2 text-right">Fees</th>
                      <th className="py-1 pr-2 text-right">Realized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(-50).map((t, idx) => (
                      <tr key={idx} className="border-t border-slate-800/60 hover:bg-slate-800/40 transition">
                        <td className="py-1 pr-2 text-slate-300">{t.timestamp}</td>
                        <td className="py-1 pr-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-[2px] text-[10px] font-semibold ${
                              t.side?.toLowerCase() === "buy"
                                ? "bg-emerald-500/15 text-emerald-200"
                                : "bg-rose-500/15 text-rose-200"
                            }`}
                          >
                            {t.side}
                          </span>
                        </td>
                        <td className="py-1 pr-2 text-right text-slate-200">{t.qty}</td>
                        <td className="py-1 pr-2 text-right text-slate-200">
                          {typeof t.price === "number" ? t.price.toFixed(2) : t.price}
                        </td>
                        <td className="py-1 pr-2 text-right text-slate-400">
                          {((t.commission ?? 0) + (t.slippage ?? 0)).toFixed(2)}
                        </td>
                        <td className="py-1 pr-2 text-right text-slate-200">
                          {t.realized_pnl != null ? t.realized_pnl.toFixed(2) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-400">No trades yet.</p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/60 backdrop-blur max-h-[320px] overflow-auto">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-50">Orders</h2>
                <span className="text-[11px] text-slate-400">Last 50</span>
              </div>
              {result && result.orders.length > 0 ? (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-slate-400">
                      <th className="py-1 pr-2 text-left">ID</th>
                      <th className="py-1 pr-2 text-left">Side</th>
                      <th className="py-1 pr-2 text-left">Type</th>
                      <th className="py-1 pr-2 text-right">Qty</th>
                      <th className="py-1 pr-2 text-right">Filled</th>
                      <th className="py-1 pr-2 text-right">Avg Price</th>
                      <th className="py-1 pr-2 text-right">Limit</th>
                      <th className="py-1 pr-2 text-right">Stop</th>
                      <th className="py-1 pr-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.orders.slice(-50).map((o) => (
                      <tr key={o.id} className="border-t border-slate-800/60 hover:bg-slate-800/40 transition">
                        <td className="py-1 pr-2 text-slate-200">{o.id}</td>
                        <td className="py-1 pr-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-[2px] text-[10px] font-semibold ${
                              o.side?.toLowerCase() === "buy"
                                ? "bg-emerald-500/15 text-emerald-200"
                                : "bg-rose-500/15 text-rose-200"
                            }`}
                          >
                            {o.side}
                          </span>
                        </td>
                        <td className="py-1 pr-2 text-slate-200">{o.order_type}</td>
                        <td className="py-1 pr-2 text-right text-slate-200">{o.qty}</td>
                        <td className="py-1 pr-2 text-right text-slate-200">{o.filled_qty}</td>
                        <td className="py-1 pr-2 text-right text-slate-200">
                          {o.avg_fill_price ? o.avg_fill_price.toFixed(2) : "-"}
                        </td>
                        <td className="py-1 pr-2 text-right text-slate-200">
                          {o.limit_price != null ? o.limit_price.toFixed(2) : "-"}
                        </td>
                        <td className="py-1 pr-2 text-right text-slate-200">
                          {o.stop_price != null ? o.stop_price.toFixed(2) : "-"}
                        </td>
                        <td className="py-1 pr-2">
                          <span className="inline-flex items-center rounded-full bg-slate-800/60 px-2 py-[2px] text-[10px] font-semibold text-slate-200">
                            {o.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-400">No orders yet.</p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/60 backdrop-blur max-h-[320px] overflow-auto">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-50">Run History</h2>
                <span className="text-[11px] text-slate-400">Last 5</span>
              </div>
              {history.length > 0 ? (
                <ul className="space-y-2 text-xs text-slate-300">
                  {history.map((h, idx) => (
                    <li
                      key={idx}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 hover:border-sky-500/60 transition"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-100">{h.form.symbol}</span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(h.savedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-slate-400">
                        <span>Ret: {(h.result.stats.total_return * 100).toFixed(2)}%</span>
                        <span>DD: {(h.result.stats.max_drawdown * 100).toFixed(2)}%</span>
                        <span>Sharpe: {h.result.stats.sharpe.toFixed(2)}</span>
                        <span>Win: {(h.result.trade_stats?.win_rate * 100 || 0).toFixed(1)}%</span>
                      </div>
                      <div className="mt-2 flex gap-2 text-[11px] text-slate-400">
                        <button
                          className="rounded-md border border-slate-700 px-2 py-1 hover:border-sky-500 transition"
                          onClick={() => setResult(h.result)}
                        >
                          View
                        </button>
                        <button
                          className="rounded-md border border-slate-700 px-2 py-1 hover:border-sky-500 transition"
                          onClick={() => {
                            setSymbol(h.form.symbol);
                            setCsvPath(h.form.csvPath);
                            setInitialCash(h.form.initialCash);
                            setMaxBars(h.form.maxBars ?? undefined);
                            setCommission(h.form.commission);
                            setSlippageBps(h.form.slippageBps);
                          }}
                        >
                          Load Config
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">No runs yet.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
