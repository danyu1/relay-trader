"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/app/lib/api";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";

// Portfolio holding with purchase info
interface PortfolioHolding {
  id: number;
  symbol: string;
  name: string;
  shares: number;
  purchasePrice: number;
  purchaseDate: number;
  dataset: string;
}

// Portfolio state
interface Portfolio {
  id: number;
  name: string;
  holdings: PortfolioHolding[];
  cash: number;
  currentDate: number; // Latest date from holdings
  createdAt: string;
}

// Trading action in timeline
interface TimelineAction {
  id: string;
  timestamp: number;
  type: "buy" | "sell" | "forward" | "init";
  symbol?: string;
  shares?: number;
  price?: number;
  description: string;
  portfolioSnapshot: Portfolio;
  parentId?: string; // For branching
}

// Dataset info
interface DatasetInfo {
  name: string;
  symbol: string;
  start_label: string;
  end_label: string;
  rows: number;
}

export default function PortfolioMode() {
  const router = useRouter();
  const { loading: authLoading } = useRequireAuth();

  const [step, setStep] = useState<"select" | "build" | "trade">("select");
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [activePortfolio, setActivePortfolio] = useState<Portfolio | null>(null);
  const [timeline, setTimeline] = useState<TimelineAction[]>([]);
  const [selectedTimelineIndex, setSelectedTimelineIndex] = useState(0);

  // Trading state
  const [tradeSymbol, setTradeSymbol] = useState("");
  const [tradeShares, setTradeShares] = useState(100);
  const [tradeAction, setTradeAction] = useState<"buy" | "sell">("buy");
  const [forwardDays, setForwardDays] = useState(1);
  const [availableDatasets, setAvailableDatasets] = useState<DatasetInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authLoading) return null;

  // Load portfolios from the portfolio builder
  useEffect(() => {
    if (authLoading) return;
    apiFetch("/portfolios?context=builder")
      .then((res) => res.json())
      .then((data) => {
        setPortfolios(data.portfolios || []);
      })
      .catch((e) => {
        console.error("Failed to load portfolios", e);
      });
  }, [authLoading]);

  // Load available datasets
  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        const response = await apiFetch("/datasets");
        const data = await response.json();
        const datasets = data.datasets || data;

        const mapped = datasets.map((d: any) => ({
          name: d.name,
          symbol: d.symbol || d.name.split('_')[0].toUpperCase(),
          start_label: d.start_label || '',
          end_label: d.end_label || '',
          rows: d.rows || 0,
        }));

        setAvailableDatasets(mapped);
      } catch (err) {
        console.error("Failed to load datasets", err);
      }
    };

    if (step === "trade") {
      fetchDatasets();
    }
  }, [step]);

  const selectPortfolio = (portfolioData: any) => {
    // Map portfolio builder data to portfolio trading format
    const mappedHoldings: PortfolioHolding[] = portfolioData.holdings.map((h: any) => ({
      id: h.id,
      symbol: h.symbol,
      name: h.symbol, // Use symbol as name for now
      shares: h.shares,
      purchasePrice: h.avgCost,
      purchaseDate: new Date(h.addedAt || Date.now()).getTime(),
      dataset: `${h.symbol}_dataset.csv`, // Placeholder
    }));

    // Find the latest purchase date to set as current date
    const latestDate = mappedHoldings.length > 0
      ? Math.max(...mappedHoldings.map(h => h.purchaseDate))
      : Date.now();

    const portfolio: Portfolio = {
      id: portfolioData.id,
      name: portfolioData.name,
      holdings: mappedHoldings,
      cash: portfolioData.cash,
      currentDate: latestDate,
      createdAt: portfolioData.createdAt,
    };

    setActivePortfolio(portfolio);

    // Initialize timeline with portfolio creation
    const initAction: TimelineAction = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      type: "init",
      description: `Portfolio "${portfolio.name}" loaded`,
      portfolioSnapshot: portfolio,
    };

    setTimeline([initAction]);
    setSelectedTimelineIndex(0);
    setStep("trade");
  };

  const createNewPortfolio = () => {
    router.push("/portfolio");
  };

  // Execute buy/sell trade
  const executeTrade = async () => {
    if (!activePortfolio || !tradeSymbol) {
      setError("Please select a symbol");
      setTimeout(() => setError(null), 3000);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const currentSnapshot = timeline[selectedTimelineIndex]?.portfolioSnapshot || activePortfolio;
      const dataset = availableDatasets.find(d => d.symbol === tradeSymbol);

      if (!dataset) {
        throw new Error(`Dataset not found for ${tradeSymbol}`);
      }

      // Fetch current price from dataset at current date
      const response = await apiFetch(
        `/dataset-preview?name=${encodeURIComponent(dataset.name)}&limit=1000`
      );
      const preview = await response.json();
      const rows = preview.head || preview.rows || [];

      // Find price at current date
      const currentDateMs = currentSnapshot.currentDate;
      let closestRow = rows[0];
      let closestDiff = Math.abs(new Date(rows[0].timestamp).getTime() - currentDateMs);

      for (const row of rows) {
        const rowDate = new Date(row.timestamp).getTime();
        const diff = Math.abs(rowDate - currentDateMs);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestRow = row;
        }
      }

      const price = closestRow.close || 0;
      const totalCost = price * tradeShares;

      let newPortfolio = { ...currentSnapshot };

      if (tradeAction === "buy") {
        if (newPortfolio.cash < totalCost) {
          throw new Error("Insufficient cash");
        }

        newPortfolio.cash -= totalCost;
        const existingHolding = newPortfolio.holdings.find(h => h.symbol === tradeSymbol);

        if (existingHolding) {
          existingHolding.shares += tradeShares;
        } else {
          newPortfolio.holdings.push({
            id: Date.now(),
            symbol: tradeSymbol,
            name: tradeSymbol,
            shares: tradeShares,
            purchasePrice: price,
            purchaseDate: currentDateMs,
            dataset: dataset.name,
          });
        }
      } else {
        const holding = newPortfolio.holdings.find(h => h.symbol === tradeSymbol);
        if (!holding || holding.shares < tradeShares) {
          throw new Error("Insufficient shares to sell");
        }

        holding.shares -= tradeShares;
        newPortfolio.cash += totalCost;

        if (holding.shares === 0) {
          newPortfolio.holdings = newPortfolio.holdings.filter(h => h.symbol !== tradeSymbol);
        }
      }

      // Add to timeline
      const newAction: TimelineAction = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: tradeAction,
        symbol: tradeSymbol,
        shares: tradeShares,
        price,
        description: `${tradeAction.toUpperCase()} ${tradeShares} ${tradeSymbol} @ $${price.toFixed(2)}`,
        portfolioSnapshot: newPortfolio,
        parentId: timeline[selectedTimelineIndex]?.id,
      };

      const newTimeline = [...timeline.slice(0, selectedTimelineIndex + 1), newAction];
      setTimeline(newTimeline);
      setSelectedTimelineIndex(newTimeline.length - 1);

      setTradeSymbol("");
      setTradeShares(100);
    } catch (err: any) {
      setError(err.message || "Trade failed");
      setTimeout(() => setError(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  // Move portfolio forward in time
  const moveForward = async () => {
    if (!activePortfolio) return;

    setLoading(true);
    setError(null);

    try {
      const currentSnapshot = timeline[selectedTimelineIndex]?.portfolioSnapshot || activePortfolio;
      const newDate = currentSnapshot.currentDate + (forwardDays * 24 * 60 * 60 * 1000);

      // Update all holdings with new prices at new date
      const updatedHoldings = await Promise.all(
        currentSnapshot.holdings.map(async (holding) => {
          const dataset = availableDatasets.find(d => d.symbol === holding.symbol);
          if (!dataset) return holding;

          const response = await apiFetch(
            `/dataset-preview?name=${encodeURIComponent(dataset.name)}&limit=1000`
          );
          const preview = await response.json();
          const rows = preview.head || preview.rows || [];

          let closestRow = rows[0];
          let closestDiff = Math.abs(new Date(rows[0].timestamp).getTime() - newDate);

          for (const row of rows) {
            const rowDate = new Date(row.timestamp).getTime();
            const diff = Math.abs(rowDate - newDate);
            if (diff < closestDiff) {
              closestDiff = diff;
              closestRow = row;
            }
          }

          return {
            ...holding,
            purchasePrice: closestRow.close || holding.purchasePrice,
          };
        })
      );

      const newPortfolio = {
        ...currentSnapshot,
        currentDate: newDate,
        holdings: updatedHoldings,
      };

      const newAction: TimelineAction = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: "forward",
        description: `Moved forward ${forwardDays} day(s)`,
        portfolioSnapshot: newPortfolio,
        parentId: timeline[selectedTimelineIndex]?.id,
      };

      const newTimeline = [...timeline.slice(0, selectedTimelineIndex + 1), newAction];
      setTimeline(newTimeline);
      setSelectedTimelineIndex(newTimeline.length - 1);
    } catch (err: any) {
      setError(err.message || "Failed to move forward");
      setTimeout(() => setError(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  if (step === "select") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-950 to-black p-6">
        <div className="max-w-[90%] mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <h1 className="text-3xl font-bold text-white">Portfolio Backtest Mode</h1>
            </div>
            <p className="text-gray-400 text-sm">
              Select an existing portfolio to backtest or create a new one
            </p>
          </div>

          {/* Create New Portfolio Card */}
          <button
            onClick={createNewPortfolio}
            className="w-full mb-6 p-6 rounded-xl border-2 border-dashed border-blue-600 bg-blue-950/20 hover:bg-blue-950/40 transition group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div className="text-left">
                <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition">Create New Portfolio</h3>
                <p className="text-sm text-gray-400">Build a new portfolio from scratch</p>
              </div>
            </div>
          </button>

          {/* Existing Portfolios */}
          {portfolios.length > 0 ? (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white mb-4">Your Portfolios</h2>
              {portfolios.map((portfolio) => {
                const totalValue = portfolio.holdings.reduce(
                  (sum, h) => sum + h.shares * h.purchasePrice,
                  0
                );
                const totalEquity = totalValue + portfolio.cash;

                return (
                  <button
                    key={portfolio.id}
                    onClick={() => selectPortfolio(portfolio)}
                    className="w-full p-6 rounded-xl border border-gray-800 bg-gray-900/50 hover:border-blue-600 hover:bg-gray-900 transition text-left group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition mb-2">
                          {portfolio.name}
                        </h3>
                        <div className="grid grid-cols-3 gap-4 mb-3">
                          <div>
                            <div className="text-xs text-gray-400">Holdings</div>
                            <div className="text-lg font-semibold text-white">{portfolio.holdings.length}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-400">Cash</div>
                            <div className="text-lg font-semibold text-white">${portfolio.cash.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-400">Total Equity</div>
                            <div className="text-lg font-semibold text-white">${totalEquity.toLocaleString()}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {portfolio.holdings.slice(0, 5).map((h) => (
                            <span key={h.id} className="px-2 py-1 rounded bg-gray-800 text-xs text-gray-300 font-mono">
                              {h.symbol}
                            </span>
                          ))}
                          {portfolio.holdings.length > 5 && (
                            <span className="px-2 py-1 rounded bg-gray-700 text-xs text-gray-400">
                              +{portfolio.holdings.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>
                      <svg className="w-6 h-6 text-gray-400 group-hover:text-blue-400 transition flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-gray-400">No portfolios found. Create one to get started!</p>
            </div>
          )}

          {/* Back Button */}
          <Link
            href="/backtest"
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-gray-700 transition text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Backtest Mode Selection
          </Link>
        </div>
      </div>
    );
  }

  // Trading View
  if (step === "trade" && activePortfolio) {
    const currentSnapshot = timeline[selectedTimelineIndex]?.portfolioSnapshot || activePortfolio;
    const totalHoldingsValue = currentSnapshot.holdings.reduce(
      (sum, h) => sum + h.shares * h.purchasePrice,
      0
    );
    const totalEquity = currentSnapshot.cash + totalHoldingsValue;

    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-950 to-black p-6">
        <div className="max-w-[95%] mx-auto">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <h1 className="text-3xl font-bold text-white">{currentSnapshot.name}</h1>
              </div>
              <p className="text-gray-400 text-sm">Portfolio Trading Mode • Timeline Position {selectedTimelineIndex + 1} of {timeline.length}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setStep("select")}
                className="px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-gray-700 transition text-sm"
              >
                Switch Portfolio
              </button>
              <Link
                href="/portfolio"
                className="px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-gray-700 transition text-sm"
              >
                Edit in Builder
              </Link>
            </div>
          </div>

          {/* Timeline */}
          <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-lg font-bold text-white">Action Timeline</h2>
            </div>

            {/* Timeline visualization */}
            <div className="relative">
              <div className="flex items-center gap-2 overflow-x-auto pb-4 scrollbar-hide">
                {timeline.map((action, idx) => (
                  <button
                    key={action.id}
                    onClick={() => setSelectedTimelineIndex(idx)}
                    className={`flex-shrink-0 group relative ${
                      idx === selectedTimelineIndex
                        ? "ring-2 ring-blue-500"
                        : "hover:ring-2 hover:ring-gray-600"
                    }`}
                  >
                    {/* Connection line */}
                    {idx < timeline.length - 1 && (
                      <div className="absolute top-1/2 left-full w-8 h-0.5 bg-gray-700 -translate-y-1/2 z-0" />
                    )}

                    {/* Node */}
                    <div className={`relative z-10 w-32 p-3 rounded-lg border transition ${
                      idx === selectedTimelineIndex
                        ? "bg-blue-950 border-blue-600"
                        : "bg-gray-800 border-gray-700 group-hover:border-gray-600"
                    }`}>
                      <div className={`text-xs font-semibold mb-1 ${
                        idx === selectedTimelineIndex ? "text-blue-400" : "text-gray-400"
                      }`}>
                        {action.type.toUpperCase()}
                      </div>
                      <div className="text-xs text-gray-300 truncate">{action.description}</div>
                      <div className="text-[10px] text-gray-500 mt-1">
                        {new Date(action.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Timeline controls */}
            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-800">
              <button
                onClick={() => setSelectedTimelineIndex(Math.max(0, selectedTimelineIndex - 1))}
                disabled={selectedTimelineIndex === 0}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 transition text-sm"
              >
                ← Previous
              </button>
              <button
                onClick={() => setSelectedTimelineIndex(Math.min(timeline.length - 1, selectedTimelineIndex + 1))}
                disabled={selectedTimelineIndex === timeline.length - 1}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 transition text-sm"
              >
                Next →
              </button>
              <div className="flex-1" />
              <div className="text-sm text-gray-400">
                Current Date: {new Date(currentSnapshot.currentDate).toLocaleDateString()}
              </div>
            </div>
          </div>

          {/* Portfolio Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-sm font-semibold text-gray-400">Cash Available</h3>
              </div>
              <div className="text-3xl font-bold text-white">${currentSnapshot.cash.toLocaleString()}</div>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                </svg>
                <h3 className="text-sm font-semibold text-gray-400">Holdings Value</h3>
              </div>
              <div className="text-3xl font-bold text-white">${totalHoldingsValue.toLocaleString()}</div>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <h3 className="text-sm font-semibold text-gray-400">Total Equity</h3>
              </div>
              <div className="text-3xl font-bold text-white">${totalEquity.toLocaleString()}</div>
            </div>
          </div>

          {/* Holdings Table */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden mb-6">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Current Holdings ({currentSnapshot.holdings.length})</h3>
            </div>

            {currentSnapshot.holdings.length === 0 ? (
              <div className="p-12 text-center">
                <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <div className="text-gray-400 text-sm">No holdings in this portfolio</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-800/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Symbol</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Shares</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Purchase Price</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Purchase Date</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Current Value</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Dataset</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {currentSnapshot.holdings.map((holding) => (
                      <tr key={holding.id} className="hover:bg-gray-800/30 transition">
                        <td className="px-4 py-3">
                          <div className="font-mono font-bold text-white">{holding.symbol}</div>
                          <div className="text-xs text-gray-400">{holding.name}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                          {holding.shares.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                          ${holding.purchasePrice.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-400">
                          {new Date(holding.purchaseDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-white">
                          ${(holding.shares * holding.purchasePrice).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-500 font-mono">
                          {holding.dataset}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-6 rounded-xl border border-red-800 bg-red-950/50 p-4">
              <div className="flex items-center gap-2 text-red-400">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-semibold">{error}</span>
              </div>
            </div>
          )}

          {/* Trading Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Buy/Sell Panel */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <h3 className="text-lg font-bold text-white">Buy / Sell Stock</h3>
              </div>

              <div className="space-y-4">
                {/* Action Toggle */}
                <div className="inline-flex rounded-lg border border-gray-800 bg-gray-900/60 p-0.5">
                  <button
                    onClick={() => setTradeAction("buy")}
                    className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
                      tradeAction === "buy"
                        ? "bg-green-600 text-white"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => setTradeAction("sell")}
                    className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
                      tradeAction === "sell"
                        ? "bg-red-600 text-white"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Sell
                  </button>
                </div>

                {/* Symbol Selection */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Symbol</label>
                  <select
                    value={tradeSymbol}
                    onChange={(e) => setTradeSymbol(e.target.value)}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                  >
                    <option value="">Select a symbol...</option>
                    {availableDatasets.map((dataset) => (
                      <option key={dataset.name} value={dataset.symbol}>
                        {dataset.symbol} ({dataset.start_label} → {dataset.end_label})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Shares */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Shares</label>
                  <input
                    type="number"
                    value={tradeShares}
                    onChange={(e) => setTradeShares(parseInt(e.target.value) || 0)}
                    min="1"
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                  />
                </div>

                {/* Execute Button */}
                <button
                  onClick={executeTrade}
                  disabled={loading || !tradeSymbol}
                  className={`w-full px-4 py-2 rounded-lg font-semibold transition ${
                    tradeAction === "buy"
                      ? "bg-green-600 hover:bg-green-700 text-white"
                      : "bg-red-600 hover:bg-red-700 text-white"
                  } disabled:bg-gray-700 disabled:text-gray-500`}
                >
                  {loading ? "Processing..." : `${tradeAction === "buy" ? "Buy" : "Sell"} ${tradeShares} shares`}
                </button>
              </div>
            </div>

            {/* Time Forward Panel */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-lg font-bold text-white">Move Forward in Time</h3>
              </div>

              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  Advance the portfolio's current date and update all holdings with new market prices.
                </p>

                {/* Days Input */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Number of Days</label>
                  <input
                    type="number"
                    value={forwardDays}
                    onChange={(e) => setForwardDays(parseInt(e.target.value) || 1)}
                    min="1"
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                  />
                </div>

                {/* Quick Buttons */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setForwardDays(1)}
                    className="px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 transition text-xs"
                  >
                    1 Day
                  </button>
                  <button
                    onClick={() => setForwardDays(7)}
                    className="px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 transition text-xs"
                  >
                    1 Week
                  </button>
                  <button
                    onClick={() => setForwardDays(30)}
                    className="px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 transition text-xs"
                  >
                    1 Month
                  </button>
                </div>

                {/* Execute Button */}
                <button
                  onClick={moveForward}
                  disabled={loading}
                  className="w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition disabled:bg-gray-700 disabled:text-gray-500"
                >
                  {loading ? "Processing..." : `Move Forward ${forwardDays} Day(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
