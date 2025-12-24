"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
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
} from "chart.js";
import "chartjs-adapter-date-fns";

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, TimeScale, Tooltip, Legend, Filler);

// ==================== TYPES ====================

interface StockPosition {
  id: string; // Unique ID for each position (to support multiple buys of same stock)
  symbol: string;
  name: string;
  shares: number;
  costBasis: number; // Price per share when purchased
  purchaseDate: number; // Timestamp when stock was purchased
  referenceDate: number; // Timestamp for calculating gain/loss (user-configurable)
  currentPrice: number;
  change: number;
  changePercent: number;
  color: string;
  cardColor: string;
  lineThickness: number;
  fontSize: number;
  lastUpdate: number;
  historicalData: { timestamp: number; price: number }[];
}

interface PortfolioState {
  positions: StockPosition[];
  totalValue: number;
  totalCost: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
}

interface ChartConfig {
  backgroundColor: string;
  gridOpacity: number;
  axisColor: string;
  lineThickness: number;
  showGlow: boolean;
}

type TimeRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";
type ChartView = "portfolio" | "earnings";

const PRESET_COLORS = [
  "#60a5fa", // blue
  "#34d399", // green
  "#a78bfa", // purple
  "#f87171", // red
  "#fbbf24", // yellow
  "#38bdf8", // cyan
  "#fb923c", // orange
  "#ec4899", // pink
];

const STORAGE_KEY = "priorsystems:live-portfolio";
const SAVED_PORTFOLIOS_KEY = "priorsystems:saved-portfolios";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8002";

// ==================== MAIN COMPONENT ====================

