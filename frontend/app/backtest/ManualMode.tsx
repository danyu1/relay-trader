"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, ChartEvent, ActiveElement } from "chart.js";

interface Trade {
  id: string;
  timestamp: number;
  index: number;
  type: "stock" | "call" | "put";
  action: "buy" | "sell";
  price: number;
  strike?: number;
  expiry?: string;
  quantity: number;
  note?: string;
  // Exit strategy fields
  exitTimestamp?: number;
  exitIndex?: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  isOpen?: boolean; // true if position is still open (buy without sell)
}

interface ManualModeProps {
  datasetPath: string;
  datasetName: string;
  symbol: string;
  apiBase: string;
  initialCashOverride?: number;
  startBar?: number;
  maxBars?: number;
  showGuide?: boolean;
  setShowGuide?: (show: boolean) => void;
}

interface SavedConfiguration {
  id: string;
  name: string;
  datasetName: string;
  trades: Trade[];
  initialCash: number;
  createdAt: string;
}

export default function ManualMode({
  datasetPath,
  datasetName,
  symbol,
  apiBase,
  initialCashOverride,
  startBar,
  maxBars,
  showGuide = true,
  setShowGuide,
}: ManualModeProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const tradesRef = useRef<Trade[]>([]);
  const [currentMode, setCurrentMode] = useState<"buy_stock" | "buy_call" | "buy_put">("buy_stock");
  const [quantity, setQuantity] = useState(100);
  const [result, setResult] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<ChartJS<"line">>(null);

  // State for exit strategy workflow
  const [pendingExit, setPendingExit] = useState<Trade | null>(null);
  const [showExitModal, setShowExitModal] = useState(false);
  const [exitDate, setExitDate] = useState<string>("");
  const [exitDaysInAdvance, setExitDaysInAdvance] = useState<number | null>(null);
  const [stopLoss, setStopLoss] = useState<number | null>(null);
  const [takeProfit, setTakeProfit] = useState<number | null>(null);

  // Portfolio state - use override if provided
  const [initialCash, setInitialCash] = useState(initialCashOverride ?? 100000);
  const [cash, setCash] = useState(initialCashOverride ?? 100000);
  const [positions, setPositions] = useState<Map<string, { qty: number; avgPrice: number }>>(new Map());
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (typeof initialCashOverride !== "number" || Number.isNaN(initialCashOverride)) {
      return;
    }
    setInitialCash(initialCashOverride);
    setCash(initialCashOverride);
  }, [initialCashOverride]);

  // Configuration saving state
  const [savedConfigurations, setSavedConfigurations] = useState<SavedConfiguration[]>([]);
  const [showSaveConfigModal, setShowSaveConfigModal] = useState(false);
  const [showLoadConfigModal, setShowLoadConfigModal] = useState(false);
  const [configName, setConfigName] = useState("");

  // Load price data from a quick backtest
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [prices, setPrices] = useState<number[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Register zoom plugin on client side only
  const [zoomReady, setZoomReady] = useState(false);
  useEffect(() => {
    import("chartjs-plugin-zoom").then((zoomPlugin) => {
      ChartJS.register(zoomPlugin.default);
      setZoomReady(true);
    });
  }, []);

  // Track if user is currently zooming/panning to prevent trade placement
  const isZoomingRef = useRef(false);

  // Load saved configurations from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("priorsystems:fundamental-configs");
      if (stored) {
        const configs = JSON.parse(stored) as SavedConfiguration[];
        setSavedConfigurations(configs);
      }
    } catch (error) {
      console.error("Failed to load saved configurations:", error);
    }
  }, []);

  // Load price data when component mounts
  useEffect(() => {
    const loadPriceData = async () => {
      setIsLoadingData(true);
      setError(null);

      try {
        const res = await fetch(`${apiBase}/backtest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "mechanical",
            csv_path: datasetPath,
            builtin_strategy_id: "buy_and_hold", // Simple strategy just to get price data
            initial_cash: 10000,
            symbol: symbol,
            start_bar: startBar ?? null,
            max_bars: maxBars ?? null,
          }),
        });

        if (!res.ok) {
          throw new Error(`Failed to load price data: ${res.statusText}`);
        }

        const data = await res.json();
        if (data.timestamps && data.price_series) {
          setTimestamps(data.timestamps);
          setPrices(data.price_series);

          // Debug: Log the actual date range loaded
          if (data.timestamps.length > 0) {
            const firstDate = new Date(data.timestamps[0]).toISOString().slice(0, 10);
            const lastDate = new Date(data.timestamps[data.timestamps.length - 1]).toISOString().slice(0, 10);
            console.log('[Manual Mode] Loaded price data:', {
              firstDate,
              lastDate,
              numBars: data.timestamps.length,
              requestedStartBar: startBar,
              requestedMaxBars: maxBars
            });
          }
        } else {
          throw new Error("Invalid price data received");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load price data";
        setError(message);
      } finally {
        setIsLoadingData(false);
      }
    };

    loadPriceData();
  }, [datasetPath, symbol, apiBase, maxBars, startBar]);

  const handleChartClick = (event: ChartEvent, elements: ActiveElement[]) => {
    // Don't place trades if user was zooming/panning
    if (isZoomingRef.current) {
      isZoomingRef.current = false;
      return;
    }

    const chart = chartRef.current;
    if (!chart) return;

    // If we have elements under cursor, use the first one's index
    let dataIndex: number;

    if (elements.length > 0) {
      dataIndex = elements[0].index;
    } else {
      // No element directly under cursor, calculate from click position
      const chartArea = chart.chartArea;
      const nativeEvent = event.native as MouseEvent;

      if (!nativeEvent || !chartArea) return;

      const canvasRect = chart.canvas.getBoundingClientRect();
      const x = nativeEvent.clientX - canvasRect.left;

      // Get the data index from the x position
      const xValue = chart.scales.x.getValueForPixel(x);
      dataIndex = Math.round(xValue ?? 0);
    }

    if (dataIndex < 0 || dataIndex >= timestamps.length || dataIndex >= prices.length) {
      setError(`Cannot place trade outside the backtest range (bar ${dataIndex}). Valid range: 0-${timestamps.length - 1}`);
      setTimeout(() => setError(null), 3000);
      return;
    }

    const clickedTimestamp = timestamps[dataIndex];
    const clickedPrice = prices[dataIndex];

    // Check if we're setting an exit for a pending trade
    if (pendingExit) {
      // Convert chart-relative index to absolute dataset index for comparison
      const absoluteExitIndex = (startBar ?? 0) + dataIndex;

      // Validate exit is after entry (both in absolute indices now)
      if (absoluteExitIndex <= pendingExit.index) {
        setError("Exit must be after entry point");
        setTimeout(() => setError(null), 3000);
        return;
      }

      // Update the pending trade with exit info
      const updatedTrade = {
        ...pendingExit,
        exitTimestamp: clickedTimestamp,
        exitIndex: absoluteExitIndex,
        exitPrice: clickedPrice,
        stopLoss: stopLoss ?? undefined,
        takeProfit: takeProfit ?? undefined,
        isOpen: false,
      };

      const updatedTrades = [...trades.filter((t) => t.id !== pendingExit.id), updatedTrade];
      setTrades(updatedTrades);
      tradesRef.current = updatedTrades;

      // Clear pending exit state
      setPendingExit(null);
      setShowExitModal(false);
      setStopLoss(null);
      setTakeProfit(null);
      setExitDate("");
      setExitDaysInAdvance(null);

      if (chartRef.current) {
        chartRef.current.update();
      }
      return;
    }

    // Create BUY trade at this point (no more sell stock option)
    // Convert chart-relative index to absolute dataset index
    const absoluteIndex = (startBar ?? 0) + dataIndex;

    const newTrade: Trade = {
      id: `trade_${Date.now()}`,
      timestamp: clickedTimestamp,
      index: absoluteIndex,
      type: currentMode.includes("stock") ? "stock" : currentMode.includes("call") ? "call" : "put",
      action: "buy", // Always BUY now
      price: clickedPrice,
      quantity: quantity,
      isOpen: true, // Mark as open until exit is set
    };

    // For options, need to set strike and expiry
    if (newTrade.type !== "stock") {
      // Default: ATM strike, 30 days out
      newTrade.strike = Math.round(clickedPrice);
      const expiryDate = new Date(clickedTimestamp);
      expiryDate.setDate(expiryDate.getDate() + 30);
      newTrade.expiry = expiryDate.toISOString().split("T")[0];
    }

    // Portfolio validation for BUY orders
    const cost = newTrade.price * newTrade.quantity;
    if (cost > cash) {
      setError(`Insufficient funds! Need $${cost.toFixed(2)} but only have $${cash.toFixed(2)}`);
      setTimeout(() => setError(null), 3000);
      return;
    }
    // Deduct cash
    setCash(cash - cost);

    console.log('Adding BUY trade:', newTrade);
    const updatedTrades = [...trades, newTrade];
    setTrades(updatedTrades);
    tradesRef.current = updatedTrades;

    // Set this as pending exit and show modal
    setPendingExit(newTrade);
    setShowExitModal(true);

    // Initialize exit date to a week later
    const weekLater = new Date(clickedTimestamp);
    weekLater.setDate(weekLater.getDate() + 7);
    setExitDate(weekLater.toISOString().split("T")[0]);
    setExitDaysInAdvance(7); // Default to 7 days

    // Force chart redraw
    if (chartRef.current) {
      chartRef.current.update();
    }
  };

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
    }
  };

  const handleDeleteTrade = (id: string) => {
    const updatedTrades = trades.filter((t) => t.id !== id);
    setTrades(updatedTrades);
    tradesRef.current = updatedTrades;
    if (chartRef.current) {
      chartRef.current.update();
    }
  };

  const handleEditTrade = (trade: Trade) => {
    // Set this trade as pending for editing
    setPendingExit(trade);
    setShowExitModal(true);

    // Pre-fill the form with existing values
    if (trade.exitTimestamp && trade.exitIndex !== undefined) {
      setExitDate(new Date(trade.exitTimestamp).toISOString().split("T")[0]);
      // Calculate days in advance
      const diffTime = trade.exitTimestamp - trade.timestamp;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      setExitDaysInAdvance(diffDays > 0 ? diffDays : null);
    }
    setStopLoss(trade.stopLoss ?? null);
    setTakeProfit(trade.takeProfit ?? null);
  };

  const handleSaveConfiguration = () => {
    if (!configName.trim()) {
      alert("Please enter a configuration name");
      return;
    }

    const newConfig: SavedConfiguration = {
      id: crypto.randomUUID(),
      name: configName.trim(),
      datasetName,
      trades: trades,
      initialCash,
      createdAt: new Date().toISOString(),
    };

    const updated = [newConfig, ...savedConfigurations].slice(0, 20); // Keep last 20
    setSavedConfigurations(updated);
    localStorage.setItem("priorsystems:fundamental-configs", JSON.stringify(updated));

    setShowSaveConfigModal(false);
    setConfigName("");
  };

  const handleLoadConfiguration = (config: SavedConfiguration) => {
    setTrades(config.trades);
    tradesRef.current = config.trades;
    setCash(config.initialCash);
    setShowLoadConfigModal(false);

    if (chartRef.current) {
      chartRef.current.update();
    }
  };

  const handleDeleteConfiguration = (id: string) => {
    const updated = savedConfigurations.filter(c => c.id !== id);
    setSavedConfigurations(updated);
    localStorage.setItem("priorsystems:fundamental-configs", JSON.stringify(updated));
  };

  const handleRunSimulation = async () => {
    if (trades.length === 0) {
      alert("Please place at least one trade on the chart");
      return;
    }

    setIsRunning(true);
    setError(null);

    try {
      // Sort trades by timestamp
      const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

      // Separate stock and option trades
      const stockTrades = sortedTrades.filter((t) => t.type === "stock");
      const optionTrades = sortedTrades.filter((t) => t.type !== "stock");

      // Convert option trades to backend format
      const annotations = optionTrades.map((t) => ({
        id: t.id,
        timestamp: t.timestamp,
        type: t.type,
        action: t.action,
        strike: t.strike!,
        expiry: t.expiry!,
        contracts: Math.floor(t.quantity / 100), // Convert shares to contracts
        note: t.note,
      }));

      // Convert stock trades to backend format
      const stockAnnotations = stockTrades.map((t) => ({
        id: t.id,
        entryTimestamp: t.timestamp,
        entryIndex: t.index,
        exitTimestamp: t.exitTimestamp,
        exitIndex: t.exitIndex,
        quantity: t.quantity,
        stopLoss: t.stopLoss,
        takeProfit: t.takeProfit,
      }));

      const requestBody = {
        mode: "manual",
        csv_path: datasetPath,
        symbol: symbol,
        start_bar: startBar ?? null,
        max_bars: maxBars ?? null,
        annotations: annotations.length > 0 ? annotations : undefined,
        stock_trades: stockAnnotations.length > 0 ? stockAnnotations : undefined,
        option_settings: annotations.length > 0 ? {
          implied_volatility: 0.30,
          risk_free_rate: 0.05,
          use_black_scholes: true,
          scenario: "base",
          scenario_move_pct: 0.10,
          commission_per_contract: 0.65,
        } : undefined,
        initial_cash: initialCash,
      };

      console.log('[Manual Mode] Sending simulation request:', {
        datasetPath,
        symbol,
        startBar,
        maxBars,
        numAnnotations: annotations.length,
        requestBody
      });

      const response = await fetch(`${apiBase}/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errorMessage = `Simulation failed with status ${response.status}`;
        try {
          const errorData = await response.json();
          console.error('[Manual Mode] Backend error response:', errorData);

          // Handle different error formats
          if (typeof errorData === 'string') {
            errorMessage = errorData;
          } else if (errorData.detail) {
            errorMessage = typeof errorData.detail === 'string'
              ? errorData.detail
              : JSON.stringify(errorData.detail);
          } else if (errorData.message) {
            errorMessage = errorData.message;
          } else {
            errorMessage = JSON.stringify(errorData);
          }
        } catch (parseError) {
          try {
            const errorText = await response.text();
            errorMessage = errorText || errorMessage;
          } catch {
            // Keep default error message
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      console.error('Simulation error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
    } finally {
      setIsRunning(false);
    }
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  // Track animation progress for each trade
  const animationProgressRef = useRef<Map<string, number>>(new Map<string, number>());
  const animationFrameRef = useRef<number | undefined>(undefined);

  // Custom plugin to draw vertical lines for trades with animation
  const verticalLinePlugin = useMemo(() => ({
    id: 'verticalLines',
    afterDraw(chart: any) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x) return;

      const currentTrades = tradesRef.current;
      let needsAnimation = false;

      currentTrades.forEach((trade) => {
        // Draw ENTRY line
        // Convert absolute index to chart-relative index for display
        const relativeEntryIndex = trade.index - (startBar ?? 0);
        const entryX = scales.x.getPixelForValue(relativeEntryIndex);

        // Get or initialize animation progress for this trade
        let progress = animationProgressRef.current.get(trade.id) || 0;

        // Animate progress from 0 to 1 (faster animation)
        if (progress < 1) {
          progress = Math.min(1, progress + 0.15); // Increase by 15% each frame (faster)
          animationProgressRef.current.set(trade.id, progress);
          needsAnimation = true;
        }

        // Determine color based on trade type
        let entryColor = "#22c55e"; // default green for stock
        if (trade.type === "call") entryColor = "#3b82f6"; // blue
        if (trade.type === "put") entryColor = "#f97316"; // orange

        // Apply easing function for smoother animation
        const easedProgress = 1 - Math.pow(1 - progress, 3); // Cubic ease-out

        // Calculate animated height
        const lineHeight = chartArea.bottom - chartArea.top;
        const animatedHeight = lineHeight * easedProgress;
        const startY = chartArea.bottom - animatedHeight;

        // Draw ENTRY line
        ctx.save();
        ctx.strokeStyle = entryColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.globalAlpha = easedProgress; // Fade in effect
        ctx.beginPath();
        ctx.moveTo(entryX, startY);
        ctx.lineTo(entryX, chartArea.bottom);
        ctx.stroke();
        ctx.restore();

        // Draw EXIT line if it exists
        if (trade.exitIndex !== undefined && trade.exitPrice !== undefined) {
          // Convert absolute exit index to chart-relative index for display
          const relativeExitIndex = trade.exitIndex - (startBar ?? 0);
          const exitX = scales.x.getPixelForValue(relativeExitIndex);
          const exitColor = "#ef4444"; // red for exit

          ctx.save();
          ctx.strokeStyle = exitColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.globalAlpha = easedProgress;
          ctx.beginPath();
          ctx.moveTo(exitX, startY);
          ctx.lineTo(exitX, chartArea.bottom);
          ctx.stroke();
          ctx.restore();

          // Draw connecting line between entry and exit
          const entryY = scales.y.getPixelForValue(trade.price);
          const exitY = scales.y.getPixelForValue(trade.exitPrice);

          ctx.save();
          ctx.strokeStyle = trade.exitPrice > trade.price ? "#22c55e" : "#ef4444"; // Green if profit, red if loss
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.globalAlpha = 0.5 * easedProgress;
          ctx.beginPath();
          ctx.moveTo(entryX, entryY);
          ctx.lineTo(exitX, exitY);
          ctx.stroke();
          ctx.restore();
        }
      });

      // Continue animation if needed
      if (needsAnimation) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        animationFrameRef.current = requestAnimationFrame(() => {
          chart.update('none'); // Update without animation to prevent conflicts
        });
      }
    },
  }), []);

  // Show loading state while fetching price data or waiting for zoom plugin
  if (isLoadingData || !zoomReady) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="text-gray-400">
            {isLoadingData ? "Loading price data for manual trading..." : "Initializing chart..."}
          </p>
        </div>
      </div>
    );
  }

  // Show error if data failed to load
  if (error && timestamps.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3 max-w-md">
          <div className="text-red-400 text-lg">⚠️ Failed to Load Data</div>
          <p className="text-gray-400">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error Toast */}
      {error && (
        <div className="fixed top-4 right-4 z-50 rounded-lg border border-red-700 bg-red-950/95 px-4 py-3 shadow-xl animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            <span className="text-sm font-semibold text-red-200">{error}</span>
          </div>
        </div>
      )}

      {/* Instructions */}
      {showGuide && (
        <div className="rounded-xl border border-blue-900/50 bg-blue-950/30 p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="text-sm font-semibold text-blue-400">How to Use Fundamental Mode</h3>
            {setShowGuide && (
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="text-blue-400 hover:text-white transition text-lg leading-none"
                title="Dismiss guide"
              >
                ✕
              </button>
            )}
          </div>
          <ol className="text-sm text-blue-300 space-y-1 list-decimal list-inside">
            <li>Select trade type (Buy Stock, Buy Call, or Buy Put)</li>
            <li><strong>Click</strong> on the chart where you want to ENTER the trade</li>
            <li>Set your exit strategy: choose a date OR click the chart again for your EXIT point</li>
            <li>Optional: Set stop loss and take profit levels for risk management</li>
            <li>Hold <strong>Shift + Drag</strong> to zoom, or use <strong>mouse wheel</strong> to zoom in/out</li>
            <li>Click "Run Simulation" to see how your trades would have performed</li>
          </ol>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Left Panel - Trade Controls */}
        <div className="space-y-4">
          {/* Dataset & Backtest Range Info */}
          {timestamps.length > 0 && (
            <div className="rounded-xl border border-blue-800 bg-blue-950/30 p-3">
              <h3 className="text-xs font-semibold text-blue-300 mb-2">Active Dataset</h3>
              <div className="space-y-1 text-[11px] mb-3">
                <div className="flex justify-between items-center">
                  <span className="text-blue-400">Dataset:</span>
                  <span className="text-white font-mono font-semibold">{datasetName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-blue-400">Symbol:</span>
                  <span className="text-white font-mono font-semibold">{symbol}</span>
                </div>
              </div>
              <div className="border-t border-blue-800/50 pt-2">
                <h4 className="text-xs font-semibold text-blue-300 mb-1.5">Selected Range</h4>
                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between items-center">
                    <span className="text-blue-400">Start:</span>
                    <span className="text-white font-mono">{new Date(timestamps[0]).toISOString().slice(0, 10)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-blue-400">End:</span>
                    <span className="text-white font-mono">{new Date(timestamps[timestamps.length - 1]).toISOString().slice(0, 10)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-blue-400">Total Bars:</span>
                    <span className="text-white font-mono">{timestamps.length}</span>
                  </div>
                  {startBar !== undefined && (
                    <div className="flex justify-between items-center">
                      <span className="text-blue-400">Bar Range:</span>
                      <span className="text-white font-mono text-[10px]">
                        {startBar} → {startBar + timestamps.length - 1}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-blue-800/50">
                <p className="text-[10px] text-blue-300">
                  ✓ Trades can only be placed within this range
                </p>
              </div>
            </div>
          )}

          {/* Portfolio Stats */}
          <div className="rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900/80 to-gray-950/80 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Portfolio</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400">Initial Equity</span>
                <span className="text-sm font-mono font-semibold text-gray-300">
                  ${initialCash.toFixed(2)}
                </span>
              </div>
              <div className="h-px bg-gray-700 my-2"></div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400">Current Cash</span>
                <span className={`text-sm font-mono font-semibold ${cash < initialCash * 0.1 ? 'text-red-400' : 'text-green-400'}`}>
                  ${cash.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400">Position Value</span>
                <span className="text-sm font-mono font-semibold text-blue-400">
                  ${hoveredIndex !== null && prices[hoveredIndex] ? (quantity * prices[hoveredIndex]).toFixed(2) : '0.00'}
                </span>
              </div>
              <div className="h-px bg-gray-700 my-2"></div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400 font-semibold">Current Total Equity</span>
                <span className="text-base font-mono font-bold text-white">
                  ${(cash + (hoveredIndex !== null && prices[hoveredIndex] ? quantity * prices[hoveredIndex] : 0)).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400">Total P&L</span>
                <span className={`text-sm font-mono font-semibold ${
                  (cash + (hoveredIndex !== null && prices[hoveredIndex] ? quantity * prices[hoveredIndex] : 0)) >= initialCash ? 'text-green-400' : 'text-red-400'
                }`}>
                  {(cash + (hoveredIndex !== null && prices[hoveredIndex] ? quantity * prices[hoveredIndex] : 0)) >= initialCash ? '+' : ''}
                  {(((cash + (hoveredIndex !== null && prices[hoveredIndex] ? quantity * prices[hoveredIndex] : 0)) - initialCash) / initialCash * 100).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>

          {/* Trade Type Selector */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Select Trade Type</h3>
            <div className="space-y-2">
              <button
                onClick={() => setCurrentMode("buy_stock")}
                disabled={!!pendingExit}
                className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  currentMode === "buy_stock"
                    ? "bg-green-600 text-white"
                    : "border border-gray-700 text-gray-400 hover:text-white"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Buy Stock
              </button>
              <button
                onClick={() => setCurrentMode("buy_call")}
                disabled={!!pendingExit}
                className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  currentMode === "buy_call"
                    ? "bg-blue-600 text-white"
                    : "border border-gray-700 text-gray-400 hover:text-white"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Buy Call Option
              </button>
              <button
                onClick={() => setCurrentMode("buy_put")}
                disabled={!!pendingExit}
                className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  currentMode === "buy_put"
                    ? "bg-orange-600 text-white"
                    : "border border-gray-700 text-gray-400 hover:text-white"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Buy Put Option
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-xs text-gray-400 mb-1">
                Quantity {currentMode.includes("stock") ? "(shares)" : "(contracts)"}
              </label>
              <input
                type="number"
                min="1"
                max={hoveredIndex !== null && prices[hoveredIndex] ? Math.floor(cash / prices[hoveredIndex]) : undefined}
                step={currentMode.includes("stock") ? "1" : "1"}
                value={quantity}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  // Always cap quantity based on available cash and current/hovered price
                  let maxAffordable = Infinity;

                  if (hoveredIndex !== null && prices[hoveredIndex]) {
                    // Use hovered price if available
                    maxAffordable = Math.floor(cash / prices[hoveredIndex]);
                  } else if (prices.length > 0) {
                    // Use the last price as estimate
                    const lastPrice = prices[prices.length - 1];
                    maxAffordable = Math.floor(cash / lastPrice);
                  }

                  setQuantity(Math.min(val, maxAffordable));
                }}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white mb-2"
              />
              {hoveredIndex !== null && prices[hoveredIndex] && currentMode.includes("buy") && (
                <>
                  <div className="flex gap-1 mb-2">
                    <button
                      onClick={() => setQuantity(Math.floor((cash * 0.25) / prices[hoveredIndex!]))}
                      className="flex-1 text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
                    >
                      25%
                    </button>
                    <button
                      onClick={() => setQuantity(Math.floor((cash * 0.5) / prices[hoveredIndex!]))}
                      className="flex-1 text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
                    >
                      50%
                    </button>
                    <button
                      onClick={() => setQuantity(Math.floor((cash * 0.75) / prices[hoveredIndex!]))}
                      className="flex-1 text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
                    >
                      75%
                    </button>
                    <button
                      onClick={() => setQuantity(Math.floor(cash / prices[hoveredIndex!]))}
                      className="flex-1 text-[10px] px-2 py-1 rounded bg-green-700 text-white hover:bg-green-600 border border-green-600"
                    >
                      MAX
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-500 flex justify-between">
                    <span>Cost: ${(quantity * prices[hoveredIndex!]).toFixed(2)}</span>
                    <span>Max: {Math.floor(cash / prices[hoveredIndex!])} shares</span>
                  </div>
                  {quantity * prices[hoveredIndex!] > cash && (
                    <div className="text-[10px] text-red-400 mt-1 font-semibold">
                      ⚠ Insufficient funds! Reduce quantity or add more cash.
                    </div>
                  )}
                </>
              )}
              {(hoveredIndex === null || !prices[hoveredIndex]) && prices.length > 0 && currentMode.includes("buy") && (
                <div className="text-[10px] text-gray-500 mt-1">
                  Available cash: ${cash.toFixed(2)}
                </div>
              )}
            </div>
          </div>

          {/* Trade List */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Your Trades ({trades.length})</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-hide">
              {trades.map((trade) => (
                <div key={trade.id} className={`rounded border p-2 ${
                  trade.isOpen ? 'border-orange-600 bg-orange-950/30' : 'border-gray-700 bg-gray-800'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            trade.type === "stock" ? "bg-green-400" : trade.type === "call" ? "bg-blue-400" : "bg-orange-400"
                          }`}
                        />
                        <span className="text-xs font-semibold text-white">
                          BUY {trade.quantity}{" "}
                          {trade.type === "stock" ? "shares" : `${trade.type.toUpperCase()} contracts`}
                        </span>
                        {trade.isOpen && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-600 text-white font-bold">
                            OPEN
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        Entry: ${trade.price.toFixed(2)} on {formatDate(trade.timestamp)}
                      </div>
                      {trade.exitPrice && (
                        <div className={`text-xs mt-1 ${
                          trade.exitPrice > trade.price ? 'text-green-400' : 'text-red-400'
                        }`}>
                          Exit: ${trade.exitPrice.toFixed(2)} on {formatDate(trade.exitTimestamp!)}
                          {' '}({trade.exitPrice > trade.price ? '+' : ''}{((trade.exitPrice - trade.price) / trade.price * 100).toFixed(1)}%)
                        </div>
                      )}
                      {trade.type !== "stock" && (
                        <div className="text-xs text-gray-500">
                          Strike ${trade.strike}, Exp {trade.expiry}
                        </div>
                      )}
                      {(trade.stopLoss || trade.takeProfit) && (
                        <div className="text-[10px] text-gray-500 mt-1">
                          {trade.stopLoss && `SL: $${trade.stopLoss.toFixed(2)}`}
                          {trade.stopLoss && trade.takeProfit && ' | '}
                          {trade.takeProfit && `TP: $${trade.takeProfit.toFixed(2)}`}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditTrade(trade)}
                        className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
                        title="Edit trade"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteTrade(trade.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                        title="Delete trade"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {trades.length === 0 && (
                <div className="text-center text-xs text-gray-500 py-8">
                  Click on the chart to place trades
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button
              onClick={handleRunSimulation}
              disabled={isRunning || trades.length === 0}
              className="w-full rounded-xl bg-white py-3 font-semibold text-black transition hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? "Running Simulation..." : "Run Simulation"}
            </button>
            <button
              onClick={() => {
                setTrades([]);
                tradesRef.current = [];
                if (chartRef.current) {
                  chartRef.current.update();
                }
              }}
              disabled={trades.length === 0}
              className="w-full rounded-xl border border-gray-700 bg-gray-900 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:opacity-50"
            >
              Clear All Trades
            </button>

            <div className="pt-4 border-t border-gray-800">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowSaveConfigModal(true)}
                  disabled={trades.length === 0}
                  className="rounded-lg border border-blue-700 bg-blue-950/30 px-3 py-2 text-xs font-semibold text-blue-400 transition hover:bg-blue-950/50 disabled:opacity-50"
                >
                  Save Config
                </button>
                <button
                  onClick={() => setShowLoadConfigModal(true)}
                  disabled={savedConfigurations.length === 0}
                  className="rounded-lg border border-purple-700 bg-purple-950/30 px-3 py-2 text-xs font-semibold text-purple-400 transition hover:bg-purple-950/50 disabled:opacity-50"
                >
                  Load Config
                </button>
              </div>
              {savedConfigurations.length > 0 && (
                <p className="text-[10px] text-gray-500 mt-2 text-center">
                  {savedConfigurations.length} saved configuration{savedConfigurations.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Chart and Results */}
        <div className="space-y-6">
          {/* Interactive Chart */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">
                {pendingExit
                  ? `${symbol} Price Chart - Click to Set EXIT Point`
                  : `${symbol} Price Chart - Click to Place Entry`}
              </h3>
              <button
                onClick={handleResetZoom}
                className="rounded-lg border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-400 transition hover:border-white hover:text-white"
              >
                Reset Zoom
              </button>
            </div>
            <div className="h-96">
              <Line
                ref={chartRef}
                data={{
                  labels: timestamps.map((ts) => formatDate(ts)),
                  datasets: [
                    {
                      label: symbol,
                      data: prices,
                      borderColor: "#10b981",
                      borderWidth: 2,
                      pointRadius: 0,
                      pointHoverRadius: 6,
                      tension: 0.1,
                    },
                  ],
                }}
                plugins={[verticalLinePlugin]}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  onClick: handleChartClick,
                  onHover: (event, elements) => {
                    // Debounce hover updates to reduce lag
                    if (hoverTimeoutRef.current) {
                      clearTimeout(hoverTimeoutRef.current);
                    }
                    hoverTimeoutRef.current = setTimeout(() => {
                      if (elements.length > 0) {
                        setHoveredIndex(elements[0].index);
                      } else {
                        setHoveredIndex(null);
                      }
                    }, 50); // 50ms debounce
                  },
                  interaction: {
                    mode: 'index',
                    intersect: false,
                  },
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (context) => {
                          const labels = [];
                          // Show price
                          if (context.parsed.y) {
                            labels.push(`Price: $${context.parsed.y.toFixed(2)}`);
                          }
                          // Show trade info if there's a trade at this index
                          // Convert chart-relative dataIndex to absolute index for comparison
                          const absoluteIndex = (startBar ?? 0) + context.dataIndex;
                          const trade = trades.find((t) => t.index === absoluteIndex);
                          if (trade) {
                            labels.push(`Trade: ${trade.action.toUpperCase()} ${trade.quantity} ${trade.type === "stock" ? "shares" : `${trade.type.toUpperCase()} contracts`}`);
                          }
                          return labels;
                        },
                      },
                    },
                    zoom: {
                      pan: {
                        enabled: true,
                        mode: 'x',
                        modifierKey: 'shift',
                        onPanStart: () => {
                          isZoomingRef.current = true;
                          return true;
                        },
                        onPanComplete: () => {
                          setTimeout(() => {
                            isZoomingRef.current = false;
                          }, 100);
                        },
                      },
                      zoom: {
                        wheel: {
                          enabled: true,
                        },
                        pinch: {
                          enabled: true,
                        },
                        drag: {
                          enabled: true,
                          modifierKey: 'shift',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          borderColor: 'rgba(59, 130, 246, 0.5)',
                          borderWidth: 1,
                        },
                        mode: 'x',
                        onZoomStart: () => {
                          isZoomingRef.current = true;
                          return true;
                        },
                        onZoomComplete: () => {
                          setTimeout(() => {
                            isZoomingRef.current = false;
                          }, 100);
                        },
                      },
                      limits: {
                        x: { min: 'original', max: 'original' },
                      },
                    },
                  },
                  scales: {
                    x: {
                      display: true,
                      grid: { display: false },
                      ticks: { maxTicksLimit: 10 },
                    },
                    y: {
                      display: true,
                      grid: { color: "#1f2937" },
                    },
                  },
                }}
              />
            </div>
            <p className="mt-3 text-xs text-gray-500 text-center">
              {pendingExit ? (
                <span className="text-orange-400 font-semibold">
                  ⚠️ Waiting for EXIT point - Click chart or use modal to set exit
                </span>
              ) : (
                <>
                  Currently placing: <span className="font-semibold text-white">{currentMode.replace("_", " ").toUpperCase()}</span>
                </>
              )}
            </p>
          </div>

          {/* Results */}
          {result && result.manual_stats && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
              <h3 className="text-sm font-semibold text-white mb-4">Simulation Results</h3>

              {/* Equity Summary */}
              <div className="mb-4 rounded-lg border-2 border-blue-700 bg-blue-950/30 p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-blue-400 font-semibold mb-1">Initial Equity</div>
                    <div className="text-lg font-mono font-bold text-white">
                      ${initialCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-blue-400 font-semibold mb-1">Final Equity</div>
                    <div className={`text-lg font-mono font-bold ${
                      (initialCash + result.manual_stats.net_pnl) >= initialCash ? "text-green-400" : "text-red-400"
                    }`}>
                      ${(initialCash + result.manual_stats.net_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-blue-800">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-blue-300 font-semibold">Total Change</span>
                    <span className={`text-base font-mono font-bold ${
                      result.manual_stats.net_pnl >= 0 ? "text-green-400" : "text-red-400"
                    }`}>
                      {result.manual_stats.net_pnl >= 0 ? "+" : ""}${result.manual_stats.net_pnl.toFixed(2)} ({result.manual_stats.net_pnl >= 0 ? "+" : ""}{(result.manual_stats.return_on_capital * 100).toFixed(2)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded border border-gray-700 bg-gray-800 p-3">
                  <div className="text-xs text-gray-400">Net P&L</div>
                  <div
                    className={`text-xl font-bold ${
                      result.manual_stats.net_pnl >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    ${result.manual_stats.net_pnl.toFixed(2)}
                  </div>
                </div>
                <div className="rounded border border-gray-700 bg-gray-800 p-3">
                  <div className="text-xs text-gray-400">Win Rate</div>
                  <div className="text-xl font-bold text-white">
                    {(result.manual_stats.win_rate * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="rounded border border-gray-700 bg-gray-800 p-3">
                  <div className="text-xs text-gray-400">Total Trades</div>
                  <div className="text-lg font-semibold text-white">{result.manual_stats.num_trades}</div>
                </div>
                <div className="rounded border border-gray-700 bg-gray-800 p-3">
                  <div className="text-xs text-gray-400">Return on Capital</div>
                  <div className="text-lg font-semibold text-white">
                    {(result.manual_stats.return_on_capital * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-gray-400">Trade Results</h4>
                {result.simulated_trades?.map((trade: any, i: number) => (
                  <div key={i} className="rounded border border-gray-700 bg-gray-800 p-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-300">Trade {i + 1}</span>
                      <span className={trade.payoff >= 0 ? "text-green-400" : "text-red-400"}>
                        ${trade.payoff.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-900 bg-red-950/30 p-4 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Exit Strategy Modal */}
      {showExitModal && pendingExit && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-700 max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Set Exit Strategy</h3>
              <button
                onClick={() => {
                  setPendingExit(null);
                  setShowExitModal(false);
                  setStopLoss(null);
                  setTakeProfit(null);
                  setExitDate("");
                  setExitDaysInAdvance(null);
                }}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>

            <div className="rounded-lg border border-blue-900/50 bg-blue-950/30 p-3">
              <p className="text-sm text-blue-300">
                <strong>Entry:</strong> {pendingExit.type.toUpperCase()} @ ${pendingExit.price.toFixed(2)} on {formatDate(pendingExit.timestamp)}
              </p>
              <p className="text-xs text-blue-400 mt-1">
                Choose your exit strategy: click on the chart OR use the date picker below
              </p>
            </div>

            <div className="space-y-3">
              {/* Position Sizing */}
              <div className={`rounded-lg border p-3 ${
                ((pendingExit.price * pendingExit.quantity / initialCash) * 100) > 25
                  ? 'border-orange-700 bg-orange-950/30'
                  : 'border-gray-700 bg-gray-800/50'
              }`}>
                <h4 className="text-xs font-semibold text-gray-300 mb-2">Position Size</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-400">Cost:</span>
                    <span className="ml-2 text-white font-mono">${(pendingExit.price * pendingExit.quantity).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">% of Portfolio:</span>
                    <span className={`ml-2 font-mono font-semibold ${
                      ((pendingExit.price * pendingExit.quantity / initialCash) * 100) > 25
                        ? 'text-orange-400'
                        : 'text-white'
                    }`}>
                      {((pendingExit.price * pendingExit.quantity / initialCash) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                {((pendingExit.price * pendingExit.quantity / initialCash) * 100) > 25 && (
                  <p className="text-[10px] text-orange-400 mt-2">
                    ⚠ Large position size - consider diversifying your risk
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Days in Advance
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="7"
                    value={exitDaysInAdvance ?? ""}
                    onChange={(e) => {
                      const days = e.target.value ? parseInt(e.target.value) : null;
                      setExitDaysInAdvance(days);
                      if (days && pendingExit) {
                        const futureDate = new Date(pendingExit.timestamp);
                        futureDate.setDate(futureDate.getDate() + days);
                        setExitDate(futureDate.toISOString().split("T")[0]);
                      }
                    }}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Exit {exitDaysInAdvance || '?'} days after entry
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Exit Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={exitDate}
                    onChange={(e) => {
                      setExitDate(e.target.value);
                      // Calculate days in advance when date is manually set
                      if (e.target.value && pendingExit) {
                        const entryDate = new Date(pendingExit.timestamp);
                        const exitDate = new Date(e.target.value);
                        const diffTime = exitDate.getTime() - entryDate.getTime();
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        setExitDaysInAdvance(diffDays > 0 ? diffDays : null);
                      }
                    }}
                    min={new Date(pendingExit.timestamp).toISOString().split("T")[0]}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Or click on chart
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Stop Loss
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={`${(pendingExit.price * 0.95).toFixed(2)}`}
                    value={stopLoss ?? ""}
                    onChange={(e) => setStopLoss(e.target.value ? parseFloat(e.target.value) : null)}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                  />
                  {stopLoss && stopLoss < pendingExit.price && (
                    <p className="text-[10px] text-red-400 mt-1">
                      Risk: ${((pendingExit.price - stopLoss) * pendingExit.quantity).toFixed(2)} (
                      {(((pendingExit.price - stopLoss) / pendingExit.price) * 100).toFixed(1)}%)
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Take Profit
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={`${(pendingExit.price * 1.1).toFixed(2)}`}
                    value={takeProfit ?? ""}
                    onChange={(e) => setTakeProfit(e.target.value ? parseFloat(e.target.value) : null)}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                  />
                  {takeProfit && takeProfit > pendingExit.price && (
                    <p className="text-[10px] text-green-400 mt-1">
                      Reward: ${((takeProfit - pendingExit.price) * pendingExit.quantity).toFixed(2)} (
                      {(((takeProfit - pendingExit.price) / pendingExit.price) * 100).toFixed(1)}%)
                    </p>
                  )}
                </div>
              </div>

              {/* Risk/Reward Ratio */}
              {stopLoss && takeProfit && stopLoss < pendingExit.price && takeProfit > pendingExit.price && (
                <div className="rounded-lg border border-blue-700 bg-blue-950/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-300">Risk/Reward Ratio:</span>
                    <span className={`text-sm font-bold ${
                      ((takeProfit - pendingExit.price) / (pendingExit.price - stopLoss)) >= 2
                        ? 'text-green-400'
                        : ((takeProfit - pendingExit.price) / (pendingExit.price - stopLoss)) >= 1
                        ? 'text-yellow-400'
                        : 'text-red-400'
                    }`}>
                      1:{((takeProfit - pendingExit.price) / (pendingExit.price - stopLoss)).toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[10px] text-blue-400 mt-1">
                    {((takeProfit - pendingExit.price) / (pendingExit.price - stopLoss)) >= 2
                      ? '✓ Excellent risk/reward ratio'
                      : ((takeProfit - pendingExit.price) / (pendingExit.price - stopLoss)) >= 1
                      ? '⚠ Acceptable risk/reward ratio'
                      : '⚠ Poor risk/reward ratio - consider adjusting levels'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  // Use the selected date to find exit point
                  if (exitDate) {
                    const exitTimestamp = new Date(exitDate).getTime();
                    const exitIndex = timestamps.findIndex((ts) => ts >= exitTimestamp);

                    // Convert chart-relative exitIndex to absolute for comparison and storage
                    const absoluteExitIndex = (startBar ?? 0) + exitIndex;

                    if (absoluteExitIndex > pendingExit.index) {
                      const updatedTrade = {
                        ...pendingExit,
                        exitTimestamp: timestamps[exitIndex],
                        exitIndex: absoluteExitIndex,
                        exitPrice: prices[exitIndex],
                        stopLoss: stopLoss ?? undefined,
                        takeProfit: takeProfit ?? undefined,
                        isOpen: false,
                      };

                      const updatedTrades = [...trades.filter((t) => t.id !== pendingExit.id), updatedTrade];
                      setTrades(updatedTrades);
                      tradesRef.current = updatedTrades;

                      setPendingExit(null);
                      setShowExitModal(false);
                      setStopLoss(null);
                      setTakeProfit(null);
                      setExitDate("");

                      if (chartRef.current) {
                        chartRef.current.update();
                      }
                    } else {
                      setError("Exit date must be after entry date");
                      setTimeout(() => setError(null), 3000);
                    }
                  } else {
                    setError("Please select an exit date or click on the chart");
                    setTimeout(() => setError(null), 3000);
                  }
                }}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 transition"
              >
                Set Exit by Date
              </button>
              <button
                onClick={() => {
                  setShowExitModal(false);
                }}
                className="flex-1 rounded-lg border border-blue-600 bg-blue-950/50 px-4 py-2.5 text-sm font-semibold text-blue-300 hover:bg-blue-900/50 transition"
              >
                Click Chart Instead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Configuration Modal */}
      {showSaveConfigModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-700 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Save Configuration</h3>
              <button
                onClick={() => {
                  setShowSaveConfigModal(false);
                  setConfigName("");
                }}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Configuration Name
              </label>
              <input
                type="text"
                value={configName}
                onChange={(e) => setConfigName(e.target.value)}
                placeholder="e.g., Swing Trade Setup"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSaveConfiguration();
                  }
                }}
              />
            </div>

            <div className="rounded-lg border border-blue-900/50 bg-blue-950/30 p-3">
              <p className="text-xs text-blue-300">
                This will save {trades.length} trade{trades.length !== 1 ? 's' : ''} for <strong>{datasetName}</strong>
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowSaveConfigModal(false);
                  setConfigName("");
                }}
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveConfiguration}
                disabled={!configName.trim()}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Configuration Modal */}
      {showLoadConfigModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-700 max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Load Configuration</h3>
              <button
                onClick={() => setShowLoadConfigModal(false)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto space-y-2">
              {savedConfigurations.map((config) => (
                <div
                  key={config.id}
                  className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 hover:bg-gray-800 transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-white">{config.name}</h4>
                      <p className="text-xs text-gray-400 mt-1">
                        {config.trades.length} trade{config.trades.length !== 1 ? 's' : ''} • {config.datasetName}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Initial Cash: ${config.initialCash.toLocaleString()} • Saved {new Date(config.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoadConfiguration(config)}
                        className="rounded-lg border border-purple-600 bg-purple-950/50 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-900/50 transition"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${config.name}"?`)) {
                            handleDeleteConfiguration(config.id);
                          }
                        }}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {savedConfigurations.length === 0 && (
              <div className="text-center py-8 text-sm text-gray-500">
                No saved configurations yet
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
