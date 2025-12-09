"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  TimeScale,
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
import "@/utils/nativeDateAdapter";

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, TimeScale, Tooltip, Legend, Filler);

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

type StrategyParamPreset = {
  id: string;
  label: string;
  params: Record<string, unknown>;
  builtIn?: boolean;
};

const STRATEGY_PARAM_PRESETS: StrategyParamPreset[] = [
  { id: "blank", label: "Empty {}", params: {} },
  {
    id: "mean_reversion_params",
    label: "Mean Reversion Params",
    params: { lookback: 50, entry_z: 2, exit_z: 0.5 },
  },
  {
    id: "sma_cross_params",
    label: "SMA Fast/Slow Params",
    params: { fast: 10, slow: 40 },
  },
];

const MODE_OPTIONS: { id: "custom" | "builtin"; title: string; caption: string }[] = [
  {
    id: "custom",
    title: "Custom Code",
    caption: "Paste your Strategy subclass",
  },
  {
    id: "builtin",
    title: "Built-in Strategy",
    caption: "Use curated templates",
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

const formatParamValue = (value: unknown) => {
  if (value == null) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? value.toString() : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const CodeEditor = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });

type ZoomableChartProps = {
  data: MixedLineData;
  options: LineChartOptions;
  onBrush?: (range: [number, number]) => void;
  onWheelZoom?: (centerValue: number, deltaY: number) => void;
  onPinchZoom?: (centerValue: number, scaleRatio: number) => void;
  brushDisabled?: boolean;
  className?: string;
  animationKey?: number;
};

function ZoomableChart({
  data,
  options,
  onBrush,
  onWheelZoom,
  onPinchZoom,
  brushDisabled,
  className,
  animationKey,
}: ZoomableChartProps) {
  const chartRef = useRef<Chart<"line">>(null);
  const [brushBox, setBrushBox] = useState({
    visible: false,
    left: 0,
    width: 0,
    top: 0,
    height: 0,
  });
  const brushState = useRef<{
    active: boolean;
    start: number;
    current: number;
    areaTop: number;
    areaBottom: number;
    pointerId: number | null;
  }>({
    active: false,
    start: 0,
    current: 0,
    areaTop: 0,
    areaBottom: 0,
    pointerId: null,
  });
  const pointerCache = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{ active: boolean; distance: number; centerValue: number | null }>({
    active: false,
    distance: 0,
    centerValue: null,
  });

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const canvas = chart.canvas;
    canvas.style.touchAction = "none";
    const getRelativePosition = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const area = chart.chartArea;
      const clampedX = Math.max(area.left, Math.min(area.right, x));
      const clampedY = Math.max(area.top, Math.min(area.bottom, y));
      return { x: clampedX, y: clampedY, area };
    };
    const releasePointer = () => {
      const state = brushState.current;
      if (state.pointerId != null) {
        try {
          canvas.releasePointerCapture?.(state.pointerId);
        } catch {
          // ignore
        }
      }
      brushState.current.pointerId = null;
    };
    const resetBrush = () => {
      brushState.current = {
        active: false,
        start: 0,
        current: 0,
        areaTop: 0,
        areaBottom: 0,
        pointerId: null,
      };
      setBrushBox((prev) => ({ ...prev, visible: false }));
      releasePointer();
    };
    const commitSelection = () => {
      const chartInstance = chartRef.current;
      const state = brushState.current;
      if (!chartInstance || !state.active) return;
      const minPx = Math.min(state.start, state.current);
      const maxPx = Math.max(state.start, state.current);
      resetBrush();
      if (maxPx - minPx < 8) return;
      const scale = chartInstance.scales.x;
      const startVal = scale.getValueForPixel(minPx);
      const endVal = scale.getValueForPixel(maxPx);
      if (Number.isFinite(startVal) && Number.isFinite(endVal)) {
        onBrush?.([Number(startVal), Number(endVal)]);
      }
    };
    const updateBrushBox = (startX: number, currentX: number, areaTop: number, areaBottom: number) => {
      setBrushBox({
        visible: true,
        left: Math.min(startX, currentX),
        width: Math.abs(currentX - startX),
        top: areaTop,
        height: areaBottom - areaTop,
      });
    };
    const updatePointerCache = (event: PointerEvent) => {
      const { x, y } = getRelativePosition(event);
      pointerCache.current.set(event.pointerId, { x, y });
      return { x, y };
    };
    const distanceBetween = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const tryStartPinch = () => {
      const chartInstance = chartRef.current;
      if (!chartInstance || !onPinchZoom) return;
      if (pointerCache.current.size !== 2) return;
      const points = Array.from(pointerCache.current.values());
      const dist = distanceBetween(points[0], points[1]);
      if (dist <= 0) return;
      const centerPx = (points[0].x + points[1].x) / 2;
      const centerVal = chartInstance.scales.x.getValueForPixel(centerPx);
      if (typeof centerVal !== "number" || Number.isNaN(centerVal)) return;
      pinchState.current = { active: true, distance: dist, centerValue: centerVal };
      resetBrush();
    };
    const handlePinchMove = () => {
      const chartInstance = chartRef.current;
      if (!chartInstance || !pinchState.current.active || !onPinchZoom) return;
      const points = Array.from(pointerCache.current.values());
      if (points.length !== 2) return;
      const newDist = distanceBetween(points[0], points[1]);
      if (pinchState.current.distance <= 0 || newDist <= 0) return;
      const scaleRatio = newDist / pinchState.current.distance;
      if (Math.abs(scaleRatio - 1) < 0.01) return;
      const centerPx = (points[0].x + points[1].x) / 2;
      const centerVal = chartInstance.scales.x.getValueForPixel(centerPx);
      if (typeof centerVal === "number") {
        pinchState.current.centerValue = centerVal;
      }
      const centerValue = pinchState.current.centerValue ?? centerVal;
      if (typeof centerValue === "number") {
        onPinchZoom(centerValue, scaleRatio);
      }
      pinchState.current.distance = newDist;
    };
    const handlePointerDown = (event: PointerEvent) => {
      updatePointerCache(event);
      tryStartPinch();
      if (pinchState.current.active || !onBrush || brushDisabled) {
        return;
      }
      const { x, y, area } = getRelativePosition(event);
      if (y < area.top || y > area.bottom) return;
      brushState.current = {
        active: true,
        start: x,
        current: x,
        areaTop: area.top,
        areaBottom: area.bottom,
        pointerId: event.pointerId,
      };
      canvas.setPointerCapture?.(event.pointerId);
      updateBrushBox(x, x, area.top, area.bottom);
    };
    const handlePointerMove = (event: PointerEvent) => {
      updatePointerCache(event);
      if (pinchState.current.active) {
        handlePinchMove();
        return;
      }
      if (!brushState.current.active) return;
      const { x, area } = getRelativePosition(event);
      brushState.current.current = x;
      updateBrushBox(brushState.current.start, x, area.top, area.bottom);
    };
    const handlePointerUp = (event: PointerEvent) => {
      pointerCache.current.delete(event.pointerId);
      if (pinchState.current.active && pointerCache.current.size < 2) {
        pinchState.current = { active: false, distance: 0, centerValue: null };
      }
      if (pinchState.current.active) return;
      if (!brushState.current.active) return;
      commitSelection();
    };
    const handlePointerLeave = () => {
      if (pinchState.current.active) return;
      if (!brushState.current.active) return;
      commitSelection();
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [brushDisabled, onBrush, onPinchZoom]);

  useEffect(() => {
    const chart = chartRef.current;
    const canvas = chart?.canvas;
    if (!chart || !canvas || !onWheelZoom) return;
    const handleWheel = (event: WheelEvent) => {
      if (brushDisabled) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const value = chart.scales.x.getValueForPixel(x);
      if (typeof value === "number") {
        onWheelZoom(value, event.deltaY);
      }
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [brushDisabled, onWheelZoom]);

  useEffect(() => {
    if (animationKey == null) return;
    const chart = chartRef.current;
    chart?.update("zoom");
  }, [animationKey]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <Line ref={chartRef} data={data} options={options} />
      {brushBox.visible && (
        <div
          className="pointer-events-none absolute border border-sky-500/60 bg-sky-500/15"
          style={{
            left: brushBox.left,
            width: brushBox.width,
            top: brushBox.top,
            height: brushBox.height,
          }}
        />
      )}
    </div>
  );
}

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
type StrategyInfo = {
  mode: "custom" | "builtin";
  class_name: string;
  builtin_id?: string | null;
  params: Record<string, unknown>;
  submitted_params?: Record<string, unknown> | null;
};
type DiagnosticsInfo = {
  run_id: string;
  started_at?: string;
  completed_at?: string;
  runtime_ms?: number;
  bars_processed?: number;
  engine_version?: string;
  form?: {
    symbol?: string;
    csv_path?: string;
    initial_cash?: number;
    max_bars?: number | null;
    commission_per_trade?: number;
    slippage_bps?: number;
    mode?: string;
    builtin_id?: string | null;
    builtin_params?: Record<string, unknown> | null;
    strategy_params?: Record<string, unknown> | null;
  };
};
type ServerRunSummary = {
  run_id: string;
  saved_at?: string;
  symbol?: string;
  total_return?: number;
  max_drawdown?: number;
};

type BacktestResponse = {
  config: BacktestConfig;
  stats: BacktestStats;
  trade_stats: TradeStats;
  trades: Trade[];
  orders: OrderResponse[];
  price_series: number[];
  timestamps: number[];
  strategy?: StrategyInfo | null;
  run_id: string;
  diagnostics?: DiagnosticsInfo;
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
    strategyParamsRaw?: string;
  };
  runId?: string;
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
type LintStatus = "idle" | "checking" | "passed" | "failed";

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
  const [serverRuns, setServerRuns] = useState<ServerRunSummary[]>([]);
  const [serverRunsLoading, setServerRunsLoading] = useState(false);
  const [serverRunsError, setServerRunsError] = useState<string | null>(null);
  const [serverRunLoadingId, setServerRunLoadingId] = useState<string | null>(null);
  const [serverRunError, setServerRunError] = useState<string | null>(null);
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
  const [strategyParamsRaw, setStrategyParamsRaw] = useState("");
  const [strategyParamsError, setStrategyParamsError] = useState<string | null>(null);
  const [strategyParamsObject, setStrategyParamsObject] = useState<Record<string, unknown>>({});
  const [lintStatus, setLintStatus] = useState<LintStatus>("idle");
  const [lintMessage, setLintMessage] = useState<string | null>(null);
  const lintSupportedRef = useRef(true);
  const [customParamPresets, setCustomParamPresets] = useState<StrategyParamPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState("");
  const [presetFeedback, setPresetFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );
  const [chartZoom, setChartZoom] = useState(1);
  const [chartOffset, setChartOffset] = useState(0);
  const [chartAnimationKey, setChartAnimationKey] = useState(0);
  const [chartsIntro, setChartsIntro] = useState(true);
  const triggerChartAnimation = useCallback(() => {
    setChartAnimationKey((key) => key + 1);
  }, []);
  const handleZoomSliderChange = useCallback(
    (value: number) => {
      setChartZoom(value);
      triggerChartAnimation();
    },
    [triggerChartAnimation],
  );
  const handleOffsetSliderChange = useCallback(
    (value: number) => {
      setChartOffset(value);
      triggerChartAnimation();
    },
    [triggerChartAnimation],
  );
  const resetChartWindow = useCallback(() => {
    setChartZoom(1);
    setChartOffset(0);
    triggerChartAnimation();
  }, [triggerChartAnimation]);

  const activeRunId = result?.run_id ?? null;

  useEffect(() => {
    if (typeof window === "undefined" || !activeRunId) return;
    setChartsIntro(false);
    const timer = window.setTimeout(() => setChartsIntro(true), 80);
    return () => window.clearTimeout(timer);
  }, [activeRunId]);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";
  const STORAGE_KEY = "relaytrader:backtest-form";
  const PRESET_STORAGE_KEY = "relaytrader:strategy-param-presets";
  const chartIntroClass = chartsIntro ? "animate-chartIntro" : "";
  const chartInstanceKey = activeRunId ?? "baseline";

  const applyFormSnapshot = useCallback((form?: DiagnosticsInfo["form"]) => {
    if (!form) return;
    if (form.symbol) setSymbol(form.symbol);
    if (form.csv_path) setCsvPath(form.csv_path);
    if (typeof form.initial_cash === "number") setInitialCash(form.initial_cash);
    if (typeof form.max_bars === "number" || form.max_bars === null) {
      setMaxBars(form.max_bars ?? undefined);
    }
    if (typeof form.commission_per_trade === "number") {
      setCommission(form.commission_per_trade);
    }
    if (typeof form.slippage_bps === "number") {
      setSlippageBps(form.slippage_bps);
    }
    if (form.mode === "builtin" || form.mode === "custom") {
      setMode(form.mode);
    }
    if (form.mode === "builtin") {
      setBuiltinId(form.builtin_id ?? null);
      if (form.builtin_params && typeof form.builtin_params === "object") {
        setBuiltinParams(form.builtin_params as NumericParams);
      } else {
        setBuiltinParams({});
      }
      setStrategyParamsRaw("");
    } else if (form.mode === "custom") {
      setBuiltinId(null);
      if (form.strategy_params && typeof form.strategy_params === "object") {
        setStrategyParamsRaw(JSON.stringify(form.strategy_params, null, 2));
      } else {
        setStrategyParamsRaw("");
      }
    }
  }, []);

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
      if (typeof saved.strategyParamsRaw === "string") {
        setStrategyParamsRaw(saved.strategyParamsRaw);
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

  useEffect(() => {
    if (!strategyParamsRaw.trim()) {
      setStrategyParamsObject({});
      setStrategyParamsError(null);
      return;
    }
    try {
      const parsed = JSON.parse(strategyParamsRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setStrategyParamsObject(parsed as Record<string, unknown>);
        setStrategyParamsError(null);
      } else {
        setStrategyParamsObject({});
        setStrategyParamsError("Params must be a JSON object.");
      }
    } catch {
      setStrategyParamsObject({});
      setStrategyParamsError("Invalid JSON");
    }
  }, [strategyParamsRaw]);

  const persistCustomPresets = useCallback(
    (presets: StrategyParamPreset[]) => {
      setCustomParamPresets(presets);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
      }
    },
    [PRESET_STORAGE_KEY],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sanitized = parsed.filter(
          (preset: unknown): preset is StrategyParamPreset =>
            Boolean(
              preset &&
                typeof preset === "object" &&
                "id" in preset &&
                typeof (preset as { id?: unknown }).id === "string" &&
                "label" in preset &&
                typeof (preset as { label?: unknown }).label === "string" &&
                "params" in preset &&
                typeof (preset as { params?: unknown }).params === "object",
            ),
        );
        setCustomParamPresets(sanitized);
      }
    } catch (e) {
      console.warn("Failed to load param presets", e);
    }
  }, [PRESET_STORAGE_KEY]);

  useEffect(() => {
    setLintStatus("idle");
    setLintMessage(null);
  }, [strategyCode]);

  useEffect(() => {
    if (mode !== "custom") {
      setLintStatus("idle");
      setLintMessage(null);
    }
  }, [mode]);

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

  const fetchServerRuns = useCallback(async () => {
    setServerRunsLoading(true);
    setServerRunsError(null);
    try {
      const res = await fetch(`${apiBase}/runs`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      const json = (await res.json()) as { runs: ServerRunSummary[] };
      setServerRuns(json.runs || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch runs";
      setServerRunsError(message);
    } finally {
      setServerRunsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchServerRuns();
  }, [fetchServerRuns]);

  const handleLoadServerRun = useCallback(
    async (runId: string) => {
      if (!runId) return;
      setServerRunLoadingId(runId);
      setServerRunError(null);
      try {
        const res = await fetch(`${apiBase}/runs/${runId}`);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const json = (await res.json()) as BacktestResponse;
        setResult(json);
        applyFormSnapshot(json.diagnostics?.form);
        setDetailTab("trades");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load run";
        setServerRunError(message);
      } finally {
        setServerRunLoadingId(null);
      }
    },
    [apiBase, applyFormSnapshot, setDetailTab],
  );

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

  const handleApplyPreset = useCallback(
    (preset: StrategyParamPreset) => {
      setMode("custom");
      setStrategyParamsRaw(JSON.stringify(preset.params ?? {}, null, 2));
    },
    [],
  );

  const handleSavePreset = useCallback(() => {
    const trimmed = newPresetName.trim();
    if (!trimmed) {
      setPresetFeedback({ type: "error", message: "Preset name required." });
      return;
    }
    if (!strategyParamsRaw.trim()) {
      setPresetFeedback({ type: "error", message: "Add JSON parameters before saving." });
      return;
    }
    if (strategyParamsError) {
      setPresetFeedback({ type: "error", message: "Fix JSON before saving preset." });
      return;
    }
    const snapshot = JSON.parse(JSON.stringify(strategyParamsObject || {}));
    const preset: StrategyParamPreset = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      label: trimmed,
      params: snapshot,
    };
    const next = [preset, ...customParamPresets].slice(0, 12);
    persistCustomPresets(next);
    setNewPresetName("");
    setPresetFeedback({ type: "success", message: "Preset saved locally." });
  }, [
    customParamPresets,
    newPresetName,
    persistCustomPresets,
    strategyParamsError,
    strategyParamsObject,
    strategyParamsRaw,
  ]);

  const handleDeletePreset = useCallback(
    (presetId: string) => {
      const next = customParamPresets.filter((preset) => preset.id !== presetId);
      persistCustomPresets(next);
      setPresetFeedback({ type: "success", message: "Preset removed." });
    },
    [customParamPresets, persistCustomPresets],
  );

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
    if (typeof window === "undefined") return;
    const payload = {
      symbol,
      csvPath,
      initialCash,
      maxBars: maxBars ?? null,
      commission,
      slippageBps,
      strategyCode,
      strategyParamsRaw,
      mode,
      builtinId,
      builtinParams,
    };
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {
        console.warn("Failed to persist form state", err);
      }
    }, 200);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    symbol,
    csvPath,
    initialCash,
    maxBars,
    commission,
    slippageBps,
    strategyCode,
    strategyParamsRaw,
    mode,
    builtinId,
    builtinParams,
  ]);

  const runLintCheck = useCallback(async () => {
    if (mode !== "custom") return true;
    if (!lintSupportedRef.current) return true;
    if (!strategyCode.trim()) {
      const message = "Strategy code is empty.";
      setLintStatus("failed");
      setLintMessage(message);
      setError(message);
      return false;
    }
    setLintStatus("checking");
    setLintMessage("Validating syntax...");
    try {
      const res = await fetch(`${apiBase}/lint-strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_code: strategyCode,
          strategy_class_name: "UserStrategy",
        }),
      });
      if (res.status === 404) {
        lintSupportedRef.current = false;
        setLintStatus("idle");
        setLintMessage("Backend lint endpoint not found; skipping syntax check.");
        return true;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      setLintStatus("passed");
      setLintMessage("Syntax + class look good.");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lint failed";
      setLintStatus("failed");
      setLintMessage(message);
      setError(message);
      return false;
    }
  }, [apiBase, mode, strategyCode]);

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

    if (mode === "custom" && strategyParamsError) {
      setError("Fix strategy params JSON before running.");
      setLoading(false);
      return;
    }

    if (mode === "custom") {
      const lintOk = await runLintCheck();
      if (!lintOk) {
        setLoading(false);
        return;
      }
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
              strategy_params: strategyParamsError ? null : strategyParamsObject,
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
          strategyParamsRaw,
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
    resetChartWindow();
  }, [resetChartWindow, result]);

  useEffect(() => {
    if (chartZoom >= 0.999 && chartOffset !== 0) {
      setChartOffset(0);
      triggerChartAnimation();
    }
  }, [chartZoom, chartOffset, triggerChartAnimation]);

  const equityCurve = result?.stats.equity_curve || [];
  const priceSeries = result?.price_series || [];
  const timestamps = useMemo(() => (result?.timestamps || []) as number[], [result?.timestamps]);
  const tradesForMarkers = filteredTrades.slice(-200);

  const hasTimestamps = timestamps.length === priceSeries.length && timestamps.length > 0;
  const timeline = hasTimestamps ? timestamps : priceSeries.map((_, idx) => idx);
  const computeXValue = (idx: number) => timeline[idx] ?? idx;
  const totalBars = timeline.length;
  const zoomSpan = Math.min(Math.max(chartZoom, 0.05), 1);
  const windowSize =
    !totalBars || zoomSpan >= 0.999 ? totalBars : Math.max(2, Math.floor(totalBars * zoomSpan));
  const maxStartIndex = Math.max(totalBars - windowSize, 0);
  const offsetValue =
    !totalBars || windowSize >= totalBars || maxStartIndex === 0
      ? 0
      : Math.min(Math.max(chartOffset, 0), 1);
  const windowStart = totalBars ? Math.min(maxStartIndex, Math.floor(offsetValue * maxStartIndex)) : 0;
  const windowEnd = totalBars ? Math.min(totalBars, windowStart + windowSize) : 0;
  const timelineWindow = totalBars ? timeline.slice(windowStart, windowEnd) : [];
  const timelineForWindow = timelineWindow.length ? timelineWindow : timeline;
  const windowRange: [number | null, number | null] = timelineForWindow.length
    ? [timelineForWindow[0], timelineForWindow[timelineForWindow.length - 1]]
    : [null, null];
  const zoomActive = totalBars > 0 && windowSize < totalBars;

  const priceSeriesWindow = totalBars ? priceSeries.slice(windowStart, windowEnd) : priceSeries;
  const equityWindow = totalBars ? equityCurve.slice(windowStart, windowEnd) : equityCurve;
  const drawdownSeries = result?.stats.drawdown_curve || [];
  const drawdownWindow = totalBars ? drawdownSeries.slice(windowStart, windowEnd) : drawdownSeries;

  const findNearestIndex = useCallback(
    (ts: number, fallbackIdx: number) => {
      if (!hasTimestamps) return Math.min(fallbackIdx, priceSeries.length - 1);
      let lo = 0;
      let hi = timestamps.length - 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const val = timestamps[mid];
        if (val === ts) return mid;
        if (val < ts) lo = mid + 1;
        else hi = mid - 1;
      }
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
    },
    [hasTimestamps, priceSeries.length, timestamps],
  );

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
  const limitMarkersToWindow = (markers: MarkerPoint[]) => {
    const [minX, maxX] = windowRange;
    if (minX == null || maxX == null) return markers;
    return markers.filter((m) => m.x >= minX && m.x <= maxX);
  };
  const visibleTradeMarkersPrice = limitMarkersToWindow(tradeMarkersPrice);
  const visibleTradeMarkersEquity = limitMarkersToWindow(tradeMarkersEquity);

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

  const chartClickHandler: NonNullable<LineChartOptions["onClick"]> = (_evt, elements, chart) =>
    handleChartPointClick(
      elements as ActiveElement[],
      chart as Chart<keyof ChartTypeRegistry>,
    );

  const createChartOptions = (yGridColor: string, useTimeScale: boolean): LineChartOptions => ({
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 8, right: 8, bottom: 0, left: 0 } },
    animation: {
      duration: 450,
      easing: "easeOutCubic",
    },
    transitions: {
      zoom: {
        animation: {
          duration: 450,
          easing: "easeOutCubic",
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
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
    interaction: { intersect: true, mode: "nearest", axis: "xy" },
    onClick: chartClickHandler,
    scales: {
      x: {
        type: useTimeScale ? "time" : "linear",
        time: useTimeScale
          ? {
              tooltipFormat: "MMM d, yyyy HH:mm",
              displayFormats: {
                millisecond: "HH:mm:ss.SSS",
                second: "HH:mm:ss",
                minute: "HH:mm",
                hour: "MMM d HH:mm",
                day: "MMM d",
                week: "MMM d",
                month: "MMM yyyy",
              },
            }
          : undefined,
        ticks: useTimeScale
          ? {
              color: "#94a3b8",
              maxRotation: 0,
            }
          : {
              color: "#94a3b8",
              maxRotation: 0,
              callback: (value) => Math.round(Number(value)).toString(),
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

  const buildSeriesPoints = (series: number[], timeAxis: number[]) =>
    series.map((value, idx) => ({
      x: timeAxis[idx],
      y: value,
    }));

  const pricePoints =
    priceSeriesWindow.length && timelineForWindow.length
      ? buildSeriesPoints(priceSeriesWindow, timelineForWindow)
      : [];
  const equityPoints =
    equityWindow.length && timelineForWindow.length
      ? buildSeriesPoints(equityWindow, timelineForWindow)
      : [];
  const drawdownPoints =
    drawdownWindow.length && timelineForWindow.length
      ? drawdownWindow.map((dd, idx) => ({
          x: timelineForWindow[idx],
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
          labels: timelineForWindow,
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
              pointHitRadius: 8,
              order: 1,
              segment: {
                borderDash: (ctx) => (ctx.p1DataIndex === 0 ? [600, 600] : undefined),
              },
            },
            {
              label: "Trades",
              data: visibleTradeMarkersEquity,
              parsing: false,
              isTrade: true,
              pointRadius: 6,
              pointHoverRadius: 9,
              pointHitRadius: 16,
              pointHoverBorderWidth: 2,
              pointBackgroundColor: visibleTradeMarkersEquity.map((m) =>
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
          labels: timelineForWindow,
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
              pointHitRadius: 8,
              order: 1,
            },
            {
              label: "Trades",
              data: visibleTradeMarkersPrice,
              parsing: false,
              isTrade: true,
              pointRadius: 6,
              pointHoverRadius: 9,
              pointHitRadius: 16,
              pointHoverBorderWidth: 2,
              pointBackgroundColor: visibleTradeMarkersPrice.map((m) =>
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
          labels: timelineForWindow,
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
              pointHitRadius: 6,
            },
          ],
        }
      : null;

  const valueToIndex = useCallback(
    (value: number) => {
      if (!timeline.length) return 0;
      if (hasTimestamps) {
        return findNearestIndex(value, 0);
      }
      const idx = Math.round(value);
      return Math.max(0, Math.min(timeline.length - 1, idx));
    },
    [timeline, hasTimestamps, findNearestIndex],
  );

  const applyZoomAroundValue = useCallback(
    (centerValue: number, scaleMultiplier: number) => {
      if (!totalBars || !Number.isFinite(centerValue) || !Number.isFinite(scaleMultiplier)) return;
      const minFraction = Math.min(1, Math.max(2 / totalBars, 0.02));
      const normalizedCurrent = Math.min(Math.max(chartZoom, minFraction), 1);
      let nextFraction = normalizedCurrent * scaleMultiplier;
      nextFraction = Math.max(minFraction, Math.min(1, nextFraction));
      const newWindowSize =
        nextFraction >= 0.999 || totalBars <= 2
          ? totalBars
          : Math.max(2, Math.round(totalBars * nextFraction));
      const centerIdx = valueToIndex(centerValue);
      const halfWindow = newWindowSize / 2;
      let nextStart = Math.round(centerIdx - halfWindow);
      nextStart = Math.max(0, Math.min(totalBars - newWindowSize, nextStart));
      const denom = totalBars - newWindowSize;
      const nextOffset = denom <= 0 ? 0 : nextStart / denom;
      setChartZoom(newWindowSize / totalBars);
      setChartOffset(nextOffset);
      triggerChartAnimation();
    },
    [chartZoom, totalBars, triggerChartAnimation, valueToIndex],
  );

  const handlePinchZoom = useCallback(
    (centerValue: number, scaleRatio: number) => {
      if (!totalBars || !Number.isFinite(scaleRatio) || scaleRatio === 0) return;
      const multiplier = 1 / scaleRatio;
      applyZoomAroundValue(centerValue, multiplier);
    },
    [applyZoomAroundValue, totalBars],
  );

  const handleBrushRange = useCallback(
    ([startVal, endVal]: [number, number]) => {
      if (!timeline.length || totalBars === 0) return;
      const minVal = Math.min(startVal, endVal);
      const maxVal = Math.max(startVal, endVal);
      if (maxVal - minVal <= 0) return;
      const startIdx = valueToIndex(minVal);
      const endIdx = valueToIndex(maxVal);
      if (endIdx <= startIdx) return;
      const newSize = Math.max(2, endIdx - startIdx);
      setChartZoom(Math.min(1, newSize / totalBars));
      if (totalBars > newSize) {
        const offset = startIdx / (totalBars - newSize);
        setChartOffset(Math.max(0, Math.min(1, offset)));
      } else {
        setChartOffset(0);
      }
      triggerChartAnimation();
    },
    [timeline.length, totalBars, valueToIndex, triggerChartAnimation],
  );

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
                Configure your own dataset and paste your own code, or choose from built-in strats to backtest..!
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
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-200">
                    Strategy Mode
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 rounded-2xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                    {MODE_OPTIONS.map((option) => {
                      const isActive = mode === option.id;
                      return (
                        <label
                          key={option.id}
                          className={`flex cursor-pointer flex-col gap-1 px-4 py-3 transition ${
                            isActive
                              ? "bg-sky-500 text-slate-950 shadow-inner shadow-sky-500/30"
                              : "text-slate-300 hover:text-slate-100"
                          }`}
                        >
                          <input
                            type="radio"
                            className="sr-only"
                            name="strategy-mode"
                            checked={isActive}
                            onChange={() => setMode(option.id)}
                          />
                          <span className="text-sm font-semibold">{option.title}</span>
                          <span
                            className={`text-[10px] uppercase tracking-wide ${
                              isActive ? "text-slate-900/80" : "text-slate-500"
                            }`}
                          >
                            {option.caption}
                          </span>
                        </label>
                      );
                    })}
                  </div>
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
                        height="420px"
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
                    <div className="flex flex-col gap-1 pt-2">
                      <label className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                        Strategy Parameters (JSON)
                      </label>
                    <div className="flex flex-col gap-3 text-[11px] text-slate-400">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>Built-in presets:</span>
                        {STRATEGY_PARAM_PRESETS.map((preset) => (
                          <button
                            type="button"
                            key={preset.id}
                            className="rounded-md border border-slate-700 px-2 py-1 hover:border-sky-500"
                            onClick={() => handleApplyPreset(preset)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span>Saved presets:</span>
                        {customParamPresets.length ? (
                          customParamPresets.map((preset) => (
                            <div
                              key={preset.id}
                              className="flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"
                            >
                              <button
                                type="button"
                                className="text-slate-200 hover:text-sky-200"
                                onClick={() => handleApplyPreset(preset)}
                              >
                                {preset.label}
                              </button>
                              <button
                                type="button"
                                className="text-[10px] text-slate-500 hover:text-rose-400"
                                aria-label={`Delete preset ${preset.label}`}
                                onClick={() => handleDeletePreset(preset.id)}
                              >
                                ×
                              </button>
                            </div>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-500">
                            None saved yet—capture your favorite parameter sets below.
                          </span>
                        )}
                      </div>
                      <div className="space-y-2 text-[11px]">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">
                          Save current parameters
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40"
                            placeholder="Preset name (e.g., fast-mean-rev)"
                            value={newPresetName}
                            onChange={(e) => setNewPresetName(e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={handleSavePreset}
                            disabled={Boolean(strategyParamsError) || loading}
                            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-sky-500 disabled:opacity-50"
                          >
                            Save Preset
                          </button>
                        </div>
                        {presetFeedback && (
                          <p
                            className={`text-[10px] ${
                              presetFeedback.type === "success" ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {presetFeedback.message}
                          </p>
                        )}
                      </div>
                    </div>
                      <textarea
                        className={`min-h-[140px] rounded-lg border px-3 py-2 text-sm font-mono outline-none transition focus:ring-1 ${
                          strategyParamsError
                            ? "border-rose-600 bg-rose-950/20 focus:border-rose-500 focus:ring-rose-500/40"
                            : "border-slate-800 bg-slate-950 focus:border-sky-500 focus:ring-sky-500/40"
                        }`}
                        placeholder='{}\n// optional JSON passed as strategy_params'
                        value={strategyParamsRaw}
                        onChange={(e) => setStrategyParamsRaw(e.target.value)}
                      />
                      {strategyParamsError ? (
                        <p className="text-[11px] text-rose-400">{strategyParamsError}</p>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          Valid JSON object is sent as <code>strategy_params</code> to the backend.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={loading || (mode === "custom" && Boolean(strategyParamsError))}
                    className="inline-flex items-center justify-center rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/40 transition hover:bg-sky-400 disabled:opacity-60 disabled:hover:bg-sky-500"
                  >
                    {loading ? "Running Backtest..." : "Run Backtest"}
                  </button>
                  <div className="text-[11px] text-slate-500">
                    Config persists locally; reset by clearing browser storage.
                  </div>
                </div>

                {mode === "custom" && lintStatus !== "idle" && (
                  <p
                    className={`text-[11px] ${
                      lintStatus === "failed"
                        ? "text-rose-400"
                        : lintStatus === "passed"
                          ? "text-emerald-400"
                          : "text-sky-400"
                    }`}
                  >
                    {lintMessage ?? (lintStatus === "checking" ? "Linting..." : null)}
                  </p>
                )}

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
                    {result.strategy && (
                      <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-200">
                        <div className="flex flex-wrap items-center gap-3 text-[13px]">
                          <span className="text-slate-400">Mode</span>
                          <span className="rounded-full border border-slate-700 px-2 py-[2px] text-xs uppercase tracking-wide text-slate-200">
                            {result.strategy.mode === "builtin" ? "Built-in" : "Custom"}
                          </span>
                          <span className="text-slate-400">Class</span>
                          <span className="font-semibold text-slate-100">{result.strategy.class_name}</span>
                          {result.strategy.builtin_id && (
                            <>
                              <span className="text-slate-400">ID</span>
                              <span>{result.strategy.builtin_id}</span>
                            </>
                          )}
                        </div>
                        <div className="mt-3">
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">
                            Applied Parameters
                          </div>
                          {Object.keys(result.strategy.params || {}).length ? (
                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[12px]">
                              {Object.entries(result.strategy.params).map(([key, value]) => (
                                <div
                                  key={key}
                                  className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-200"
                                >
                                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{key}</div>
                                  <div className="font-semibold">{formatParamValue(value)}</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-[11px] text-slate-500">
                              No overrides provided—engine defaults were used.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
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
                  {totalBars > 1 && (
                    <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-300">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                        <label className="flex-1">
                          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                            <span>Zoom Window</span>
                            <span>{Math.round(Math.min(chartZoom, 1) * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0.1}
                            max={1}
                            step={0.05}
                            value={chartZoom}
                            onChange={(e) => handleZoomSliderChange(parseFloat(e.target.value))}
                            className="mt-1 w-full accent-sky-500"
                          />
                        </label>
                        <label className={`flex-1 ${!zoomActive ? "opacity-40" : ""}`}>
                          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                            <span>Offset</span>
                            <span>{Math.round(chartOffset * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={chartOffset}
                            onChange={(e) => handleOffsetSliderChange(parseFloat(e.target.value))}
                            disabled={!zoomActive}
                            className="mt-1 w-full accent-sky-500 disabled:opacity-40"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={resetChartWindow}
                          className="rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-sky-500 hover:text-sky-200"
                        >
                          Reset Zoom
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {equityData && (
                      <div
                        className={`rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-inner shadow-slate-950/40 transition-all duration-700 ${chartIntroClass}`}
                        style={{ animationDelay: chartsIntro ? "0ms" : "0ms" }}
                      >
                        <div className="flex items-center justify-between pb-2 text-xs text-slate-400">
                          <span>Equity Curve</span>
                          <span className="text-[11px] text-slate-500">Cash + positions</span>
                        </div>
                        <ZoomableChart
                          key={`${chartInstanceKey}-equity`}
                          data={equityData}
                          options={equityOptions}
                          onBrush={handleBrushRange}
                          onPinchZoom={handlePinchZoom}
                          brushDisabled={!timeline.length}
                          className="h-[320px]"
                          animationKey={chartAnimationKey}
                        />
                      </div>
                    )}
                    {priceData && (
                      <div
                        className={`rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-inner shadow-slate-950/40 transition-all duration-700 ${chartIntroClass}`}
                        style={{ animationDelay: chartsIntro ? "120ms" : "0ms" }}
                      >
                        <div className="flex items-center justify-between pb-2 text-xs text-slate-400">
                          <span>Price</span>
                          <span className="text-[11px] text-slate-500">Trades overlaid</span>
                        </div>
                        <ZoomableChart
                          key={`${chartInstanceKey}-price`}
                          data={priceData}
                          options={priceOptions}
                          onBrush={handleBrushRange}
                          onPinchZoom={handlePinchZoom}
                          brushDisabled={!timeline.length}
                          className="h-[320px]"
                          animationKey={chartAnimationKey}
                        />
                      </div>
                    )}
                  </div>
                  {drawdownData && (
                      <div
                        className={`mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-inner shadow-slate-950/40 transition-all duration-700 ${chartIntroClass}`}
                        style={{ animationDelay: chartsIntro ? "220ms" : "0ms" }}
                      >
                        <div className="flex items-center justify-between pb-2 text-xs text-slate-400">
                          <span>Drawdown Curve</span>
                          <span className="text-[11px] text-slate-500">Peak-to-trough (%)</span>
                        </div>
                        <ZoomableChart
                          key={`${chartInstanceKey}-drawdown`}
                          data={drawdownData}
                          options={drawdownOptions}
                          onBrush={handleBrushRange}
                          onPinchZoom={handlePinchZoom}
                          brushDisabled={!timeline.length}
                          className="h-[240px]"
                          animationKey={chartAnimationKey}
                        />
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
                  <div className="mt-4 space-y-5">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">Server Runs</h3>
                          <p className="text-[11px] text-slate-500">
                            Persisted on the FastAPI host (runs.json)
                          </p>
                        </div>
                        <div className="flex gap-2 text-[11px]">
                          <button
                            type="button"
                            className="rounded-full border border-slate-700 px-3 py-1 font-semibold uppercase tracking-wide text-slate-200 hover:border-sky-500"
                            onClick={fetchServerRuns}
                            disabled={serverRunsLoading}
                          >
                            {serverRunsLoading ? "Refreshing..." : "Refresh"}
                          </button>
                        </div>
                      </div>
                      {serverRunsError && (
                        <p className="mt-2 text-[11px] text-rose-400">{serverRunsError}</p>
                      )}
                      {serverRunError && (
                        <p className="mt-2 text-[11px] text-rose-400">{serverRunError}</p>
                      )}
                      {serverRunsLoading ? (
                        <p className="mt-3 text-sm text-slate-400">Loading server history…</p>
                      ) : serverRuns.length ? (
                        <ul className="mt-3 grid gap-3 md:grid-cols-2">
                          {serverRuns.map((run) => (
                            <li
                              key={run.run_id}
                              className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-200"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-100">
                                  {run.symbol ?? "—"}
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  {run.saved_at
                                    ? new Date(run.saved_at).toLocaleString()
                                    : "Unknown"}
                                </span>
                              </div>
                              <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-slate-400">
                                <span>
                                  Ret:{" "}
                                  {run.total_return != null
                                    ? (run.total_return * 100).toFixed(2) + "%"
                                    : "—"}
                                </span>
                                <span>
                                  DD:{" "}
                                  {run.max_drawdown != null
                                    ? (run.max_drawdown * 100).toFixed(2) + "%"
                                    : "—"}
                                </span>
                              </div>
                              <div className="mt-2 flex gap-2 text-[11px]">
                                <button
                                  type="button"
                                  className="rounded-md border border-slate-700 px-3 py-1 font-semibold text-slate-200 hover:border-sky-500 disabled:opacity-60"
                                  onClick={() => handleLoadServerRun(run.run_id)}
                                  disabled={serverRunLoadingId === run.run_id}
                                >
                                  {serverRunLoadingId === run.run_id ? "Loading..." : "Load Run"}
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-slate-400">
                          No persisted runs yet. Execute a backtest to populate runs.json.
                        </p>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">Local Snapshots</h3>
                          <p className="text-[11px] text-slate-500">
                            Stored in browser storage for quick recall
                          </p>
                        </div>
                        {history.length > 0 && (
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">
                            {history.length} stored
                          </span>
                        )}
                      </div>
                      {history.length ? (
                        <ul className="mt-3 grid gap-3 md:grid-cols-2">
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
                                <span>
                                  Win: {(h.result.trade_stats?.win_rate * 100 || 0).toFixed(1)}%
                                </span>
                              </div>
                              {h.form.mode === "custom" && h.form.strategyParamsRaw && (
                                <div
                                  className="mt-1 text-[10px] text-slate-500 truncate"
                                  title={h.form.strategyParamsRaw}
                                >
                                  Params: {h.form.strategyParamsRaw.replace(/\s+/g, " ").slice(0, 80)}
                                </div>
                              )}
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
                                    setStrategyParamsRaw(h.form.strategyParamsRaw ?? "");
                                  }}
                                >
                                  Load Config
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-slate-400">No local runs saved yet.</p>
                      )}
                    </div>
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
      <style jsx global>{`
        @keyframes chartIntroKeyframes {
          0% {
            opacity: 0;
            transform: translateY(18px) scale(0.99);
          }
          60% {
            opacity: 1;
            transform: translateY(-4px) scale(1);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-chartIntro {
          opacity: 0;
          transform: translateY(12px);
          animation: chartIntroKeyframes 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          will-change: transform, opacity;
        }
      `}</style>
    </>
  );
}
