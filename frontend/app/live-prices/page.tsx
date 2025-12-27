"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { apiFetch } from "@/app/lib/api";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";
import { UserDisplay } from "@/app/components/UserDisplay";

// Register Chart.js components
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
  isPotential?: boolean; // True if this is a potential stock projection
  growthRate?: number; // Growth rate per period (e.g., 5% per month)
  growthPeriod?: 'day' | 'week' | 'month' | 'year'; // Period for growth rate
  holdingPeriod?: number; // How long they plan to hold (in days)
  purchaseDates?: number[]; // For clumped stocks, array of all purchase dates
}

interface LineStyle {
  color: string;
  thickness: number;
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

type TimeRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "2Y" | "3Y" | "ALL";
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

const DEFAULT_CHART_CONFIG: ChartConfig = {
  backgroundColor: "#0a0a0f",
  gridOpacity: 0.1,
  axisColor: "#6b7280",
  lineThickness: 2,
  showGlow: false,
};

const CURRENT_CONTEXT = "live-current";
const SAVED_CONTEXT = "live-prices";
const CURRENT_PORTFOLIO_NAME = "Current Portfolio";

// ==================== MAIN COMPONENT ====================

export default function LivePricesPage() {
  const { user, loading: authLoading } = useRequireAuth();
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
  const [showPotentialStockDialog, setShowPotentialStockDialog] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [clumpByStock, setClumpByStock] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [chartConfig, setChartConfig] = useState<ChartConfig>(DEFAULT_CHART_CONFIG);
  const [lineStyles, setLineStyles] = useState<Record<string, LineStyle>>({});
  const [currentPortfolioId, setCurrentPortfolioId] = useState<number | null>(null);
  const [savedPortfolios, setSavedPortfolios] = useState<
    { id: number; name: string; savedAt: number; positionCount: number; payload?: any }[]
  >([]);
  const [currentSavedPortfolioId, setCurrentSavedPortfolioId] = useState<number | null>(null);
  const [currentSavedPortfolioName, setCurrentSavedPortfolioName] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const lineStyleTimeoutRef = useRef<number | null>(null);

  // Toast notification helper
  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const buildDefaultLineStyles = useCallback(
    (positions: StockPosition[], thickness: number = DEFAULT_CHART_CONFIG.lineThickness) => {
    const symbols: string[] = [];
    positions.forEach((position) => {
      if (!symbols.includes(position.symbol)) {
        symbols.push(position.symbol);
      }
    });

    return symbols.reduce<Record<string, LineStyle>>((acc, symbol, index) => {
      acc[symbol] = {
        color: PRESET_COLORS[index % PRESET_COLORS.length],
        thickness,
      };
      return acc;
    }, {});
    },
    [],
  );

  const buildHoldingsPayload = useCallback((positions: StockPosition[]) => {
    return positions.map((position) => ({
      symbol: position.symbol,
      shares: position.shares,
      avgCost: position.costBasis,
      costBasis: position.costBasis,
      purchaseDate: position.purchaseDate,
      referenceDate: position.referenceDate,
      currentPrice: position.currentPrice,
      currentValue: position.shares * position.currentPrice,
      color: position.color,
      cardColor: position.cardColor,
      lineThickness: position.lineThickness,
      fontSize: position.fontSize,
      lastUpdate: position.lastUpdate,
      meta: {
        name: position.name,
        historicalData: position.historicalData,
        isPotential: position.isPotential,
        growthRate: position.growthRate,
        growthPeriod: position.growthPeriod,
        holdingPeriod: position.holdingPeriod,
        purchaseDates: position.purchaseDates,
      },
    }));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || authLoading) return;
    const legacyPortfolio = window.localStorage.getItem("priorsystems:live-portfolio");
    const legacyStyles = window.localStorage.getItem("priorsystems:live-line-styles");
    const legacySaved = window.localStorage.getItem("priorsystems:saved-portfolios");

    if (!legacyPortfolio && !legacyStyles && !legacySaved) return;

    const migrate = async () => {
      try {
        if (legacyStyles) {
          const parsed = JSON.parse(legacyStyles) as Record<string, LineStyle>;
          const styles = Object.entries(parsed).map(([symbol, style]) => ({
            symbol,
            color: style.color,
            thickness: style.thickness,
          }));
          if (styles.length > 0) {
            await apiFetch("/line-styles", {
              method: "POST",
              body: JSON.stringify({ styles }),
            });
          }
        }

        if (legacyPortfolio) {
          const parsed = JSON.parse(legacyPortfolio) as PortfolioState;
          await apiFetch("/portfolios", {
            method: "POST",
            body: JSON.stringify({
              name: CURRENT_PORTFOLIO_NAME,
              context: CURRENT_CONTEXT,
              cash: 0,
              chartConfig: DEFAULT_CHART_CONFIG,
              lineStyles: legacyStyles ? JSON.parse(legacyStyles) : undefined,
              holdings: buildHoldingsPayload(parsed.positions || []),
            }),
          });
        }

        if (legacySaved) {
          const parsed = JSON.parse(legacySaved) as Record<string, any>;
          for (const [name, entry] of Object.entries(parsed)) {
            if (!entry?.portfolio) continue;
            await apiFetch("/portfolios", {
              method: "POST",
              body: JSON.stringify({
                name,
                context: SAVED_CONTEXT,
                cash: 0,
                chartConfig: entry.chartConfig || DEFAULT_CHART_CONFIG,
                lineStyles: entry.lineStyles || undefined,
                holdings: buildHoldingsPayload(entry.portfolio.positions || []),
              }),
            });
          }
        }
      } catch (error) {
        console.error("Failed to migrate live prices storage:", error);
      } finally {
        window.localStorage.removeItem("priorsystems:live-portfolio");
        window.localStorage.removeItem("priorsystems:live-line-styles");
        window.localStorage.removeItem("priorsystems:saved-portfolios");
      }
    };

    migrate();
  }, [authLoading, buildHoldingsPayload]);

  // Clump positions by stock if enabled
  const displayPositions = React.useMemo(() => {
    if (!clumpByStock) {
      return portfolio.positions;
    }

    // Group positions by symbol
    const grouped = new Map<string, StockPosition[]>();
    portfolio.positions.forEach((position) => {
      if (!grouped.has(position.symbol)) {
        grouped.set(position.symbol, []);
      }
      grouped.get(position.symbol)!.push(position);
    });

    // Create clumped positions
    const clumped: StockPosition[] = [];
    grouped.forEach((positions, symbol) => {
      // Separate real and potential stocks
      const realPositions = positions.filter(p => !p.isPotential);
      const potentialPositions = positions.filter(p => p.isPotential);

      // Clump real positions if there are multiple
      if (realPositions.length === 1) {
        clumped.push(realPositions[0]);
      } else if (realPositions.length > 1) {
        const totalShares = realPositions.reduce((sum, p) => sum + p.shares, 0);
        const totalCost = realPositions.reduce((sum, p) => sum + p.shares * p.costBasis, 0);
        const weightedAvgPrice = totalCost / totalShares;
        const firstPosition = realPositions[0];
        const allPurchaseDates = realPositions.map(p => p.purchaseDate).sort((a, b) => a - b);

        clumped.push({
          ...firstPosition,
          id: `clumped-${symbol}`,
          shares: totalShares,
          costBasis: weightedAvgPrice,
          purchaseDates: allPurchaseDates,
          purchaseDate: allPurchaseDates[0], // Earliest purchase date
        });
      }

      // Add potential stocks separately (never clump these)
      clumped.push(...potentialPositions);
    });

    return clumped;
  }, [portfolio.positions, clumpByStock]);

