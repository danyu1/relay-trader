"use client";

import React, { useState } from "react";
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

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

type BacktestStats = {
  total_return: number;
  annualized_return: number;
  volatility: number;
  sharpe: number;
  max_drawdown: number;
  equity_curve: number[];
};

type BacktestResponse = {
  config: Record<string, any>;
  stats: BacktestStats;
  trades: any[];
  orders: any[];
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
    "C:/Users/danie/OneDrive/Desktop/relay-trader/backend/data/AAPL.csv",
  );
  const [initialCash, setInitialCash] = useState(100000);
  const [maxBars, setMaxBars] = useState<number | undefined>(2000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";

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
        commission_per_trade: 0,
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
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Backtest failed");
    } finally {
      setLoading(false);
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
    borderColor: "#0ea5e9",               // sky-500 neon cyan
    backgroundColor: "rgba(14,165,233,0.25)",
    tension: 0.25,                        // smooth curve
    pointRadius: 0,                       // no dots
  },
]
          ,
        }
      : null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            relay-trader Backtest Dashboard
          </h1>
          <p className="text-sm text-slate-400">
            Paste a Python strategy, point to a CSV on the backend, and run a backtest through your
            FastAPI service.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr),minmax(0,1fr)]">
          {/* Left: config + code */}
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-xl shadow-slate-950/60">
              <h2 className="text-lg font-medium mb-3">Backtest Configuration</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-300 uppercase tracking-wide">
                      Symbol
                    </label>
                    <input
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-300 uppercase tracking-wide">
                      Initial Cash
                    </label>
                    <input
                      type="number"
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
                      value={initialCash}
                      onChange={(e) => setInitialCash(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-300 uppercase tracking-wide">
                      Max Bars
                    </label>
                    <input
                      type="number"
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
                      value={maxBars ?? ""}
                      onChange={(e) =>
                        setMaxBars(
                          e.target.value === "" ? undefined : Number(e.target.value) || undefined,
                        )
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-300 uppercase tracking-wide">
                    CSV Path (on backend)
                  </label>
                  <input
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs md:text-sm outline-none focus:border-sky-500"
                    value={csvPath}
                    onChange={(e) => setCsvPath(e.target.value)}
                  />
                  <p className="text-[10px] text-slate-500">
                    Must be readable by the FastAPI server (absolute path for now).
                  </p>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-300 uppercase tracking-wide">
                    Strategy Code (Python)
                  </label>
                  <textarea
                    className="min-h-[260px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono outline-none focus:border-sky-500"
                    value={strategyCode}
                    onChange={(e) => setStrategyCode(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex items-center justify-center rounded-xl bg-sky-500 px-4 py-1.5 text-sm font-medium text-slate-950 shadow-lg shadow-sky-500/40 hover:bg-sky-400 disabled:opacity-60 disabled:hover:bg-sky-500"
                  >
                    {loading ? "Running Backtest..." : "Run Backtest"}
                  </button>
                  <div className="text-[11px] text-slate-500">
                    Backend: <code>{apiBase}</code>
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
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-xl shadow-slate-950/60">
              <h2 className="text-lg font-medium mb-3">Performance</h2>
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
                    <Stat
                      label="Max Drawdown"
                      value={(result.stats.max_drawdown * 100).toFixed(2) + "%"}
                    />
                    <Stat
                      label="Bars"
                      value={result.stats.equity_curve.length.toString()}
                    />
                  </div>
                  {equityData && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2">
                      <Line
                        data={equityData}
                        options={{
                          responsive: true,
                          plugins: { legend: { display: false } },
                          scales: {
                            x: { ticks: { display: false }, grid: { display: false } },
                            y: { grid: { color: "rgba(30,64,175,0.3)" } },
                          },
                        }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400">
                  Run a backtest to see performance metrics and equity curve.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-xl shadow-slate-950/60 max-h-[320px] overflow-auto">
              <h2 className="text-lg font-medium mb-3">Recent Trades</h2>
              {result && result.trades.length > 0 ? (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-slate-400">
                      <th className="py-1 pr-2 text-left">Time</th>
                      <th className="py-1 pr-2 text-left">Side</th>
                      <th className="py-1 pr-2 text-right">Qty</th>
                      <th className="py-1 pr-2 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(-50).map((t, idx) => (
                      <tr key={idx} className="border-t border-slate-800/60">
                        <td className="py-1 pr-2">{t.timestamp}</td>
                        <td className="py-1 pr-2">{t.side}</td>
                        <td className="py-1 pr-2 text-right">{t.qty}</td>
                        <td className="py-1 pr-2 text-right">
                          {typeof t.price === "number" ? t.price.toFixed(2) : t.price}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-400">No trades yet.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
