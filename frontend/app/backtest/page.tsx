"use client";

import React, { ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Line, Bar } from "react-chartjs-2";
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
  BarElement,
  BarController,
} from "chart.js";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { python } from "@codemirror/lang-python";
import "chartjs-adapter-date-fns";
import ManualMode from "./ManualMode";
import PortfolioMode from "./PortfolioMode";
import { apiFetch, API_BASE } from "@/app/lib/api";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";
import { UserDisplay } from "@/app/components/UserDisplay";
import { CandlestickChart, ChartControls, CrosshairTooltip, convertPricesToOHLCWithVariation, generateVolumeData } from "@/app/components/charts";
import type { ChartType as CandleChartType, OHLCData, CrosshairData, VolumeData, TradeMarker, ChartAnnotation, AnnotationMode } from "@/app/components/charts/types";

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, TimeScale, Tooltip, Legend, Filler, BarElement, BarController);

const STRATEGY_TEMPLATES = [
  {
    id: "mean_reversion",
    label: "Mean Reversion Template",
    code: `from relaytrader.core.strategy import Strategy\nfrom relaytrader.core.types import Bar, OrderType\n\n\nclass UserStrategy(Strategy):\n    """Mean reversion strategy using z-score with dynamic position sizing"""\n    \n    def on_bar(self, bar: Bar):\n        lookback = int(self.params.get("lookback", 50))\n        entry_z = float(self.params.get("entry_z", 2.0))\n        exit_z = float(self.params.get("exit_z", 0.5))\n        position_pct = float(self.params.get("position_pct", 100.0))\n\n        z = self.zscore(bar.symbol, "close", lookback)\n        if z is None:\n            return\n\n        # Calculate position size based on percentage of available capital\n        cash = self.context.get_cash()\n        max_position_value = cash * (position_pct / 100.0)\n        qty = int(max_position_value / bar.close) if bar.close > 0 else 0\n        if qty <= 0:\n            return\n\n        pos = self.context.get_position_qty(bar.symbol)\n\n        if z > entry_z and pos > 0:\n            self.sell(bar.symbol, pos, OrderType.MARKET)\n        elif z < -entry_z and pos >= 0:\n            self.buy(bar.symbol, qty, OrderType.MARKET)\n        elif abs(z) < exit_z and pos != 0:\n            if pos > 0:\n                self.sell(bar.symbol, pos, OrderType.MARKET)\n            else:\n                self.buy(bar.symbol, -pos, OrderType.MARKET)`,
  },
  {
    id: "sma_cross",
    label: "SMA Crossover Template",
    code: `from relaytrader.core.strategy import Strategy\nfrom relaytrader.core.types import Bar, OrderType\n\n\nclass UserStrategy(Strategy):\n    """SMA crossover strategy with dynamic position sizing"""\n    \n    def on_bar(self, bar: Bar):\n        fast = int(self.params.get("fast", 10))\n        slow = int(self.params.get("slow", 40))\n        position_pct = float(self.params.get("position_pct", 100.0))\n        \n        if fast >= slow:\n            return\n\n        history = list(self.context.get_history(bar.symbol, "close", slow))\n        if len(history) < slow:\n            return\n\n        fast_ma = sum(history[-fast:]) / fast\n        slow_ma = sum(history) / slow\n        \n        # Calculate position size based on percentage of available capital\n        cash = self.context.get_cash()\n        max_position_value = cash * (position_pct / 100.0)\n        qty = int(max_position_value / bar.close) if bar.close > 0 else 0\n        if qty <= 0:\n            return\n        \n        pos = self.context.get_position_qty(bar.symbol)\n\n        if fast_ma > slow_ma and pos <= 0:\n            if pos < 0:\n                self.buy(bar.symbol, -pos, OrderType.MARKET)\n            self.buy(bar.symbol, qty, OrderType.MARKET)\n        elif fast_ma < slow_ma and pos >= 0:\n            if pos > 0:\n                self.sell(bar.symbol, pos, OrderType.MARKET)\n            self.sell(bar.symbol, qty, OrderType.MARKET)`,
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

const deriveSymbolFromName = (name: string | undefined) => {
  if (!name) return "";
  // Remove file extension
  const base = name.split(".")[0] || name;
  // Extract symbol from patterns like "RKLB_20201123-20251218" or "AAPL_daily"
  const symbolMatch = base.match(/^([A-Za-z]+)(?:_|\-|$)/);
  if (symbolMatch && symbolMatch[1]) {
    return symbolMatch[1].toUpperCase();
  }
  // Fallback: return the whole base name
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

const numericInputRegex = /^-?\d*(\.\d*)?$/;
const isIntermediateNumeric = (value: string) =>
  value === "" || value === "-" || value === "." || value === "-.";

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
  layoutAnimating?: boolean;
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
  layoutAnimating,
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
    if (!layoutAnimating) {
      chart.resize();
      return;
    }
    let raf: number | null = null;
    const pumpResize = () => {
      chart.resize();
      raf = requestAnimationFrame(pumpResize);
    };
    raf = requestAnimationFrame(pumpResize);
    return () => {
      if (raf != null) {
        cancelAnimationFrame(raf);
      }
    };
  }, [layoutAnimating]);

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
    chart?.update();
  }, [animationKey]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <Line ref={chartRef} data={data} options={options} />
      {brushBox.visible && (
        <div
          className="pointer-events-none absolute border border-white/60 bg-white/15"
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
type MarkerPoint = ScatterDataPoint & { meta: { trade: Trade; timestamp: number | null } };
type TradeLineDataset = ChartData<"line">["datasets"][number] & {
  isTrade?: boolean;
  data: (ChartData<"line">["datasets"][number]["data"][number] | MarkerPoint)[];
};
type MixedLineData = {
  labels?: ChartData<"line">["labels"];
  datasets: TradeLineDataset[];
};
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
    start_bar?: number | null;
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
    startBar?: number | null;
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

type DataSetProfile = {
  id: number;
  datasetName: string;
  displayName: string;
  startIndex: number;
  endIndex: number;
  startTimestamp: number;
  endTimestamp: number;
  startDate: string;
  endDate: string;
  initialEquity: number;
  createdAt: string;
};

type BuiltinStrategy = {
  id: string;
  name: string;
  description: string;
  params: { name: string; type: string; default: number; min?: number; max?: number }[];
};

type BuiltinParam = BuiltinStrategy["params"][number];
type LintStatus = "idle" | "checking" | "passed" | "failed";
type CollapseProps = { open: boolean; className?: string; children: ReactNode };
type StrategySelectProps = {
  options: BuiltinStrategy[];
  value: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
};

function Collapse({ open, className = "", children }: CollapseProps) {
  return (
    <div
      className={`transition-all duration-200 ${
        open
          ? "max-h-screen opacity-100 translate-y-0 overflow-visible"
          : "max-h-0 opacity-0 -translate-y-1 overflow-hidden"
      }`}
    >
      <div className={className}>{children}</div>
    </div>
  );
}

function StrategySelect({ options, value, onSelect, disabled }: StrategySelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = options.find((o) => o.id === value) ?? null;

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    if (open) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div className="relative isolate z-50" ref={ref}>
      <button
        type="button"
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
          disabled
            ? "border-gray-800/80 bg-gray-900/50 text-gray-500"
            : "border-gray-700 bg-gray-950 text-gray-100 hover:border-white/60"
        }`}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <div className="flex flex-col flex-1 min-w-0 pr-2">
          <span className="font-semibold">{active?.name ?? "Select strategy"}</span>
          <span className="text-[11px] text-gray-500 truncate">
            {active?.description ?? "Choose a preset strategy"}
          </span>
        </div>
        <svg
          className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div
        className={`absolute left-0 right-0 top-[calc(100%+6px)] z-[9999] origin-top rounded-xl border border-gray-800/80 bg-gray-950/95 shadow-2xl backdrop-blur transition-all duration-150 ${
          open ? "pointer-events-auto opacity-100 translate-y-0 scale-100" : "pointer-events-none opacity-0 -translate-y-2 scale-95"
        }`}
      >
        <div className="max-h-64 overflow-y-auto py-2 scrollbar-hide">
          {options.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-gray-500">No built-in strategies available.</div>
          ) : (
            options.map((option) => {
              const selected = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`w-full px-4 py-2 text-left text-sm transition ${
                    selected ? "bg-white/10 text-white" : "text-gray-200 hover:bg-white/5"
                  }`}
                  onClick={() => handleSelect(option.id)}
                >
                  <div className="font-semibold">{option.name}</div>
                  <div className="text-[11px] text-gray-400 break-words">{option.description}</div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

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

function KeyMetricCard({ label, value, accent = false, tooltip }: { label: string; value: string; accent?: boolean; tooltip?: string }) {
  return (
    <div className={`rounded-lg border ${accent ? "border-white/30 bg-white/20" : "border-gray-700"} bg-gray-900 px-4 py-3`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
        {tooltip && <InfoIcon tooltip={tooltip} />}
      </div>
      <div className={`mt-1 text-2xl font-bold ${accent ? "text-white" : "text-gray-50"}`}>{value}</div>
    </div>
  );
}

function SecondaryMetricRow({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-800/50 py-2">
      <span className="text-xs text-gray-400">
        {label}
        {tooltip && <InfoIcon tooltip={tooltip} />}
      </span>
      <span className="text-sm font-semibold text-gray-200">{value}</span>
    </div>
  );
}

// Calculate advanced trade metrics
function calculateAdvancedMetrics(trades: Trade[]) {
  if (!trades || trades.length === 0) {
    return {
      profitFactor: 0,
      expectancy: 0,
      largestWin: 0,
      largestLoss: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      avgTradeDuration: 0,
    };
  }

  const tradesWithPnL = trades.filter(t => t.realized_pnl !== undefined && t.realized_pnl !== null);
  const winningTrades = tradesWithPnL.filter(t => (t.realized_pnl || 0) > 0);
  const losingTrades = tradesWithPnL.filter(t => (t.realized_pnl || 0) < 0);

  const grossProfit = winningTrades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0));

  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;
  const expectancy = tradesWithPnL.length > 0
    ? tradesWithPnL.reduce((sum, t) => sum + (t.realized_pnl || 0), 0) / tradesWithPnL.length
    : 0;

  const largestWin = winningTrades.length > 0
    ? Math.max(...winningTrades.map(t => t.realized_pnl || 0))
    : 0;
  const largestLoss = losingTrades.length > 0
    ? Math.min(...losingTrades.map(t => t.realized_pnl || 0))
    : 0;

  // Calculate consecutive wins/losses
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  tradesWithPnL.forEach(trade => {
    const pnl = trade.realized_pnl || 0;
    if (pnl > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
    } else if (pnl < 0) {
      currentLossStreak++;
      currentWinStreak = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
    }
  });

  return {
    profitFactor,
    expectancy,
    largestWin,
    largestLoss,
    consecutiveWins: maxConsecutiveWins,
    consecutiveLosses: maxConsecutiveLosses,
  };
}

// Calculate drawdown statistics
function calculateDrawdownStats(equityCurve: number[]) {
  if (!equityCurve || equityCurve.length === 0) {
    return { maxDrawdownDuration: 0, avgDrawdownDuration: 0, recoveryTime: 0 };
  }

  let peak = equityCurve[0];
  let maxDrawdownDuration = 0;
  let currentDrawdownStart = -1;
  const drawdownDurations: number[] = [];
  let maxDrawdownEnd = 0;
  let maxDrawdownPeak = 0;

  equityCurve.forEach((equity, i) => {
    if (equity > peak) {
      // New peak - end any drawdown
      if (currentDrawdownStart >= 0) {
        const duration = i - currentDrawdownStart;
        drawdownDurations.push(duration);
        maxDrawdownDuration = Math.max(maxDrawdownDuration, duration);
        currentDrawdownStart = -1;
      }
      peak = equity;
    } else if (equity < peak && currentDrawdownStart < 0) {
      // Start of drawdown
      currentDrawdownStart = i;

      // Check if this is the max drawdown
      const drawdown = (equity - peak) / peak;
      const maxDD = Math.min(...equityCurve.slice(0, i + 1).map((e, idx) => {
        const p = Math.max(...equityCurve.slice(0, idx + 1));
        return (e - p) / p;
      }));

      if (Math.abs(drawdown) >= Math.abs(maxDD) * 0.99) {
        maxDrawdownPeak = i;
      }
    }
  });

  // Find recovery time for max drawdown
  let recoveryTime = 0;
  if (maxDrawdownPeak > 0) {
    const peakValue = Math.max(...equityCurve.slice(0, maxDrawdownPeak + 1));
    for (let i = maxDrawdownPeak + 1; i < equityCurve.length; i++) {
      if (equityCurve[i] >= peakValue) {
        recoveryTime = i - maxDrawdownPeak;
        break;
      }
    }
    if (recoveryTime === 0 && maxDrawdownPeak < equityCurve.length - 1) {
      recoveryTime = equityCurve.length - maxDrawdownPeak; // Still in drawdown
    }
  }

  const avgDrawdownDuration = drawdownDurations.length > 0
    ? drawdownDurations.reduce((sum, d) => sum + d, 0) / drawdownDurations.length
    : 0;

  return {
    maxDrawdownDuration,
    avgDrawdownDuration,
    recoveryTime,
  };
}

function InfoIcon({ tooltip }: { tooltip: string }) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <span className="relative ml-1 inline-block">
      <button
        type="button"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-gray-600 text-[9px] text-gray-500 transition hover:border-gray-400 hover:text-gray-300"
        aria-label="More information"
      >
        ?
      </button>
      {showTooltip && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-[99999] mb-2 w-48 -translate-x-1/2 whitespace-normal rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-[11px] leading-relaxed text-gray-300 shadow-xl">
          {tooltip}
          <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-4 border-transparent border-t-gray-700" />
        </div>
      )}
    </span>
  );
}

// Parameter tooltips for built-in strategies
const PARAM_TOOLTIPS: Record<string, string> = {
  lookback: "Number of bars to look back for calculations. Higher values = smoother signals but slower to react.",
  entry_z: "Z-score threshold to enter a position. Higher = wait for more extreme mean reversion opportunities.",
  exit_z: "Z-score threshold to exit. Lower = exit closer to the mean.",
  fast: "Period for the fast-moving average. Reacts quickly to price changes.",
  slow: "Period for the slow-moving average. Smooths out long-term trends.",
  length: "RSI calculation period. Standard is 14. Lower = more sensitive.",
  oversold: "RSI level considered oversold. Below this triggers buy signal. Standard is 30.",
  overbought: "RSI level considered overbought. Above this triggers sell signal. Standard is 70.",
  num_std: "Number of standard deviations for Bollinger Bands. Higher = wider bands, fewer signals.",
  threshold: "Minimum percentage change to trigger momentum signal. Higher = only trade strong moves.",
  position_pct: "Percentage of available capital to use per trade. 100% = use all available capital (compounding). Lower values for risk management.",
  qty: "Fixed position size in units/shares. Ignored if position_pct is less than 100%.",
};

function BacktestPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useRequireAuth();
  const FORM_SETTING_KEY = "backtest-form";
  const PRESET_SETTING_KEY = "strategy-param-presets";

  useEffect(() => {
    if (typeof window === "undefined" || authLoading) return;
    const legacyForm = window.localStorage.getItem("priorsystems:backtest-form");
    const legacyPresets = window.localStorage.getItem("priorsystems:strategy-param-presets");
    const legacyMode = window.localStorage.getItem("priorsystems:trading-mode");

    const migrate = async () => {
      try {
        if (legacyForm) {
          const parsed = JSON.parse(legacyForm);
          await apiFetch(`/user-settings/${FORM_SETTING_KEY}`, {
            method: "PUT",
            body: JSON.stringify({ key: FORM_SETTING_KEY, value: parsed }),
          });
        }
        if (legacyPresets) {
          const parsed = JSON.parse(legacyPresets);
          await apiFetch(`/user-settings/${PRESET_SETTING_KEY}`, {
            method: "PUT",
            body: JSON.stringify({ key: PRESET_SETTING_KEY, value: parsed }),
          });
        }
        if (legacyMode) {
          await apiFetch("/user-settings/trading-mode", {
            method: "PUT",
            body: JSON.stringify({ key: "trading-mode", value: legacyMode }),
          });
        }
      } catch (error) {
        console.error("Failed to migrate backtest settings:", error);
      } finally {
        window.localStorage.removeItem("priorsystems:backtest-form");
        window.localStorage.removeItem("priorsystems:strategy-param-presets");
        window.localStorage.removeItem("priorsystems:trading-mode");
        window.localStorage.removeItem("priorsystems:history");
      }
    };

    if (legacyForm || legacyPresets || legacyMode) {
      migrate();
    }
  }, [authLoading, FORM_SETTING_KEY, PRESET_SETTING_KEY]);

  const [strategyCode, setStrategyCode] = useState(DEFAULT_STRATEGY);
  const [symbol, setSymbol] = useState("AAPL");
  const [csvPath, setCsvPath] = useState("");
  const [initialCash, setInitialCash] = useState(100000);
  const [maxBars, setMaxBars] = useState<number | undefined>(undefined);
  const [startBar, setStartBar] = useState<number | undefined>(undefined);
  const [commission, setCommission] = useState(0);
  const [slippageBps, setSlippageBps] = useState(0);
  const [quantity, setQuantity] = useState<number | ''>(0);
  const [initialCashInput, setInitialCashInput] = useState("100000");
  const [commissionInput, setCommissionInput] = useState("0");
  const [slippageInput, setSlippageInput] = useState("0");
  const [portfolioEquity, setPortfolioEquity] = useState<number | null>(null);
  const [usingPortfolio, setUsingPortfolio] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [lockedDatasetName, setLockedDatasetName] = useState<string | null>(null);
  const [lockedDataset, setLockedDataset] = useState<DatasetInfo | null>(null);
  const [datasetLoading, setDatasetLoading] = useState(true);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [datasetPrice, setDatasetPrice] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [serverRuns, setServerRuns] = useState<ServerRunSummary[]>([]);
  const [serverRunsLoading, setServerRunsLoading] = useState(false);
  const [serverRunsError, setServerRunsError] = useState<string | null>(null);
  const [serverRunLoadingId, setServerRunLoadingId] = useState<string | null>(null);
  const [serverRunError, setServerRunError] = useState<string | null>(null);
  const [tradingMode, setTradingMode] = useState<"mechanical" | "manual">("manual");
  const [mode, setMode] = useState<"custom" | "builtin">("builtin");
  const [builtinId, setBuiltinId] = useState<string | null>(null);
  const [builtinParams, setBuiltinParams] = useState<NumericParams>({});
  const [builtinList, setBuiltinList] = useState<BuiltinStrategy[]>([]);
  const [builtinParamInputs, setBuiltinParamInputs] = useState<Record<string, string>>({});
  const [configCollapsed, setConfigCollapsed] = useState(false);
  const [layoutAnimating, setLayoutAnimating] = useState(false);
  const [activeProfile, setActiveProfile] = useState<DataSetProfile | null>(null);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [showDatasetInfo, setShowDatasetInfo] = useState(false);
  const [showMechanicalGuide, setShowMechanicalGuide] = useState(true);
  const [showManualGuide, setShowManualGuide] = useState(true);
  const [priceChartType, setPriceChartType] = useState<CandleChartType>('candlestick');
  const [priceCrosshairData, setPriceCrosshairData] = useState<CrosshairData | null>(null);
  const [priceChartResetKey, setPriceChartResetKey] = useState(0);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("trend");
  const [priceAnnotations, setPriceAnnotations] = useState<ChartAnnotation[]>([]);
  const [previewTimestamps, setPreviewTimestamps] = useState<number[]>([]);
  const [previewPrices, setPreviewPrices] = useState<number[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setLayoutAnimating(true);
    const timeout = window.setTimeout(() => setLayoutAnimating(false), 250);
    return () => window.clearTimeout(timeout);
  }, [configCollapsed]);

  const buildBuiltinParamInputs = useCallback((params: NumericParams, strategy?: BuiltinStrategy | null) => {
    const inputs: Record<string, string> = {};
    if (strategy) {
      strategy.params.forEach((p) => {
        const value = params?.[p.name];
        if (typeof value === "number" && !Number.isNaN(value)) {
          inputs[p.name] = String(value);
        } else {
          inputs[p.name] = String(p.default);
        }
      });
    } else {
      Object.entries(params ?? {}).forEach(([key, value]) => {
        if (typeof value === "number" && !Number.isNaN(value)) {
          inputs[key] = String(value);
        }
      });
    }
    return inputs;
  }, []);

  const applyBuiltinParamState = useCallback(
    (params: NumericParams, strategy?: BuiltinStrategy | null) => {
      setBuiltinParams(params);
      setBuiltinParamInputs(buildBuiltinParamInputs(params, strategy));
    },
    [buildBuiltinParamInputs],
  );

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
  const [showMoreMetrics, setShowMoreMetrics] = useState(false);
  const [showTradingParams, setShowTradingParams] = useState(true);

  useEffect(() => {
    setInitialCashInput(String(initialCash));
  }, [initialCash]);

  useEffect(() => {
    setCommissionInput(String(commission));
  }, [commission]);

  useEffect(() => {
    setSlippageInput(String(slippageBps));
  }, [slippageBps]);

  const triggerChartAnimation = useCallback(() => {
    setChartAnimationKey((key) => key + 1);
  }, []);
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

  const chartIntroClass = ""; // Disabled for performance
  const chartInstanceKey = activeRunId ?? "baseline";

  useEffect(() => {
    let cancelled = false;
    const loadSelection = async () => {
      try {
        const [datasetRes, profileRes, profilesRes] = await Promise.all([
          apiFetch("/user-settings/selected-dataset"),
          apiFetch("/user-settings/active-profile-id"),
          apiFetch("/dataset-profiles"),
        ]);
        const datasetData = await datasetRes.json();
        const profileData = await profileRes.json();
        const profilesData = await profilesRes.json();
        if (cancelled) return;
        const selectedDataset = datasetData?.value as string | null;
        const activeProfileId =
          typeof profileData?.value === "number" ? (profileData.value as number) : null;
        if (activeProfileId && Array.isArray(profilesData?.profiles)) {
          const profile = profilesData.profiles.find((item: DataSetProfile) => item.id === activeProfileId);
          if (profile) {
            setActiveProfile(profile);
            setLockedDatasetName(profile.datasetName);
            setStartBar(profile.startIndex);
            const rangeBars = profile.endIndex - profile.startIndex + 1;
            if (Number.isFinite(rangeBars) && rangeBars > 0) {
              setMaxBars(rangeBars);
            }
            if (typeof profile.initialEquity === "number" && Number.isFinite(profile.initialEquity)) {
              setInitialCash(profile.initialEquity);
            }
            return;
          }
        }
        if (selectedDataset) {
          setLockedDatasetName(selectedDataset);
          return;
        }
        setDatasetLoading(false);
        setDatasetError("Select a dataset first.");
      } catch {
        if (cancelled) return;
        setDatasetLoading(false);
        setDatasetError("Select a dataset first.");
      }
    };
    loadSelection();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load and persist trading mode
  useEffect(() => {
    apiFetch("/user-settings/trading-mode")
      .then((res) => res.json())
      .then((data) => {
        const value = data.value;
        if (value === "manual" || value === "mechanical") {
          setTradingMode(value);
        } else {
          // Default to manual (Fundamental) if no saved preference
          setTradingMode("manual");
        }
      })
      .catch(() => {
        // Default to manual (Fundamental) on error
        setTradingMode("manual");
      });
  }, []);

  useEffect(() => {
    apiFetch("/user-settings/trading-mode", {
      method: "PUT",
      body: JSON.stringify({ key: "trading-mode", value: tradingMode }),
    }).catch(() => undefined);
  }, [tradingMode]);

  useEffect(() => {
    if (!lockedDatasetName) return;
    let cancelled = false;
    const fetchDatasetInfo = async () => {
      setDatasetLoading(true);
      setDatasetError(null);
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const res = await apiFetch("/datasets");
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to fetch datasets");
        }
        const json = (await res.json()) as { datasets: DatasetInfo[] };
        const match = json.datasets?.find((d) => d.name === lockedDatasetName);
        if (!match) {
          throw new Error(`Dataset "${lockedDatasetName}" not found. Select another dataset.`);
        }
        if (cancelled) return;
        setLockedDataset(match);
        setCsvPath(match.path);
        // Always update symbol to match the loaded dataset
        const derivedSymbol = deriveSymbolFromName(match.name);
        if (derivedSymbol) {
          setSymbol(derivedSymbol);
        }

        // Fetch first price + preview series from dataset
        try {
          const sampleTarget = match.rows && match.rows <= 2000 ? -1 : 2000;
          const previewRes = await apiFetch(
            `/dataset-preview?name=${encodeURIComponent(match.name)}&limit=1&sample=${sampleTarget}`,
          );
          if (previewRes.ok) {
            const previewData = await previewRes.json();
            if (previewData.head && previewData.head.length > 0) {
              const firstRow = previewData.head[0];
              const price = firstRow.close || firstRow.Close || null;
              if (price && !cancelled) {
                setDatasetPrice(typeof price === 'number' ? price : Number(price));
              }
            }

            const series = Array.isArray(previewData.series) ? previewData.series : [];
            const nextTimestamps: number[] = [];
            const nextPrices: number[] = [];
            series.forEach((point: { timestamp: number; close: number }) => {
              if (!Number.isFinite(point?.timestamp) || !Number.isFinite(point?.close)) return;
              nextTimestamps.push(Number(point.timestamp));
              nextPrices.push(Number(point.close));
            });
            if (!cancelled) {
              setPreviewTimestamps(nextTimestamps);
              setPreviewPrices(nextPrices);
            }
          }
        } catch (priceErr) {
          if (!cancelled) {
            setPreviewError("Failed to load price preview.");
          }
          console.warn("Failed to fetch dataset price preview:", priceErr);
        } finally {
          if (!cancelled) setPreviewLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load selected dataset";
        setDatasetError(message);
        setLockedDataset(null);
      } finally {
        if (!cancelled) {
          setDatasetLoading(false);
          setPreviewLoading(false);
        }
      }
    };
    fetchDatasetInfo();
    return () => {
      cancelled = true;
    };
  }, [lockedDatasetName]);

  const loadPortfolioEquity = useCallback(async () => {
    try {
      const [activeRes, portfoliosRes] = await Promise.all([
        apiFetch("/user-settings/active-portfolio-id"),
        apiFetch("/portfolios?context=builder"),
      ]);
      const activeSetting = await activeRes.json();
      const portfolioData = await portfoliosRes.json();
      const portfolios = portfolioData.portfolios || [];
      const activeId = typeof activeSetting.value === "number" ? activeSetting.value : null;
      const portfolio =
        (activeId ? portfolios.find((p: any) => p.id === activeId) : null) ||
        portfolios[0];

      if (!portfolio) {
        const confirmNav = confirm("No portfolio found. Would you like to create one now?");
        if (confirmNav) {
          router.push("/portfolio");
        }
        return;
      }

      const holdings = portfolio.holdings || [];
      const cash = portfolio.cash || 0;
      const totalHoldingsValue = holdings.reduce((sum: number, holding: any) => {
        return sum + (holding.currentValue || holding.shares * holding.avgCost);
      }, 0);
      const totalEquity = cash + totalHoldingsValue;

      setPortfolioEquity(totalEquity);
      setInitialCash(totalEquity);
      setInitialCashInput(totalEquity.toFixed(2));
      setUsingPortfolio(true);
    } catch (err) {
      setError("Failed to load portfolio equity");
      setTimeout(() => setError(null), 3000);
    }
  }, [router]);

  // Auto-load portfolio equity if mode=portfolio
  useEffect(() => {
    const mode = searchParams.get('mode');
    if (mode === 'portfolio') {
      loadPortfolioEquity();
    }
  }, [searchParams, loadPortfolioEquity]);

  const applyFormSnapshot = useCallback(
    (form?: DiagnosticsInfo["form"]) => {
      if (!form) return;
      if (form.symbol) setSymbol(form.symbol);
      if (form.csv_path) setCsvPath(form.csv_path);
      if (typeof form.initial_cash === "number") setInitialCash(form.initial_cash);
      if (typeof form.start_bar === "number" || form.start_bar === null) {
        setStartBar(form.start_bar ?? undefined);
      }
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
          const params = form.builtin_params as NumericParams;
          const strategy =
            builtinList.find((b) => b.id === (form.builtin_id ?? "")) ?? null;
          applyBuiltinParamState(params, strategy);
        } else {
          applyBuiltinParamState({});
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
    },
    [applyBuiltinParamState, builtinList],
  );

  // hydrate from user settings
  useEffect(() => {
    const loadForm = async () => {
      try {
        const res = await apiFetch(`/user-settings/${FORM_SETTING_KEY}`);
        if (!res.ok) return;
        const data = await res.json();
        const saved = data.value;
        if (!saved || typeof saved !== "object") return;

        const hasProfileEquity =
          typeof activeProfile?.initialEquity === "number" && Number.isFinite(activeProfile?.initialEquity);

        if (saved.symbol) setSymbol(saved.symbol);
        // Don't restore saved csvPath if a dataset was just selected from data-selection page
        // The lockedDatasetName takes priority over saved form state
        // csvPath will be set by the lockedDataset useEffect when the dataset loads
        if (typeof saved.initialCash === "number" && !hasProfileEquity) {
          setInitialCash(saved.initialCash);
        }
        // Don't restore maxBars/startBar from saved form if activeProfile is set
        // The profile's startIndex/endIndex take priority
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
        if (saved.mode === "builtin" && saved.builtinParams && typeof saved.builtinParams === "object") {
          applyBuiltinParamState(saved.builtinParams as NumericParams);
        } else {
          applyBuiltinParamState({});
        }
      } catch (e) {
        console.warn("Failed to load saved config", e);
      }
    };
    loadForm();
  }, [applyBuiltinParamState, activeProfile, FORM_SETTING_KEY]);

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
      apiFetch(`/user-settings/${PRESET_SETTING_KEY}`, {
        method: "PUT",
        body: JSON.stringify({ key: PRESET_SETTING_KEY, value: presets }),
      }).catch(() => undefined);
    },
    [PRESET_SETTING_KEY],
  );

  useEffect(() => {
    const loadPresets = async () => {
      try {
        const res = await apiFetch(`/user-settings/${PRESET_SETTING_KEY}`);
        if (!res.ok) return;
        const data = await res.json();
        const parsed = data.value;
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
    };
    loadPresets();
  }, [PRESET_SETTING_KEY]);

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

  // history is kept in-memory; server runs are available via /runs

  // load built-in strategies
  useEffect(() => {
    const fetchBuiltins = async () => {
      try {
        const res = await apiFetch("/strategies");
        if (!res.ok) return;
        const json = (await res.json()) as { strategies: BuiltinStrategy[] };
        setBuiltinList(json.strategies || []);
        if (!builtinId && json.strategies?.length) {
          setBuiltinId(json.strategies[0].id);
          const defaults: NumericParams = {};
          json.strategies[0].params.forEach((p) => (defaults[p.name] = p.default));
          applyBuiltinParamState(defaults, json.strategies[0]);
        }
      } catch (e) {
        console.warn("Builtin fetch failed", e);
      }
    };
    fetchBuiltins();
  }, [applyBuiltinParamState, builtinId]);

  const fetchServerRuns = useCallback(async () => {
    setServerRunsLoading(true);
    setServerRunsError(null);
    try {
      const res = await apiFetch("/runs");
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
  }, []);

  useEffect(() => {
    fetchServerRuns();
  }, [fetchServerRuns]);

  useEffect(() => {
    if (!builtinId) {
      setBuiltinParamInputs({});
      return;
    }
    const strategy = builtinList.find((b) => b.id === builtinId);
    if (!strategy) return;
    setBuiltinParamInputs((prev) => {
      const next = { ...prev };
      let changed = false;
      const allowed = new Set<string>();
      strategy.params.forEach((p) => {
        allowed.add(p.name);
        if (!(p.name in next)) {
          const numeric = builtinParams[p.name];
          next[p.name] =
            typeof numeric === "number" && !Number.isNaN(numeric)
              ? String(numeric)
              : String(p.default);
          changed = true;
        }
      });
      Object.keys(next).forEach((key) => {
        if (!allowed.has(key)) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [builtinId, builtinList, builtinParams]);

  const handleLoadServerRun = useCallback(
    async (runId: string) => {
      if (!runId) return;
      setServerRunLoadingId(runId);
      setServerRunError(null);
      try {
        const res = await apiFetch(`/runs/${runId}`);
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
    [applyFormSnapshot, setDetailTab],
  );

  const handleBuiltinParamChange = (param: BuiltinParam, rawValue: string) => {
    if (!numericInputRegex.test(rawValue) && !isIntermediateNumeric(rawValue)) {
      return;
    }
    setBuiltinParamInputs((prev) => ({ ...prev, [param.name]: rawValue }));
    if (isIntermediateNumeric(rawValue)) {
      return;
    }
    let value = param.type === "int" ? parseInt(rawValue, 10) : parseFloat(rawValue);
    if (Number.isNaN(value)) {
      return;
    }
    if (param.min != null) value = Math.max(param.min, value);
    if (param.max != null) value = Math.min(param.max, value);
    setBuiltinParams((prev) => ({ ...prev, [param.name]: value }));
  };

  const handleBuiltinParamBlur = (param: BuiltinParam) => {
    setBuiltinParamInputs((prev) => {
      const current = prev[param.name];
      if (current && !isIntermediateNumeric(current)) {
        return prev;
      }
      const fallbackValue = (() => {
        const stored = builtinParams[param.name];
        if (typeof stored === "number" && !Number.isNaN(stored)) {
          return stored;
        }
        return param.default;
      })();
      return { ...prev, [param.name]: String(fallbackValue) };
    });
    setBuiltinParams((prev) => {
      const stored = prev[param.name];
      if (typeof stored === "number" && !Number.isNaN(stored)) {
        return prev;
      }
      return { ...prev, [param.name]: param.default };
    });
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

  // persist form inputs
  useEffect(() => {
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
      apiFetch(`/user-settings/${FORM_SETTING_KEY}`, {
        method: "PUT",
        body: JSON.stringify({ key: FORM_SETTING_KEY, value: payload }),
      }).catch((err) => {
        console.warn("Failed to persist form state", err);
      });
    }, 1000);
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
    FORM_SETTING_KEY,
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
      const res = await apiFetch("/lint-strategy", {
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
  }, [mode, strategyCode]);

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

    if (!csvPath) {
      setError("Select a dataset on the data selection page before running a backtest.");
      setLoading(false);
      return;
    }

    // Validate that quantity doesn't exceed available cash for mechanical mode
    if (mode === "builtin" && datasetPrice !== null) {
      const effectiveQuantity = typeof quantity === 'number' ? quantity : 1;
      const positionCost = effectiveQuantity * datasetPrice;
      if (positionCost > initialCash) {
        setError(`Insufficient funds! Position cost ($${positionCost.toFixed(2)}) exceeds initial cash ($${initialCash.toFixed(2)}). Maximum shares: ${Math.floor(initialCash / datasetPrice)}`);
        setLoading(false);
        return;
      }
    }

    try {
      const body =
        mode === "builtin"
          ? {
              builtin_strategy_id: builtinId,
              builtin_params: { ...builtinParams, qty: typeof quantity === 'number' ? quantity : 1 },
              strategy_code: null,
              strategy_class_name: "",
              csv_path: csvPath,
              symbol,
              initial_cash: initialCash,
              commission_per_trade: commission,
              slippage_bps: slippageBps,
              start_bar: startBar ?? null,
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
              start_bar: startBar ?? null,
              max_bars: maxBars ?? null,
              strategy_params: strategyParamsError ? null : strategyParamsObject,
            };

      const res = await apiFetch("/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const json = (await res.json()) as BacktestResponse;

      // Debug: Log actual timestamp range
      if (json.timestamps && json.timestamps.length > 0) {
        const firstTs = json.timestamps[0];
        const lastTs = json.timestamps[json.timestamps.length - 1];
        console.log('[Backtest] Timestamp range:', {
          first: new Date(firstTs).toISOString(),
          last: new Date(lastTs).toISOString(),
          numBars: json.timestamps.length,
          requestedStartBar: startBar,
          requestedMaxBars: maxBars
        });
      }

      setResult(json);
      const entry: HistoryEntry = {
        savedAt: new Date().toISOString(),
        result: json,
        form: {
          symbol,
          csvPath,
          initialCash,
          startBar: startBar ?? null,
          maxBars: maxBars ?? null,
          commission,
          slippageBps,
          mode,
          builtinId: builtinId ?? undefined,
          builtinParams,
          strategyParamsRaw,
        },
      };
      const nextHistory = [entry, ...history].slice(0, 5);
      setHistory(nextHistory);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Backtest failed";
      setError(message);
    } finally {
      setLoading(false);
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
  const timelineWindow = useMemo(
    () => (totalBars ? timeline.slice(windowStart, windowEnd) : []),
    [timeline, totalBars, windowStart, windowEnd],
  );
  const timelineForWindow = useMemo(
    () => (timelineWindow.length ? timelineWindow : timeline),
    [timelineWindow, timeline],
  );
  const windowRange: [number | null, number | null] = timelineForWindow.length
    ? [timelineForWindow[0], timelineForWindow[timelineForWindow.length - 1]]
    : [null, null];

  const drawdownSeries = result?.stats.drawdown_curve || [];
  const priceSeriesWindow = useMemo(
    () => (totalBars ? priceSeries.slice(windowStart, windowEnd) : priceSeries),
    [priceSeries, totalBars, windowStart, windowEnd],
  );
  const equityWindow = useMemo(
    () => (totalBars ? equityCurve.slice(windowStart, windowEnd) : equityCurve),
    [equityCurve, totalBars, windowStart, windowEnd],
  );
  const drawdownWindow = useMemo(
    () => (totalBars ? drawdownSeries.slice(windowStart, windowEnd) : drawdownSeries),
    [drawdownSeries, totalBars, windowStart, windowEnd],
  );

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

  const makeMarkers = (series: number[], useTradePrice: boolean): MarkerPoint[] => {
    const markers: MarkerPoint[] = [];
    for (let idx = 0; idx < tradesForMarkers.length; idx++) {
      const t = tradesForMarkers[idx];
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
        continue;
      }
      markers.push({
        x: tsNum ?? computeXValue(resolvedIdx),
        y: yValue,
        meta: {
          trade: t,
          timestamp: tsNum,
        },
      });
    }
    return markers;
  };

  const tradeMarkersPrice = makeMarkers(priceSeries, true);
  const tradeMarkersEquity = makeMarkers(equityCurve, false);
  const limitMarkersToWindow = (markers: MarkerPoint[]) => {
    const [minX, maxX] = windowRange;
    if (minX == null || maxX == null) return markers;
    return markers.filter((m) => m.x != null && m.x >= minX && m.x <= maxX);
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
      duration: 0, // Disable animations for better performance
    },
    transitions: {
      zoom: {
        animation: {
          duration: 150,
          easing: "easeOutCubic",
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        filter: (tooltipItem) => {
          // Only show one trade tooltip, not both equity and price markers
          const dataset = tooltipItem.dataset as { isTrade?: boolean };
          if (dataset?.isTrade) {
            // Only show trade tooltip from the first dataset (equity chart)
            return tooltipItem.datasetIndex === 1;
          }
          return true;
        },
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
                hour: "MMM d, yyyy HH:mm",
                day: "MMM d, yyyy",
                week: "MMM d, yyyy",
                month: "MMM yyyy",
                year: "yyyy",
              },
            }
          : undefined,
        ticks: useTimeScale
          ? {
              color: "#94a3b8",
              maxRotation: 0,
              callback: function(value: any) {
                const date = new Date(value);
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
              },
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

  // Cumulative P&L Chart Options
  const cumulativePnLOptions: LineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: "index",
        intersect: false,
        backgroundColor: "rgba(0,0,0,0.9)",
        titleColor: "#fff",
        bodyColor: "#fff",
        borderColor: "#8b5cf6",
        borderWidth: 1,
        callbacks: {
          label: (ctx) => {
            const y = ctx.parsed.y;
            return `P&L: $${y !== null ? y.toFixed(2) : '0.00'}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "#9ca3af", maxTicksLimit: 10 },
      },
      y: {
        grid: { color: "rgba(255,255,255,0.05)" },
        ticks: {
          color: "#9ca3af",
          callback: (value) => `$${value}`,
        },
      },
    },
  };

  // Trade Distribution Histogram Options
  const histogramOptions: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: "index",
        intersect: false,
        backgroundColor: "rgba(0,0,0,0.9)",
        titleColor: "#fff",
        bodyColor: "#fff",
        borderColor: "#8b5cf6",
        borderWidth: 1,
        callbacks: {
          title: (items) => items[0]?.label || "",
          label: (ctx) => `Count: ${ctx.parsed.y} trades`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: "#9ca3af",
          maxRotation: 45,
          minRotation: 45,
          font: { size: 10 },
        },
      },
      y: {
        grid: { color: "rgba(255,255,255,0.05)" },
        ticks: {
          color: "#9ca3af",
          stepSize: 1,
        },
        title: {
          display: true,
          text: "Trade Count",
          color: "#9ca3af",
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
              borderColor: "#10b981",
              fill: true,
              backgroundColor: (ctx) => gradientFill(ctx, "rgba(16,185,129,0.2)", "rgba(16,185,129,0.02)"),
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
              pointRadius: 5,
              pointHoverRadius: 7,
              pointHitRadius: 16,
              pointStyle: visibleTradeMarkersEquity.map((m) =>
                m.meta?.trade?.side?.toLowerCase() === "buy" ? "line" : "line"
              ),
              pointBackgroundColor: visibleTradeMarkersEquity.map((m) =>
                m.meta?.trade?.side?.toLowerCase() === "buy" ? "#10b981" : "#ef4444",
              ),
              pointBorderColor: visibleTradeMarkersEquity.map((m) =>
                m.meta?.trade?.side?.toLowerCase() === "buy" ? "#10b981" : "#ef4444",
              ),
              pointBorderWidth: 3,
              pointRotation: visibleTradeMarkersEquity.map((m) =>
                m.meta?.trade?.side?.toLowerCase() === "buy" ? 90 : 90
              ),
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
              borderColor: "#60a5fa",
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
              pointRadius: 5,
              pointHoverRadius: 7,
              pointHitRadius: 16,
              pointStyle: visibleTradeMarkersPrice.map((m) =>
                m.meta?.trade?.side?.toLowerCase() === "buy" ? "line" : "line"
              ),
              pointBackgroundColor: visibleTradeMarkersPrice.map((m) =>
                m.meta?.trade?.side?.toLowerCase() === "buy" ? "#10b981" : "#ef4444",
              ),
              pointBorderColor: visibleTradeMarkersPrice.map((m) =>
                m.meta?.trade?.side?.toLowerCase() === "buy" ? "#10b981" : "#ef4444",
              ),
              pointBorderWidth: 3,
              pointRotation: visibleTradeMarkersPrice.map((m) =>
                m.meta?.trade?.side?.toLowerCase() === "buy" ? 90 : 90
              ),
              borderWidth: 0,
              order: 0,
              showLine: false,
            },
          ],
        }
      : null;

  // Convert price data to OHLC format for candlestick chart
  const priceOHLCData: OHLCData[] = useMemo(() => {
    if (priceSeriesWindow.length && timelineForWindow.length) {
      return convertPricesToOHLCWithVariation(
        timelineForWindow.map(t => typeof t === 'number' ? t : Date.parse(t as string)),
        priceSeriesWindow,
        0.3 // 0.3% volatility for realistic candlesticks
      );
    }
    return [];
  }, [priceSeriesWindow, timelineForWindow]);

  // Generate volume data for candlestick chart
  const priceVolumeData: VolumeData[] = useMemo(() => {
    if (priceSeriesWindow.length && timelineForWindow.length) {
      return generateVolumeData(
        timelineForWindow.map(t => typeof t === 'number' ? t : Date.parse(t as string)),
        priceSeriesWindow,
        100000 // base volume
      );
    }
    return [];
  }, [priceSeriesWindow, timelineForWindow]);

  // Convert trade markers to candlestick chart format
  const priceTradeMarkers: TradeMarker[] = useMemo(() => {
    return visibleTradeMarkersPrice.map((m: any) => ({
      time: (typeof m.x === 'number' ? m.x / 1000 : Math.floor(Date.parse(m.x as string) / 1000)) as any,
      position: m.meta?.trade?.side?.toLowerCase() === 'buy' ? 'belowBar' as const : 'aboveBar' as const,
      color: m.meta?.trade?.side?.toLowerCase() === 'buy' ? '#10b981' : '#ef4444',
      shape: 'arrowUp' as const,
      text: m.meta?.trade?.side?.toLowerCase() === 'buy' ? 'B' : 'S',
    }));
  }, [visibleTradeMarkersPrice]);

  const previewWindow = useMemo(() => {
    if (!previewTimestamps.length || !previewPrices.length) {
      return { timestamps: [] as number[], prices: [] as number[] };
    }
    if (activeProfile && previewTimestamps.length > activeProfile.endIndex) {
      const start = Math.max(0, activeProfile.startIndex);
      const end = Math.min(previewTimestamps.length, activeProfile.endIndex + 1);
      return {
        timestamps: previewTimestamps.slice(start, end),
        prices: previewPrices.slice(start, end),
      };
    }
    return { timestamps: previewTimestamps, prices: previewPrices };
  }, [previewPrices, previewTimestamps, activeProfile]);

  const previewOHLCData: OHLCData[] = useMemo(() => {
    if (!previewWindow.timestamps.length || !previewWindow.prices.length) return [];
    return convertPricesToOHLCWithVariation(previewWindow.timestamps, previewWindow.prices, 0.3);
  }, [previewWindow]);

  const previewVolumeData: VolumeData[] = useMemo(() => {
    if (!previewWindow.timestamps.length || !previewWindow.prices.length) return [];
    return generateVolumeData(previewWindow.timestamps, previewWindow.prices, 100000);
  }, [previewWindow]);

  const combinedPriceMarkers = useMemo(() => {
    return [...priceTradeMarkers].sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      if (a.position === b.position) return 0;
      return a.position === "belowBar" ? -1 : 1;
    });
  }, [priceTradeMarkers]);

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

  // Cumulative P&L Chart Data
  const cumulativePnLData: MixedLineData | null = useMemo(() => {
    if (!result || !result.trades || result.trades.length === 0) return null;

    const tradesWithPnL = result.trades.filter(t => t.realized_pnl !== undefined && t.realized_pnl !== null);
    if (tradesWithPnL.length === 0) return null;

    let cumulativePnL = 0;
    const points = tradesWithPnL.map((trade, idx) => {
      cumulativePnL += trade.realized_pnl || 0;
      return {
        x: idx,
        y: cumulativePnL,
      };
    });

    return {
      labels: tradesWithPnL.map((_, idx) => `Trade ${idx + 1}`),
      datasets: [
        {
          label: "Cumulative P&L ($)",
          data: points,
          parsing: false,
          borderWidth: 2,
          borderColor: "#8b5cf6",
          fill: true,
          backgroundColor: (ctx) => gradientFill(ctx, "rgba(139,92,246,0.25)", "rgba(139,92,246,0.05)"),
          tension: 0.1,
          pointRadius: 0,
          pointHitRadius: 6,
        },
      ],
    };
  }, [result]);

  // Trade Distribution Histogram Data
  const tradeDistributionData = useMemo(() => {
    if (!result || !result.trades || result.trades.length === 0) return null;

    const tradesWithPnL = result.trades.filter(t => t.realized_pnl !== undefined && t.realized_pnl !== null);
    if (tradesWithPnL.length === 0) return null;

    // Create histogram bins
    const pnlValues = tradesWithPnL.map(t => t.realized_pnl || 0);
    const minPnL = Math.min(...pnlValues);
    const maxPnL = Math.max(...pnlValues);
    const binCount = Math.min(20, Math.ceil(Math.sqrt(pnlValues.length)));
    const binSize = (maxPnL - minPnL) / binCount;

    const bins: number[] = new Array(binCount).fill(0);
    const binLabels: string[] = [];

    for (let i = 0; i < binCount; i++) {
      const binStart = minPnL + i * binSize;
      const binEnd = binStart + binSize;
      binLabels.push(`$${binStart.toFixed(0)} to $${binEnd.toFixed(0)}`);

      pnlValues.forEach(pnl => {
        if (i === binCount - 1) {
          if (pnl >= binStart && pnl <= binEnd) bins[i]++;
        } else {
          if (pnl >= binStart && pnl < binEnd) bins[i]++;
        }
      });
    }

    return {
      labels: binLabels,
      datasets: [
        {
          label: "Trade Count",
          data: bins,
          backgroundColor: bins.map((_, idx) => {
            const binMidpoint = minPnL + (idx + 0.5) * binSize;
            return binMidpoint >= 0 ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.7)";
          }),
          borderColor: bins.map((_, idx) => {
            const binMidpoint = minPnL + (idx + 0.5) * binSize;
            return binMidpoint >= 0 ? "rgba(34,197,94,1)" : "rgba(239,68,68,1)";
          }),
          borderWidth: 1,
        },
      ],
    };
  }, [result]);

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

  const portfolioMode = searchParams.get("mode") === "portfolio";
  if (authLoading) {
    return null;
  }
  if (portfolioMode) {
    return <PortfolioMode />;
  }

  const equityChartHeight = configCollapsed ? "h-[480px]" : "h-[420px]";
  const priceChartHeight = configCollapsed ? 640 : 560;
  const previewChartHeight = configCollapsed ? 820 : 780;

  return (
    <>
      <main className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100">
        <div className="mx-auto max-w-[1920px] px-4 py-3 lg:px-8">
          {/* Compact Top Navigation with Mode Toggle */}
          <header className="mb-4 rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-2.5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link
                  href="/data-selection"
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  ← Back
                </Link>
                <div className="h-6 w-px bg-gray-700"></div>
                <img src="/logo-white-full.svg" alt="Prior Systems" className="h-7 w-auto" />
                <div className="h-6 w-px bg-gray-700"></div>
                <h1 className="text-lg font-bold tracking-tight text-gray-50">Backtest Console</h1>
              </div>

              <div className="flex items-center gap-4">
                {/* Trading Mode Toggle - Inline with Header */}
                <div className="inline-flex rounded-lg border border-gray-800 bg-gray-900/60 p-0.5">
                  <button
                    onClick={() => setTradingMode("mechanical")}
                    className={`rounded-md px-4 py-1.5 text-xs font-semibold transition ${
                      tradingMode === "mechanical"
                        ? "bg-white text-black"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Mechanical
                  </button>
                  <button
                    onClick={() => setTradingMode("manual")}
                    className={`rounded-md px-4 py-1.5 text-xs font-semibold transition ${
                      tradingMode === "manual"
                        ? "bg-white text-black"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Fundamental
                  </button>
                </div>
                {user && <UserDisplay email={user.email} />}
              </div>
            </div>
          </header>

          {/* Manual Mode */}
          {tradingMode === "manual" && lockedDataset && (
            <ManualMode
              datasetPath={csvPath}
              datasetName={lockedDataset.name}
              symbol={symbol}
              apiBase={API_BASE}
              startBar={startBar}
              maxBars={maxBars}
              initialCashOverride={usingPortfolio ? portfolioEquity ?? undefined : initialCash}
              showGuide={showManualGuide}
              setShowGuide={setShowManualGuide}
            />
          )}

          {/* Mechanical Mode - Main Layout: Sidebar + Content */}
          {tradingMode === "mechanical" && (
          <>
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => setConfigCollapsed((prev) => !prev)}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-white hover:text-white"
            >
              {configCollapsed ? "Show Configuration" : "Hide Configuration"}
            </button>
          </div>
          <div className="relative lg:flex lg:items-start lg:gap-6">
            {/* LEFT SIDEBAR - Configuration */}
            <div
              className={`${
                configCollapsed ? "max-h-0 overflow-hidden opacity-0" : "max-h-[4000px] opacity-100"
              } transition-all duration-200 lg:max-h-none lg:overflow-visible lg:flex-shrink-0 lg:transition-[width,opacity] lg:duration-200 ${
                configCollapsed
                  ? "lg:w-0 lg:opacity-0 lg:pointer-events-none"
                  : "lg:w-[360px] lg:opacity-100 lg:pointer-events-auto"
              }`}
            >
              <form
                onSubmit={handleSubmit}
                className={`space-y-3 ${
                  configCollapsed ? "lg:pr-0" : "lg:pr-4"
                }`}
              >
                {/* How to Use Mechanical Mode Guide - Moved to Top */}
                {showMechanicalGuide && (
                  <div className="rounded-xl border border-blue-800 bg-blue-950/30 p-3">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="text-xs font-bold text-blue-300">How to Use Mechanical Mode</h3>
                      <button
                        type="button"
                        onClick={() => setShowMechanicalGuide(false)}
                        className="text-blue-400 hover:text-white transition text-base leading-none"
                        title="Dismiss guide"
                      >
                        ✕
                      </button>
                    </div>
                    <ol className="space-y-1 text-[10px] text-blue-200 leading-relaxed">
                      <li><span className="font-semibold">1.</span> Select dataset → Choose strategy → Configure parameters</li>
                      <li><span className="font-semibold">2.</span> Set trading parameters (quantity, commission, slippage)</li>
                      <li><span className="font-semibold">3.</span> Click "Run Backtest" and review results below</li>
                    </ol>
                  </div>
                )}

                {/* Dataset Summary */}
                <section className="rounded-xl border border-gray-800 bg-gray-900/80 p-3 shadow-xl backdrop-blur-sm overflow-hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-200">Dataset</h3>
                        {datasetLoading ? (
                          <p className="mt-1 text-xs text-gray-500">Loading selected dataset…</p>
                        ) : lockedDataset ? (
                          <p className="mt-1 text-xs text-gray-400">{lockedDataset.name}</p>
                        ) : (
                          <p className="mt-1 text-xs text-rose-400">
                            {datasetError ?? "No dataset selected. Choose one before running backtests."}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      {lockedDataset && (
                        <button
                          type="button"
                          onClick={() => setShowDatasetInfo(!showDatasetInfo)}
                          className="rounded-lg border border-gray-700 px-3 py-1.5 text-[11px] font-semibold text-gray-200 transition hover:border-white hover:text-white"
                        >
                          {showDatasetInfo ? "Hide" : "Info"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded-lg border border-gray-700 px-3 py-1.5 text-[11px] font-semibold text-gray-200 transition hover:border-white hover:text-white"
                        onClick={() => router.push("/data-selection")}
                      >
                        Change
                      </button>
                    </div>
                  </div>
                  {lockedDataset && (
                    <div
                      className={`grid transition-all duration-300 ease-in-out ${
                        showDatasetInfo
                          ? "grid-rows-[1fr] opacity-100 mt-4"
                          : "grid-rows-[0fr] opacity-0"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="space-y-2 text-xs text-gray-300">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Symbol</span>
                        <span className="font-semibold">
                          {deriveSymbolFromName(lockedDataset.name) || symbol}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Rows</span>
                        <span>{lockedDataset.rows ?? "—"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">
                          {activeProfile ? "Selected Range" : "Dataset Range"}
                        </span>
                        <span>
                          {activeProfile
                            ? `${activeProfile.startDate || formatTimestamp(activeProfile.startTimestamp)} → ${
                                activeProfile.endDate || formatTimestamp(activeProfile.endTimestamp)
                              }`
                            : `${formatTimestamp(lockedDataset.start)} → ${formatTimestamp(lockedDataset.end)}`}
                        </span>
                      </div>
                      {activeProfile && startBar !== undefined && maxBars !== undefined && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Backtest Range</span>
                          <span className="font-mono text-[11px]">
                            Bar {startBar} to {startBar + maxBars - 1} ({maxBars} bars)
                          </span>
                        </div>
                      )}
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-2 font-mono text-[11px] text-gray-400 break-all">
                        {lockedDataset.path}
                      </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {!datasetLoading && !lockedDataset && (
                    <p className="mt-3 text-[11px] text-gray-400">
                      Please choose a dataset on the data selection page to unlock the backtest console.
                    </p>
                  )}
                </section>

                {/* Trading Parameters - Collapsible */}
                <section className="relative z-10 rounded-xl border border-gray-800 bg-gray-900/80 p-3 shadow-xl backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => setShowTradingParams(!showTradingParams)}
                    className="flex w-full items-center justify-between text-xs font-semibold text-gray-200"
                  >
                    <span>Trading Parameters</span>
                    <span className="text-gray-500">{showTradingParams ? "−" : "+"}</span>
                  </button>
                  <Collapse open={showTradingParams} className="mt-3 space-y-2.5">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-400 mb-1">
                          Initial Cash
                          <InfoIcon tooltip="Starting capital for the backtest. This is the total cash available to deploy." />
                          {activeProfile && (
                            <span className="ml-2 text-[10px] text-blue-400">(Set in data-selection)</span>
                          )}
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={activeProfile !== null}
                            className={`w-full rounded-lg border px-3 py-1.5 text-sm outline-none transition ${
                              activeProfile
                                ? "border-blue-600 bg-blue-950/30 cursor-not-allowed opacity-75"
                                : usingPortfolio
                                ? "border-blue-600 bg-blue-950/30 focus:border-blue-500 focus:ring-blue-500/20 focus:ring-2"
                                : "border-gray-700 bg-gray-950 focus:border-white focus:ring-white/20 focus:ring-2"
                            }`}
                            value={initialCashInput}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (!numericInputRegex.test(val) && !isIntermediateNumeric(val)) return;
                              setInitialCashInput(val);
                              if (isIntermediateNumeric(val)) return;
                              setInitialCash(Number(val));
                              setUsingPortfolio(false);
                            }}
                            onBlur={() => {
                              if (isIntermediateNumeric(initialCashInput)) {
                                const fallback = 0;
                                setInitialCash(fallback);
                                setInitialCashInput(String(fallback));
                              }
                            }}
                          />
                          {usingPortfolio && portfolioEquity !== null && (
                            <div className="mt-1 flex items-center gap-1 text-[10px] text-blue-400">
                              <span>✓</span>
                              <span>Using portfolio equity: ${portfolioEquity.toLocaleString()}</span>
                            </div>
                          )}
                          {activeProfile && (
                            <div className="mt-1 flex items-center gap-1 text-[10px] text-blue-400">
                              <span>✓</span>
                              <span>Initial equity from profile: ${activeProfile.initialEquity.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="col-span-2">
                        <label className="mb-1 block text-xs text-gray-400">
                          Shares per Trade
                          <InfoIcon tooltip="Number of shares to buy/sell in each trade. The strategy will use this quantity for position sizing." />
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm outline-none transition focus:border-white focus:ring-2 focus:ring-white/20"
                          value={quantity}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setQuantity('');
                            } else {
                              const num = parseInt(val);
                              if (!isNaN(num)) {
                                setQuantity(num);
                              }
                            }
                          }}
                          onBlur={(e) => {
                            if (e.target.value === '' || parseInt(e.target.value) < 1) {
                              setQuantity(1);
                            }
                          }}
                        />
                        {lockedDataset && datasetPrice !== null && (
                          <>
                            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                              <div className="rounded bg-gray-800 px-2 py-1.5 border border-gray-700">
                                <div className="text-gray-500">Price/Share</div>
                                <div className="text-white font-mono mt-0.5">${datasetPrice.toFixed(2)}</div>
                              </div>
                              <div className={`rounded px-2 py-1.5 border ${
                                (datasetPrice * (typeof quantity === 'number' ? quantity : 1)) > initialCash
                                  ? 'bg-red-950/30 border-red-700'
                                  : 'bg-gray-800 border-gray-700'
                              }`}>
                                <div className="text-gray-500">Position Cost</div>
                                <div className={`font-mono mt-0.5 ${
                                  (datasetPrice * (typeof quantity === 'number' ? quantity : 1)) > initialCash ? 'text-red-400' : 'text-white'
                                }`}>${(datasetPrice * (typeof quantity === 'number' ? quantity : 1)).toFixed(2)}</div>
                              </div>
                              <div className="rounded bg-gray-800 px-2 py-1.5 border border-gray-700">
                                <div className="text-gray-500">Max Shares</div>
                                <div className="text-green-400 font-mono mt-0.5">{Math.floor(initialCash / datasetPrice)}</div>
                              </div>
                            </div>
                            {(datasetPrice * (typeof quantity === 'number' ? quantity : 1)) > initialCash && (
                              <div className="mt-2 p-2 rounded-lg bg-red-950/30 border border-red-700 text-[11px] text-red-400">
                                ⚠ Position cost exceeds available cash. Reduce quantity to {Math.floor(initialCash / datasetPrice)} or less.
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-400">
                          Start Bar
                          <InfoIcon tooltip="Bar index to start the backtest from. Set in data-selection page." />
                          {activeProfile && (
                            <span className="ml-2 text-[10px] text-blue-400">(Set in data-selection)</span>
                          )}
                        </label>
                        <input
                          type="number"
                          disabled={activeProfile !== null}
                          className={`w-full rounded-lg border px-3 py-1.5 text-sm outline-none transition ${
                            activeProfile
                              ? "border-blue-600 bg-blue-950/30 cursor-not-allowed opacity-75"
                              : "border-gray-700 bg-gray-950 focus:border-white focus:ring-2 focus:ring-white/20"
                          }`}
                          value={startBar ?? ""}
                          onChange={(e) =>
                            setStartBar(
                              e.target.value === "" ? undefined : Number(e.target.value) || undefined,
                            )
                          }
                          min="0"
                        />
                        {activeProfile && startBar !== undefined && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-blue-400">
                            <span>✓</span>
                            <span>Start bar from profile: {startBar}</span>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-400">
                          Max Bars
                          <InfoIcon tooltip="Number of bars in the selected range. Set in data-selection page." />
                          {activeProfile && (
                            <span className="ml-2 text-[10px] text-blue-400">(Set in data-selection)</span>
                          )}
                        </label>
                        <input
                          type="number"
                          disabled={activeProfile !== null}
                          className={`w-full rounded-lg border px-3 py-1.5 text-sm outline-none transition ${
                            activeProfile
                              ? "border-blue-600 bg-blue-950/30 cursor-not-allowed opacity-75"
                              : "border-gray-700 bg-gray-950 focus:border-white focus:ring-2 focus:ring-white/20"
                          }`}
                          value={maxBars ?? ""}
                          onChange={(e) =>
                            setMaxBars(
                              e.target.value === "" ? undefined : Number(e.target.value) || undefined,
                            )
                          }
                        />
                        {activeProfile && maxBars !== undefined && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-blue-400">
                            <span>✓</span>
                            <span>Range length from profile: {maxBars} bars</span>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-400">
                          Commission
                          <InfoIcon tooltip="Fixed cost per trade in dollars. Charged on both entry and exit. Examples: $0.50, $1, $5." />
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm outline-none transition focus:border-white focus:ring-2 focus:ring-white/20"
                          value={commissionInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!numericInputRegex.test(val) && !isIntermediateNumeric(val)) return;
                            setCommissionInput(val);
                            if (isIntermediateNumeric(val)) return;
                            setCommission(Number(val));
                          }}
                          onBlur={() => {
                            if (isIntermediateNumeric(commissionInput)) {
                              const fallback = 0;
                              setCommission(fallback);
                              setCommissionInput(String(fallback));
                            }
                          }}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="mb-1 block text-xs text-gray-400">
                          Slippage (bps)
                          <InfoIcon tooltip="Price slippage in basis points (1 bps = 0.01%). Simulates market impact. Example: 5 bps on a $100 stock = $0.05 per share." />
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm outline-none transition focus:border-white focus:ring-2 focus:ring-white/20"
                          value={slippageInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!numericInputRegex.test(val) && !isIntermediateNumeric(val)) return;
                            setSlippageInput(val);
                            if (isIntermediateNumeric(val)) return;
                            setSlippageBps(Number(val));
                          }}
                          onBlur={() => {
                            if (isIntermediateNumeric(slippageInput)) {
                              const fallback = 0;
                              setSlippageBps(fallback);
                              setSlippageInput(String(fallback));
                            }
                          }}
                        />
                      </div>
                    </div>
                  </Collapse>
                </section>

                {/* Strategy Selection */}
                <section className="relative z-20 rounded-xl border border-gray-800 bg-gray-900/80 p-3 shadow-xl backdrop-blur-sm">
                  <h3 className="mb-2 text-xs font-semibold text-gray-200">Strategy</h3>
                  <div className="mb-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMode("builtin")}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        mode === "builtin"
                          ? "bg-white text-black shadow-lg shadow-white/30"
                          : "border border-gray-700 text-gray-300 hover:border-gray-600"
                      }`}
                    >
                      Built-in
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("custom")}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        mode === "custom"
                          ? "bg-white text-black shadow-lg shadow-white/30"
                          : "border border-gray-700 text-gray-300 hover:border-gray-600"
                      }`}
                    >
                      Advanced
                    </button>
                  </div>

                  <Collapse open={mode === "builtin"} className="space-y-2.5">
                    <StrategySelect
                      options={builtinList}
                      value={builtinId}
                      onSelect={(id) => {
                        const chosen = builtinList.find((b) => b.id === id);
                        setBuiltinId(id);
                        if (chosen) {
                          const defaults: NumericParams = {};
                          chosen.params.forEach((p) => (defaults[p.name] = p.default));
                          applyBuiltinParamState(defaults, chosen);
                        } else {
                          applyBuiltinParamState({});
                        }
                      }}
                      disabled={!builtinList.length}
                    />
                    {builtinId && (
                      <p className="text-[11px] text-gray-500 break-words">
                        {builtinList.find((b) => b.id === builtinId)?.description}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {builtinList
                        .find((b) => b.id === builtinId)
                        ?.params.filter((p) => p.name !== 'qty')
                        .map((p) => (
                          <div key={p.name}>
                            <label className="mb-1 block text-xs text-gray-400">
                              {p.name} ({p.type})
                              {PARAM_TOOLTIPS[p.name] && <InfoIcon tooltip={PARAM_TOOLTIPS[p.name]} />}
                            </label>
                            <input
                              type="text"
                              inputMode={p.type === "int" ? "numeric" : "decimal"}
                              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm outline-none transition focus:border-white focus:ring-2 focus:ring-white/20"
                              value={builtinParamInputs[p.name] ?? String(builtinParams[p.name] ?? p.default)}
                              onChange={(e) => handleBuiltinParamChange(p, e.target.value)}
                              onBlur={() => handleBuiltinParamBlur(p)}
                            />
                          </div>
                        ))}
                    </div>
                  </Collapse>

                  <Collapse open={mode === "custom"} className="space-y-3">
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      {STRATEGY_TEMPLATES.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          className="rounded border border-gray-700 px-2 py-1 text-gray-300 transition hover:border-white"
                          onClick={() => handleTemplateInsert(template.code)}
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                    <div className="relative rounded-xl border border-gray-800 bg-gray-950 scrollbar-hide">
                      <button
                        type="button"
                        onClick={() => setEditorExpanded(!editorExpanded)}
                        className="absolute top-2 right-2 z-10 rounded bg-gray-800/80 px-2 py-1 text-[11px] text-gray-300 transition hover:bg-gray-700 hover:text-white"
                        title={editorExpanded ? "Exit fullscreen" : "Expand editor"}
                      >
                        {editorExpanded ? "✕ Exit" : "⛶ Expand"}
                      </button>
                      <CodeEditor
                        value={strategyCode}
                        height="300px"
                        extensions={[python()]}
                        theme="dark"
                        onChange={(val) => setStrategyCode(val)}
                      />
                    </div>
                    {editorExpanded && (
                      <div className="fixed inset-0 z-50 flex flex-col bg-gray-950 p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <h2 className="text-lg font-semibold text-white">Strategy Code Editor</h2>
                          <button
                            type="button"
                            onClick={() => setEditorExpanded(false)}
                            className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-gray-700 hover:text-white"
                          >
                            ✕ Close
                          </button>
                        </div>
                        <div className="flex-1 rounded-xl border border-gray-800 bg-gray-950 overflow-hidden">
                          <CodeEditor
                            value={strategyCode}
                            height="100%"
                            extensions={[python()]}
                            theme="dark"
                            onChange={(val) => setStrategyCode(val)}
                          />
                        </div>
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-gray-300">Strategy Parameters (JSON)</label>
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        {STRATEGY_PARAM_PRESETS.map((preset) => (
                          <button
                            type="button"
                            key={preset.id}
                            className="rounded border border-gray-700 px-2 py-1 text-gray-300 transition hover:border-white"
                            onClick={() => handleApplyPreset(preset)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <textarea
                        className={`w-full min-h-[100px] rounded-lg border px-3 py-2 text-xs font-mono outline-none transition focus:ring-2 ${
                          strategyParamsError
                            ? "border-rose-600 bg-rose-950/20 focus:border-rose-500 focus:ring-rose-500/20"
                            : "border-gray-700 bg-gray-950 focus:border-white focus:ring-white/20"
                        }`}
                        placeholder='{}\n// optional JSON params'
                        value={strategyParamsRaw}
                        onChange={(e) => setStrategyParamsRaw(e.target.value)}
                      />
                      {strategyParamsError && (
                        <p className="text-[11px] text-rose-400">{strategyParamsError}</p>
                      )}
                      {customParamPresets.length > 0 && (
                        <div className="flex flex-wrap gap-2 text-[11px] text-gray-300">
                          {customParamPresets.map((preset) => (
                            <div
                              key={preset.id}
                              className="inline-flex items-center gap-1 rounded-full border border-gray-700 px-2 py-1"
                            >
                              <button
                                type="button"
                                className="text-gray-200 hover:text-white"
                                onClick={() => handleApplyPreset(preset)}
                              >
                                {preset.label}
                              </button>
                              <button
                                type="button"
                                className="text-gray-500 hover:text-rose-400"
                                aria-label={`Delete preset ${preset.label}`}
                                onClick={() => handleDeletePreset(preset.id)}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs outline-none transition focus:border-white focus:ring-white/20"
                            placeholder="Preset name"
                            value={newPresetName}
                            onChange={(e) => setNewPresetName(e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={handleSavePreset}
                            className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 transition hover:border-white hover:text-white"
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
                  </Collapse>
                </section>

                {/* Run Button */}
                <button
                  type="submit"
                  disabled={
                    loading ||
                    datasetLoading ||
                    !csvPath ||
                    (mode === "builtin" && !builtinId) ||
                    (mode === "custom" && Boolean(strategyParamsError))
                  }
                  className="w-full rounded-xl bg-white py-2.5 text-sm font-bold text-black shadow-lg shadow-white/30 transition hover:bg-white disabled:opacity-50 disabled:hover:bg-white"
                >
                  {loading ? "Running Backtest..." : "Run Backtest"}
                </button>

                {error && (
                  <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-xs text-rose-400">
                    {error}
                  </div>
                )}

                {mode === "custom" && lintStatus !== "idle" && (
                  <p
                    className={`text-[11px] ${
                      lintStatus === "failed"
                        ? "text-rose-400"
                        : lintStatus === "passed"
                          ? "text-emerald-400"
                          : "text-white"
                    }`}
                  >
                    {lintMessage ?? (lintStatus === "checking" ? "Linting..." : null)}
                  </p>
                )}
              </form>
            </div>

            {/* RIGHT CONTENT AREA */}
            <main className="mt-4 flex-1 space-y-6 transition-all duration-200 lg:mt-0 lg:min-w-0">
              {!result ? (
                previewLoading ? (
                  <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/40 backdrop-blur-sm">
                    <div className="text-center">
                      <div className="mb-3 text-4xl">📈</div>
                      <h3 className="mb-2 text-lg font-semibold text-gray-200">Loading Price Chart…</h3>
                      <p className="text-sm text-gray-400">Fetching dataset preview for charting</p>
                    </div>
                  </div>
                ) : previewOHLCData.length > 0 ? (
                  <section className="rounded-2xl border border-gray-800 bg-gray-900/80 p-5 shadow-xl backdrop-blur-sm">
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-50">Price Chart Preview</h2>
                        <p className="text-xs text-gray-400">
                          Explore the dataset and draw trendlines or horizontal levels before running a backtest.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <ChartControls
                          chartType={priceChartType}
                          onChartTypeChange={setPriceChartType}
                          showTimeframeSelector={false}
                        />
                        <button
                          type="button"
                          onClick={() => setAnnotationMode((mode) => (mode === "trend" ? "none" : "trend"))}
                          className={`rounded-lg border px-3 py-1 text-[11px] font-semibold transition ${
                            annotationMode === "trend"
                              ? "border-sky-400 text-sky-200"
                              : "border-gray-700 text-gray-400 hover:border-white hover:text-white"
                          }`}
                        >
                          Trend
                        </button>
                        <button
                          type="button"
                          onClick={() => setAnnotationMode((mode) => (mode === "horizontal" ? "none" : "horizontal"))}
                          className={`rounded-lg border px-3 py-1 text-[11px] font-semibold transition ${
                            annotationMode === "horizontal"
                              ? "border-rose-400 text-rose-200"
                              : "border-gray-700 text-gray-400 hover:border-white hover:text-white"
                          }`}
                        >
                          Horizontal
                        </button>
                        <button
                          type="button"
                          onClick={() => setPriceAnnotations([])}
                          disabled={priceAnnotations.length === 0}
                          className="rounded-lg border border-gray-700 px-3 py-1 text-[11px] font-semibold text-gray-400 transition hover:border-white hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Clear Drawings
                        </button>
                        <button
                          type="button"
                          onClick={() => setPriceChartResetKey((key) => key + 1)}
                          className="rounded-lg border border-gray-700 px-3 py-1 text-[11px] font-semibold text-gray-400 transition hover:border-white hover:text-white"
                        >
                          Reset Zoom
                        </button>
                      </div>
                    </div>

                    <div className="relative">
                      <CandlestickChart
                        key={`${chartInstanceKey}-preview`}
                        data={previewOHLCData}
                        volumeData={previewVolumeData}
                        chartType={priceChartType}
                        resetSignal={priceChartResetKey}
                        theme="dark"
                        height={previewChartHeight}
                        onCrosshairMove={(data) => {
                          if (data) {
                            const rawTime = typeof data.time === "number" ? data.time : Number(data.time);
                            const formattedTime = Number.isFinite(rawTime)
                              ? new Date(rawTime * 1000).toLocaleString()
                              : String(data.time);
                            setPriceCrosshairData({
                              time: formattedTime,
                              open: data.open,
                              high: data.high,
                              low: data.low,
                              close: data.close,
                              volume: Number.isFinite(rawTime)
                                ? previewVolumeData.find((v) => v.time === rawTime)?.value
                                : undefined,
                            });
                          } else {
                            setPriceCrosshairData(null);
                          }
                        }}
                        tradeMarkers={combinedPriceMarkers}
                        annotationMode={annotationMode}
                        annotations={priceAnnotations}
                        onAnnotationsChange={setPriceAnnotations}
                        showVolume={true}
                      />
                      <CrosshairTooltip data={priceCrosshairData} position="top-left" />
                    </div>
                  </section>
                ) : (
                  <div className="flex min-h-[600px] items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/40 backdrop-blur-sm">
                    <div className="text-center">
                      <div className="mb-3 text-4xl">📊</div>
                      <h3 className="mb-2 text-lg font-semibold text-gray-200">No Results Yet</h3>
                      <p className="text-sm text-gray-400">
                        {previewError ?? "Configure your strategy and run a backtest to see results"}
                      </p>
                    </div>
                  </div>
                )
              ) : (
                <>
                  {/* Equity Summary */}
                  <section className="rounded-2xl border-2 border-blue-700 bg-blue-950/30 p-5 shadow-xl backdrop-blur-sm mb-6">
                    <h2 className="text-lg font-semibold text-blue-300 mb-4">Equity Summary</h2>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <div className="text-xs text-blue-400 font-semibold mb-1">Initial Equity</div>
                        <div className="text-2xl font-mono font-bold text-white">
                          ${initialCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-blue-400 font-semibold mb-1">Final Equity</div>
                        <div className={`text-2xl font-mono font-bold ${
                          result.stats.total_return >= 0 ? "text-green-400" : "text-red-400"
                        }`}>
                          ${(initialCash * (1 + result.stats.total_return)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-blue-800">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-blue-300 font-semibold">Total Change</span>
                        <span className={`text-xl font-mono font-bold ${
                          result.stats.total_return >= 0 ? "text-green-400" : "text-red-400"
                        }`}>
                          {result.stats.total_return >= 0 ? "+" : ""}${(initialCash * result.stats.total_return).toFixed(2)} ({result.stats.total_return >= 0 ? "+" : ""}{(result.stats.total_return * 100).toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Key Metrics Bar */}
                  <section className="rounded-2xl border border-gray-800 bg-gray-900/80 p-5 shadow-xl backdrop-blur-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="text-lg font-semibold text-gray-50">Performance Overview</h2>
                      <span className="text-[11px] text-gray-400">Run ID: {result.run_id?.slice(0, 8)}</span>
                    </div>

                    {/* Top 4-5 Key Metrics */}
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                      <KeyMetricCard
                        label="Total Return"
                        value={(result.stats.total_return * 100).toFixed(2) + "%"}
                        accent
                        tooltip="The total percentage gain or loss from your initial capital over the entire backtest period."
                      />
                      <KeyMetricCard
                        label="Sharpe Ratio"
                        value={result.stats.sharpe != null ? result.stats.sharpe.toFixed(2) : "N/A"}
                        tooltip="Risk-adjusted return metric. Measures excess return per unit of risk. Higher is better. Above 1 is good, above 2 is excellent."
                      />
                      <KeyMetricCard
                        label="Max Drawdown"
                        value={(result.stats.max_drawdown * 100).toFixed(2) + "%"}
                        tooltip="The largest peak-to-trough decline in equity. Indicates the worst historical loss from a previous high."
                      />
                      <KeyMetricCard
                        label="Win Rate"
                        value={(result.trade_stats.win_rate * 100).toFixed(1) + "%"}
                        tooltip="Percentage of trades that were profitable. Note: A high win rate doesn't guarantee profitability if losses are larger than wins."
                      />
                    </div>

                    {/* Collapsible More Metrics */}
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setShowMoreMetrics(!showMoreMetrics)}
                        className="flex w-full items-center justify-between rounded-lg border border-gray-700 bg-gray-950/40 px-4 py-2 text-sm text-gray-300 transition hover:border-gray-600"
                      >
                        <span>{showMoreMetrics ? "Hide" : "Show"} Additional Metrics</span>
                        <span className="text-gray-500">{showMoreMetrics ? "−" : "+"}</span>
                      </button>
                      <Collapse open={showMoreMetrics} className="mt-3 rounded-lg border border-gray-800 bg-gray-950/40 p-4">
                        <div className="grid gap-2 md:grid-cols-2">
                          <SecondaryMetricRow
                            label="Annualized Return"
                            value={(result.stats.annualized_return * 100).toFixed(2) + "%"}
                            tooltip="Average yearly return if the strategy performed consistently over a year. Accounts for compounding."
                          />
                          <SecondaryMetricRow
                            label="Volatility"
                            value={result.stats.volatility != null ? (result.stats.volatility * 100).toFixed(2) + "%" : "N/A"}
                            tooltip="Standard deviation of returns. Measures how much returns fluctuate. Higher volatility means more risk."
                          />
                          <SecondaryMetricRow
                            label="Sortino"
                            value={result.stats.sortino != null ? result.stats.sortino.toFixed(2) : "N/A"}
                            tooltip="Similar to Sharpe but only penalizes downside volatility. Better for asymmetric return distributions."
                          />
                          <SecondaryMetricRow
                            label="Calmar"
                            value={result.stats.calmar != null ? result.stats.calmar.toFixed(2) : "N/A"}
                            tooltip="Annualized return divided by max drawdown. Measures return relative to worst-case loss. Higher is better."
                          />
                          <SecondaryMetricRow
                            label="Avg Win"
                            value={result.trade_stats.avg_win.toFixed(2)}
                            tooltip="Average profit per winning trade. Compare with Avg Loss to assess risk/reward ratio."
                          />
                          <SecondaryMetricRow
                            label="Avg Loss"
                            value={result.trade_stats.avg_loss.toFixed(2)}
                            tooltip="Average loss per losing trade (shown as negative). Ideally should be smaller in magnitude than Avg Win."
                          />
                          <SecondaryMetricRow
                            label="Turnover"
                            value={result.trade_stats.turnover.toFixed(2)}
                            tooltip="Trading activity level. Higher turnover means more frequent trades, which increases transaction costs."
                          />
                          <SecondaryMetricRow
                            label="Net PnL"
                            value={result.trade_stats.net_pnl.toFixed(2)}
                            tooltip="Total profit or loss after all costs. The bottom-line dollar amount gained or lost."
                          />
                          <SecondaryMetricRow
                            label="Total Trades"
                            value={result.trade_stats.num_trades.toString()}
                            tooltip="Number of completed round-trip trades. More trades generally means more statistical significance."
                          />
                          <SecondaryMetricRow label="Bars Processed" value={result.stats.equity_curve.length.toString()} />

                          {/* Advanced Trade Metrics */}
                          {(() => {
                            const advancedMetrics = calculateAdvancedMetrics(result.trades);
                            return (
                              <>
                                <SecondaryMetricRow
                                  label="Profit Factor"
                                  value={advancedMetrics.profitFactor === Infinity ? "∞" : advancedMetrics.profitFactor.toFixed(2)}
                                  tooltip="Ratio of gross profit to gross loss. Above 1.0 means profitable. Above 2.0 is excellent."
                                />
                                <SecondaryMetricRow
                                  label="Expectancy"
                                  value={`$${advancedMetrics.expectancy.toFixed(2)}`}
                                  tooltip="Average profit/loss per trade. Positive expectancy means the strategy is profitable on average."
                                />
                                <SecondaryMetricRow
                                  label="Largest Win"
                                  value={`$${advancedMetrics.largestWin.toFixed(2)}`}
                                  tooltip="The single most profitable trade in the backtest period."
                                />
                                <SecondaryMetricRow
                                  label="Largest Loss"
                                  value={`$${advancedMetrics.largestLoss.toFixed(2)}`}
                                  tooltip="The single most unprofitable trade in the backtest period."
                                />
                                <SecondaryMetricRow
                                  label="Max Consecutive Wins"
                                  value={advancedMetrics.consecutiveWins.toString()}
                                  tooltip="The longest streak of consecutive winning trades."
                                />
                                <SecondaryMetricRow
                                  label="Max Consecutive Losses"
                                  value={advancedMetrics.consecutiveLosses.toString()}
                                  tooltip="The longest streak of consecutive losing trades. Indicates potential psychological stress periods."
                                />
                              </>
                            );
                          })()}

                          {/* Drawdown Statistics */}
                          {(() => {
                            const ddStats = calculateDrawdownStats(result.stats.equity_curve);
                            return (
                              <>
                                <SecondaryMetricRow
                                  label="Max DD Duration (Bars)"
                                  value={ddStats.maxDrawdownDuration.toString()}
                                  tooltip="Number of bars the portfolio stayed in the longest drawdown period."
                                />
                                <SecondaryMetricRow
                                  label="Avg DD Duration (Bars)"
                                  value={ddStats.avgDrawdownDuration.toFixed(1)}
                                  tooltip="Average number of bars across all drawdown periods."
                                />
                                <SecondaryMetricRow
                                  label="Recovery Time (Bars)"
                                  value={ddStats.recoveryTime.toString()}
                                  tooltip="Number of bars it took to recover from the maximum drawdown to previous peak."
                                />
                              </>
                            );
                          })()}
                        </div>
                      </Collapse>
                    </div>
                  </section>

                  {/* Charts Grid - Equity + Price Stacked */}
                  <section className="rounded-2xl border border-gray-800 bg-gray-900/80 p-5 shadow-xl backdrop-blur-sm">
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <h2 className="text-lg font-semibold text-gray-50">Charts</h2>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-gray-400">Drag to zoom • Click markers for details</span>
                        {totalBars > 1 && (
                          <button
                            type="button"
                            onClick={resetChartWindow}
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-[11px] font-semibold text-gray-300 transition hover:border-white hover:text-white"
                          >
                            Reset Zoom
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Charts Stacked */}
                    <div className="grid grid-cols-1 gap-4">
                      {equityData && (
                        <div
                          className={`rounded-lg border border-gray-700 bg-gray-950/60 p-3 ${chartIntroClass}`}
                        >
                          <div className="mb-2 text-xs font-semibold text-gray-300">Equity Curve</div>
                          <ZoomableChart
                            key={`${chartInstanceKey}-equity`}
                            data={equityData}
                            options={equityOptions}
                            onBrush={handleBrushRange}
                            onPinchZoom={handlePinchZoom}
                            brushDisabled={!timeline.length}
                            className={equityChartHeight}
                            animationKey={chartAnimationKey}
                            layoutAnimating={layoutAnimating}
                          />
                        </div>
                      )}
                      {priceOHLCData.length > 0 && (
                        <div
                          className={`rounded-lg border border-gray-700 bg-gray-950/60 p-3 ${chartIntroClass}`}
                          style={{ animationDelay: chartsIntro ? "100ms" : "0ms" }}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-xs font-semibold text-gray-300">Price Chart</div>
                            <div className="flex items-center gap-2">
                              <ChartControls
                                chartType={priceChartType}
                                onChartTypeChange={setPriceChartType}
                                showTimeframeSelector={false}
                              />
                              <button
                                type="button"
                                onClick={() => setAnnotationMode((mode) => (mode === "trend" ? "none" : "trend"))}
                                className={`rounded-lg border px-3 py-1 text-[11px] font-semibold transition ${
                                  annotationMode === "trend"
                                    ? "border-sky-400 text-sky-200"
                                    : "border-gray-700 text-gray-400 hover:border-white hover:text-white"
                                }`}
                              >
                                Trend
                              </button>
                              <button
                                type="button"
                                onClick={() => setAnnotationMode((mode) => (mode === "horizontal" ? "none" : "horizontal"))}
                                className={`rounded-lg border px-3 py-1 text-[11px] font-semibold transition ${
                                  annotationMode === "horizontal"
                                    ? "border-rose-400 text-rose-200"
                                    : "border-gray-700 text-gray-400 hover:border-white hover:text-white"
                                }`}
                              >
                                Horizontal
                              </button>
                              <button
                                type="button"
                                onClick={() => setPriceAnnotations([])}
                                disabled={priceAnnotations.length === 0}
                                className="rounded-lg border border-gray-700 px-3 py-1 text-[11px] font-semibold text-gray-400 transition hover:border-white hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Clear Drawings
                              </button>
                              <button
                                type="button"
                                onClick={() => setPriceChartResetKey((key) => key + 1)}
                                className="rounded-lg border border-gray-700 px-3 py-1 text-[11px] font-semibold text-gray-400 transition hover:border-white hover:text-white"
                              >
                                Reset Zoom
                              </button>
                            </div>
                          </div>
                          <div className="relative">
                            <CandlestickChart
                              key={`${chartInstanceKey}-price`}
                              data={priceOHLCData}
                              volumeData={priceVolumeData}
                              chartType={priceChartType}
                              resetSignal={priceChartResetKey}
                              theme="dark"
                              onCrosshairMove={(data) => {
                                if (data) {
                                  const rawTime = typeof data.time === "number" ? data.time : Number(data.time);
                                  const formattedTime = Number.isFinite(rawTime)
                                    ? new Date(rawTime * 1000).toLocaleString()
                                    : String(data.time);
                                  setPriceCrosshairData({
                                    time: formattedTime,
                                    open: data.open,
                                    high: data.high,
                                    low: data.low,
                                    close: data.close,
                                    volume: Number.isFinite(rawTime)
                                      ? priceVolumeData.find((v) => v.time === rawTime)?.value
                                      : undefined,
                                  });
                                } else {
                                  setPriceCrosshairData(null);
                                }
                              }}
                              tradeMarkers={combinedPriceMarkers}
                              annotationMode={annotationMode}
                              annotations={priceAnnotations}
                              onAnnotationsChange={setPriceAnnotations}
                              showVolume={true}
                              height={priceChartHeight}
                            />
                            <CrosshairTooltip data={priceCrosshairData} position="top-left" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Drawdown Chart - Full Width Below */}
                    {drawdownData && (
                      <div
                        className={`mt-4 rounded-lg border border-gray-700 bg-gray-950/60 p-3 ${chartIntroClass}`}
                        style={{ animationDelay: chartsIntro ? "200ms" : "0ms" }}
                      >
                        <div className="mb-2 text-xs font-semibold text-gray-300">Drawdown</div>
                        <ZoomableChart
                          key={`${chartInstanceKey}-drawdown`}
                          data={drawdownData}
                          options={drawdownOptions}
                          onBrush={handleBrushRange}
                          onPinchZoom={handlePinchZoom}
                          brushDisabled={!timeline.length}
                          className="h-[240px]"
                          animationKey={chartAnimationKey}
                          layoutAnimating={layoutAnimating}
                        />
                      </div>
                    )}

                    {/* Cumulative P&L Chart and Trade Distribution Side by Side */}
                    {(cumulativePnLData || tradeDistributionData) && (
                      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Cumulative P&L Chart */}
                        {cumulativePnLData && (
                          <div
                            className={`rounded-lg border border-gray-700 bg-gray-950/60 p-3 ${chartIntroClass}`}
                            style={{ animationDelay: chartsIntro ? "300ms" : "0ms" }}
                          >
                            <div className="mb-2 text-xs font-semibold text-gray-300">Cumulative P&L</div>
                            <div className="h-[280px]">
                              <Line data={cumulativePnLData} options={cumulativePnLOptions} />
                            </div>
                          </div>
                        )}

                        {/* Trade Distribution Histogram */}
                        {tradeDistributionData && (
                          <div
                            className={`rounded-lg border border-gray-700 bg-gray-950/60 p-3 ${chartIntroClass}`}
                            style={{ animationDelay: chartsIntro ? "400ms" : "0ms" }}
                          >
                            <div className="mb-2 text-xs font-semibold text-gray-300">Trade P&L Distribution</div>
                            <div className="h-[280px]">
                              <Bar data={tradeDistributionData} options={histogramOptions} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                  {/* Tabs: Trades | Orders | History */}
                  <section className="rounded-2xl border border-gray-800 bg-gray-900/80 p-5 shadow-xl backdrop-blur-sm">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-lg font-semibold text-gray-50">Details</h2>
                      <div className="flex flex-wrap gap-2">
                        {/* Export Buttons */}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!result) return;
                              const csvContent = [
                                ["Metric", "Value"],
                                ["Total Return", `${(result.stats.total_return * 100).toFixed(2)}%`],
                                ["Sharpe Ratio", result.stats.sharpe != null ? result.stats.sharpe.toFixed(2) : "N/A"],
                                ["Max Drawdown", `${(result.stats.max_drawdown * 100).toFixed(2)}%`],
                                ["Win Rate", `${(result.trade_stats.win_rate * 100).toFixed(1)}%`],
                                ["Net P&L", `$${result.trade_stats.net_pnl.toFixed(2)}`],
                                ["Total Trades", result.trade_stats.num_trades.toString()],
                                ...calculateAdvancedMetrics(result.trades) ? [
                                  ["Profit Factor", calculateAdvancedMetrics(result.trades).profitFactor === Infinity ? "∞" : calculateAdvancedMetrics(result.trades).profitFactor.toFixed(2)],
                                  ["Expectancy", `$${calculateAdvancedMetrics(result.trades).expectancy.toFixed(2)}`],
                                  ["Largest Win", `$${calculateAdvancedMetrics(result.trades).largestWin.toFixed(2)}`],
                                  ["Largest Loss", `$${calculateAdvancedMetrics(result.trades).largestLoss.toFixed(2)}`],
                                ] : []
                              ].map(row => row.join(",")).join("\n");

                              const blob = new Blob([csvContent], { type: "text/csv" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `backtest-metrics-${result.run_id}.csv`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:border-gray-600 hover:text-white transition"
                          >
                            Export Metrics (CSV)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!result) return;
                              const csvContent = [
                                ["Timestamp", "Symbol", "Side", "Qty", "Price", "Commission", "Slippage", "Realized P&L"],
                                ...result.trades.map(t => [
                                  t.timestamp,
                                  t.symbol || "",
                                  t.side,
                                  t.qty.toString(),
                                  t.price.toFixed(4),
                                  (t.commission || 0).toFixed(4),
                                  (t.slippage || 0).toFixed(4),
                                  (t.realized_pnl || 0).toFixed(2),
                                ])
                              ].map(row => row.join(",")).join("\n");

                              const blob = new Blob([csvContent], { type: "text/csv" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `backtest-trades-${result.run_id}.csv`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:border-gray-600 hover:text-white transition"
                          >
                            Export Trades (CSV)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!result) return;
                              const jsonContent = JSON.stringify(result, null, 2);
                              const blob = new Blob([jsonContent], { type: "application/json" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `backtest-full-${result.run_id}.json`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:border-gray-600 hover:text-white transition"
                          >
                            Export Full (JSON)
                          </button>
                        </div>

                        {/* Tab Buttons */}
                        <div className="flex gap-2">
                          {[
                            { id: "trades", label: "Trades" },
                            { id: "orders", label: "Orders" },
                            { id: "history", label: "History" },
                          ].map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                                detailTab === tab.id
                                  ? "bg-white text-black shadow-lg shadow-white/20"
                                  : "border border-gray-700 text-gray-300 hover:border-gray-600"
                              }`}
                              onClick={() => setDetailTab(tab.id as typeof detailTab)}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {detailTab === "trades" ? (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {["ALL", "BUY", "SELL"].map((filter) => (
                            <button
                              key={filter}
                              type="button"
                              onClick={() => setTradeFilter(filter as typeof tradeFilter)}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                tradeFilter === filter
                                  ? "bg-white/20 text-white border border-white/50"
                                  : "border border-gray-700 text-gray-400 hover:text-gray-300"
                              }`}
                            >
                              {filter}
                            </button>
                          ))}
                          <input
                            type="text"
                            placeholder="Search timestamp"
                            className="ml-auto flex-1 min-w-[180px] rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs text-gray-100 outline-none focus:border-white focus:ring-2 focus:ring-white/20"
                            value={tradeSearch}
                            onChange={(e) => setTradeSearch(e.target.value)}
                          />
                        </div>
                        <div className="overflow-auto rounded-lg border border-gray-700">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-950/90 text-[11px] uppercase tracking-wide text-gray-400">
                              <tr>
                                <th className="px-3 py-2 text-left">Timestamp</th>
                                <th className="px-3 py-2 text-left">Side</th>
                                <th className="px-3 py-2 text-right">Qty</th>
                                <th className="px-3 py-2 text-right">Price</th>
                                <th className="px-3 py-2 text-right">PnL</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredTrades.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-500">
                                    No trades match your filters.
                                  </td>
                                </tr>
                              )}
                              {filteredTrades.map((t, idx) => {
                                const isSelected = selectedTrade === t;
                                return (
                                  <tr
                                    key={`${t.timestamp}-${idx}`}
                                    className={`cursor-pointer border-t border-gray-800/60 transition hover:bg-gray-800/40 ${
                                      isSelected ? "bg-gray-800/60" : ""
                                    }`}
                                    onClick={() => setSelectedTrade(t)}
                                  >
                                    <td className="px-3 py-2 text-xs text-gray-300">
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
                                    <td className="px-3 py-2 text-right text-gray-200">{t.qty}</td>
                                    <td className="px-3 py-2 text-right text-gray-200">
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
                        {selectedTrade && (
                          <div className="rounded-lg border border-gray-700 bg-gray-950/60 p-4">
                            <div className="mb-2 text-xs uppercase tracking-wide text-gray-400">
                              Selected Trade Details
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <span className="text-gray-400">Timestamp:</span>{" "}
                                <span className="text-gray-200">{formatTradeTimestamp(selectedTrade.timestamp)}</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Symbol:</span>{" "}
                                <span className="text-gray-200">{selectedTrade.symbol ?? symbol}</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Side:</span>{" "}
                                <span className="font-semibold text-gray-200">{selectedTrade.side}</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Qty:</span>{" "}
                                <span className="text-gray-200">{selectedTrade.qty}</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Price:</span>{" "}
                                <span className="text-gray-200">{selectedTrade.price?.toFixed(4)}</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Commission:</span>{" "}
                                <span className="text-gray-200">{selectedTrade.commission?.toFixed(2) ?? "—"}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="mt-3 text-xs text-gray-400 underline"
                              onClick={() => setSelectedTrade(null)}
                            >
                              Clear selection
                            </button>
                          </div>
                        )}
                      </div>
                    ) : detailTab === "orders" ? (
                      <div className="overflow-auto rounded-lg border border-gray-700">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-gray-950/90 text-[11px] uppercase tracking-wide text-gray-400">
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
                                <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-500">
                                  No orders were generated.
                                </td>
                              </tr>
                            )}
                            {result.orders.map((order) => (
                              <tr key={order.id} className="border-t border-gray-800/60 text-gray-200">
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
                                <td className="px-3 py-2 text-xs uppercase tracking-wide text-gray-400">
                                  {order.status}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-lg border border-gray-700 bg-gray-950/40 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-200">Server Runs</h3>
                            <button
                              type="button"
                              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-white"
                              onClick={fetchServerRuns}
                              disabled={serverRunsLoading}
                            >
                              {serverRunsLoading ? "Refreshing..." : "Refresh"}
                            </button>
                          </div>
                          {serverRunsError && (
                            <p className="mb-2 text-xs text-rose-400">{serverRunsError}</p>
                          )}
                          {serverRunError && (
                            <p className="mb-2 text-xs text-rose-400">{serverRunError}</p>
                          )}
                          {serverRuns.length ? (
                            <div className="grid gap-3 md:grid-cols-2">
                              {serverRuns.map((run) => (
                                <div
                                  key={run.run_id}
                                  className="rounded-lg border border-gray-800 bg-gray-950/60 p-3"
                                >
                                  <div className="mb-2 flex items-center justify-between">
                                    <span className="font-semibold text-gray-100">
                                      {run.symbol ?? "—"}
                                    </span>
                                    <span className="text-[10px] text-gray-500">
                                      {run.saved_at
                                        ? new Date(run.saved_at).toLocaleString()
                                        : "Unknown"}
                                    </span>
                                  </div>
                                  <div className="mb-2 grid grid-cols-2 gap-2 text-xs text-gray-400">
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
                                  <button
                                    type="button"
                                    className="w-full rounded-lg border border-gray-700 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-white disabled:opacity-50"
                                    onClick={() => handleLoadServerRun(run.run_id)}
                                    disabled={serverRunLoadingId === run.run_id}
                                  >
                                    {serverRunLoadingId === run.run_id ? "Loading..." : "Load Run"}
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">No server runs available.</p>
                          )}
                        </div>

                        <div className="rounded-lg border border-gray-700 bg-gray-950/40 p-4">
                          <h3 className="mb-3 text-sm font-semibold text-gray-200">Local History</h3>
                          {history.length ? (
                            <div className="grid gap-3 md:grid-cols-2">
                              {history.map((h, idx) => (
                                <div
                                  key={`${h.savedAt}-${idx}`}
                                  className="rounded-lg border border-gray-800 bg-gray-950/60 p-3"
                                >
                                  <div className="mb-2 flex items-center justify-between">
                                    <span className="font-semibold text-gray-100">{h.form.symbol}</span>
                                    <span className="text-[10px] text-gray-500">
                                      {new Date(h.savedAt).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="mb-2 grid grid-cols-2 gap-2 text-xs text-gray-400">
                                    <span>Ret: {(h.result.stats.total_return * 100).toFixed(2)}%</span>
                                    <span>Sharpe: {h.result.stats.sharpe != null ? h.result.stats.sharpe.toFixed(2) : "N/A"}</span>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      className="flex-1 rounded-lg border border-gray-700 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-white"
                                      onClick={() => {
                                        setResult(h.result);
                                        setDetailTab("trades");
                                      }}
                                    >
                                      View
                                    </button>
                                    <button
                                      className="flex-1 rounded-lg border border-gray-700 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-white"
                                      onClick={() => {
                                        setSymbol(h.form.symbol);
                                        setCsvPath(h.form.csvPath);
                                        setInitialCash(h.form.initialCash);
                                        setStartBar(h.form.startBar ?? undefined);
                                        setMaxBars(h.form.maxBars ?? undefined);
                                        setCommission(h.form.commission);
                                        setSlippageBps(h.form.slippageBps);
                                        setMode(h.form.mode);
                                        setBuiltinId(h.form.builtinId ?? null);
                                        applyBuiltinParamState(h.form.builtinParams ?? {});
                                        setStrategyParamsRaw(h.form.strategyParamsRaw ?? "");
                                      }}
                                    >
                                      Load
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">No local history.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                </>
              )}
            </main>
          </div>
          </>
          )}
        </div>
      </main>

      <style jsx global>{`
        @keyframes chartIntro {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-chartIntro {
          animation: chartIntro 0.7s ease-out forwards;
        }
      `}</style>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="text-gray-400">Loading backtest...</p>
        </div>
      </div>
    }>
      <BacktestPageContent />
    </Suspense>
  );
}