export default function LivePricesPage() {
  // State
  const [portfolio, setPortfolio] = useState<PortfolioState>({
    positions: [],
    totalValue: 0,
    totalCost: 0,
    totalGainLoss: 0,
    totalGainLossPercent: 0,
  });
  const [timeRange, setTimeRange] = useState<TimeRange>("1M");
  const [chartView, setChartView] = useState<ChartView>("portfolio");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showCustomization, setShowCustomization] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [chartConfig, setChartConfig] = useState<ChartConfig>({
    backgroundColor: "#0a0a0f",
    gridOpacity: 0.1,
    axisColor: "#6b7280",
    lineThickness: 2,
    showGlow: false,
  });

  const ITEMS_PER_PAGE = 8; // 2 rows x 4 columns
  const totalPages = Math.ceil(portfolio.positions.length / ITEMS_PER_PAGE);
  const paginatedPositions = portfolio.positions.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  // Load portfolio from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        setPortfolio(data);
      }
    } catch (error) {
      console.error("Failed to load portfolio:", error);
    }
  }, []);

  // Save portfolio to localStorage whenever it changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (portfolio.positions.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
    }
  }, [portfolio]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      refreshPrices();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [portfolio.positions]);

  // Auto-refresh when time range changes
  useEffect(() => {
    if (portfolio.positions.length > 0) {
      refreshPrices();
    }
  }, [timeRange]);

  // Refresh stock prices
  const refreshPrices = useCallback(async () => {
    if (portfolio.positions.length === 0) return;

    setIsRefreshing(true);
    try {
      // Fetch latest prices for all positions
      const symbols = portfolio.positions.map((p) => p.symbol);
      const response = await fetch(`${API_BASE}/api/stock-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols, range: timeRange }),
      });

      if (!response.ok) throw new Error("Failed to fetch prices");

      const data = await response.json();

      // Update positions with new prices
      const updatedPositions = portfolio.positions.map((position) => {
        const stockData = data[position.symbol];
        if (!stockData) return position;

        const currentPrice = stockData.current_price;
        const change = currentPrice - stockData.previous_close;
        const changePercent = (change / stockData.previous_close) * 100;

        return {
          ...position,
          currentPrice,
          change,
          changePercent,
          lastUpdate: Date.now(),
          historicalData: stockData.historical,
        };
      });

      // Recalculate portfolio totals
      const totalValue = updatedPositions.reduce(
        (sum, p) => sum + p.shares * p.currentPrice,
        0
      );
      const totalCost = updatedPositions.reduce(
        (sum, p) => sum + p.shares * p.costBasis,
        0
      );
      const totalGainLoss = totalValue - totalCost;
      const totalGainLossPercent = (totalGainLoss / totalCost) * 100;

      setPortfolio({
        positions: updatedPositions,
        totalValue,
        totalCost,
        totalGainLoss,
        totalGainLossPercent,
      });

      setLastRefresh(new Date());
    } catch (error) {
      console.error("Failed to refresh prices:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [portfolio.positions, timeRange]);

  // Add new stock position
  const addPosition = useCallback(async (symbol: string, shares: number, currentValue: number, purchaseDate: number) => {
    try {
      // Fetch current stock data
      const response = await fetch(`${API_BASE}/api/stock-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: [symbol], range: timeRange }),
      });

      if (!response.ok) throw new Error("Failed to fetch stock data");

      const data = await response.json();
      const stockData = data[symbol];

      if (!stockData) throw new Error("Stock not found");

      const colorIndex = portfolio.positions.length % PRESET_COLORS.length;

      // Calculate cost basis from current value
      // Current value = shares * current price
      // Cost basis per share = current value / shares
      const costBasis = currentValue / shares;

      // Generate unique ID for this position
      const positionId = `${symbol.toUpperCase()}-${purchaseDate}-${Date.now()}`;

      const newPosition: StockPosition = {
        id: positionId,
        symbol: symbol.toUpperCase(),
        name: stockData.name || symbol,
        shares,
        costBasis,
        purchaseDate,
        referenceDate: purchaseDate, // Default to purchase date, user can change later
        currentPrice: stockData.current_price,
        change: stockData.current_price - stockData.previous_close,
        changePercent: ((stockData.current_price - stockData.previous_close) / stockData.previous_close) * 100,
        color: PRESET_COLORS[colorIndex],
        cardColor: PRESET_COLORS[colorIndex] + "20",
        lineThickness: 2,
        fontSize: 100,
        lastUpdate: Date.now(),
        historicalData: stockData.historical,
      };

      const updatedPositions = [...portfolio.positions, newPosition];
      const totalValue = updatedPositions.reduce((sum, p) => sum + p.shares * p.currentPrice, 0);
      const totalCost = updatedPositions.reduce((sum, p) => sum + p.shares * p.costBasis, 0);
      const totalGainLoss = totalValue - totalCost;

      setPortfolio({
        positions: updatedPositions,
        totalValue,
        totalCost,
        totalGainLoss,
        totalGainLossPercent: (totalGainLoss / totalCost) * 100,
      });

      setShowAddDialog(false);
    } catch (error) {
      console.error("Failed to add position:", error);
      alert("Failed to add stock. Please try again.");
    }
  }, [portfolio.positions, timeRange]);

  // Remove position by ID (allows removing specific positions of same stock)
  const removePosition = useCallback((positionId: string) => {
    const updatedPositions = portfolio.positions.filter((p) => p.id !== positionId);
    const totalValue = updatedPositions.reduce((sum, p) => sum + p.shares * p.currentPrice, 0);
    const totalCost = updatedPositions.reduce((sum, p) => sum + p.shares * p.costBasis, 0);
    const totalGainLoss = totalValue - totalCost;

    setPortfolio({
      positions: updatedPositions,
      totalValue,
      totalCost,
      totalGainLoss,
      totalGainLossPercent: totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0,
    });
  }, [portfolio]);

  // Update position color
  const updatePositionColor = useCallback((symbol: string, color: string) => {
    setPortfolio((prev) => ({
      ...prev,
      positions: prev.positions.map((p) =>
        p.symbol === symbol ? { ...p, color } : p
      ),
    }));
  }, []);

  // Update position card color
  const updatePositionCardColor = useCallback((symbol: string, cardColor: string) => {
    setPortfolio((prev) => ({
      ...prev,
      positions: prev.positions.map((p) =>
        p.symbol === symbol ? { ...p, cardColor } : p
      ),
    }));
  }, []);

  // Update position line thickness
  const updatePositionLineThickness = useCallback((symbol: string, thickness: number) => {
    setPortfolio((prev) => ({
      ...prev,
      positions: prev.positions.map((p) =>
        p.symbol === symbol ? { ...p, lineThickness: thickness } : p
      ),
    }));
  }, []);

  // Update position font size
  const updatePositionFontSize = useCallback((symbol: string, fontSize: number) => {
    setPortfolio((prev) => ({
      ...prev,
      positions: prev.positions.map((p) =>
        p.symbol === symbol ? { ...p, fontSize } : p
      ),
    }));
  }, []);

  // Update position reference date
  const updatePositionReferenceDate = useCallback((symbol: string, referenceDate: number) => {
    setPortfolio((prev) => ({
      ...prev,
      positions: prev.positions.map((p) =>
        p.symbol === symbol ? { ...p, referenceDate } : p
      ),
    }));
  }, []);

  // Save portfolio with a custom name
  const savePortfolio = useCallback((name: string) => {
    if (!name.trim()) return;

    try {
      const savedPortfoliosJson = localStorage.getItem(SAVED_PORTFOLIOS_KEY);
      const savedPortfolios = savedPortfoliosJson ? JSON.parse(savedPortfoliosJson) : {};

      savedPortfolios[name] = {
        portfolio,
        chartConfig,
        savedAt: Date.now(),
      };

      localStorage.setItem(SAVED_PORTFOLIOS_KEY, JSON.stringify(savedPortfolios));
      setShowSaveDialog(false);
      alert(`Portfolio "${name}" saved successfully!`);
    } catch (error) {
      console.error("Failed to save portfolio:", error);
      alert("Failed to save portfolio. Please try again.");
    }
  }, [portfolio, chartConfig]);

  // Load a saved portfolio by name
  const loadPortfolio = useCallback((name: string) => {
    try {
      const savedPortfoliosJson = localStorage.getItem(SAVED_PORTFOLIOS_KEY);
      if (!savedPortfoliosJson) return;

      const savedPortfolios = JSON.parse(savedPortfoliosJson);
      const saved = savedPortfolios[name];

      if (!saved) {
        alert(`Portfolio "${name}" not found.`);
        return;
      }

      setPortfolio(saved.portfolio);
      setChartConfig(saved.chartConfig);
      setShowLoadDialog(false);
      alert(`Portfolio "${name}" loaded successfully!`);
    } catch (error) {
      console.error("Failed to load portfolio:", error);
      alert("Failed to load portfolio. Please try again.");
    }
  }, []);

  // Delete a saved portfolio
  const deleteSavedPortfolio = useCallback((name: string) => {
    try {
      const savedPortfoliosJson = localStorage.getItem(SAVED_PORTFOLIOS_KEY);
      if (!savedPortfoliosJson) return;

      const savedPortfolios = JSON.parse(savedPortfoliosJson);
      delete savedPortfolios[name];

      localStorage.setItem(SAVED_PORTFOLIOS_KEY, JSON.stringify(savedPortfolios));
    } catch (error) {
      console.error("Failed to delete portfolio:", error);
    }
  }, []);

  // Get list of saved portfolios
  const getSavedPortfolios = useCallback(() => {
    try {
      const savedPortfoliosJson = localStorage.getItem(SAVED_PORTFOLIOS_KEY);
      if (!savedPortfoliosJson) return [];

      const savedPortfolios = JSON.parse(savedPortfoliosJson);
      return Object.keys(savedPortfolios).map(name => ({
        name,
        savedAt: savedPortfolios[name].savedAt,
        positionCount: savedPortfolios[name].portfolio.positions.length,
      }));
    } catch (error) {
      console.error("Failed to get saved portfolios:", error);
      return [];
    }
  }, []);

  // Format time since last update
  const getTimeSinceRefresh = () => {
    const now = new Date();
    const diffMs = now.getTime() - lastRefresh.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins === 0) return "just now";
    if (diffMins === 1) return "1 minute ago";
    if (diffMins < 60) return `${diffMins} minutes ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return "1 hour ago";
    return `${diffHours} hours ago`;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-gray-400 hover:text-white transition"
            >
              ← Dashboard
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Live Prices</h1>
              <p className="text-sm text-gray-400">
                Real-time portfolio tracking
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-400">
              Last updated: {getTimeSinceRefresh()}
            </div>
            <button
              onClick={() => setShowSaveDialog(true)}
              className="px-3 py-2 hover:bg-gray-800 rounded-lg transition text-sm font-medium"
              title="Save Portfolio"
            >
              Save
            </button>
            <button
              onClick={() => setShowLoadDialog(true)}
              className="px-3 py-2 hover:bg-gray-800 rounded-lg transition text-sm font-medium"
              title="Load Portfolio"
            >
              Load
            </button>
            <button
              onClick={refreshPrices}
              disabled={isRefreshing}
              className="p-2 hover:bg-gray-800 rounded-lg transition disabled:opacity-50"
              title="Refresh prices"
            >
              <svg
                className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            <button
              onClick={() => setShowCustomization(!showCustomization)}
              className="p-2 hover:bg-gray-800 rounded-lg transition"
              title="Customization"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Portfolio Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="text-sm text-gray-400 mb-1">Total Value</div>
            <div className="text-2xl font-bold">
              ${portfolio.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="text-sm text-gray-400 mb-1">Total Cost</div>
            <div className="text-2xl font-bold text-gray-300">
              ${portfolio.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="text-sm text-gray-400 mb-1">Total Gain/Loss</div>
            <div className={`text-2xl font-bold ${portfolio.totalGainLoss >= 0 ? "text-green-400" : "text-red-400"}`}>
              {portfolio.totalGainLoss >= 0 ? "+" : ""}${portfolio.totalGainLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="text-sm text-gray-400 mb-1">Return</div>
            <div className={`text-2xl font-bold ${portfolio.totalGainLossPercent >= 0 ? "text-green-400" : "text-red-400"}`}>
              {portfolio.totalGainLossPercent >= 0 ? "+" : ""}{portfolio.totalGainLossPercent.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Stock Positions */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Your Holdings</h2>
            <button
              onClick={() => setShowAddDialog(true)}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 transition font-semibold flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Stock
            </button>
          </div>

          {portfolio.positions.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-800 bg-gray-900/30 p-12 text-center">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <h3 className="text-lg font-semibold mb-2">No holdings yet</h3>
              <p className="text-gray-400 mb-4">Add your first stock to start tracking your portfolio</p>
              <button
                onClick={() => setShowAddDialog(true)}
                className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 transition font-semibold"
              >
                Add Your First Stock
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {paginatedPositions.map((position) => (
                  <StockCard
                    key={position.id}
                    position={position}
                    onRemove={removePosition}
                    onColorChange={updatePositionColor}
                  />
                ))}
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-6">
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(0, prev - 1))}
                    disabled={currentPage === 0}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  <span className="text-sm text-gray-400">
                    Page {currentPage + 1} of {totalPages}
                  </span>

                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1))}
                    disabled={currentPage === totalPages - 1}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Portfolio Chart */}
        {portfolio.positions.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">
                {chartView === "portfolio" ? "Portfolio Value" : "Lifetime Earnings"}
              </h2>

              <div className="flex items-center gap-3">
                {/* Time Range Selector */}
                <div className="flex rounded-lg border border-gray-800 bg-gray-900/50 overflow-hidden">
                  {(["1D", "1W", "1M", "3M", "6M", "1Y", "ALL"] as TimeRange[]).map((range) => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={`px-3 py-1.5 text-sm font-medium transition ${
                        timeRange === range
                          ? "bg-blue-600 text-white"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>

                {/* View Toggle */}
                <button
                  onClick={() => setChartView(chartView === "portfolio" ? "earnings" : "portfolio")}
                  className="p-2 rounded-lg border border-gray-800 bg-gray-900/50 hover:bg-gray-800 transition"
                  title="Toggle view"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12M8 12h12m-12 5h12m-12 0H4m16 0h4" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-800 p-6" style={{ backgroundColor: chartConfig.backgroundColor }}>
              <PortfolioChart
                portfolio={portfolio}
                chartView={chartView}
                timeRange={timeRange}
                config={chartConfig}
              />
            </div>
          </section>
        )}
      </main>

      {/* Add Stock Dialog */}
      {showAddDialog && (
        <AddStockDialog
          onClose={() => setShowAddDialog(false)}
          onAdd={addPosition}
        />
      )}

      {/* Save Portfolio Dialog */}
      {showSaveDialog && (
        <SavePortfolioDialog
          onClose={() => setShowSaveDialog(false)}
          onSave={savePortfolio}
        />
      )}

      {/* Load Portfolio Dialog */}
      {showLoadDialog && (
        <LoadPortfolioDialog
          onClose={() => setShowLoadDialog(false)}
          onLoad={loadPortfolio}
          onDelete={deleteSavedPortfolio}
          getSavedPortfolios={getSavedPortfolios}
        />
      )}

      {/* Customization Panel */}
      {showCustomization && (
        <CustomizationPanel
          config={chartConfig}
          onConfigChange={setChartConfig}
          onClose={() => setShowCustomization(false)}
          portfolio={portfolio}
          onUpdateCardColor={updatePositionCardColor}
          onUpdateLineThickness={updatePositionLineThickness}
          onUpdateFontSize={updatePositionFontSize}
          onUpdateReferenceDate={updatePositionReferenceDate}
        />
      )}
    </div>
  );
}

