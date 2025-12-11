"use client";

import { useState, useRef, useEffect } from "react";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, ChartEvent, ActiveElement } from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";

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
}

interface ManualModeProps {
  datasetPath: string;
  datasetName: string;
  symbol: string;
  apiBase: string;
}

// Register zoom plugin
ChartJS.register(zoomPlugin);

export default function ManualMode({ datasetPath, datasetName, symbol, apiBase }: ManualModeProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [currentMode, setCurrentMode] = useState<"buy_stock" | "sell_stock" | "buy_call" | "buy_put">("buy_stock");
  const [quantity, setQuantity] = useState(100);
  const [result, setResult] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<ChartJS<"line">>(null);

  // Load price data from a quick backtest
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [prices, setPrices] = useState<number[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

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
          }),
        });

        if (!res.ok) {
          throw new Error(`Failed to load price data: ${res.statusText}`);
        }

        const data = await res.json();
        if (data.timestamps && data.price_series) {
          setTimestamps(data.timestamps);
          setPrices(data.price_series);
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
  }, [datasetPath, symbol, apiBase]);

  const handleChartClick = (event: ChartEvent, elements: ActiveElement[]) => {
    const chart = chartRef.current;
    if (!chart) return;

    // If we have elements under cursor, use the first one's index
    let dataIndex: number;

    if (elements.length > 0) {
      // Don't place trades if clicking on an existing trade marker
      if (elements[0].datasetIndex === 1) {
        return;
      }
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

    if (dataIndex < 0 || dataIndex >= timestamps.length || dataIndex >= prices.length) return;

    const clickedTimestamp = timestamps[dataIndex];
    const clickedPrice = prices[dataIndex];

    // Create trade at this point
    const newTrade: Trade = {
      id: `trade_${Date.now()}`,
      timestamp: clickedTimestamp,
      index: dataIndex,
      type: currentMode.includes("stock") ? "stock" : currentMode.includes("call") ? "call" : "put",
      action: currentMode.includes("buy") ? "buy" : "sell",
      price: clickedPrice,
      quantity: quantity,
    };

    // For options, need to set strike and expiry
    if (newTrade.type !== "stock") {
      // Default: ATM strike, 30 days out
      newTrade.strike = Math.round(clickedPrice);
      const expiryDate = new Date(clickedTimestamp);
      expiryDate.setDate(expiryDate.getDate() + 30);
      newTrade.expiry = expiryDate.toISOString().split("T")[0];
    }

    setTrades([...trades, newTrade]);
  };

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
    }
  };

  const handleDeleteTrade = (id: string) => {
    setTrades(trades.filter((t) => t.id !== id));
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

      // Convert to backend format
      const annotations = sortedTrades
        .filter((t) => t.type !== "stock")
        .map((t) => ({
          id: t.id,
          timestamp: t.timestamp,
          type: t.type,
          action: t.action,
          strike: t.strike!,
          expiry: t.expiry!,
          contracts: Math.floor(t.quantity / 100), // Convert shares to contracts
          note: t.note,
        }));

      const response = await fetch(`${apiBase}/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          csv_path: datasetPath,
          symbol: symbol,
          annotations: annotations,
          option_settings: {
            implied_volatility: 0.30,
            risk_free_rate: 0.05,
            use_black_scholes: true,
            scenario: "base",
            scenario_move_pct: 0.10,
            commission_per_contract: 0.65,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Simulation failed");
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsRunning(false);
    }
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString();

  // Show loading state while fetching price data
  if (isLoadingData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="text-gray-400">Loading price data for manual trading...</p>
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
      {/* Instructions */}
      <div className="rounded-xl border border-blue-900/50 bg-blue-950/30 p-4">
        <h3 className="text-sm font-semibold text-blue-400 mb-2">How to Use Manual Mode</h3>
        <ol className="text-sm text-blue-300 space-y-1 list-decimal list-inside">
          <li>Select trade type below (Buy Stock, Buy Call, Buy Put, etc.)</li>
          <li><strong>Click</strong> on the chart where you want to place a trade</li>
          <li>Hold <strong>Shift + Drag</strong> to zoom into a specific time range</li>
          <li>Use <strong>mouse wheel</strong> to zoom in/out, or <strong>Shift + Drag</strong> to pan</li>
          <li>Click "Run Simulation" to see how your trades would have performed</li>
        </ol>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Left Panel - Trade Controls */}
        <div className="space-y-4">
          {/* Trade Type Selector */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Select Trade Type</h3>
            <div className="space-y-2">
              <button
                onClick={() => setCurrentMode("buy_stock")}
                className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  currentMode === "buy_stock"
                    ? "bg-green-600 text-white"
                    : "border border-gray-700 text-gray-400 hover:text-white"
                }`}
              >
                Buy Stock
              </button>
              <button
                onClick={() => setCurrentMode("sell_stock")}
                className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  currentMode === "sell_stock"
                    ? "bg-red-600 text-white"
                    : "border border-gray-700 text-gray-400 hover:text-white"
                }`}
              >
                Sell Stock
              </button>
              <button
                onClick={() => setCurrentMode("buy_call")}
                className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  currentMode === "buy_call"
                    ? "bg-blue-600 text-white"
                    : "border border-gray-700 text-gray-400 hover:text-white"
                }`}
              >
                Buy Call Option
              </button>
              <button
                onClick={() => setCurrentMode("buy_put")}
                className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  currentMode === "buy_put"
                    ? "bg-orange-600 text-white"
                    : "border border-gray-700 text-gray-400 hover:text-white"
                }`}
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
                step={currentMode.includes("stock") ? "1" : "1"}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              />
            </div>
          </div>

          {/* Trade List */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Your Trades ({trades.length})</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {trades.map((trade) => (
                <div key={trade.id} className="rounded border border-gray-700 bg-gray-800 p-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            trade.action === "buy" ? "bg-green-400" : "bg-red-400"
                          }`}
                        />
                        <span className="text-xs font-semibold text-white">
                          {trade.action.toUpperCase()} {trade.quantity}{" "}
                          {trade.type === "stock" ? "shares" : `${trade.type.toUpperCase()} contracts`}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        ${trade.price.toFixed(2)} on {formatDate(trade.timestamp)}
                      </div>
                      {trade.type !== "stock" && (
                        <div className="text-xs text-gray-500">
                          Strike ${trade.strike}, Exp {trade.expiry}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteTrade(trade.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      ×
                    </button>
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
              onClick={() => setTrades([])}
              disabled={trades.length === 0}
              className="w-full rounded-xl border border-gray-700 bg-gray-900 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:opacity-50"
            >
              Clear All Trades
            </button>
          </div>
        </div>

        {/* Right Panel - Chart and Results */}
        <div className="space-y-6">
          {/* Interactive Chart */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">
                {symbol} Price Chart - Click to Place Trades
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
                    // Trade markers - create sparse array with markers at correct indices
                    {
                      label: "Trades",
                      data: prices.map((price, idx) => {
                        const trade = trades.find((t) => t.index === idx);
                        return trade ? trade.price : null as any;
                      }),
                      backgroundColor: prices.map((_, idx) => {
                        const trade = trades.find((t) => t.index === idx);
                        return trade?.action === "buy" ? "#22c55e" : "#ef4444";
                      }),
                      borderColor: prices.map((_, idx) => {
                        const trade = trades.find((t) => t.index === idx);
                        return trade?.action === "buy" ? "#16a34a" : "#dc2626";
                      }),
                      pointRadius: prices.map((_, idx) => {
                        return trades.find((t) => t.index === idx) ? 8 : 0;
                      }),
                      pointHoverRadius: 10,
                      showLine: false,
                      spanGaps: true,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  onClick: handleChartClick,
                  interaction: {
                    mode: 'index',
                    intersect: false,
                  },
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (context) => {
                          if (context.datasetIndex === 1 && context.parsed.y !== null) {
                            const trade = trades.find((t) => t.index === context.dataIndex);
                            if (trade) {
                              return `${trade.action.toUpperCase()} ${trade.type} @ $${trade.price.toFixed(2)}`;
                            }
                          }
                          return context.parsed.y ? `$${context.parsed.y.toFixed(2)}` : "";
                        },
                      },
                    },
                    zoom: {
                      pan: {
                        enabled: true,
                        mode: 'x',
                        modifierKey: 'shift' as any,
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
                          modifierKey: 'shift' as any,
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          borderColor: 'rgba(59, 130, 246, 0.5)',
                          borderWidth: 1,
                        },
                        mode: 'x',
                      },
                      limits: {
                        x: { min: 'original' as any, max: 'original' as any },
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
              Currently placing: <span className="font-semibold text-white">{currentMode.replace("_", " ").toUpperCase()}</span>
            </p>
          </div>

          {/* Results */}
          {result && result.manual_stats && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
              <h3 className="text-sm font-semibold text-white mb-4">Simulation Results</h3>

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
    </div>
  );
}
