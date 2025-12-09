"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
  ChartData,
  ChartOptions,
  TooltipItem,
  ActiveElement,
  Chart,
  ChartTypeRegistry,
  ScatterDataPoint,
  ScriptableContext,
} from "chart.js";
import dynamic from "next/dynamic";
import { python } from "@codemirror/lang-python";

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

const STRATEGY_TEMPLATES = [
  {
    id: "mean_reversion",
    label: "Mean Reversion Template",
    code: `from relaytrader.core.strategy import Strategy\nfrom relaytrader.core.types import Bar, OrderType\n\n\nclass UserStrategy(Strategy):\n    def on_bar(self, bar: Bar):\n        lookback = self.params.get(\"lookback\", 50)\n        entry_z = self.params.get(\"entry_z\", 2.0)\n        exit_z = self.params.get(\"exit_z\", 0.5)\n\n        z = self.zscore(bar.symbol, \"close\", lookback)\n        if z is None:\n            return\n\n        pos = self.context.get_position_qty(bar.symbol)\n\n        if z > entry_z and pos > 0:\n            self.sell(bar.symbol, pos, OrderType.MARKET)\n        elif z < -entry_z and pos >= 0:\n            self.buy(bar.symbol, 1, OrderType.MARKET)\n        elif abs(z) < exit_z and pos != 0:\n            if pos > 0:\n                self.sell(bar.symbol, pos, OrderType.MARKET)\n            else:\n                self.buy(bar.symbol, -pos, OrderType.MARKET)`,
  },
  {
    id: "sma_cross",
    label: "SMA Crossover Template",
    code: `from relaytrader.core.strategy import Strategy\nfrom relaytrader.core.types import Bar, OrderType\n\n\nclass UserStrategy(Strategy):\n    def on_bar(self, bar: Bar):\n        fast = self.params.get(\"fast\", 10)\n        slow = self.params.get(\"slow\", 40)\n        if fast >= slow:\n            return\n\n        history = list(self.context.get_history(bar.symbol, \"close\", slow))\n        if len(history) < slow:\n            return\n\n        fast_ma = sum(history[-fast:]) / fast\n        slow_ma = sum(history) / slow\n        pos = self.context.get_position_qty(bar.symbol)\n\n        if fast_ma > slow_ma and pos <= 0:\n            if pos < 0:\n                self.buy(bar.symbol, -pos, OrderType.MARKET)\n            self.buy(bar.symbol, 1, OrderType.MARKET)\n        elif fast_ma < slow_ma and pos >= 0:\n            if pos > 0:\n                self.sell(bar.symbol, pos, OrderType.MARKET)\n            self.sell(bar.symbol, 1, OrderType.MARKET)`,
  },
];

const deriveSymbolFromName = (name: string | undefined) => {
  if (!name) return "";
  const base = name.split(".")[0] || name;
  return base.toUpperCase();
};

const formatTimestamp = (ts: number | null | undefined) => {
  if (ts == null) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
};

const formatTradeTimestamp = (ts: string | number | undefined) => {
  if (!ts) return "—";
  const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return String(ts);
  return date.toLocaleString();
};

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

type NumericParams = Record<string, number>;
type BacktestConfig = Record<string, unknown>;
type CsvRow = Record<string, string | number | boolean | null | undefined>;
type DatasetPreview = { head: CsvRow[]; tail: CsvRow[] };
type MarkerPoint = ScatterDataPoint & { meta: { trade: Trade; timestamp: number | null } };
type MixedLineData = ChartData<"line">;
type LineChartOptions = ChartOptions<"line">;