// ==================== STOCK CARD COMPONENT ====================

interface StockCardProps {
  position: StockPosition;
  onRemove: (positionId: string) => void;
  onColorChange: (symbol: string, color: string) => void;
}

function StockCard({ position, onRemove, onColorChange }: StockCardProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);

  const positionValue = position.shares * position.currentPrice;
  const positionCost = position.shares * position.costBasis;
  const positionGainLoss = positionValue - positionCost;
  const positionGainLossPercent = (positionGainLoss / positionCost) * 100;

  // Calculate price at reference date (user-configurable date)
  const referenceDateData = position.historicalData.find(d =>
    Math.abs(d.timestamp - position.referenceDate) < 24 * 60 * 60 * 1000 // Within 1 day
  );
  const priceAtReference = referenceDateData?.price || position.costBasis;

  // Calculate gain/loss from reference date to current date
  const changeFromReference = position.currentPrice - priceAtReference;
  const changePercentFromReference = (changeFromReference / priceAtReference) * 100;

  const fontSizeScale = position.fontSize / 100;

  // Prepare sparkline data (last 20 points)
  const sparklineData = position.historicalData.slice(-20).map(d => d.price);
  const minPrice = Math.min(...sparklineData);
  const maxPrice = Math.max(...sparklineData);
  const priceRange = maxPrice - minPrice || 1;

  return (
    <div
      className="rounded-xl border p-4 relative transition-all"
      style={{
        borderColor: position.color + "40",
        backgroundColor: position.cardColor,
        fontSize: `${fontSizeScale}rem`
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full cursor-pointer"
            style={{ backgroundColor: position.color }}
            onClick={() => setShowColorPicker(!showColorPicker)}
          />
          <div>
            <div className="font-bold" style={{ fontSize: `${1.125 * fontSizeScale}rem` }}>{position.symbol}</div>
            <div className="text-xs text-gray-400" style={{ fontSize: `${0.75 * fontSizeScale}rem` }}>{position.name}</div>
          </div>
        </div>

        <button
          onClick={() => onRemove(position.id)}
          className="text-gray-500 hover:text-red-400 transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Color Picker */}
      {showColorPicker && (
        <div className="absolute top-12 left-4 z-10 p-3 rounded-lg border border-gray-800 bg-gray-900 shadow-xl">
          <div className="grid grid-cols-4 gap-2 mb-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => {
                  onColorChange(position.symbol, color);
                  setShowColorPicker(false);
                }}
                className="w-8 h-8 rounded-full border-2 border-transparent hover:border-white transition"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <button
            onClick={() => setShowColorPicker(false)}
            className="text-xs text-gray-400 hover:text-white w-full text-center"
          >
            Close
          </button>
        </div>
      )}

      {/* Price */}
      <div className="mb-3">
        <div className="text-2xl font-bold">${position.currentPrice.toFixed(2)}</div>
        <div className={`text-sm ${changePercentFromReference >= 0 ? "text-green-400" : "text-red-400"}`}>
          {changePercentFromReference >= 0 ? "+" : ""}{changeFromReference.toFixed(2)} ({changePercentFromReference.toFixed(2)}%) since {new Date(position.referenceDate).toLocaleDateString()}
        </div>
      </div>

      {/* Sparkline Chart */}
      <div className="mb-3">
        <svg width="100%" height="50" className="overflow-visible">
          <polyline
            fill="none"
            stroke={position.color}
            strokeWidth="2"
            points={sparklineData
              .map((price, idx) => {
                const x = (idx / (sparklineData.length - 1)) * 100;
                const y = 50 - ((price - minPrice) / priceRange) * 45;
                return `${x}%,${y}`;
              })
              .join(" ")}
          />
          {/* Add subtle fill under the line */}
          <defs>
            <linearGradient id={`gradient-${position.symbol}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style={{ stopColor: position.color, stopOpacity: 0.3 }} />
              <stop offset="100%" style={{ stopColor: position.color, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <polygon
            fill={`url(#gradient-${position.symbol})`}
            points={`0%,50 ${sparklineData
              .map((price, idx) => {
                const x = (idx / (sparklineData.length - 1)) * 100;
                const y = 50 - ((price - minPrice) / priceRange) * 45;
                return `${x}%,${y}`;
              })
              .join(" ")} 100%,50`}
          />
        </svg>
      </div>

      {/* Position Details */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Shares:</span>
          <span className="font-medium">{position.shares}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Cost Basis:</span>
          <span className="font-medium">${position.costBasis.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Position Value:</span>
          <span className="font-medium">${positionValue.toFixed(2)}</span>
        </div>
        <div className="flex justify-between pt-2 border-t border-gray-800">
          <span className="text-gray-400">Gain/Loss:</span>
          <span className={`font-bold ${positionGainLoss >= 0 ? "text-green-400" : "text-red-400"}`}>
            {positionGainLoss >= 0 ? "+" : ""}${positionGainLoss.toFixed(2)}
            <span className="text-xs ml-1">({positionGainLossPercent >= 0 ? "+" : ""}{positionGainLossPercent.toFixed(2)}%)</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ==================== PORTFOLIO CHART COMPONENT ====================

interface PortfolioChartProps {
  portfolio: PortfolioState;
  chartView: ChartView;
  timeRange: TimeRange;
  config: ChartConfig;
}

function PortfolioChart({ portfolio, chartView, timeRange, config }: PortfolioChartProps) {
  // Build chart data based on view
  const getChartData = () => {
    if (chartView === "portfolio") {
      // Group positions by symbol and aggregate shares
      const groupedBySymbol = new Map<string, StockPosition[]>();
      portfolio.positions.forEach((position) => {
        if (!groupedBySymbol.has(position.symbol)) {
          groupedBySymbol.set(position.symbol, []);
        }
        groupedBySymbol.get(position.symbol)!.push(position);
      });

      // Create one dataset per unique symbol
      const datasets = Array.from(groupedBySymbol.entries()).map(([symbol, positions]) => {
        // Use the first position's styling
        const firstPosition = positions[0];

        // Calculate total shares across all positions of this symbol
        const totalShares = positions.reduce((sum, p) => sum + p.shares, 0);

        return {
          label: symbol,
          data: firstPosition.historicalData.map((d) => ({
            x: d.timestamp,
            y: d.price * totalShares,
          })),
          borderColor: firstPosition.color,
          backgroundColor: firstPosition.color + "20",
          borderWidth: firstPosition.lineThickness,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          tension: 0.1,
          // Store all purchase dates for this symbol
          purchaseDates: positions.map(p => ({ date: p.purchaseDate, id: p.id })),
        };
      });

      return { datasets };
    } else {
      // Single line showing total portfolio value over time
      // Aggregate all positions' historical data
      const allTimestamps = new Set<number>();
      portfolio.positions.forEach((position) => {
        position.historicalData.forEach((d) => allTimestamps.add(d.timestamp));
      });

      const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

      const portfolioValues = sortedTimestamps.map((timestamp) => {
        const value = portfolio.positions.reduce((sum, position) => {
          const dataPoint = position.historicalData.find((d) => d.timestamp === timestamp);
          if (dataPoint) {
            return sum + dataPoint.price * position.shares;
          }
          return sum;
        }, 0);

        return { x: timestamp, y: value };
      });

      // Calculate earnings (value - cost)
      const earningsData = portfolioValues.map((point) => ({
        x: point.x,
        y: point.y - portfolio.totalCost,
      }));

      return {
        datasets: [
          {
            label: "Lifetime Earnings",
            data: earningsData,
            borderColor: earningsData[earningsData.length - 1]?.y >= 0 ? "#34d399" : "#f87171",
            backgroundColor: (earningsData[earningsData.length - 1]?.y >= 0 ? "#34d399" : "#f87171") + "20",
            borderWidth: config.lineThickness,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.1,
          },
        ],
      };
    }
  };

  // Purchase date markers plugin
  const purchaseDatePlugin = {
    id: 'purchaseDateMarkers',
    afterDatasetsDraw(chart: any) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || chartView !== "portfolio") return;

      // Draw all purchase markers for all datasets
      chart.data.datasets.forEach((dataset: any) => {
        if (!dataset.purchaseDates || !Array.isArray(dataset.purchaseDates)) return;

        dataset.purchaseDates.forEach((purchase: { date: number; id: string }) => {
          const xPixel = scales.x.getPixelForValue(purchase.date);

          // Skip if marker is outside chart bounds
          if (xPixel < chartArea.left || xPixel > chartArea.right) return;

          // Draw vertical line
          ctx.save();
          ctx.strokeStyle = dataset.borderColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(xPixel, chartArea.top + 20); // Start below the label area
          ctx.lineTo(xPixel, chartArea.bottom);
          ctx.stroke();
          ctx.restore();

          // Draw label with background to prevent clipping
          ctx.save();
          const labelText = `${dataset.label} ▼`;
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          const textMetrics = ctx.measureText(labelText);
          const textWidth = textMetrics.width;
          const textHeight = 12;

          // Draw background box for label
          ctx.fillStyle = 'rgba(10, 10, 15, 0.9)';
          ctx.fillRect(
            xPixel - textWidth / 2 - 3,
            chartArea.top - textHeight - 3,
            textWidth + 6,
            textHeight + 6
          );

          // Draw label text
          ctx.fillStyle = dataset.borderColor;
          ctx.fillText(labelText, xPixel, chartArea.top - 5);
          ctx.restore();
        });
      });
    }
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        top: 25, // Add padding to prevent label clipping
        right: 10,
        bottom: 10,
        left: 10,
      },
    },
    plugins: {
      legend: {
        display: false, // Always hide legend as requested
      },
      tooltip: {
        mode: "index" as const,
        intersect: false,
        backgroundColor: "rgba(17, 24, 39, 0.95)",
        titleColor: "#fff",
        bodyColor: "#9ca3af",
        borderColor: "#374151",
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        callbacks: {
          label: (context: any) => {
            const label = context.dataset.label || "";
            const value = context.parsed.y;
            return `${label}: $${value.toFixed(2)}`;
          },
        },
      },
    },
    scales: {
      x: {
        type: "time" as const,
        time: {
          unit: (timeRange === "1D" ? "hour" : timeRange === "1W" ? "day" : "month") as "hour" | "day" | "month",
          displayFormats: {
            hour: 'yyyy-MM-dd HH:mm',
            day: 'yyyy-MM-dd',
            month: 'yyyy-MM',
          },
        },
        grid: {
          color: config.axisColor,
          borderColor: config.axisColor,
        },
        ticks: {
          color: config.axisColor,
        },
      },
      y: {
        title: {
          display: true,
          text: 'Price (USD)',
          color: config.axisColor,
          font: {
            size: 12,
            weight: 'bold' as const,
          },
        },
        grid: {
          color: `rgba(107, 114, 128, ${config.gridOpacity})`,
          borderColor: config.axisColor,
        },
        ticks: {
          color: config.axisColor,
          callback: (value: any) => value.toFixed(0), // Remove $ sign
        },
      },
    },
    interaction: {
      mode: "index" as const,
      intersect: false,
    },
  };

  return (
    <div style={{ height: "400px" }}>
      <Line data={getChartData()} options={options} plugins={[purchaseDatePlugin]} />
    </div>
  );
}

// ==================== ADD STOCK DIALOG ====================

interface AddStockDialogProps {
  onClose: () => void;
  onAdd: (symbol: string, shares: number, currentValue: number, purchaseDate: number) => void;
}

function AddStockDialog({ onClose, onAdd }: AddStockDialogProps) {
  const [symbol, setSymbol] = useState("");
  const [shares, setShares] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !shares || !currentValue || !purchaseDate) return;

    const purchaseTimestamp = new Date(purchaseDate).getTime();
    onAdd(symbol.toUpperCase(), parseFloat(shares), parseFloat(currentValue), purchaseTimestamp);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-800 max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">Add Stock Position</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Stock Symbol
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Number of Shares
            </label>
            <input
              type="number"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="100"
              step="0.001"
              min="0"
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Current Total Value
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
              <input
                type="number"
                value={currentValue}
                onChange={(e) => setCurrentValue(e.target.value)}
                placeholder="15000.00"
                step="0.01"
                min="0"
                className="w-full pl-8 pr-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Enter the current value shown in your brokerage app (e.g., Robinhood)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Purchase Date
            </label>
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              When did you purchase this stock?
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition"
            >
              Add Position
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== CUSTOMIZATION PANEL ====================

interface CustomizationPanelProps {
  config: ChartConfig;
  onConfigChange: (config: ChartConfig) => void;
  onClose: () => void;
  portfolio: PortfolioState;
  onUpdateCardColor: (symbol: string, color: string) => void;
  onUpdateLineThickness: (symbol: string, thickness: number) => void;
  onUpdateFontSize: (symbol: string, fontSize: number) => void;
  onUpdateReferenceDate: (symbol: string, referenceDate: number) => void;
}

function CustomizationPanel({ config, onConfigChange, onClose, portfolio, onUpdateCardColor, onUpdateLineThickness, onUpdateFontSize, onUpdateReferenceDate }: CustomizationPanelProps) {
  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-gray-900 border-l border-gray-800 z-40 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold">Chart Settings</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Background Color
          </label>
          <input
            type="color"
            value={config.backgroundColor}
            onChange={(e) => onConfigChange({ ...config, backgroundColor: e.target.value })}
            className="w-full h-10 rounded border border-gray-700 bg-gray-800 cursor-pointer"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Grid Opacity: {config.gridOpacity.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={config.gridOpacity}
            onChange={(e) => onConfigChange({ ...config, gridOpacity: parseFloat(e.target.value) })}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Axis Label Color
          </label>
          <input
            type="color"
            value={config.axisColor}
            onChange={(e) => onConfigChange({ ...config, axisColor: e.target.value })}
            className="w-full h-10 rounded border border-gray-700 bg-gray-800 cursor-pointer"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Line Thickness: {config.lineThickness}px
          </label>
          <input
            type="range"
            min="1"
            max="5"
            step="1"
            value={config.lineThickness}
            onChange={(e) => onConfigChange({ ...config, lineThickness: parseInt(e.target.value) })}
            className="w-full"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-300">
            Glow Effect
          </label>
          <button
            onClick={() => onConfigChange({ ...config, showGlow: !config.showGlow })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
              config.showGlow ? "bg-blue-600" : "bg-gray-700"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                config.showGlow ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Stock-Specific Settings */}
        {portfolio.positions.length > 0 && (
          <>
            <div className="pt-6 border-t border-gray-800">
              <h4 className="text-md font-bold mb-4">Stock Customization</h4>
            </div>

            {portfolio.positions.map((position) => (
              <div key={position.id} className="pb-6 border-b border-gray-800 last:border-0">
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: position.color }}
                  />
                  <span className="font-semibold">{position.symbol}</span>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">
                      Card Background Color
                    </label>
                    <input
                      type="color"
                      value={position.cardColor.replace(/[0-9a-f]{2}$/i, '')} // Remove alpha
                      onChange={(e) => onUpdateCardColor(position.symbol, e.target.value + '20')}
                      className="w-full h-8 rounded border border-gray-700 bg-gray-800 cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">
                      Line Thickness: {position.lineThickness}px
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      step="1"
                      value={position.lineThickness}
                      onChange={(e) => onUpdateLineThickness(position.symbol, parseInt(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">
                      Font Size: {position.fontSize}%
                    </label>
                    <input
                      type="range"
                      min="75"
                      max="150"
                      step="5"
                      value={position.fontSize}
                      onChange={(e) => onUpdateFontSize(position.symbol, parseInt(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">
                      Reference Date for Gain/Loss
                    </label>
                    <input
                      type="date"
                      value={new Date(position.referenceDate).toISOString().split('T')[0]}
                      onChange={(e) => onUpdateReferenceDate(position.symbol, new Date(e.target.value).getTime())}
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-white text-xs"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Card shows change from this date to now
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ==================== SAVE PORTFOLIO DIALOG ====================

interface SavePortfolioDialogProps {
  onClose: () => void;
  onSave: (name: string) => void;
}

function SavePortfolioDialog({ onClose, onSave }: SavePortfolioDialogProps) {
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name);
    setName("");
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-800 max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">Save Portfolio</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Portfolio Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Portfolio"
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
              autoFocus
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== LOAD PORTFOLIO DIALOG ====================

interface LoadPortfolioDialogProps {
  onClose: () => void;
  onLoad: (name: string) => void;
  onDelete: (name: string) => void;
  getSavedPortfolios: () => Array<{ name: string; savedAt: number; positionCount: number }>;
}

function LoadPortfolioDialog({ onClose, onLoad, onDelete, getSavedPortfolios }: LoadPortfolioDialogProps) {
  const [savedPortfolios, setSavedPortfolios] = useState(getSavedPortfolios());

  const handleDelete = (name: string) => {
    if (confirm(`Delete portfolio "${name}"?`)) {
      onDelete(name);
      setSavedPortfolios(getSavedPortfolios());
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-800 max-w-2xl w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">Load Portfolio</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {savedPortfolios.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p>No saved portfolios found.</p>
            <p className="text-sm mt-2">Save your current portfolio to load it later.</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {savedPortfolios.map((portfolio) => (
              <div
                key={portfolio.name}
                className="flex items-center justify-between p-4 rounded-lg border border-gray-800 bg-gray-800/50 hover:bg-gray-800 transition"
              >
                <div className="flex-1">
                  <div className="font-semibold">{portfolio.name}</div>
                  <div className="text-sm text-gray-400">
                    {portfolio.positionCount} position{portfolio.positionCount !== 1 ? 's' : ''} •
                    Saved {new Date(portfolio.savedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onLoad(portfolio.name)}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => handleDelete(portfolio.name)}
                    className="p-2 rounded-lg text-red-400 hover:bg-red-950 transition"
                    title="Delete"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