  const ITEMS_PER_PAGE = 8; // 2 rows x 4 columns
  const totalPages = Math.ceil(displayPositions.length / ITEMS_PER_PAGE);
  const paginatedPositions = displayPositions.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  useEffect(() => {
    let cancelled = false;
    const loadState = async () => {
      try {
        const [currentRes, stylesRes, savedRes] = await Promise.all([
          apiFetch(`/portfolios?context=${CURRENT_CONTEXT}`),
          apiFetch("/line-styles"),
          apiFetch(`/portfolios?context=${SAVED_CONTEXT}`),
        ]);

        if (cancelled) return;

        // Parse responses with error handling
        const currentData = currentRes.ok ? await currentRes.json() : { portfolios: [] };
        const stylesData = stylesRes.ok ? await stylesRes.json() : { styles: [] };
        const savedData = savedRes.ok ? await savedRes.json() : { portfolios: [] };

        if (cancelled) return;

        const styleMap = (stylesData?.styles || []).reduce((acc: Record<string, LineStyle>, style: any) => {
          acc[style.symbol] = { color: style.color, thickness: style.thickness };
          return acc;
        }, {});
        if (stylesData?.styles) {
          setLineStyles(styleMap);
        }

        const currentPortfolio = currentData.portfolios?.[0];
        console.log('[Live Prices] Loaded current portfolio:', currentPortfolio ? `ID ${currentPortfolio.id} with ${currentPortfolio.holdings?.length || 0} holdings` : 'none');
        if (currentPortfolio) {
          setCurrentPortfolioId(currentPortfolio.id);
          setChartConfig(currentPortfolio.chartConfig || DEFAULT_CHART_CONFIG);

          // Merge portfolio lineStyles with the ones from /line-styles endpoint
          if (currentPortfolio.lineStyles) {
            setLineStyles(prev => ({
              ...prev,
              ...currentPortfolio.lineStyles,
            }));
          }

          // Restore the saved portfolio reference if it exists in notes
          if (currentPortfolio.notes) {
            try {
              const notesData = JSON.parse(currentPortfolio.notes);
              if (notesData.savedPortfolioId) {
                console.log('[Live Prices] Restoring saved portfolio reference:', notesData.savedPortfolioName);
                setCurrentSavedPortfolioId(notesData.savedPortfolioId);
                setCurrentSavedPortfolioName(notesData.savedPortfolioName || null);
              }
            } catch (e) {
              // notes might not be JSON, ignore
              console.log('[Live Prices] Notes field is not JSON, skipping saved portfolio restoration');
            }
          }
          const positions = (currentPortfolio.holdings || []).map((holding: any, index: number) => {
            const metaName = holding.meta?.name;
            const baseColor = styleMap[holding.symbol]?.color || PRESET_COLORS[index % PRESET_COLORS.length];
            return {
              id: String(holding.id ?? `${holding.symbol}-${index}`),
              symbol: holding.symbol,
              name: metaName || holding.symbol,
              shares: holding.shares,
              costBasis: holding.costBasis ?? holding.avgCost ?? 0,
              purchaseDate: holding.purchaseDate ?? Date.now(),
              referenceDate: holding.referenceDate ?? holding.purchaseDate ?? Date.now(),
              currentPrice: holding.currentPrice ?? holding.avgCost ?? 0,
              change: 0,
              changePercent: 0,
              color: holding.color || baseColor,
              cardColor: holding.cardColor || `${baseColor}20`,
              lineThickness: holding.lineThickness ?? DEFAULT_CHART_CONFIG.lineThickness,
              fontSize: holding.fontSize ?? 100,
              lastUpdate: holding.lastUpdate ?? Date.now(),
              historicalData: holding.meta?.historicalData || [],
              isPotential: holding.meta?.isPotential,
              growthRate: holding.meta?.growthRate,
              growthPeriod: holding.meta?.growthPeriod,
              holdingPeriod: holding.meta?.holdingPeriod,
              purchaseDates: holding.meta?.purchaseDates,
            };
          });
          // Only include real positions in portfolio totals, exclude potential stocks
          const realPositions = positions.filter((p: StockPosition) => !p.isPotential);
          const totalValue = realPositions.reduce((sum: number, p: StockPosition) => sum + p.shares * p.currentPrice, 0);
          const totalCost = realPositions.reduce((sum: number, p: StockPosition) => sum + p.shares * p.costBasis, 0);
          const totalGainLoss = totalValue - totalCost;
          const totalGainLossPercent = totalCost ? (totalGainLoss / totalCost) * 100 : 0;
          setPortfolio({
            positions,
            totalValue,
            totalCost,
            totalGainLoss,
            totalGainLossPercent,
          });

          // Trigger price refresh after loading to update today's gain/loss
          setTimeout(() => {
            if (positions.length > 0) {
              refreshPricesRef.current();
            }
          }, 100);
        }

        if (Array.isArray(savedData?.portfolios)) {
          const list = savedData.portfolios.map((p: any) => ({
            id: p.id,
            name: p.name,
            savedAt: new Date(p.updatedAt || p.createdAt).getTime(),
            positionCount: (p.holdings || []).length,
            payload: p,
          }));
          setSavedPortfolios(list);
        }
      } catch (error) {
        console.error("[Live Prices] Failed to load portfolio:", error);
      }
    };
    if (!authLoading) {
      console.log('[Live Prices] Auth loaded, fetching portfolio data...');
      loadState();
    }
    return () => {
      cancelled = true;
    };
  }, [authLoading]);

  useEffect(() => {
    if (portfolio.positions.length === 0) return;
    setLineStyles((prev) => {
      const defaults = buildDefaultLineStyles(portfolio.positions, chartConfig.lineThickness);
      let updated = false;
      const next = { ...prev };

      Object.entries(defaults).forEach(([symbol, style]) => {
        if (!next[symbol]) {
          next[symbol] = style;
          updated = true;
        }
      });

      return updated ? next : prev;
    });
  }, [portfolio.positions, chartConfig.lineThickness, buildDefaultLineStyles]);

