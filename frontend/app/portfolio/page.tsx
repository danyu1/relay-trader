"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// Minimalistic Icons
function ChartIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

function WalletIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M22 12h-4a2 2 0 0 1 0-4h4" />
    </svg>
  );
}

function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6" />
      <path d="M2.5 22v-6h6" />
      <path d="M2 11.5a10 10 0 0 1 18.8-4.3" />
      <path d="M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
  );
}

function DownloadIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TrashIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function TrendingUpIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function PlusIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function DollarIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function RocketIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function AlertIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

interface PortfolioHolding {
  id: string;
  symbol: string;
  shares: number;
  avgCost: number;
  currentPrice?: number;
  currentValue?: number;
  addedAt?: string;
}

interface Portfolio {
  id: string;
  name: string;
  holdings: PortfolioHolding[];
  cash: number;
  createdAt: string;
  updatedAt: string;
}

export default function PortfolioPage() {
  // Multi-portfolio state
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [activePortfolioId, setActivePortfolioId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState("");

  // Legacy state (for current active portfolio)
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [cash, setCash] = useState(100000);
  const [newSymbol, setNewSymbol] = useState("");
  const [newShares, setNewShares] = useState(100);
  const [newAvgCost, setNewAvgCost] = useState(0);
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);

  // Timeline state
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineDate, setTimelineDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Comparison view state
  const [showComparison, setShowComparison] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8002";

  // Load portfolios from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("priorsystems:portfolios");
    const savedActiveId = localStorage.getItem("priorsystems:active-portfolio-id");

    if (saved) {
      const loadedPortfolios = JSON.parse(saved);
      setPortfolios(loadedPortfolios);

      if (savedActiveId && loadedPortfolios.find((p: Portfolio) => p.id === savedActiveId)) {
        setActivePortfolioId(savedActiveId);
        const activePortfolio = loadedPortfolios.find((p: Portfolio) => p.id === savedActiveId);
        if (activePortfolio) {
          setHoldings(activePortfolio.holdings);
          setCash(activePortfolio.cash);
        }
      } else if (loadedPortfolios.length > 0) {
        setActivePortfolioId(loadedPortfolios[0].id);
        setHoldings(loadedPortfolios[0].holdings);
        setCash(loadedPortfolios[0].cash);
      }
    } else {
      // Create default portfolio if none exists
      const defaultPortfolio: Portfolio = {
        id: crypto.randomUUID(),
        name: "My Portfolio",
        holdings: [],
        cash: 100000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setPortfolios([defaultPortfolio]);
      setActivePortfolioId(defaultPortfolio.id);
      localStorage.setItem("priorsystems:portfolios", JSON.stringify([defaultPortfolio]));
      localStorage.setItem("priorsystems:active-portfolio-id", defaultPortfolio.id);
    }
  }, []);

  // Save active portfolio changes to localStorage
  useEffect(() => {
    if (portfolios.length > 0 && activePortfolioId) {
      const updatedPortfolios = portfolios.map(p =>
        p.id === activePortfolioId
          ? { ...p, holdings, cash, updatedAt: new Date().toISOString() }
          : p
      );
      setPortfolios(updatedPortfolios);
      localStorage.setItem("priorsystems:portfolios", JSON.stringify(updatedPortfolios));
    }
  }, [holdings, cash]);

  // Create new portfolio
  const createPortfolio = () => {
    if (!newPortfolioName.trim()) return;

    const newPortfolio: Portfolio = {
      id: crypto.randomUUID(),
      name: newPortfolioName.trim(),
      holdings: [],
      cash: 100000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updatedPortfolios = [...portfolios, newPortfolio];
    setPortfolios(updatedPortfolios);
    setActivePortfolioId(newPortfolio.id);
    setHoldings([]);
    setCash(100000);
    setNewPortfolioName("");
    setShowCreateModal(false);

    localStorage.setItem("priorsystems:portfolios", JSON.stringify(updatedPortfolios));
    localStorage.setItem("priorsystems:active-portfolio-id", newPortfolio.id);
  };

  // Switch to different portfolio
  const switchPortfolio = (portfolioId: string) => {
    const portfolio = portfolios.find(p => p.id === portfolioId);
    if (!portfolio) return;

    setActivePortfolioId(portfolioId);
    setHoldings(portfolio.holdings);
    setCash(portfolio.cash);
    localStorage.setItem("priorsystems:active-portfolio-id", portfolioId);
  };

  // Delete portfolio
  const deletePortfolio = (portfolioId: string) => {
    if (portfolios.length <= 1) {
      alert("Cannot delete the last portfolio");
      return;
    }

    if (!confirm("Are you sure you want to delete this portfolio?")) return;

    const updatedPortfolios = portfolios.filter(p => p.id !== portfolioId);
    setPortfolios(updatedPortfolios);

    if (activePortfolioId === portfolioId) {
      const newActive = updatedPortfolios[0];
      setActivePortfolioId(newActive.id);
      setHoldings(newActive.holdings);
      setCash(newActive.cash);
      localStorage.setItem("priorsystems:active-portfolio-id", newActive.id);
    }

    localStorage.setItem("priorsystems:portfolios", JSON.stringify(updatedPortfolios));
  };

  // Rename portfolio
  const renamePortfolio = (portfolioId: string) => {
    const newName = prompt("Enter new portfolio name:");
    if (!newName || !newName.trim()) return;

    const updatedPortfolios = portfolios.map(p =>
      p.id === portfolioId
        ? { ...p, name: newName.trim(), updatedAt: new Date().toISOString() }
        : p
    );
    setPortfolios(updatedPortfolios);
    localStorage.setItem("priorsystems:portfolios", JSON.stringify(updatedPortfolios));
  };

  // Load available symbols from datasets
  useEffect(() => {
    const fetchSymbols = async () => {
      setIsLoadingSymbols(true);
      try {
        const response = await fetch(`${apiBase}/datasets`);
        const data = await response.json();

        // API returns { datasets: [...] }
        const datasets = data.datasets || data;

        if (!Array.isArray(datasets)) {
          console.error("Datasets is not an array:", datasets);
          return;
        }

        // Extract symbols from dataset names
        const symbols = datasets.map((dataset: any) => {
          // Use the symbol field if available, otherwise extract from name
          if (dataset.symbol) {
            return dataset.symbol.toUpperCase();
          }

          // Extract symbol from name like "AAPL_2020-2024.csv" or "AAPL.csv"
          const name = dataset.name.replace('.csv', '');
          const match = name.match(/^([A-Z]+)(?:_|$)/i);
          return match ? match[1].toUpperCase() : name.split('_')[0].toUpperCase();
        }).filter((symbol: string, index: number, self: string[]) =>
          symbol && self.indexOf(symbol) === index // Remove duplicates and empty strings
        ).sort();

        setAvailableSymbols(symbols);
      } catch (err) {
        console.error("Failed to load symbols", err);
      } finally {
        setIsLoadingSymbols(false);
      }
    };

    fetchSymbols();
  }, [apiBase]);

  const addHolding = () => {
    if (!newSymbol.trim()) {
      setError("Please enter a symbol");
      setTimeout(() => setError(null), 3000);
      return;
    }

    if (newShares <= 0) {
      setError("Shares must be greater than 0");
      setTimeout(() => setError(null), 3000);
      return;
    }

    const newHolding: PortfolioHolding = {
      id: `${Date.now()}_${newSymbol}`,
      symbol: newSymbol.toUpperCase(),
      shares: newShares,
      avgCost: newAvgCost,
      addedAt: showTimeline ? timelineDate : new Date().toISOString(),
    };

    setHoldings([...holdings, newHolding]);
    setNewSymbol("");
    setNewShares(100);
    setNewAvgCost(0);
  };

  const removeHolding = (id: string) => {
    setHoldings(holdings.filter(h => h.id !== id));
  };

  const fetchCurrentPrices = async () => {
    setIsLoadingPrices(true);
    setError(null);

    try {
      // Fetch current prices for all symbols
      const updatedHoldings = await Promise.all(
        holdings.map(async (holding) => {
          try {
            // Try to get latest price from a dataset (if exists)
            const response = await fetch(`${apiBase}/datasets`);
            const datasets = await response.json();

            // Find a dataset matching this symbol
            const matchingDataset = datasets.find((d: any) =>
              d.name.toUpperCase().includes(holding.symbol)
            );

            if (matchingDataset) {
              // Get preview to extract latest price
              const previewResponse = await fetch(
                `${apiBase}/dataset-preview?name=${encodeURIComponent(matchingDataset.name)}&limit=1`
              );
              const preview = await previewResponse.json();

              if (preview.rows && preview.rows.length > 0) {
                const lastRow = preview.rows[0];
                const closePrice = lastRow.Close || lastRow.close || holding.avgCost;

                return {
                  ...holding,
                  currentPrice: closePrice,
                  currentValue: holding.shares * closePrice,
                };
              }
            }

            // Fallback to avg cost if no dataset found
            return {
              ...holding,
              currentPrice: holding.avgCost,
              currentValue: holding.shares * holding.avgCost,
            };
          } catch (e) {
            console.error(`Failed to fetch price for ${holding.symbol}`, e);
            return {
              ...holding,
              currentPrice: holding.avgCost,
              currentValue: holding.shares * holding.avgCost,
            };
          }
        })
      );

      setHoldings(updatedHoldings);
    } catch (e) {
      setError("Failed to fetch current prices");
      console.error(e);
    } finally {
      setIsLoadingPrices(false);
    }
  };

  const totalHoldingsValue = holdings.reduce((sum, h) => sum + (h.currentValue || h.shares * h.avgCost), 0);
  const totalEquity = cash + totalHoldingsValue;
  const totalCost = holdings.reduce((sum, h) => sum + h.shares * h.avgCost, 0);
  const unrealizedPnL = totalHoldingsValue - totalCost;
  const unrealizedPnLPercent = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0;

  const exportToCSV = () => {
    const headers = ["Symbol", "Shares", "Avg Cost", "Current Price", "Current Value"];
    const rows = holdings.map(h => [
      h.symbol,
      h.shares,
      h.avgCost.toFixed(2),
      (h.currentPrice || h.avgCost).toFixed(2),
      (h.currentValue || h.shares * h.avgCost).toFixed(2),
    ]);

    const csv = [
      headers.join(","),
      ...rows.map(row => row.join(",")),
      "",
      `Total Holdings Value,${totalHoldingsValue.toFixed(2)}`,
      `Cash,${cash.toFixed(2)}`,
      `Total Equity,${totalEquity.toFixed(2)}`,
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearPortfolio = () => {
    if (confirm("Are you sure you want to clear your entire portfolio?")) {
      setHoldings([]);
      setCash(100000);
    }
  };

  const activePortfolio = portfolios.find(p => p.id === activePortfolioId);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-black p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <ChartIcon className="w-8 h-8 text-gray-400" />
              <h1 className="text-3xl font-bold text-white">Portfolio Builder</h1>
            </div>
            <p className="text-gray-400 text-sm">
              Build your portfolio, track holdings, and use your equity for backtesting
            </p>
          </div>
          <Link
            href="/"
            className="px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-gray-700 transition text-sm"
          >
            ← Back to Home
          </Link>
        </div>

        {/* Portfolio Switcher */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Portfolio:</span>
            <select
              value={activePortfolioId || ""}
              onChange={(e) => switchPortfolio(e.target.value)}
              className="px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white hover:border-gray-600 transition text-sm font-semibold outline-none focus:border-purple-500"
            >
              {portfolios.map((portfolio) => (
                <option key={portfolio.id} value={portfolio.id}>
                  {portfolio.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition text-sm font-semibold"
          >
            <PlusIcon className="w-4 h-4" />
            New Portfolio
          </button>

          {activePortfolio && (
            <>
              <button
                onClick={() => renamePortfolio(activePortfolio.id)}
                className="px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-gray-700 transition text-sm"
              >
                Rename
              </button>
              <button
                onClick={() => deletePortfolio(activePortfolio.id)}
                disabled={portfolios.length <= 1}
                className="px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 transition text-sm"
              >
                Delete
              </button>
            </>
          )}

          <button
            onClick={() => setShowComparison(!showComparison)}
            className={`px-4 py-2 rounded-lg transition text-sm font-semibold ${
              showComparison
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-800 text-white hover:bg-gray-700'
            }`}
          >
            {showComparison ? 'Hide Comparison' : 'Compare Portfolios'}
          </button>
        </div>
      </div>

      {/* Create Portfolio Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-white mb-4">Create New Portfolio</h2>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Portfolio Name</label>
              <input
                type="text"
                value={newPortfolioName}
                onChange={(e) => setNewPortfolioName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createPortfolio()}
                placeholder="My Portfolio"
                className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white outline-none focus:border-purple-500"
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={createPortfolio}
                disabled={!newPortfolioName.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-600 transition font-semibold"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewPortfolioName("");
                }}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-gray-700 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="fixed top-4 right-4 z-50 rounded-lg border border-gray-700 bg-gray-900/95 px-4 py-3 shadow-xl">
          <div className="flex items-center gap-2">
            <AlertIcon className="w-5 h-5 text-gray-400" />
            <span className="text-sm font-semibold text-white">{error}</span>
          </div>
        </div>
      )}

      {/* Portfolio Comparison View */}
      {showComparison && portfolios.length > 0 && (
        <div className="max-w-6xl mx-auto mb-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <h2 className="text-xl font-bold text-white mb-4">Portfolio Comparison</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Portfolio Name</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Holdings</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Cash</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Holdings Value</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Total Equity</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Created</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {portfolios.map((portfolio) => {
                    const portfolioHoldingsValue = portfolio.holdings.reduce(
                      (sum, h) => sum + (h.currentValue || h.shares * h.avgCost),
                      0
                    );
                    const portfolioEquity = portfolio.cash + portfolioHoldingsValue;
                    const isActive = portfolio.id === activePortfolioId;

                    return (
                      <tr
                        key={portfolio.id}
                        className={`hover:bg-gray-800/30 transition cursor-pointer ${
                          isActive ? 'bg-blue-900/20' : ''
                        }`}
                        onClick={() => switchPortfolio(portfolio.id)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{portfolio.name}</span>
                            {isActive && (
                              <span className="px-2 py-0.5 rounded bg-blue-600 text-xs text-white">Active</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                          {portfolio.holdings.length}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                          ${portfolio.cash.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-white">
                          ${portfolioHoldingsValue.toLocaleString(undefined, {maximumFractionDigits: 0})}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-white">
                          ${portfolioEquity.toLocaleString(undefined, {maximumFractionDigits: 0})}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-400">
                          {new Date(portfolio.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-400">
                          {new Date(portfolio.updatedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        {/* Main Content */}
        <div className="space-y-6">
          {/* Portfolio Summary */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <WalletIcon className="w-6 h-6 text-gray-400" />
              <h2 className="text-xl font-bold text-white">Portfolio Summary</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-gray-400 mb-1">Cash</div>
                <div className="text-2xl font-bold text-white">${cash.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Holdings Value</div>
                <div className="text-2xl font-bold text-white">${totalHoldingsValue.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Total Equity</div>
                <div className="text-2xl font-bold text-white">${totalEquity.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Unrealized P&L</div>
                <div className={`text-2xl font-bold ${unrealizedPnL >= 0 ? 'text-white' : 'text-gray-400'}`}>
                  {unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL.toLocaleString(undefined, {maximumFractionDigits: 0})}
                  <span className="text-sm ml-2">({unrealizedPnL >= 0 ? '+' : ''}{unrealizedPnLPercent.toFixed(2)}%)</span>
                </div>
              </div>
            </div>

            {/* Portfolio Allocation */}
            {holdings.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-800">
                <h3 className="text-sm font-semibold text-gray-400 mb-3">Portfolio Allocation</h3>
                <div className="space-y-2">
                  {holdings.map((holding) => {
                    const value = holding.currentValue || holding.shares * holding.avgCost;
                    const percentage = (value / totalEquity) * 100;
                    return (
                      <div key={holding.id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono text-white">{holding.symbol}</span>
                          <span className="text-xs text-gray-400">{percentage.toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-white">CASH</span>
                      <span className="text-xs text-gray-400">{((cash / totalEquity) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-green-500 to-emerald-500 h-2 rounded-full"
                        style={{ width: `${(cash / totalEquity) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={fetchCurrentPrices}
                disabled={isLoadingPrices || holdings.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black hover:bg-gray-200 disabled:bg-gray-700 disabled:text-gray-500 transition text-sm font-semibold"
              >
                <RefreshIcon className="w-4 h-4" />
                {isLoadingPrices ? "Fetching..." : "Update Prices"}
              </button>
              <button
                onClick={exportToCSV}
                disabled={holdings.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 transition text-sm"
              >
                <DownloadIcon className="w-4 h-4" />
                Export CSV
              </button>
              <button
                onClick={clearPortfolio}
                disabled={holdings.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:bg-gray-800 disabled:text-gray-600 transition text-sm"
              >
                <TrashIcon className="w-4 h-4" />
                Clear All
              </button>
            </div>
          </div>

          {/* Holdings Table */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
            <div className="p-4 border-b border-gray-800">
              <h3 className="text-lg font-bold text-white">Holdings ({holdings.length})</h3>
            </div>

            {holdings.length === 0 ? (
              <div className="p-12 text-center">
                <TrendingUpIcon className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <div className="text-gray-400 text-sm">No holdings yet. Add your first stock to get started!</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-800/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Symbol</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Shares</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Avg Cost</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Current Price</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Value</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">P&L</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">Added</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {holdings.map((holding) => {
                      const currentPrice = holding.currentPrice || holding.avgCost;
                      const currentValue = holding.currentValue || holding.shares * holding.avgCost;
                      const costBasis = holding.shares * holding.avgCost;
                      const pnl = currentValue - costBasis;
                      const pnlPercent = (pnl / costBasis) * 100;
                      const addedDate = holding.addedAt ? new Date(holding.addedAt).toLocaleDateString() : '—';

                      return (
                        <tr key={holding.id} className="hover:bg-gray-800/30 transition">
                          <td className="px-4 py-3">
                            <div className="font-mono font-bold text-white">{holding.symbol}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                            {holding.shares.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                            ${holding.avgCost.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm text-white">
                            ${currentPrice.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-white">
                            ${currentValue.toLocaleString(undefined, {maximumFractionDigits: 0})}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            <span className={pnl >= 0 ? 'text-white' : 'text-gray-400'}>
                              {pnl >= 0 ? '+' : ''}${pnl.toLocaleString(undefined, {maximumFractionDigits: 0})}
                              <div className="text-xs">{pnl >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%</div>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-gray-400">
                            {addedDate}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => removeHolding(holding.id)}
                              className="text-gray-400 hover:text-white text-lg"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - Add Holdings */}
        <div className="space-y-6">
          {/* Timeline Toggle */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <h3 className="text-lg font-bold text-white">Timeline Mode</h3>
              </div>
              <button
                onClick={() => setShowTimeline(!showTimeline)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  showTimeline
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {showTimeline ? 'ON' : 'OFF'}
              </button>
            </div>

            {showTimeline && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Add holdings at date:</label>
                <input
                  type="date"
                  value={timelineDate}
                  onChange={(e) => setTimelineDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Holdings added will be timestamped with this date
                </p>
              </div>
            )}

            {!showTimeline && (
              <p className="text-xs text-gray-500">
                Enable timeline mode to add holdings at specific historical dates
              </p>
            )}
          </div>

          {/* Add Stock Card */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <PlusIcon className="w-5 h-5 text-gray-400" />
              <h3 className="text-lg font-bold text-white">Add Stock</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Symbol {isLoadingSymbols && <span className="text-gray-500">(Loading...)</span>}
                </label>
                {availableSymbols.length > 0 ? (
                  <div className="relative">
                    <select
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 appearance-none cursor-pointer scrollbar-hide"
                    >
                      <option value="" className="bg-gray-800">Select a symbol...</option>
                      {availableSymbols.map((symbol) => (
                        <option key={symbol} value={symbol} className="bg-gray-800">
                          {symbol}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={newSymbol}
                    onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                    placeholder="AAPL"
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Shares</label>
                <input
                  type="number"
                  value={newShares}
                  onChange={(e) => setNewShares(parseInt(e.target.value) || 0)}
                  min="1"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Avg Cost per Share</label>
                <input
                  type="number"
                  value={newAvgCost}
                  onChange={(e) => setNewAvgCost(parseFloat(e.target.value) || 0)}
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
              </div>

              <button
                onClick={addHolding}
                className="w-full px-4 py-2 rounded-lg bg-white text-black hover:bg-gray-200 transition font-semibold"
              >
                {showTimeline ? `Add at ${timelineDate}` : 'Add to Portfolio'}
              </button>
            </div>
          </div>

          {/* Cash Management */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <DollarIcon className="w-5 h-5 text-gray-400" />
              <h3 className="text-lg font-bold text-white">Cash</h3>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Available Cash</label>
              <input
                type="number"
                value={cash}
                onChange={(e) => setCash(parseFloat(e.target.value) || 0)}
                min="0"
                step="1000"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-lg font-bold text-white outline-none focus:border-white focus:ring-2 focus:ring-white/20"
              />
            </div>

            <div className="mt-4 text-xs text-gray-500">
              This cash will be available for backtesting strategies
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <RocketIcon className="w-5 h-5 text-gray-400" />
              <h3 className="text-lg font-bold text-white">Quick Actions</h3>
            </div>

            <div className="space-y-2">
              <Link
                href="/backtest?mode=portfolio"
                className="block w-full px-4 py-3 rounded-lg bg-white text-black hover:bg-gray-200 transition text-center font-semibold"
              >
                Start Backtesting →
              </Link>
              <div className="text-xs text-gray-400 text-center">
                Use ${totalEquity.toLocaleString()} equity for trading
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
