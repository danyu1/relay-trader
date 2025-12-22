"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function DashboardPage() {
  const [portfolioCount, setPortfolioCount] = useState(0);
  const [backtestCount, setBacktestCount] = useState(0);

  useEffect(() => {
    // Load portfolio count
    const savedPortfolios = localStorage.getItem("priorsystems:portfolios");
    if (savedPortfolios) {
      const portfolios = JSON.parse(savedPortfolios);
      setPortfolioCount(portfolios.length);
    }

    // Load backtest count (saved profiles)
    const savedProfiles = localStorage.getItem("priorsystems:data-profiles");
    if (savedProfiles) {
      const profiles = JSON.parse(savedProfiles);
      setBacktestCount(profiles.length);
    }
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-gray-400 mt-2">Select a service to get started</p>
        </div>
      </div>

      {/* Service Cards */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">

          {/* Data Suite Card */}
          <div className="group relative rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-8 hover:border-gray-700 transition-all">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />

            <div className="relative">
              {/* Icon */}
              <div className="w-16 h-16 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
              </div>

              <h2 className="text-2xl font-bold mb-3">Information Suite</h2>
              <p className="text-gray-400 text-sm mb-6">
                Download and manage market data from multiple sources. Build comprehensive datasets for analysis from informed decisions.
              </p>

              <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
                <span className="px-2 py-1 rounded bg-gray-800 border border-gray-700">Coming Soon</span>
              </div>

              <button
                disabled
                className="w-full px-6 py-3 rounded-lg bg-gray-800 text-gray-500 cursor-not-allowed font-semibold"
              >
                Not Available
              </button>
            </div>
          </div>

          {/* Backtester Card */}
          <div className="group relative rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-8 hover:border-green-600/50 transition-all">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-emerald-500/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />

            <div className="relative">
              {/* Icon */}
              <div className="w-16 h-16 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>

              <h2 className="text-2xl font-bold mb-3">Backtester</h2>
              <p className="text-gray-400 text-sm mb-6">
                Test trading strategies against historical data. Supports both mechanical algorithms and manual fundamental analysis.
              </p>

              <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
                <span className="px-2 py-1 rounded bg-green-950 border border-green-800 text-green-400">Mechanical</span>
                <span className="px-2 py-1 rounded bg-blue-950 border border-blue-800 text-blue-400">Fundamental</span>
              </div>

              <Link
                href="/data-selection"
                className="block w-full px-6 py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition text-center"
              >
                Launch Backtester →
              </Link>
            </div>
          </div>

          {/* Portfolio Builder Card */}
          <div className="group relative rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-8 hover:border-purple-600/50 transition-all">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />

            <div className="relative">
              {/* Icon */}
              <div className="w-16 h-16 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>

              <h2 className="text-2xl font-bold mb-3">Portfolio Builder</h2>
              <p className="text-gray-400 text-sm mb-6">
                Build and simulate realistic portfolios. Track multiple assets, make trades, and visualize performance over time.
              </p>

              <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
                <span className="px-2 py-1 rounded bg-purple-950 border border-purple-800 text-purple-400">Multi-Asset</span>
                <span className="px-2 py-1 rounded bg-pink-950 border border-pink-800 text-pink-400">Timeline</span>
              </div>

              <Link
                href="/portfolio"
                className="block w-full px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition text-center"
              >
                Build Portfolio →
              </Link>
            </div>
          </div>

        </div>

        {/* Quick Stats */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="text-sm text-gray-400 mb-1">Available Datasets</div>
            <div className="text-3xl font-bold">6</div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="text-sm text-gray-400 mb-1">Saved Backtests</div>
            <div className="text-3xl font-bold">{backtestCount}</div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="text-sm text-gray-400 mb-1">Active Portfolios</div>
            <div className="text-3xl font-bold">{portfolioCount}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