  useEffect(() => {
    if (authLoading) return;
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        const payload = {
          id: currentPortfolioId ?? undefined,
          name: CURRENT_PORTFOLIO_NAME,
          context: CURRENT_CONTEXT,
          cash: 0,
          chartConfig,
          lineStyles,
          holdings: buildHoldingsPayload(portfolio.positions),
          notes: currentSavedPortfolioId ? JSON.stringify({
            savedPortfolioId: currentSavedPortfolioId,
            savedPortfolioName: currentSavedPortfolioName,
          }) : undefined,
        };
        console.log('[Live Prices] Auto-saving portfolio:', {
          portfolioId: currentPortfolioId,
          holdingsCount: portfolio.positions.length,
          savedPortfolioRef: currentSavedPortfolioName,
        });
        const res = await apiFetch("/portfolios", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const saved = await res.json();
          console.log('[Live Prices] Auto-save successful, portfolio ID:', saved?.id);
          if (!currentPortfolioId && saved?.id) {
            setCurrentPortfolioId(saved.id);
          }
        } else {
          console.error('[Live Prices] Auto-save failed with status:', res.status);
        }
      } catch (error) {
        console.error("[Live Prices] Failed to persist live portfolio:", error);
      }
    }, 800);
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [authLoading, portfolio.positions, chartConfig, lineStyles, currentPortfolioId, buildHoldingsPayload, currentSavedPortfolioId, currentSavedPortfolioName]);

  // Memoize line styles array to prevent unnecessary re-renders
  const lineStylesArray = useMemo(() => {
    return Object.entries(lineStyles).map(([symbol, style]) => ({
      symbol,
      color: style.color,
      thickness: style.thickness,
    }));
  }, [lineStyles]);

  useEffect(() => {
    if (authLoading) return;
    if (lineStylesArray.length === 0) return;

    if (lineStyleTimeoutRef.current) {
      window.clearTimeout(lineStyleTimeoutRef.current);
    }
    lineStyleTimeoutRef.current = window.setTimeout(() => {
      apiFetch("/line-styles", {
        method: "POST",
        body: JSON.stringify({ styles: lineStylesArray }),
      }).catch((error) => {
        console.error("Failed to persist line styles:", error);
      });
    }, 800);
    return () => {
      if (lineStyleTimeoutRef.current) {
        window.clearTimeout(lineStyleTimeoutRef.current);
      }
    };
  }, [authLoading, lineStylesArray.length]); // Only depend on the count, not the full array

  // Refresh stock prices
  const refreshPrices = useCallback(async () => {
    if (portfolio.positions.length === 0) return;

    setIsRefreshing(true);
    try {
      // Fetch latest prices for all non-potential positions
      const realPositions = portfolio.positions.filter(p => !p.isPotential);
      const symbols = realPositions.map((p) => p.symbol);

      if (symbols.length === 0) {
        setIsRefreshing(false);
        return;
      }

      const response = await apiFetch("/api/stock-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols, range: timeRange }),
      });

      if (!response.ok) throw new Error("Failed to fetch prices");

      const data = await response.json();

      // Update positions with new prices (skip potential stocks)
      const updatedPositions = portfolio.positions.map((position) => {
        if (position.isPotential) return position; // Don't refresh potential stocks

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

      // Recalculate portfolio totals (exclude potential stocks)
      const realUpdatedPositions = updatedPositions.filter(p => !p.isPotential);
      const totalValue = realUpdatedPositions.reduce(
        (sum, p) => sum + p.shares * p.currentPrice,
        0
      );
      const totalCost = realUpdatedPositions.reduce(
        (sum, p) => sum + p.shares * p.costBasis,
        0
      );
      const totalGainLoss = totalValue - totalCost;
      const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;

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

  // Store refreshPrices in a ref to avoid dependency issues
  const refreshPricesRef = useRef(refreshPrices);
  useEffect(() => {
    refreshPricesRef.current = refreshPrices;
  }, [refreshPrices]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (portfolio.positions.length === 0) return;

    const interval = setInterval(() => {
      refreshPricesRef.current();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [portfolio.positions.length]);

  // Auto-refresh when time range changes
  useEffect(() => {
    if (portfolio.positions.length > 0) {
      refreshPricesRef.current();
    }
  }, [timeRange, portfolio.positions.length]);

  // Add new stock position
  const addPosition = useCallback(async (symbol: string, shares: number, purchaseDate: number, purchasePrice: number) => {
    try {
      // Fetch current stock data
      const response = await apiFetch("/api/stock-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: [symbol], range: timeRange }),
      });

      if (!response.ok) throw new Error("Failed to fetch stock data");

      const data = await response.json();
      const stockData = data[symbol];

      if (!stockData) throw new Error("Stock not found");
      if (stockData.error) throw new Error(stockData.error);

      const symbolKey = symbol.toUpperCase();
      const existingLineStyle = lineStyles[symbolKey];
      const fallbackColor = PRESET_COLORS[Object.keys(lineStyles).length % PRESET_COLORS.length];
      const assignedColor = existingLineStyle?.color || fallbackColor;
      const assignedThickness = existingLineStyle?.thickness || chartConfig.lineThickness;

      // Cost basis per share derived from purchase date price
      const costBasis = purchasePrice;

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
        color: assignedColor,
        cardColor: assignedColor + "20",
        lineThickness: assignedThickness,
        fontSize: 100,
        lastUpdate: Date.now(),
        historicalData: stockData.historical,
      };

      setLineStyles((prev) => {
        if (prev[symbolKey]) return prev;
        return {
          ...prev,
          [symbolKey]: {
            color: assignedColor,
            thickness: assignedThickness,
          },
        };
      });

      const updatedPositions = [...portfolio.positions, newPosition];
      const realUpdated = updatedPositions.filter(p => !p.isPotential);
      const totalValue = realUpdated.reduce((sum, p) => sum + p.shares * p.currentPrice, 0);
      const totalCost = realUpdated.reduce((sum, p) => sum + p.shares * p.costBasis, 0);
      const totalGainLoss = totalValue - totalCost;

      setPortfolio({
        positions: updatedPositions,
        totalValue,
        totalCost,
        totalGainLoss,
        totalGainLossPercent: totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0,
      });

      setShowAddDialog(false);
    } catch (error) {
      console.error("Failed to add position:", error);
      alert("Failed to add stock. Please try again.");
    }
  }, [portfolio.positions, timeRange, lineStyles, chartConfig.lineThickness]);

  // Remove position by ID (allows removing specific positions of same stock)
  const removePosition = useCallback((positionId: string) => {
    const updatedPositions = portfolio.positions.filter((p) => p.id !== positionId);
    const realRemaining = updatedPositions.filter(p => !p.isPotential);
    const totalValue = realRemaining.reduce((sum, p) => sum + p.shares * p.currentPrice, 0);
    const totalCost = realRemaining.reduce((sum, p) => sum + p.shares * p.costBasis, 0);
    const totalGainLoss = totalValue - totalCost;

    setPortfolio({
      positions: updatedPositions,
      totalValue,
      totalCost,
      totalGainLoss,
      totalGainLossPercent: totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0,
    });
  }, [portfolio]);

  const updateLineColor = useCallback((symbol: string, color: string) => {
    setLineStyles((prev) => ({
      ...prev,
      [symbol]: {
        color,
        thickness: prev[symbol]?.thickness || chartConfig.lineThickness,
      },
    }));
  }, [chartConfig.lineThickness]);

  const updateLineThickness = useCallback((symbol: string, thickness: number) => {
    setLineStyles((prev) => ({
      ...prev,
      [symbol]: {
        color: prev[symbol]?.color || PRESET_COLORS[0],
        thickness,
      },
    }));
  }, []);

  const updatePositionCardColor = useCallback((positionId: string, cardColor: string) => {
    setPortfolio((prev) => ({
      ...prev,
      positions: prev.positions.map((p) =>
        p.id === positionId ? { ...p, cardColor } : p
      ),
    }));
  }, []);

  const updatePositionFontSize = useCallback((positionId: string, fontSize: number) => {
    setPortfolio((prev) => ({
      ...prev,
      positions: prev.positions.map((p) =>
        p.id === positionId ? { ...p, fontSize } : p
      ),
    }));
  }, []);

  const updatePositionReferenceDate = useCallback((positionId: string, referenceDate: number) => {
    setPortfolio((prev) => ({
      ...prev,
      positions: prev.positions.map((p) =>
        p.id === positionId ? { ...p, referenceDate } : p
      ),
    }));
  }, []);

  const resetChartConfig = useCallback(() => {
    setChartConfig({ ...DEFAULT_CHART_CONFIG });
  }, []);

  const resetCardCustomization = useCallback(
    (positionId: string) => {
      setPortfolio((prev) => {
        const target = prev.positions.find((position) => position.id === positionId);
        if (!target) return prev;
        const lineColor = lineStyles[target.symbol]?.color || PRESET_COLORS[0];
        return {
          ...prev,
          positions: prev.positions.map((position) =>
            position.id === positionId
              ? {
                  ...position,
                  cardColor: `${lineColor}20`,
                  fontSize: 100,
                  referenceDate: position.purchaseDate,
                }
              : position,
          ),
        };
      });
    },
    [lineStyles],
  );

  const refreshSavedPortfolios = useCallback(async () => {
    try {
      const res = await apiFetch(`/portfolios?context=${SAVED_CONTEXT}`);
      if (!res.ok) return;
      const data = await res.json();
      const list = (data.portfolios || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        savedAt: new Date(p.updatedAt || p.createdAt).getTime(),
        positionCount: (p.holdings || []).length,
        payload: p,
      }));
      setSavedPortfolios(list);
    } catch (error) {
      console.error("Failed to refresh portfolios:", error);
    }
  }, []);

  // Reorder positions via drag and drop
  const reorderPositions = useCallback((fromIndex: number, toIndex: number) => {
    setPortfolio((prev) => {
      const newPositions = [...prev.positions];
      const [removed] = newPositions.splice(fromIndex, 1);
      newPositions.splice(toIndex, 0, removed);

      const realPositions = newPositions.filter(p => !p.isPotential);
      const totalValue = realPositions.reduce((sum, p) => sum + p.shares * p.currentPrice, 0);
      const totalCost = realPositions.reduce((sum, p) => sum + p.shares * p.costBasis, 0);
      const totalGainLoss = totalValue - totalCost;

      return {
        positions: newPositions,
        totalValue,
        totalCost,
        totalGainLoss,
        totalGainLossPercent: totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0,
      };
    });
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback((index: number) => {
    setDraggedIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      reorderPositions(draggedIndex, dragOverIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [draggedIndex, dragOverIndex, reorderPositions]);

  // Save portfolio with a custom name
  const savePortfolio = useCallback(
    async (name: string) => {
      if (!name.trim()) {
        alert("Please enter a portfolio name");
        return false;
      }

      // Validate that user is authenticated
      if (!user) {
        alert("You must be logged in to save portfolios");
        return false;
      }

      try {
        const payload = {
          name: name.trim(),
          context: SAVED_CONTEXT,
          cash: 0,
          chartConfig,
          lineStyles,
          holdings: buildHoldingsPayload(portfolio.positions),
        };

        // If we have a currently loaded saved portfolio, update it
        if (currentSavedPortfolioId) {
          const res = await apiFetch(`/portfolios/${currentSavedPortfolioId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            let errorMessage = "Failed to update portfolio";
            try {
              const errorData = await res.json();
              errorMessage = errorData.detail || errorData.message || errorMessage;
            } catch {
              const textError = await res.text();
              if (textError) errorMessage = textError;
            }

            // Handle specific error cases
            if (res.status === 401) {
              errorMessage = "You are not logged in. Please log in and try again.";
            } else if (res.status === 404) {
              errorMessage = "Portfolio not found. It may have been deleted.";
              setCurrentSavedPortfolioId(null);
            } else if (res.status === 403) {
              errorMessage = "You don't have permission to update this portfolio.";
            }

            throw new Error(errorMessage);
          }

          await refreshSavedPortfolios();
          setShowSaveDialog(false);
          showToast(`Portfolio "${name}" updated successfully!`, "success");
          return true;
        } else {
          // Create a new portfolio
          const res = await apiFetch("/portfolios", {
            method: "POST",
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            let errorMessage = "Failed to save portfolio";
            try {
              const errorData = await res.json();
              errorMessage = errorData.detail || errorData.message || errorMessage;
            } catch {
              const textError = await res.text();
              if (textError) errorMessage = textError;
            }

            // Handle specific error cases
            if (res.status === 401) {
              errorMessage = "You are not logged in. Please log in and try again.";
            } else if (res.status === 409) {
              errorMessage = "A portfolio with this name already exists.";
            }

            throw new Error(errorMessage);
          }

          const saved = await res.json();
          setCurrentSavedPortfolioId(saved?.id || null);
          setCurrentSavedPortfolioName(name.trim());
          await refreshSavedPortfolios();
          setShowSaveDialog(false);
          showToast(`Portfolio "${name}" saved successfully!`, "success");
          return true;
        }
      } catch (error) {
        console.error("Failed to save portfolio:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to save portfolio. Please try again.";
        showToast(errorMessage, "error");
        return false;
      }
    },
    [portfolio.positions, chartConfig, lineStyles, buildHoldingsPayload, refreshSavedPortfolios, currentSavedPortfolioId, user, showToast],
  );

  // Load a saved portfolio by name
  const loadPortfolio = useCallback(
    (name: string) => {
      const savedPortfolio = savedPortfolios.find((p) => p.name === name);
      const saved = savedPortfolio?.payload;
      if (!saved) {
        alert(`Portfolio "${name}" not found.`);
        return;
      }

      const positions = (saved.holdings || []).map((holding: any, index: number) => {
        const metaName = holding.meta?.name;
        const baseColor = lineStyles[holding.symbol]?.color || PRESET_COLORS[index % PRESET_COLORS.length];
        return {
          id: String(holding.id ?? `${holding.symbol}-${index}`),
          symbol: holding.symbol,
          name: metaName || holding.symbol,
          shares: holding.shares,
          costBasis: holding.costBasis ?? holding.avgCost ?? 0,
          purchaseDate: holding.purchaseDate ?? Date.now(),
          referenceDate: holding.referenceDate ?? holding.purchaseDate ?? Date.now(),
          currentPrice: holding.currentPrice ?? holding.avgCost ?? 0,
          change: 0,
          changePercent: 0,
          color: holding.color || baseColor,
          cardColor: holding.cardColor || `${baseColor}20`,
          lineThickness: holding.lineThickness ?? DEFAULT_CHART_CONFIG.lineThickness,
          fontSize: holding.fontSize ?? 100,
          lastUpdate: holding.lastUpdate ?? Date.now(),
          historicalData: holding.meta?.historicalData || [],
          isPotential: holding.meta?.isPotential,
          growthRate: holding.meta?.growthRate,
          growthPeriod: holding.meta?.growthPeriod,
          holdingPeriod: holding.meta?.holdingPeriod,
          purchaseDates: holding.meta?.purchaseDates,
        };
      });

      const realLoadedPositions = positions.filter((p: StockPosition) => !p.isPotential);
      const totalValue = realLoadedPositions.reduce((sum: number, p: StockPosition) => sum + p.shares * p.currentPrice, 0);
      const totalCost = realLoadedPositions.reduce((sum: number, p: StockPosition) => sum + p.shares * p.costBasis, 0);
      const totalGainLoss = totalValue - totalCost;
      const totalGainLossPercent = totalCost ? (totalGainLoss / totalCost) * 100 : 0;

      setPortfolio({
        positions,
        totalValue,
        totalCost,
        totalGainLoss,
        totalGainLossPercent,
      });
      setChartConfig(saved.chartConfig || DEFAULT_CHART_CONFIG);

      // Merge saved lineStyles with current ones, prioritizing saved values
      if (saved.lineStyles) {
        setLineStyles(prev => ({
          ...prev,
          ...saved.lineStyles,
        }));
      }

      setCurrentSavedPortfolioId(savedPortfolio?.id || null);
      setCurrentSavedPortfolioName(savedPortfolio?.name || null);
      setShowLoadDialog(false);
      alert(`Portfolio "${name}" loaded successfully!`);

      // Trigger price refresh to update today's gain/loss
      setTimeout(() => {
        if (positions.length > 0) {
          refreshPricesRef.current();
        }
      }, 100);
    },
    [savedPortfolios, lineStyles],
  );

  // Create a new portfolio (clear current state)
  const newPortfolio = useCallback(() => {
    if (portfolio.positions.length > 0) {
      const confirmed = confirm("This will clear your current portfolio. Any unsaved changes will be lost. Continue?");
      if (!confirmed) return;
    }

    // Clear all portfolio data
    setPortfolio({
      positions: [],
      totalValue: 0,
      totalCost: 0,
      totalGainLoss: 0,
      totalGainLossPercent: 0,
    });
    setCurrentSavedPortfolioId(null);
    setCurrentSavedPortfolioName(null);
    setShowLoadDialog(false);
    showToast("New portfolio created", "success");
  }, [portfolio.positions.length, showToast]);

  // Delete a saved portfolio
  const deleteSavedPortfolio = useCallback(
    (name: string) => {
      const target = savedPortfolios.find((p) => p.name === name);
      if (!target) return;

      // If we're deleting the currently loaded portfolio, clear the reference
      if (target.id === currentSavedPortfolioId) {
        setCurrentSavedPortfolioId(null);
        setCurrentSavedPortfolioName(null);
      }

      apiFetch(`/portfolios/${target.id}`, { method: "DELETE" })
        .then(() => refreshSavedPortfolios())
        .catch((error) => {
          console.error("Failed to delete portfolio:", error);
        });
    },
    [savedPortfolios, refreshSavedPortfolios, currentSavedPortfolioId],
  );

  // Get list of saved portfolios
  const getSavedPortfolios = useCallback(() => savedPortfolios, [savedPortfolios]);

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

  // Wait for auth to load
  if (authLoading) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-[1800px] mx-auto px-10 py-4 flex items-center justify-between">
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
            {user && <UserDisplay email={user.email} />}
            <div className="text-sm text-gray-400">
              Last updated: {getTimeSinceRefresh()}
            </div>
            {currentSavedPortfolioId && currentSavedPortfolioName && (
              <div className="text-xs text-blue-400 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20">
                Editing: {currentSavedPortfolioName}
              </div>
            )}
            <button
              onClick={() => setShowSaveDialog(true)}
              className={`px-3 py-2 hover:bg-gray-800 rounded-lg transition text-sm font-medium ${
                currentSavedPortfolioId ? 'text-blue-400 border border-blue-500/30' : ''
              }`}
              title={currentSavedPortfolioId ? "Update current portfolio" : "Save new portfolio"}
            >
              {currentSavedPortfolioId ? 'Update' : 'Save'}
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
      <main className="max-w-[1800px] mx-auto px-10 py-8">
        {/* Portfolio Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="text-sm text-gray-400 mb-1">Total Value</div>
            <div className="text-2xl font-bold">
              ${portfolio.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {(() => {
              const realPositions = portfolio.positions.filter(p => !p.isPotential);
              const totalDailyChange = realPositions.reduce((sum, p) => sum + (p.shares * p.change), 0);
              const yesterdayTotalValue = portfolio.totalValue - totalDailyChange;
              const totalDailyChangePercent = yesterdayTotalValue > 0 ? (totalDailyChange / yesterdayTotalValue) * 100 : 0;
              return (
                <div className={`text-xs font-semibold mt-1 ${totalDailyChangePercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                  Today: {totalDailyChangePercent >= 0 ? "+" : ""}${totalDailyChange.toFixed(2)} ({totalDailyChangePercent >= 0 ? "+" : ""}{totalDailyChangePercent.toFixed(2)}%)
                </div>
              );
            })()}
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

        {/* Projected Portfolio Summary (if there are potential stocks) */}
        {portfolio.positions.some(p => p.isPotential) && (() => {
          const potentialStocks = portfolio.positions.filter(p => p.isPotential);

          // Calculate projected value from potential stocks (final price at end of holding period)
          const projectedGainsFromPotential = potentialStocks.reduce((sum, p) => {
            if (p.historicalData.length > 0) {
              const finalPrice = p.historicalData[p.historicalData.length - 1].price;
              const gain = (finalPrice - p.currentPrice) * p.shares;
              return sum + gain;
            }
            return sum;
          }, 0);

          const projectedTotalValue = portfolio.totalValue + projectedGainsFromPotential;
          const projectedTotalGainLoss = portfolio.totalGainLoss + projectedGainsFromPotential;
          const projectedTotalGainLossPercent = portfolio.totalCost > 0
            ? (projectedTotalGainLoss / portfolio.totalCost) * 100
            : 0;

          // Find the latest projection end date (from today, not purchase date)
          const today = Date.now();
          const latestProjectionDate = Math.max(
            ...potentialStocks.map(p => today + (p.holdingPeriod || 0) * 24 * 60 * 60 * 1000)
          );

          return (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="rounded-xl border border-purple-800 bg-purple-950/30 p-6">
                <div className="text-sm text-purple-400 mb-1 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Projected Total Value
                </div>
                <div className="text-2xl font-bold text-purple-300">
                  ${projectedTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-purple-500 mt-1">
                  By {new Date(latestProjectionDate).toLocaleDateString()}
                </div>
              </div>

              <div className="rounded-xl border border-purple-800 bg-purple-950/30 p-6">
                <div className="text-sm text-purple-400 mb-1">Potential Gains</div>
                <div className={`text-2xl font-bold ${projectedGainsFromPotential >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {projectedGainsFromPotential >= 0 ? "+" : ""}${projectedGainsFromPotential.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-purple-500 mt-1">
                  From {potentialStocks.length} projection{potentialStocks.length !== 1 ? 's' : ''}
                </div>
              </div>

              <div className="rounded-xl border border-purple-800 bg-purple-950/30 p-6">
                <div className="text-sm text-purple-400 mb-1">Projected Gain/Loss</div>
                <div className={`text-2xl font-bold ${projectedTotalGainLoss >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {projectedTotalGainLoss >= 0 ? "+" : ""}${projectedTotalGainLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-purple-500 mt-1">
                  Total including projections
                </div>
              </div>

              <div className="rounded-xl border border-purple-800 bg-purple-950/30 p-6">
                <div className="text-sm text-purple-400 mb-1">Projected Return</div>
                <div className={`text-2xl font-bold ${projectedTotalGainLossPercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {projectedTotalGainLossPercent >= 0 ? "+" : ""}{projectedTotalGainLossPercent.toFixed(2)}%
                </div>
                <div className="text-xs text-purple-500 mt-1">
                  With all projections
                </div>
              </div>
            </div>
          );
        })()}

        {/* Stock Positions */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Your Holdings</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setClumpByStock(!clumpByStock)}
                className={`px-4 py-2 rounded-lg transition font-semibold flex items-center gap-2 ${
                  clumpByStock
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-gray-700 hover:bg-gray-600"
                }`}
                title="Toggle clump by stock"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                {clumpByStock ? "Clumped" : "Clump by Stock"}
              </button>
              <button
                onClick={() => setShowPotentialStockDialog(true)}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition font-semibold flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                Potential Stock
              </button>
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
                {paginatedPositions.map((position, index) => {
                  const actualIndex = currentPage * ITEMS_PER_PAGE + index;
                  return (
                    <StockCard
                      key={position.id}
                      position={position}
                      index={actualIndex}
                      lineColor={lineStyles[position.symbol]?.color || position.color || PRESET_COLORS[0]}
                      onRemove={removePosition}
                      onLineColorChange={updateLineColor}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDragEnd={handleDragEnd}
                      isDragging={draggedIndex === actualIndex}
                      isDragOver={dragOverIndex === actualIndex}
                    />
                  );
                })}
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
                {chartView === "portfolio" ? "Market Prices" : "Portfolio Value"}
              </h2>

              <div className="flex items-center gap-3">
                {/* Time Range Selector */}
                <div className="flex rounded-lg border border-gray-800 bg-gray-900/50 overflow-hidden">
                  {(["1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "3Y", "ALL"] as TimeRange[]).map((range) => (
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
                lineStyles={lineStyles}
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
          currentName={currentSavedPortfolioName || undefined}
        />
      )}

      {/* Load Portfolio Dialog */}
      {showLoadDialog && (
        <LoadPortfolioDialog
          onClose={() => setShowLoadDialog(false)}
          onLoad={loadPortfolio}
          onDelete={deleteSavedPortfolio}
          onNewPortfolio={newPortfolio}
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
          lineStyles={lineStyles}
          onResetChartConfig={resetChartConfig}
          onResetCard={resetCardCustomization}
          onUpdateLineColor={updateLineColor}
          onUpdateCardColor={updatePositionCardColor}
          onUpdateLineThickness={updateLineThickness}
          onUpdateFontSize={updatePositionFontSize}
          onUpdateReferenceDate={updatePositionReferenceDate}
        />
      )}

      {/* Potential Stock Dialog */}
      {showPotentialStockDialog && (
        <PotentialStockDialog
          onClose={() => setShowPotentialStockDialog(false)}
          onAdd={(symbol, currentPrice, shares, growthRate, growthPeriod, holdingPeriod) => {
            // Create potential stock position
            const now = Date.now();
            const symbolKey = symbol.toUpperCase();
            const existingLineStyle = lineStyles[symbolKey];
            const fallbackColor = PRESET_COLORS[Object.keys(lineStyles).length % PRESET_COLORS.length];
            const assignedColor = existingLineStyle?.color || fallbackColor;
            const assignedThickness = existingLineStyle?.thickness || chartConfig.lineThickness;

            // Calculate future price based on growth rate and period
            const calculateFuturePrice = (days: number) => {
              let periodsElapsed = 0;
              switch (growthPeriod) {
                case 'day':
                  periodsElapsed = days;
                  break;
                case 'week':
                  periodsElapsed = days / 7;
                  break;
                case 'month':
                  periodsElapsed = days / 30;
                  break;
                case 'year':
                  periodsElapsed = days / 365;
                  break;
              }
              return currentPrice * Math.pow(1 + growthRate / 100, periodsElapsed);
            };

            // Generate historical data for the projection
            const historicalData = [];
            const daysToProject = holdingPeriod;
            const pointsToGenerate = Math.min(100, daysToProject);
            const dayIncrement = daysToProject / pointsToGenerate;

            for (let i = 0; i <= pointsToGenerate; i++) {
              const days = i * dayIncrement;
              const timestamp = now + days * 24 * 60 * 60 * 1000;
              const price = calculateFuturePrice(days);
              historicalData.push({ timestamp, price });
            }

            const newPosition: StockPosition = {
              id: `potential-${symbolKey}-${Date.now()}`,
              symbol: symbolKey,
              name: symbolKey,
              shares: shares,
              costBasis: currentPrice,
              purchaseDate: now,
              referenceDate: now,
              currentPrice,
              change: 0,
              changePercent: 0,
              color: assignedColor,
              cardColor: `${assignedColor}20`,
              lineThickness: assignedThickness,
              fontSize: 100,
              lastUpdate: now,
              historicalData,
              isPotential: true,
              growthRate,
              growthPeriod,
              holdingPeriod,
            };

            setLineStyles((prev) => {
              if (prev[symbolKey]) return prev;
              return {
                ...prev,
                [symbolKey]: {
                  color: assignedColor,
                  thickness: assignedThickness,
                },
              };
            });

            const updatedPositions = [...portfolio.positions, newPosition];
            const realPotentialUpdated = updatedPositions.filter(p => !p.isPotential);
            const totalValue = realPotentialUpdated.reduce((sum, p) => sum + p.shares * p.currentPrice, 0);
            const totalCost = realPotentialUpdated.reduce((sum, p) => sum + p.shares * p.costBasis, 0);
            const totalGainLoss = totalValue - totalCost;

            setPortfolio({
              positions: updatedPositions,
              totalValue,
              totalCost,
              totalGainLoss,
              totalGainLossPercent: totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0,
            });

            setShowPotentialStockDialog(false);
          }}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-6 py-4 rounded-lg shadow-xl border animate-slide-up ${
          toast.type === "success"
            ? "bg-green-600/90 border-green-500/50 text-white"
            : "bg-red-600/90 border-red-500/50 text-white"
        }`}>
          <div className="flex items-center gap-3">
            {toast.type === "success" ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <span className="font-medium">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== STOCK CARD COMPONENT ====================

interface StockCardProps {
  position: StockPosition;
  index: number;
  lineColor: string;
  onRemove: (positionId: string) => void;
  onLineColorChange: (symbol: string, color: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isDragOver: boolean;
}

function StockCard({ position, index, lineColor, onRemove, onLineColorChange, onDragStart, onDragOver, onDragEnd, isDragging, isDragOver }: StockCardProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);

  const positionValue = position.shares * position.currentPrice;
  const positionCost = position.shares * position.costBasis;
  const positionGainLoss = positionValue - positionCost;
  const positionGainLossPercent = positionCost > 0 ? (positionGainLoss / positionCost) * 100 : 0;

  // Calculate price at reference date (user-configurable date)
  const referenceDateData = position.historicalData.find(d =>
    Math.abs(d.timestamp - position.referenceDate) < 24 * 60 * 60 * 1000 // Within 1 day
  );
  const priceAtReference = referenceDateData?.price || position.costBasis;

  // Calculate gain/loss from reference date to current/final date
  const finalPrice = position.isPotential && position.historicalData.length > 0
    ? position.historicalData[position.historicalData.length - 1].price
    : position.currentPrice;
  const changeFromReference = finalPrice - priceAtReference;
  const changePercentFromReference = priceAtReference > 0 ? (changeFromReference / priceAtReference) * 100 : 0;

  // Calculate daily gain/loss (change and changePercent are already daily from API)
  const dailyChange = position.change;
  const dailyChangePercent = position.changePercent;

  const fontSizeScale = position.fontSize / 100;

  // Prepare sparkline data (last 20 points)
  const sparklineData = position.historicalData.slice(-20).map(d => d.price);
  const minPrice = Math.min(...sparklineData);
  const maxPrice = Math.max(...sparklineData);
  const priceRange = maxPrice - minPrice || 1;

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(index);
      }}
      onDragEnd={onDragEnd}
      className={`rounded-xl border p-4 relative transition-all cursor-move ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'ring-2 ring-blue-500' : ''}`}
      style={{
        borderColor: lineColor + "40",
        backgroundColor: position.isPotential ? "#8b5cf640" : position.cardColor,
        fontSize: `${fontSizeScale}rem`
      }}
    >
      {/* Potential Stock Badge */}
      {position.isPotential && (
        <div className="absolute top-2 right-2 px-2 py-1 rounded-md bg-purple-600 text-white text-xs font-bold">
          Potential Stock
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full cursor-pointer"
            style={{ backgroundColor: lineColor }}
            onClick={() => setShowColorPicker(!showColorPicker)}
          />
          <div>
            <div className="font-bold" style={{ fontSize: `${1.125 * fontSizeScale}rem` }}>{position.symbol}</div>
            <div className="text-xs text-gray-400" style={{ fontSize: `${0.75 * fontSizeScale}rem` }}>{position.name}</div>
          </div>
        </div>

        {!position.isPotential && (
          <button
            onClick={() => onRemove(position.id)}
            className="text-gray-500 hover:text-red-400 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {position.isPotential && (
          <button
            onClick={() => onRemove(position.id)}
            className="text-gray-500 hover:text-red-400 transition mt-8"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Color Picker */}
      {showColorPicker && (
        <div className="absolute top-12 left-4 z-10 p-3 rounded-lg border border-gray-800 bg-gray-900 shadow-xl">
          <div className="grid grid-cols-4 gap-2 mb-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => {
                  onLineColorChange(position.symbol, color);
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
        <div className="text-2xl font-bold">
          ${position.currentPrice.toFixed(2)}
          {position.isPotential && finalPrice !== position.currentPrice && (
            <span className="text-base ml-2">→ ${finalPrice.toFixed(2)}</span>
          )}
        </div>

        {/* Daily Gain/Loss */}
        {!position.isPotential && (
          <div className={`text-xs font-semibold ${dailyChangePercent >= 0 ? "text-green-400" : "text-red-400"}`}>
            Today: {dailyChangePercent >= 0 ? "+" : ""}${dailyChange.toFixed(2)} ({dailyChangePercent >= 0 ? "+" : ""}{dailyChangePercent.toFixed(2)}%)
          </div>
        )}

        <div className={`text-sm ${changePercentFromReference >= 0 ? "text-green-400" : "text-red-400"}`}>
          {position.isPotential ? (
            <>
              {changePercentFromReference >= 0 ? "+" : ""}{changeFromReference.toFixed(2)} ({changePercentFromReference.toFixed(2)}%) projected over {position.holdingPeriod} days
            </>
          ) : (
            <>
              {changePercentFromReference >= 0 ? "+" : ""}{changeFromReference.toFixed(2)} ({changePercentFromReference.toFixed(2)}%) since {new Date(position.referenceDate).toLocaleDateString()}
            </>
          )}
        </div>
        {/* Show all purchase dates if clumped */}
        {!position.isPotential && position.purchaseDates && position.purchaseDates.length > 1 && (
          <div className="text-xs text-gray-400 mt-1">
            Purchased: {position.purchaseDates.map(d => new Date(d).toLocaleDateString()).join(', ')}
          </div>
        )}
        {/* Show growth details for potential stocks */}
        {position.isPotential && (
          <div className="text-xs text-gray-400 mt-1">
            Growth: {position.growthRate}% per {position.growthPeriod}
          </div>
        )}
      </div>

      {/* Sparkline Chart */}
      <div className="mb-3">
        <svg width="100%" height="50" className="overflow-visible">
          <polyline
            fill="none"
            stroke={lineColor}
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
              <stop offset="0%" style={{ stopColor: lineColor, stopOpacity: 0.3 }} />
              <stop offset="100%" style={{ stopColor: lineColor, stopOpacity: 0 }} />
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
      {!position.isPotential && (
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
      )}
      {position.isPotential && (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Current Price:</span>
            <span className="font-medium">${position.currentPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Projected Price:</span>
            <span className="font-medium">${finalPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Holding Period:</span>
            <span className="font-medium">{position.holdingPeriod} days</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Target Date:</span>
            <span className="font-medium text-purple-400">
              {new Date(Date.now() + position.holdingPeriod! * 24 * 60 * 60 * 1000).toLocaleDateString()}
            </span>
          </div>
          <div className="flex justify-between pt-2 border-t border-gray-800">
            <span className="text-gray-400">Projected Gain:</span>
            <span className={`font-bold ${changeFromReference >= 0 ? "text-green-400" : "text-red-400"}`}>
              {changeFromReference >= 0 ? "+" : ""}${changeFromReference.toFixed(2)}
              <span className="text-xs ml-1">({changePercentFromReference >= 0 ? "+" : ""}{changePercentFromReference.toFixed(2)}%)</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== PORTFOLIO CHART COMPONENT ====================

interface PortfolioChartProps {
  portfolio: PortfolioState;
  chartView: ChartView;
  timeRange: TimeRange;
  config: ChartConfig;
  lineStyles: Record<string, LineStyle>;
}

function PortfolioChart({ portfolio, chartView, timeRange, config, lineStyles }: PortfolioChartProps) {
  const positionsBySymbol = React.useMemo(() => {
    const grouped = new Map<string, StockPosition[]>();
    portfolio.positions.forEach((position) => {
      if (!grouped.has(position.symbol)) {
        grouped.set(position.symbol, []);
      }
      grouped.get(position.symbol)!.push(position);
    });
    return grouped;
  }, [portfolio.positions]);

  const getLineStyle = React.useCallback(
    (symbol: string) =>
      lineStyles[symbol] || {
        color: PRESET_COLORS[0],
        thickness: config.lineThickness,
      },
    [lineStyles, config.lineThickness],
  );

  const getHeldSharesAt = React.useCallback(
    (symbol: string, timestamp: number) => {
      const positions = positionsBySymbol.get(symbol) || [];
      return positions.reduce((sum, position) => {
        if (position.purchaseDate <= timestamp) {
          return sum + position.shares;
        }
        return sum;
      }, 0);
    },
    [positionsBySymbol],
  );

  // Build chart data based on view
  const getChartData = () => {
    if (chartView === "portfolio") {
      // Create datasets - need to separate real and potential stocks even if same symbol
      const datasets: any[] = [];

      positionsBySymbol.forEach((positions, symbol) => {
        const lineStyle = getLineStyle(symbol);

        // Separate real and potential positions
        const realPositions = positions.filter(p => !p.isPotential);
        const potentialPositions = positions.filter(p => p.isPotential);

        // Add dataset for real positions (if any)
        if (realPositions.length > 0) {
          const firstReal = realPositions[0];
          datasets.push({
            label: symbol,
            data: firstReal.historicalData.map((d) => ({
              x: d.timestamp,
              y: d.price,
            })),
            borderColor: lineStyle.color,
            backgroundColor: lineStyle.color + "20",
            borderWidth: lineStyle.thickness,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.1,
            purchaseDates: realPositions.map(p => ({ date: p.purchaseDate, id: p.id })),
            isPotential: false,
          });
        }

        // Add dataset for each potential position
        potentialPositions.forEach((potentialPos) => {
          datasets.push({
            label: `${symbol} (Projected)`,
            data: potentialPos.historicalData.map((d) => ({
              x: d.timestamp,
              y: d.price,
            })),
            borderColor: lineStyle.color,
            backgroundColor: lineStyle.color + "20",
            borderWidth: lineStyle.thickness,
            borderDash: [10, 5], // Dashed line for potential stocks
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.1,
            purchaseDates: [],
            isPotential: true,
            segment: {
              borderDash: [10, 5],
            },
          });
        });
      });

      return { datasets };
    } else {
      const allTimestamps = new Set<number>();
      positionsBySymbol.forEach((positions) => {
        positions[0].historicalData.forEach((d) => allTimestamps.add(d.timestamp));
      });

      const earliestPurchaseDate = Math.min(
        ...portfolio.positions.map((position) => position.purchaseDate),
      );
      const sortedTimestamps = Array.from(allTimestamps)
        .sort((a, b) => a - b)
        .filter((timestamp) => timestamp >= earliestPurchaseDate);

      const priceSeriesBySymbol = new Map(
        Array.from(positionsBySymbol.entries()).map(([symbol, positions]) => [
          symbol,
          positions[0].historicalData,
        ]),
      );

      const seriesPointers = new Map<string, number>();
      const lastPrices = new Map<string, number>();
      priceSeriesBySymbol.forEach((_, symbol) => {
        seriesPointers.set(symbol, 0);
      });

      const totalValueData = sortedTimestamps.map((timestamp) => {
        let totalValue = 0;
        priceSeriesBySymbol.forEach((series, symbol) => {
          let pointer = seriesPointers.get(symbol) ?? 0;
          while (pointer < series.length && series[pointer].timestamp <= timestamp) {
            lastPrices.set(symbol, series[pointer].price);
            pointer += 1;
          }
          seriesPointers.set(symbol, pointer);

          const price = lastPrices.get(symbol);
          if (price === undefined) {
            return;
          }
          const sharesHeld = getHeldSharesAt(symbol, timestamp);
          if (sharesHeld > 0) {
            totalValue += price * sharesHeld;
          }
        });
        return { x: timestamp, y: totalValue };
      });

      return {
        datasets: [
          {
            label: "Total Value",
            data: totalValueData,
            borderColor: "#38bdf8",
            backgroundColor: "#38bdf8" + "20",
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
        bodySpacing: 6,
        titleMarginBottom: 8,
        caretPadding: 6,
        boxPadding: 4,
        displayColors: true,
        callbacks: {
          title: (items: any[]) => {
            if (!items.length) return "";
            const date = new Date(items[0].parsed.x).toLocaleDateString();
            if (chartView !== "portfolio") {
              return `Total Value • ${date}`;
            }
            const uniqueSymbols = Array.from(
              new Set(items.map((item) => item.dataset.label).filter(Boolean)),
            );
            const maxNames = 4;
            const displaySymbols =
              uniqueSymbols.length > maxNames
                ? [...uniqueSymbols.slice(0, maxNames), `+${uniqueSymbols.length - maxNames} more`]
                : uniqueSymbols;
            return `${displaySymbols.join(", ")} • ${date}`;
          },
          label: (context: any) => {
            const price = context.parsed.y;
            if (chartView !== "portfolio") {
              return [
                `Total Value: $${price.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}`,
              ];
            }
            const lines = [`Price: $${price.toFixed(2)}`];
            if (chartView === "portfolio") {
              const symbol = context.dataset.label || "";
              const sharesHeld = getHeldSharesAt(symbol, context.parsed.x);
              if (sharesHeld > 0) {
                const contribution = price * sharesHeld;
                lines.push(
                  `Contribution: $${contribution.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })} (${sharesHeld.toLocaleString()} shares)`,
                );
              }
            }
            return lines;
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
          text: chartView === "portfolio" ? "Price (USD)" : "Total Value (USD)",
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
          callback: (value: any) =>
            chartView === "portfolio"
              ? value.toFixed(0)
              : `$${Number(value).toLocaleString()}`,
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
  onAdd: (symbol: string, shares: number, purchaseDate: number, purchasePrice: number) => void;
}

function AddStockDialog({ onClose, onAdd }: AddStockDialogProps) {
  const [symbol, setSymbol] = useState("");
  const [shares, setShares] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchasePrice, setPurchasePrice] = useState<number | null>(null);
  const [priceLabel, setPriceLabel] = useState<string>("");
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  useEffect(() => {
    const trimmedSymbol = symbol.trim().toUpperCase();
    if (!trimmedSymbol || !purchaseDate) {
      setPurchasePrice(null);
      setPriceLabel("");
      setPriceError(null);
      return;
    }

    let cancelled = false;
    setIsFetchingPrice(true);
    setPriceError(null);

    const loadPrice = async () => {
      try {
        const response = await apiFetch("/api/stock-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: [trimmedSymbol], range: "ALL" }),
        });

        if (!response.ok) {
          throw new Error("Failed to fetch price data");
        }

        const data = await response.json();
        const stockData = data[trimmedSymbol];
        if (!stockData || !Array.isArray(stockData.historical) || stockData.historical.length === 0) {
          throw new Error("No historical data found");
        }

        const targetTimestamp = new Date(purchaseDate).getTime();
        let closest = stockData.historical[0];
        let closestDiff = Math.abs(closest.timestamp - targetTimestamp);
        for (const point of stockData.historical) {
          const diff = Math.abs(point.timestamp - targetTimestamp);
          if (diff < closestDiff) {
            closest = point;
            closestDiff = diff;
          }
        }

        if (!cancelled) {
          setPurchasePrice(closest.price);
          setPriceLabel(new Date(closest.timestamp).toISOString().slice(0, 10));
        }
      } catch (error) {
        if (!cancelled) {
          setPurchasePrice(null);
          setPriceLabel("");
          setPriceError(error instanceof Error ? error.message : "Failed to fetch price");
        }
      } finally {
        if (!cancelled) {
          setIsFetchingPrice(false);
        }
      }
    };

    loadPrice();
    return () => {
      cancelled = true;
    };
  }, [symbol, purchaseDate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sharesValue = parseFloat(shares);
    if (!symbol || !purchaseDate || purchasePrice === null || !Number.isFinite(sharesValue) || sharesValue <= 0) {
      return;
    }

    const purchaseTimestamp = new Date(purchaseDate).getTime();
    onAdd(symbol.toUpperCase(), sharesValue, purchaseTimestamp, purchasePrice);
  };

  const sharesValue = parseFloat(shares);
  const hasShares = Number.isFinite(sharesValue) && sharesValue > 0;
  const estimatedValue = purchasePrice !== null && hasShares ? purchasePrice * sharesValue : null;

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
              Used to estimate your purchase price per share.
            </p>
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
            <p className="text-xs text-gray-500 mt-1">
              Enter the total shares you purchased.
            </p>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-4">
            <div className="flex items-center justify-between text-sm text-gray-300">
              <span>Estimated Position Value</span>
              {isFetchingPrice ? (
                <span className="text-xs text-gray-500">Fetching price...</span>
              ) : (
                <span className="text-sm font-semibold text-white">
                  {estimatedValue !== null
                    ? `$${estimatedValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : "--"}
                </span>
              )}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              {priceError
                ? `Price lookup failed: ${priceError}`
                : purchasePrice !== null && priceLabel
                ? `Price on ${priceLabel}: $${purchasePrice.toFixed(2)}`
                : "Select a date to load the purchase price."}
            </div>
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
              disabled={!symbol || !purchaseDate || purchasePrice === null || !hasShares}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
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
  lineStyles: Record<string, LineStyle>;
  onResetChartConfig: () => void;
  onResetCard: (positionId: string) => void;
  onUpdateLineColor: (symbol: string, color: string) => void;
  onUpdateCardColor: (positionId: string, color: string) => void;
  onUpdateLineThickness: (symbol: string, thickness: number) => void;
  onUpdateFontSize: (positionId: string, fontSize: number) => void;
  onUpdateReferenceDate: (positionId: string, referenceDate: number) => void;
}

function CustomizationPanel({ config, onConfigChange, onClose, portfolio, lineStyles, onResetChartConfig, onResetCard, onUpdateLineColor, onUpdateCardColor, onUpdateLineThickness, onUpdateFontSize, onUpdateReferenceDate }: CustomizationPanelProps) {
  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-gray-900 border-l border-gray-800 z-40 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold">Chart Settings</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onResetChartConfig}
            className="rounded-md border border-gray-700 px-2 py-1 text-xs font-semibold text-gray-300 hover:border-gray-500 hover:text-white transition"
          >
            Reset Chart
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
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
              <h4 className="text-md font-bold mb-4">Chart Line Styles</h4>
            </div>

            {Array.from(new Set(portfolio.positions.map((position) => position.symbol))).map((symbol) => {
              const lineStyle = lineStyles[symbol] || {
                color: PRESET_COLORS[0],
                thickness: config.lineThickness,
              };
              return (
                <div key={symbol} className="pb-6 border-b border-gray-800 last:border-0">
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: lineStyle.color }}
                    />
                    <span className="font-semibold">{symbol}</span>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-2">
                        Line Color
                      </label>
                      <input
                        type="color"
                        value={lineStyle.color}
                        onChange={(e) => onUpdateLineColor(symbol, e.target.value)}
                        className="w-full h-8 rounded border border-gray-700 bg-gray-800 cursor-pointer"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-2">
                        Line Thickness: {lineStyle.thickness}px
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        step="1"
                        value={lineStyle.thickness}
                        onChange={(e) => onUpdateLineThickness(symbol, parseInt(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="pt-6 border-t border-gray-800">
              <h4 className="text-md font-bold mb-4">Card Styling (Batches)</h4>
            </div>

            {portfolio.positions.map((position) => {
              const lineColor =
                lineStyles[position.symbol]?.color || position.color || PRESET_COLORS[0];
              const purchaseDate = new Date(position.purchaseDate).toISOString().split('T')[0];
              return (
                <div key={position.id} className="pb-6 border-b border-gray-800 last:border-0">
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: lineColor }}
                    />
                    <div className="flex-1">
                      <div className="font-semibold">{position.symbol}</div>
                      <div className="text-[10px] text-gray-500">
                        {purchaseDate} • {position.shares} shares
                      </div>
                    </div>
                    <button
                      onClick={() => onResetCard(position.id)}
                      className="rounded-md border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-300 hover:border-gray-500 hover:text-white transition"
                    >
                      Reset Card
                    </button>
                  </div>

                  <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">
                      Card Background Color
                    </label>
                    <input
                      type="color"
                      value={position.cardColor.replace(/[0-9a-f]{2}$/i, '')} // Remove alpha
                      onChange={(e) => onUpdateCardColor(position.id, e.target.value + '20')}
                      className="w-full h-8 rounded border border-gray-700 bg-gray-800 cursor-pointer"
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
                      onChange={(e) => onUpdateFontSize(position.id, parseInt(e.target.value))}
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
                      onChange={(e) => onUpdateReferenceDate(position.id, new Date(e.target.value).getTime())}
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-white text-xs"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Card shows change from this date to now
                    </p>
                  </div>
                </div>
              </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ==================== SAVE PORTFOLIO DIALOG ====================

interface SavePortfolioDialogProps {
  onClose: () => void;
  onSave: (name: string) => Promise<boolean>;
  currentName?: string;
}

function SavePortfolioDialog({ onClose, onSave, currentName }: SavePortfolioDialogProps) {
  const [name, setName] = useState(currentName || "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      const success = await onSave(name);
      if (success) {
        setName("");
        // Dialog will be closed by parent component
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-800 max-w-md w-full p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xl font-bold">{currentName ? "Update Portfolio" : "Save Portfolio"}</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {currentName && (
            <p className="text-sm text-gray-400">
              Your changes will be saved to <span className="text-blue-400 font-medium">"{currentName}"</span>
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Portfolio Name {currentName && <span className="text-xs text-gray-500">(press Update to keep this name)</span>}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Portfolio"
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
              autoFocus
              disabled={isSaving}
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              disabled={isSaving}
            >
              {isSaving && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {isSaving ? "Saving..." : (currentName ? "Update" : "Save")}
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
  onNewPortfolio: () => void;
  getSavedPortfolios: () => Array<{ name: string; savedAt: number; positionCount: number }>;
}

function LoadPortfolioDialog({ onClose, onLoad, onDelete, onNewPortfolio, getSavedPortfolios }: LoadPortfolioDialogProps) {
  const [savedPortfolios, setSavedPortfolios] = useState(getSavedPortfolios());

  useEffect(() => {
    setSavedPortfolios(getSavedPortfolios());
  }, [getSavedPortfolios]);

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

        <div className="mt-6 flex gap-3">
          <button
            onClick={onNewPortfolio}
            className="flex-1 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Portfolio
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== POTENTIAL STOCK DIALOG ====================

interface PotentialStockDialogProps {
  onClose: () => void;
  onAdd: (symbol: string, currentPrice: number, shares: number, growthRate: number, growthPeriod: 'day' | 'week' | 'month' | 'year', holdingPeriod: number) => void;
}

function PotentialStockDialog({ onClose, onAdd }: PotentialStockDialogProps) {
  const [symbol, setSymbol] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [shares, setShares] = useState("");
  const [growthRate, setGrowthRate] = useState("");
  const [growthPeriod, setGrowthPeriod] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [holdingPeriod, setHoldingPeriod] = useState("");
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  // Fetch current price when symbol changes
  useEffect(() => {
    const trimmedSymbol = symbol.trim().toUpperCase();
    if (!trimmedSymbol) {
      setCurrentPrice("");
      setPriceError(null);
      return;
    }

    let cancelled = false;
    setIsFetchingPrice(true);
    setPriceError(null);

    const loadPrice = async () => {
      try {
        const response = await apiFetch("/api/stock-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: [trimmedSymbol], range: "1D" }),
        });

        if (!response.ok) {
          throw new Error("Failed to fetch price data");
        }

        const data = await response.json();
        const stockData = data[trimmedSymbol];
        if (!stockData || stockData.error) {
          throw new Error(stockData?.error || "Stock not found");
        }

        if (!cancelled) {
          setCurrentPrice(stockData.current_price.toFixed(2));
        }
      } catch (error) {
        if (!cancelled) {
          setCurrentPrice("");
          setPriceError(error instanceof Error ? error.message : "Failed to fetch price");
        }
      } finally {
        if (!cancelled) {
          setIsFetchingPrice(false);
        }
      }
    };

    const debounce = setTimeout(loadPrice, 500);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [symbol]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const priceValue = parseFloat(currentPrice);
    const sharesValue = parseFloat(shares);
    const rateValue = parseFloat(growthRate);
    const periodValue = parseFloat(holdingPeriod);

    if (!symbol || !Number.isFinite(priceValue) || priceValue <= 0 ||
        !Number.isFinite(sharesValue) || sharesValue <= 0 ||
        !Number.isFinite(rateValue) || !Number.isFinite(periodValue) || periodValue <= 0) {
      return;
    }

    onAdd(symbol.toUpperCase(), priceValue, sharesValue, rateValue, growthPeriod, periodValue);
  };

  const priceValue = parseFloat(currentPrice);
  const sharesValue = parseFloat(shares);
  const rateValue = parseFloat(growthRate);
  const periodValue = parseFloat(holdingPeriod);
  const hasValidInputs = Number.isFinite(priceValue) && priceValue > 0 &&
                         Number.isFinite(sharesValue) && sharesValue > 0 &&
                         Number.isFinite(rateValue) &&
                         Number.isFinite(periodValue) && periodValue > 0;

  // Calculate projected value
  let projectedPrice = 0;
  if (hasValidInputs) {
    let periodsElapsed = 0;
    switch (growthPeriod) {
      case 'day':
        periodsElapsed = periodValue;
        break;
      case 'week':
        periodsElapsed = periodValue / 7;
        break;
      case 'month':
        periodsElapsed = periodValue / 30;
        break;
      case 'year':
        periodsElapsed = periodValue / 365;
        break;
    }
    projectedPrice = priceValue * Math.pow(1 + rateValue / 100, periodsElapsed);
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-900 rounded-xl border border-gray-800 max-w-md w-full p-6 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">Add Potential Stock</h3>
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
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              required
            />
            {isFetchingPrice && <p className="text-xs text-gray-500 mt-1">Fetching current price...</p>}
            {priceError && <p className="text-xs text-red-400 mt-1">{priceError}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Current Price Per Share
            </label>
            <input
              type="number"
              value={currentPrice}
              onChange={(e) => setCurrentPrice(e.target.value)}
              placeholder="150.00"
              step="0.01"
              min="0"
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
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
              placeholder="10"
              step="1"
              min="0"
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              How many shares you plan to buy
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Expected Growth Rate (%)
            </label>
            <input
              type="number"
              value={growthRate}
              onChange={(e) => setGrowthRate(e.target.value)}
              placeholder="5.0"
              step="0.1"
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Enter positive for growth, negative for decline
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Growth Period
            </label>
            <select
              value={growthPeriod}
              onChange={(e) => setGrowthPeriod(e.target.value as 'day' | 'week' | 'month' | 'year')}
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500"
            >
              <option value="day">Per Day</option>
              <option value="week">Per Week</option>
              <option value="month">Per Month</option>
              <option value="year">Per Year</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Holding Period (days)
            </label>
            <input
              type="number"
              value={holdingPeriod}
              onChange={(e) => setHoldingPeriod(e.target.value)}
              placeholder="365"
              step="1"
              min="1"
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              How many days you plan to hold this stock
            </p>
          </div>

          {hasValidInputs && (
            <div className="rounded-lg border border-purple-800 bg-purple-950/40 p-4">
              <div className="text-sm text-gray-300 mb-2">Projected Position Value</div>
              <div className="text-2xl font-bold text-purple-400">
                ${(sharesValue * projectedPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {sharesValue} shares @ ${projectedPrice.toFixed(2)} per share
              </div>
              <div className="text-xs text-gray-400">
                After {periodValue} days at {rateValue}% per {growthPeriod}
              </div>
              <div className={`text-sm mt-2 ${projectedPrice >= priceValue ? "text-green-400" : "text-red-400"}`}>
                {projectedPrice >= priceValue ? "+" : ""}
                ${((projectedPrice - priceValue) * sharesValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} gain ({((projectedPrice - priceValue) / priceValue * 100).toFixed(2)}%)
              </div>
            </div>
          )}

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
              disabled={!hasValidInputs}
              className="flex-1 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Potential Stock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