type BacktestResponse = {
  config: BacktestConfig;
  stats: BacktestStats;
  trade_stats: TradeStats;
  trades: Trade[];
  orders: OrderResponse[];
  price_series: number[];
  timestamps: number[];
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
    mode: "custom" | "builtin";
    builtinId?: string;
    builtinParams?: NumericParams;
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

type BuiltinStrategy = {
  id: string;
  name: string;
  description: string;
  params: { name: string; type: string; default: number; min?: number; max?: number }[];
};

type BuiltinParam = BuiltinStrategy["params"][number];

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
  const [selectedDataset, setSelectedDataset] = useState<DatasetInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [mode, setMode] = useState<"custom" | "builtin">("custom");
  const [builtinId, setBuiltinId] = useState<string | null>(null);
  const [builtinParams, setBuiltinParams] = useState<NumericParams>({});
  const [builtinList, setBuiltinList] = useState<BuiltinStrategy[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<DatasetPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [tradeFilter, setTradeFilter] = useState<"ALL" | "BUY" | "SELL">("ALL");
  const [tradeSearch, setTradeSearch] = useState("");
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [detailTab, setDetailTab] = useState<"trades" | "orders" | "history">("trades");

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
      if (saved.mode === "builtin" || saved.mode === "custom") {
        setMode(saved.mode);
      }
      if (typeof saved.builtinId === "string") {
        setBuiltinId(saved.builtinId);
      }
      if (saved.builtinParams && typeof saved.builtinParams === "object") {
        setBuiltinParams(saved.builtinParams);
      }
    } catch (e) {
      console.warn("Failed to load saved config", e);
    }
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

  useEffect(() => {
    if (!datasets.length) {
      setSelectedDataset(null);
      return;
    }
    const match = datasets.find((d) => d.path === csvPath);
    if (match) {
      setSelectedDataset(match);
    } else {
      setSelectedDataset(null);
    }
  }, [datasets, csvPath]);

  // load built-in strategies
  useEffect(() => {
    const fetchBuiltins = async () => {
      try {
        const res = await fetch(`${apiBase}/strategies`);
        if (!res.ok) return;
        const json = (await res.json()) as { strategies: BuiltinStrategy[] };
        setBuiltinList(json.strategies || []);
        if (!builtinId && json.strategies?.length) {
          setBuiltinId(json.strategies[0].id);
          const defaults: NumericParams = {};
          json.strategies[0].params.forEach((p) => (defaults[p.name] = p.default));
          setBuiltinParams(defaults);
        }
      } catch (e) {
        console.warn("Builtin fetch failed", e);
      }
    };
    fetchBuiltins();
  }, [apiBase, builtinId]);

  const builtinMap = useMemo(() => {
    const map: Record<string, BuiltinStrategy> = {};
    builtinList.forEach((b) => {
      map[b.id] = b;
    });
    return map;
  }, [builtinList]);

  const handleBuiltinParamChange = (param: BuiltinParam, rawValue: string) => {
    let value = param.type === "int" ? parseInt(rawValue, 10) : parseFloat(rawValue);
    if (Number.isNaN(value)) {
      value = param.default;
    }
    if (param.min != null) value = Math.max(param.min, value);
    if (param.max != null) value = Math.min(param.max, value);
    setBuiltinParams((prev) => ({ ...prev, [param.name]: value }));
  };

  const handleDatasetSelect = (name: string) => {
    if (!name) {
      setSelectedDataset(null);
      return;
    }
    const ds = datasets.find((d) => d.name === name);
    if (ds) {
      setSelectedDataset(ds);
      setCsvPath(ds.path);
      const derived = deriveSymbolFromName(ds.name);
      if (derived) {
        setSymbol(derived);
      }
    }
  };

  const handlePreviewDataset = async () => {
    if (!selectedDataset) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(
        `${apiBase}/dataset-preview?name=${encodeURIComponent(selectedDataset.name)}&limit=5`,
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      const json = (await res.json()) as DatasetPreview;
      setPreviewData(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewData(null);
    setPreviewError(null);
  };

  const handleTemplateInsert = (code: string) => {
    setMode("custom");
    setStrategyCode(code);
  };

  const renderPreviewTable = (rows: CsvRow[]) => {
    if (!rows || rows.length === 0) {
      return <p className="text-[11px] text-slate-500">No data</p>;
    }
    const columns = Object.keys(rows[0]);
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-[11px] border-collapse">
          <thead>
            <tr className="text-slate-400">
              {columns.map((col) => (
                <th key={col} className="px-1 py-0.5 text-left">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-t border-slate-800/60">
                {columns.map((col) => (
                  <td key={col} className="px-1 py-0.5 text-slate-200 break-all">
                    {String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

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
      mode,
      builtinId,
      builtinParams,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [symbol, csvPath, initialCash, maxBars, commission, slippageBps, strategyCode, mode, builtinId, builtinParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    if (mode === "builtin" && !builtinId) {
      setError("Select a built-in strategy");
      setLoading(false);
      return;
    }

    try {
      const body =
        mode === "builtin"
          ? {
              builtin_strategy_id: builtinId,
              builtin_params: builtinParams,
              strategy_code: null,
              strategy_class_name: "",
              csv_path: csvPath,
              symbol,
              initial_cash: initialCash,
              commission_per_trade: commission,
              slippage_bps: slippageBps,
              max_bars: maxBars ?? null,
              strategy_params: null,
            }
          : {
              strategy_code: strategyCode,
              strategy_class_name: "UserStrategy",
              builtin_strategy_id: null,
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
          mode,
          builtinId,
          builtinParams,
        },
      };
      const nextHistory = [entry, ...history].slice(0, 5);
      setHistory(nextHistory);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("relaytrader:history", JSON.stringify(nextHistory));
      }
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Backtest failed";
      setError(message);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
    } finally {
      setUploading(false);
    }
  };

  const filteredTrades = useMemo(() => {
    if (!result) return [];
    return result.trades.filter((t) => {
      if (tradeFilter !== "ALL" && t.side?.toUpperCase() !== tradeFilter) return false;
      if (tradeSearch && !(t.timestamp ?? "").toString().includes(tradeSearch)) return false;
      return true;
    });
  }, [result, tradeFilter, tradeSearch]);

  useEffect(() => {
    setSelectedTrade(null);
  }, [result]);

  const equityCurve = result?.stats.equity_curve || [];
  const priceSeries = result?.price_series || [];
  const timestamps = (result?.timestamps || []) as number[];
  const tradesForMarkers = filteredTrades.slice(-200);

  const hasTimestamps = timestamps.length === priceSeries.length && timestamps.length > 0;
  const timeline = hasTimestamps ? timestamps : priceSeries.map((_, idx) => idx);
  const computeXValue = (idx: number) => timeline[idx] ?? idx;

  const findNearestIndex = (ts: number, fallbackIdx: number) => {
    if (!hasTimestamps) return Math.min(fallbackIdx, priceSeries.length - 1);
    // binary search
    let lo = 0;
    let hi = timestamps.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const val = timestamps[mid];
      if (val === ts) return mid;
      if (val < ts) lo = mid + 1;
      else hi = mid - 1;
    }
    // closest of lo/hi
    const candidates = [lo, hi].filter((i) => i >= 0 && i < timestamps.length);
    if (!candidates.length) return Math.min(fallbackIdx, priceSeries.length - 1);
    let best = candidates[0];
    let bestDiff = Math.abs(timestamps[best] - ts);
    for (const i of candidates) {
      const d = Math.abs(timestamps[i] - ts);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    return best;
  };

  const makeMarkers = (series: number[], useTradePrice: boolean): MarkerPoint[] =>
    tradesForMarkers
      .map((t, idx) => {
        const tsRaw = t.timestamp;
        let tsNum: number | null = null;
        if (typeof tsRaw === "number") tsNum = tsRaw;
        else if (typeof tsRaw === "string") {
          const parsed = Date.parse(tsRaw);
          tsNum = Number.isFinite(parsed) ? parsed : null;
        }
        const seriesIdx =
          tsNum != null ? findNearestIndex(tsNum, idx) : Math.min(idx, series.length - 1);
        const resolvedIdx = Math.max(0, Math.min(seriesIdx, series.length - 1));
        const yValue =
          useTradePrice && typeof t.price === "number"
            ? t.price
            : series[resolvedIdx] ?? series[series.length - 1] ?? null;
        if (yValue == null) {
          return null;
        }
        return {
          x: tsNum ?? computeXValue(resolvedIdx),
          y: yValue,
          meta: {
            trade: t,
            timestamp: tsNum,
          },
        };
      })
      .filter((m): m is MarkerPoint => Boolean(m));

  const tradeMarkersPrice = makeMarkers(priceSeries, true);
  const tradeMarkersEquity = makeMarkers(equityCurve, false);

  const formatTradeLabel = (meta?: MarkerPoint["meta"]) => {
    const trade: Trade | undefined = meta?.trade;
    if (!trade) return "Trade";
    const parts = [] as string[];
    if (trade.side) parts.push(trade.side);
    if (typeof trade.price === "number") parts.push(`@ ${trade.price.toFixed(2)}`);
    if (trade.qty != null) parts.push(`qty ${trade.qty}`);
    if (trade.realized_pnl != null) parts.push(`PnL ${trade.realized_pnl.toFixed(2)}`);
    if (trade.timestamp) parts.push(formatTradeTimestamp(trade.timestamp));
    return parts.join(" • ") || "Trade";
  };

  const handleChartPointClick = (
    elements: ActiveElement[],
    chart: Chart<keyof ChartTypeRegistry>,
  ) => {
    if (!elements.length) return;
    const element = elements[0];
    const dataset = chart.data.datasets[element.datasetIndex] as {
      isTrade?: boolean;
      data?: MarkerPoint[];
    };
    if (!dataset.isTrade) return;
    const dataPoint = dataset.data?.[element.index];
    const trade = dataPoint?.meta?.trade;
    if (trade) {
      setSelectedTrade(trade);
    }
  };

  const formatAxisTickValue = (value: number) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return Math.round(value).toString();
    }
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const chartClickHandler: NonNullable<LineChartOptions["onClick"]> = (_evt, elements, chart) =>
    handleChartPointClick(
      elements as ActiveElement[],
      chart as Chart<keyof ChartTypeRegistry>,
    );

  const createChartOptions = (yGridColor: string, showDateTicks: boolean): LineChartOptions => ({
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 8, right: 8, bottom: 0, left: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"line">) => {
            const dataset = ctx.dataset as { label: string; isTrade?: boolean };
            if (dataset?.isTrade) {
              const rawPoint = ctx.raw as MarkerPoint | undefined;
              if (rawPoint?.meta) {
                return formatTradeLabel(rawPoint.meta);
              }
              return "Trade";
            }
            const value = ctx.parsed?.y;
            return `${dataset.label}: ${typeof value === "number" ? value.toFixed(2) : value ?? ""}`;
          },
        },
      },
    },
    interaction: { intersect: false, mode: "nearest" },
    onClick: chartClickHandler,
    scales: {
      x: {
        type: "linear",
        ticks: {
          color: "#94a3b8",
          maxRotation: 0,
          callback: (value) =>
            showDateTicks ? formatAxisTickValue(Number(value)) : Math.round(Number(value)).toString(),
        },
        grid: { display: false },
      },
      y: {
        grid: { color: yGridColor },
        ticks: { color: "#cbd5e1" },
      },
    },
  });

  const equityOptions = createChartOptions("rgba(30,64,175,0.25)", hasTimestamps);
  const priceOptions = createChartOptions("rgba(56,189,248,0.2)", hasTimestamps);
  const drawdownOptionsBase = createChartOptions("rgba(248,113,113,0.25)", hasTimestamps);
  const drawdownOptions: LineChartOptions = {
    ...drawdownOptionsBase,
    scales: {
      ...drawdownOptionsBase.scales,
      y: {
        ...(drawdownOptionsBase.scales?.y ?? {}),
        ticks: {
          ...(drawdownOptionsBase.scales?.y?.ticks ?? {}),
          callback: (value) => `${value}%`,
        },
      },
    },
  };

  const buildSeriesPoints = (series: number[]) =>
    series.map((value, idx) => ({
      x: computeXValue(idx),
      y: value,
    }));

  const pricePoints = priceSeries.length ? buildSeriesPoints(priceSeries) : [];
  const equityPoints = equityCurve.length ? buildSeriesPoints(equityCurve) : [];
  const drawdownPoints =
    result?.stats.drawdown_curve?.length
      ? result.stats.drawdown_curve.map((dd, idx) => ({
          x: computeXValue(idx),
          y: dd * 100,
        }))
      : [];

  const gradientFill = (
    ctx: ScriptableContext<"line">,
    topColor: string,
    bottomColor: string,
  ) => {
    const chart = ctx.chart;
    const { ctx: canvas, chartArea } = chart;
    if (!chartArea) return topColor;
    const gradient = canvas.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, topColor);
    gradient.addColorStop(1, bottomColor);
    return gradient;
  };

  const equityData: MixedLineData | null =
    equityPoints.length > 0
      ? {
          labels: timeline,
          datasets: [
            {
              label: "Equity",
              data: equityPoints,
              parsing: false,
              borderWidth: 2,
              borderColor: "#0ea5e9",
              fill: true,
              backgroundColor: (ctx) => gradientFill(ctx, "rgba(14,165,233,0.35)", "rgba(14,165,233,0.04)"),
              tension: 0.2,
              pointRadius: 0,
              order: 1,
            },
            {
              label: "Trades",
              data: tradeMarkersEquity,
              parsing: false,
              isTrade: true,
              pointRadius: 6,
              pointHoverRadius: 8,
              pointHitRadius: 14,
              pointHoverBorderWidth: 2,
              pointBackgroundColor: tradeMarkersEquity.map((m) =>
                m.meta?.trade?.side?.toLowerCase() === "buy" ? "#10b981" : "#f43f5e",
              ),
              pointBorderColor: "rgba(0,0,0,0)",
              borderWidth: 0,
              order: 0,
              showLine: false,
            },
          ],
        }
      : null;

  const priceData: MixedLineData | null =
    pricePoints.length > 0
      ? {
          labels: timeline,
          datasets: [
            {
              label: "Price",
              data: pricePoints,
              parsing: false,
              borderWidth: 2,
              borderColor: "#38bdf8",
              fill: false,
              tension: 0.15,
              pointRadius: 0,
              order: 1,
            },
            {
              label: "Trades",
              data: tradeMarkersPrice,
              parsing: false,
              isTrade: true,
              pointRadius: 6,
              pointHoverRadius: 8,
              pointHitRadius: 14,
              pointHoverBorderWidth: 2,
              pointBackgroundColor: tradeMarkersPrice.map((m) =>
                m.meta?.trade?.side?.toLowerCase() === "buy" ? "#10b981" : "#f43f5e",
              ),
              pointBorderColor: "rgba(0,0,0,0)",
              borderWidth: 0,
              order: 0,
              showLine: false,
            },
          ],
        }
      : null;

  const drawdownData: MixedLineData | null =
    drawdownPoints.length > 0
      ? {
          labels: timeline,
          datasets: [
            {
              label: "Drawdown (%)",
              data: drawdownPoints,
              parsing: false,
              borderWidth: 2,
              borderColor: "#f97316",
              fill: true,
              backgroundColor: (ctx) => gradientFill(ctx, "rgba(249,115,22,0.35)", "rgba(249,115,22,0.05)"),
              tension: 0.25,
              pointRadius: 0,
            },
          ],
        }
      : null;

  return (
    <>
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
        <div className="mx-auto max-w-[1800px] px-6 py-8 space-y-6">
          <header className="rounded-3xl border border-slate-800 bg-slate-900/80 px-6 py-5 shadow-2xl shadow-slate-950/60 backdrop-blur">
            <div className="flex flex-col gap-3">
              <div className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-800/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                RelayTrader · Backtest Console
              </div>
              <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
                  Build, iterate, and diagnose strategies
                </h1>
                <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400">
                  <span className="rounded-full border border-slate-700 px-3 py-1">Python 3.11</span>
                  <span className="rounded-full border border-slate-700 px-3 py-1">Next.js 16</span>
                </div>
              </div>
              <p className="max-w-4xl text-sm text-slate-400">
                Configure a dataset, choose a built-in or paste custom code, and RelayTrader will execute the backtest with full transparency—performance, trades, and diagnostics are presented side by side for fast iteration.
              </p>
            </div>
          </header>

          <div className="grid gap-5 items-start xl:grid-cols-[520px,minmax(0,1fr)]">
            {/* Left rail */}
            <section className="lg:w-[480px] xl:w-[520px] flex-shrink-0 space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/60 backdrop-blur sticky top-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-50">Backtest Configuration</h2>
                  <span className="text-[11px] text-slate-400">Saved locally</span>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex gap-3 text-xs font-semibold text-slate-200 uppercase tracking-wide">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={mode === "custom"}
                      onChange={() => setMode("custom")}
                    />
                    <span>Custom Code</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={mode === "builtin"}
                      onChange={() => setMode("builtin")}
                    />
                    <span>Built-in Strategy</span>
                  </label>
                </div>
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
                      value={selectedDataset?.name ?? ""}
                      onChange={(e) => handleDatasetSelect(e.target.value)}
                    >
                      <option value="">Select dataset</option>
                      {datasets.map((d) => (
                        <option key={d.name} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs md:text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50"
                      value={csvPath}
                      onChange={(e) => {
                        setCsvPath(e.target.value);
                        setSelectedDataset(null);
                      }}
                      placeholder="/home/you/data/AAPL.csv"
                    />
                    <p className="text-[10px] text-slate-500">
                      Pick an uploaded dataset or paste an absolute path readable by FastAPI.
                    </p>
                    {selectedDataset && (
                      <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[11px] text-slate-400 space-y-1">
                        <div className="flex justify-between text-slate-300">
                          <span>Rows</span>
                          <span>{selectedDataset.rows ?? "—"}</span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>Date Range</span>
                          <span>
                            {formatTimestamp(selectedDataset.start)} → {formatTimestamp(selectedDataset.end)}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 break-words">
                          Columns: {selectedDataset.columns?.join(", ") || "unknown"}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            className="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-200 hover:border-sky-500"
                            disabled={previewLoading}
                            onClick={handlePreviewDataset}
                          >
                            {previewLoading ? "Loading preview..." : "Preview Dataset"}
                          </button>
                          <span className="text-[10px] text-slate-500">Symbol → {deriveSymbolFromName(selectedDataset.name)}</span>
                        </div>
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

                {mode === "builtin" ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                        Built-in Strategy
                      </label>
                      <select
                        className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50"
                        value={builtinId ?? ""}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          setBuiltinId(id);
                          const chosen = builtinList.find((b) => b.id === id);
                          if (chosen) {
                            const defaults: NumericParams = {};
                            chosen.params.forEach((p) => (defaults[p.name] = p.default));
                            setBuiltinParams(defaults);
                          }
                        }}
                      >
                        {builtinList.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      {builtinList.length === 0 && (
                        <p className="text-[11px] text-amber-400">No built-in strategies available.</p>
                      )}
                      {builtinId && (
                        <p className="text-[11px] text-slate-500">
                          {builtinList.find((b) => b.id === builtinId)?.description}
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {builtinList
                        .find((b) => b.id === builtinId)
                        ?.params.map((p) => (
                          <div className="flex flex-col gap-1" key={p.name}>
                            <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                              {p.name} ({p.type})
                            </label>
                            <input
                              type="number"
                              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50"
                              value={builtinParams[p.name] ?? p.default}
                              min={p.min ?? undefined}
                              max={p.max ?? undefined}
                              step={p.type === "int" ? 1 : 0.1}
                              onChange={(e) => handleBuiltinParamChange(p, e.target.value)}
                            />
                            <span className="text-[10px] text-slate-500">
                              Range: {p.min ?? "-"} – {p.max ?? "-"}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                      Strategy Code (Python)
                    </label>
                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                      <span>Templates:</span>
                      {STRATEGY_TEMPLATES.map((tpl) => (
                        <button
                          type="button"
                          key={tpl.id}
                          className="rounded-md border border-slate-700 px-2 py-1 hover:border-sky-500"
                          onClick={() => handleTemplateInsert(tpl.code)}
                        >
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                      <CodeEditor
                        value={strategyCode}
                        height="360px"
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
                    <p className="text-[11px] text-slate-500">
                      Subclass Strategy and implement hooks; your code runs server-side.
                    </p>
                  </div>
                )}

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
            {/* Right: results workspace */}
            <section className="flex-1 space-y-6">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/60 backdrop-blur">
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
                      <Stat label="Bars" value={result.stats.equity_curve.length.toString()} />
                      <Stat
                        label="Win Rate"
                        value={(result.trade_stats.win_rate * 100).toFixed(1) + "%"}
                      />
                      <Stat label="Avg Win" value={result.trade_stats.avg_win.toFixed(2)} />
                      <Stat label="Avg Loss" value={result.trade_stats.avg_loss.toFixed(2)} />
                      <Stat label="Turnover" value={result.trade_stats.turnover.toFixed(2)} />
                      <Stat label="Net PnL" value={result.trade_stats.net_pnl.toFixed(2)} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">
                    Run a backtest to see performance metrics and equity/drawdown curves.
                  </p>
                )}
              </div>

              {result && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/50 backdrop-blur">
                  <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-lg font-semibold text-slate-50">Market Curves</h2>
                    <span className="text-[11px] text-slate-400">
                      Hover markers for fills • Click to inspect trade
                    </span>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {equityData && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-inner shadow-slate-950/40">
                        <div className="flex items-center justify-between pb-2 text-xs text-slate-400">
                          <span>Equity Curve</span>
                          <span className="text-[11px] text-slate-500">Cash + positions</span>
                        </div>
                        <div className="h-[320px]">
                          <Line data={equityData} options={equityOptions} />
                        </div>
                      </div>
                    )}
                    {priceData && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-inner shadow-slate-950/40">
                        <div className="flex items-center justify-between pb-2 text-xs text-slate-400">
                          <span>Price</span>
                          <span className="text-[11px] text-slate-500">Trades overlaid</span>
                        </div>
                        <div className="h-[320px]">
                          <Line data={priceData} options={priceOptions} />
                        </div>
                      </div>
                    )}
                  </div>
                  {drawdownData && (
                    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-inner shadow-slate-950/40">
                      <div className="flex items-center justify-between pb-2 text-xs text-slate-400">
                        <span>Drawdown Curve</span>
                        <span className="text-[11px] text-slate-500">Peak-to-trough (%)</span>
                      </div>
                      <div className="h-[240px]">
                        <Line data={drawdownData} options={drawdownOptions} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/60 backdrop-blur">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-50">Trade Insight & Tooling</h2>
                    <p className="text-sm text-slate-400">
                      Filter executions, jump into orders, or reload past runs without leaving this
                      workspace.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {[
                      { id: "trades", label: "Trades" },
                      { id: "orders", label: "Orders" },
                      { id: "history", label: "History" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={`rounded-full border px-3 py-1 font-semibold transition ${
                          detailTab === tab.id
                            ? "border-sky-500 bg-sky-500/10 text-sky-200"
                            : "border-slate-700 text-slate-300 hover:border-slate-500"
                        }`}
                        onClick={() => setDetailTab(tab.id as typeof detailTab)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {detailTab === "trades" ? (
                  result ? (
                    <div className="mt-4 space-y-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {["ALL", "BUY", "SELL"].map((filter) => (
                          <button
                            key={filter}
                            type="button"
                            onClick={() => setTradeFilter(filter as typeof tradeFilter)}
                            className={`rounded-full border px-3 py-1 font-semibold transition ${
                              tradeFilter === filter
                                ? "border-sky-500 bg-sky-500/10 text-sky-200"
                                : "border-slate-700 text-slate-300 hover:border-slate-500"
                            }`}
                          >
                            {filter}
                          </button>
                        ))}
                        <input
                          type="text"
                          placeholder="Search timestamp"
                          className="ml-auto flex-1 min-w-[180px] rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40"
                          value={tradeSearch}
                          onChange={(e) => setTradeSearch(e.target.value)}
                        />
                        <span className="text-[11px] text-slate-500">
                          Showing {filteredTrades.length} / {result.trades.length} trades
                        </span>
                      </div>
                      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60">
                          <div className="max-h-[360px] overflow-auto">
                            <table className="w-full text-sm">
                              <thead className="sticky top-0 bg-slate-950/80 text-[11px] uppercase tracking-wide text-slate-400">
                                <tr>
                                  <th className="px-3 py-2 text-left">Timestamp</th>
                                  <th className="px-3 py-2 text-left">Side</th>
                                  <th className="px-3 py-2 text-right">Qty</th>
                                  <th className="px-3 py-2 text-right">Price</th>
                                  <th className="px-3 py-2 text-right">Realized PnL</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredTrades.length === 0 && (
                                  <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-sm text-slate-500">
                                      No trades match your filters.
                                    </td>
                                  </tr>
                                )}
                                {filteredTrades.map((t, idx) => {
                                  const isSelected = selectedTrade === t;
                                  return (
                                    <tr
                                      key={`${t.timestamp}-${idx}`}
                                      className={`cursor-pointer border-t border-slate-800/60 text-slate-200 transition hover:bg-slate-900/60 ${
                                        isSelected ? "bg-slate-900/80" : ""
                                      }`}
                                      onClick={() => setSelectedTrade(t)}
                                    >
                                      <td className="px-3 py-2 text-xs">
                                        {formatTradeTimestamp(t.timestamp)}
                                      </td>
                                      <td
                                        className={`px-3 py-2 text-xs font-semibold ${
                                          t.side?.toLowerCase() === "buy"
                                            ? "text-emerald-400"
                                            : "text-rose-400"
                                        }`}
                                      >
                                        {t.side?.toUpperCase()}
                                      </td>
                                      <td className="px-3 py-2 text-right">{t.qty}</td>
                                      <td className="px-3 py-2 text-right">
                                        {typeof t.price === "number" ? t.price.toFixed(2) : "—"}
                                      </td>
                                      <td
                                        className={`px-3 py-2 text-right ${
                                          (t.realized_pnl ?? 0) >= 0
                                            ? "text-emerald-400"
                                            : "text-rose-400"
                                        }`}
                                      >
                                        {t.realized_pnl?.toFixed(2) ?? "—"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-200">
                          {selectedTrade ? (
                            <div className="space-y-2">
                              <div className="text-xs uppercase tracking-wide text-slate-400">
                                Trade Detail
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-[13px]">
                                <span className="text-slate-400">Timestamp</span>
                                <span>{formatTradeTimestamp(selectedTrade.timestamp)}</span>
                                <span className="text-slate-400">Symbol</span>
                                <span>{selectedTrade.symbol ?? symbol}</span>
                                <span className="text-slate-400">Side</span>
                                <span className="font-semibold">{selectedTrade.side}</span>
                                <span className="text-slate-400">Qty</span>
                                <span>{selectedTrade.qty}</span>
                                <span className="text-slate-400">Price</span>
                                <span>{selectedTrade.price?.toFixed(4)}</span>
                                <span className="text-slate-400">Commission</span>
                                <span>{selectedTrade.commission?.toFixed(2) ?? "—"}</span>
                                <span className="text-slate-400">Slippage</span>
                                <span>{selectedTrade.slippage?.toFixed(2) ?? "—"}</span>
                                <span className="text-slate-400">Realized PnL</span>
                                <span
                                  className={
                                    (selectedTrade.realized_pnl ?? 0) >= 0
                                      ? "text-emerald-400"
                                      : "text-rose-400"
                                  }
                                >
                                  {selectedTrade.realized_pnl?.toFixed(2) ?? "—"}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="text-[11px] text-slate-400 underline underline-offset-4"
                                onClick={() => setSelectedTrade(null)}
                              >
                                Clear selection
                              </button>
                            </div>
                          ) : (
                            <div className="text-sm text-slate-400">
                              Select a chart marker or table row to inspect trade metadata.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-400">
                      Run a backtest to explore executions.
                    </p>
                  )
                ) : detailTab === "orders" ? (
                  result ? (
                    <div className="mt-4 overflow-auto rounded-xl border border-slate-800 bg-slate-950/60">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-950/80 text-[11px] uppercase tracking-wide text-slate-400">
                          <tr>
                            <th className="px-3 py-2 text-left">ID</th>
                            <th className="px-3 py-2 text-left">Symbol</th>
                            <th className="px-3 py-2 text-left">Side</th>
                            <th className="px-3 py-2 text-left">Type</th>
                            <th className="px-3 py-2 text-right">Qty / Filled</th>
                            <th className="px-3 py-2 text-right">Avg Price</th>
                            <th className="px-3 py-2 text-left">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.orders.length === 0 && (
                            <tr>
                              <td colSpan={7} className="px-3 py-4 text-center text-sm text-slate-500">
                                No orders were generated.
                              </td>
                            </tr>
                          )}
                          {result.orders.map((order) => (
                            <tr key={order.id} className="border-t border-slate-800/60 text-slate-200">
                              <td className="px-3 py-2 text-xs font-mono">{order.id}</td>
                              <td className="px-3 py-2 text-xs">{order.symbol}</td>
                              <td
                                className={`px-3 py-2 text-xs font-semibold ${
                                  order.side?.toLowerCase() === "buy" ? "text-emerald-400" : "text-rose-400"
                                }`}
                              >
                                {order.side}
                              </td>
                              <td className="px-3 py-2 text-xs">{order.order_type}</td>
                              <td className="px-3 py-2 text-right text-xs">
                                {order.qty} / {order.filled_qty}
                              </td>
                              <td className="px-3 py-2 text-right text-xs">
                                {order.avg_fill_price?.toFixed(2) ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-xs uppercase tracking-wide text-slate-400">
                                {order.status}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-400">
                      Run a backtest to view order flow.
                    </p>
                  )
                ) : (
                  <div className="mt-4 space-y-4">
                    {history.length ? (
                      <ul className="grid gap-3 md:grid-cols-2">
                        {history.map((h, idx) => (
                          <li
                            key={`${h.savedAt}-${idx}`}
                            className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-100">{h.form.symbol}</span>
                              <span className="text-[10px] text-slate-500">
                                {new Date(h.savedAt).toLocaleString()}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px]">
                              <span className="inline-flex items-center rounded-full border border-slate-700 px-2 py-[2px] text-slate-300">
                                {h.form.mode === "builtin"
                                  ? `Built-in: ${
                                      builtinMap[h.form.builtinId ?? ""]?.name ??
                                      h.form.builtinId ??
                                      "Unknown"
                                    }`
                                  : "Custom Code"}
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
                                onClick={() => {
                                  setResult(h.result);
                                  setDetailTab("trades");
                                }}
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
                                  setMode(h.form.mode);
                                  setBuiltinId(h.form.builtinId ?? null);
                                  setBuiltinParams(h.form.builtinParams ?? {});
                                }}
                              >
                                Load Config
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">No runs saved yet.</p>
                    )}
                  </div>
                )}
              </div>
            </section>
        </div>
      </div>
      </main>

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Dataset Preview</h3>
                <p className="text-[11px] text-slate-500">Showing first and last rows</p>
              </div>
              <button
                type="button"
                className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-sky-500"
                onClick={closePreview}
              >
                Close
              </button>
            </div>
            {previewError && <p className="text-xs text-rose-400 mb-2">{previewError}</p>}
            {previewData ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Head</h4>
                  {renderPreviewTable(previewData.head)}
                </div>
                <div>
                  <h4 className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Tail</h4>
                  {renderPreviewTable(previewData.tail)}
                </div>
              </div>
            ) : previewLoading ? (
              <p className="text-sm text-slate-400">Loading preview...</p>
            ) : (
              <p className="text-sm text-slate-400">Select a dataset to preview.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
