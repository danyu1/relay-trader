"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { FileText, TrendingUp, Activity, Database, BarChart3, TrendingDown } from "lucide-react";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";
import { UserDisplay } from "@/app/components/UserDisplay";

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();
  if (loading) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-orange-50 to-orange-100">
      {/* Header */}
      <header className="border-b border-orange-200 bg-white/50 backdrop-blur-xl">
        <div className="max-w-[1800px] mx-auto px-10 py-8">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-gray-600">Select a service to get started</p>
            </div>
            {user && <UserDisplay email={user.email} />}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1800px] mx-auto px-10 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Information Suite Column */}
          <div className="space-y-8">
            <InfoSuiteCard />
            <InfoSuiteAnimation />
          </div>

          {/* Backtester Column */}
          <div className="space-y-8">
            <BacktesterCard />
            <BacktesterAnimation />
          </div>

          {/* Live Prices Column */}
          <div className="space-y-8">
            <LivePricesCard />
            <LivePricesAnimation />
          </div>
        </div>
      </main>

      <style jsx global>{`
        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes pulse-slow {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
        @keyframes pulse-slower {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.1); opacity: 0.6; }
        }
        @keyframes float {
          0%, 100% { transform: translate(-50%, -50%) translateY(0); }
          50% { transform: translate(-50%, -50%) translateY(-5px); }
        }
        @keyframes draw-line {
          from { stroke-dasharray: 1000; stroke-dashoffset: 1000; }
          to { stroke-dasharray: 1000; stroke-dashoffset: 0; }
        }
        @keyframes pop-in {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-slide-in {
          animation: slide-in 0.5s ease-out forwards;
        }
        .pulse-slow {
          animation: pulse-slow 3s ease-in-out infinite;
        }
        .pulse-slower {
          animation: pulse-slower 3s ease-in-out 0.5s infinite;
        }
        .pulse-line {
          animation: pulse-slow 2s ease-in-out infinite;
        }
        .animate-float {
          animation: float 2s ease-in-out infinite;
        }
        .price-line {
          animation: draw-line 2s ease-in-out forwards;
        }
        .signal-marker {
          animation: pop-in 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

// Information Suite Card
function InfoSuiteCard() {
  return (
    <div className="group relative animate-slide-in opacity-0 h-[320px]" style={{ animationDelay: '0.1s' }}>
      {/* Gradient Glow Effect */}
      <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 rounded-2xl opacity-0 group-hover:opacity-100 blur transition duration-500"></div>

      {/* Card Content */}
      <div className="relative bg-white backdrop-blur-xl rounded-2xl border border-orange-200 p-8 h-full flex flex-col transition-all duration-300 hover:border-orange-400 hover:-translate-y-1 shadow-lg">
        {/* Icon */}
        <div className="w-14 h-14 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center mb-6 text-orange-600 group-hover:scale-110 transition-transform duration-300">
          <FileText className="w-6 h-6" />
        </div>

        {/* Title */}
        <h3 className="text-xl font-semibold text-gray-900 mb-3">Information Suite</h3>

        {/* Description */}
        <p className="text-gray-600 text-sm leading-relaxed mb-4 h-20">
          Access comprehensive market data, reports, and analytics. Build comprehensive solutions for analysis from informed decisions.
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="px-3 py-1 rounded-md border bg-orange-50 border-orange-300 text-gray-700 text-xs backdrop-blur-sm">
            Coming Soon
          </span>
        </div>

        {/* Button */}
        <button
          disabled
          className="mt-auto w-full px-6 py-2.5 rounded-lg bg-gray-100 text-gray-400 border border-gray-300 cursor-not-allowed transition-all"
        >
          Not Available
        </button>
      </div>
    </div>
  );
}

// Backtester Card
function BacktesterCard() {
  return (
    <div className="group relative animate-slide-in opacity-0 h-[320px]" style={{ animationDelay: '0.2s' }}>
      {/* Gradient Glow Effect */}
      <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-2xl opacity-0 group-hover:opacity-100 blur transition duration-500"></div>

      {/* Card Content */}
      <div className="relative bg-white backdrop-blur-xl rounded-2xl border border-orange-200 p-8 h-full flex flex-col transition-all duration-300 hover:border-orange-400 hover:-translate-y-1 shadow-lg">
        {/* Icon */}
        <div className="w-14 h-14 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center mb-6 text-orange-600 group-hover:scale-110 transition-transform duration-300">
          <TrendingUp className="w-6 h-6" />
        </div>

        {/* Title */}
        <h3 className="text-xl font-semibold text-gray-900 mb-3">Backtester</h3>

        {/* Description */}
        <p className="text-gray-600 text-sm leading-relaxed mb-4 h-20">
          Test your trading strategies with historical data. Simulate both mechanical algorithms and manual fundamental analysis.
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="px-3 py-1 rounded-md border bg-orange-50 border-orange-300 text-orange-700 text-xs backdrop-blur-sm">
            Mechanical
          </span>
          <span className="px-3 py-1 rounded-md border bg-orange-50 border-orange-300 text-orange-700 text-xs backdrop-blur-sm">
            Fundamental
          </span>
        </div>

        {/* Button */}
        <Link
          href="/data-selection?entry=dashboard"
          className="mt-auto w-full px-6 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-center transition-all duration-300 hover:shadow-lg"
        >
          Launch Backtester →
        </Link>
      </div>
    </div>
  );
}

// Live Prices Card
function LivePricesCard() {
  return (
    <div className="group relative animate-slide-in opacity-0 h-[320px]" style={{ animationDelay: '0.3s' }}>
      {/* Gradient Glow Effect */}
      <div className="absolute -inset-0.5 bg-gradient-to-r from-orange-500/20 to-amber-500/20 rounded-2xl opacity-0 group-hover:opacity-100 blur transition duration-500"></div>

      {/* Card Content */}
      <div className="relative bg-white backdrop-blur-xl rounded-2xl border border-orange-200 p-8 h-full flex flex-col transition-all duration-300 hover:border-orange-400 hover:-translate-y-1 shadow-lg">
        {/* Icon */}
        <div className="w-14 h-14 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center mb-6 text-orange-600 group-hover:scale-110 transition-transform duration-300">
          <Activity className="w-6 h-6" />
        </div>

        {/* Title */}
        <h3 className="text-xl font-semibold text-gray-900 mb-3">Live Prices</h3>

        {/* Description */}
        <p className="text-gray-600 text-sm leading-relaxed mb-4 h-20">
          Monitor real-time market data and price movements. View historical performance and analyze your holdings for your everyday buy and hold trades.
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="px-3 py-1 rounded-md border bg-orange-50 border-orange-300 text-orange-700 text-xs backdrop-blur-sm">
            Real-time
          </span>
          <span className="px-3 py-1 rounded-md border bg-orange-50 border-orange-300 text-orange-700 text-xs backdrop-blur-sm">
            Heatlist
          </span>
        </div>

        {/* Button */}
        <Link
          href="/live-prices"
          className="mt-auto w-full px-6 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-center transition-all duration-300 hover:shadow-lg"
        >
          View Live Prices →
        </Link>
      </div>
    </div>
  );
}

// Info Suite Animation Component
function InfoSuiteAnimation() {
  const dataPoints = [
    { Icon: FileText, label: 'Reports', angle: 0 },
    { Icon: BarChart3, label: 'Analytics', angle: 90 },
    { Icon: TrendingUp, label: 'Trends', angle: 180 },
    { Icon: Database, label: 'Data', angle: 270 },
  ];

  return (
    <div className="bg-white backdrop-blur-xl rounded-2xl border border-orange-200 p-8 h-[420px] relative overflow-hidden animate-slide-in opacity-0 shadow-lg" style={{ animationDelay: '0.4s' }}>
      {/* Background Grid */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'linear-gradient(rgba(234, 88, 12, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(234, 88, 12, 0.5) 1px, transparent 1px)',
        backgroundSize: '40px 40px'
      }}></div>

      {/* Title */}
      <div className="relative mb-6">
        <h4 className="text-lg font-semibold text-orange-600">Information Flow</h4>
        <p className="text-gray-500 text-sm mt-1">Data aggregation & analysis</p>
      </div>

      {/* Central Hub */}
      <div className="relative flex items-center justify-center h-[280px]">
        <div className="absolute w-32 h-32 rounded-full bg-blue-500/10 border border-blue-500/30 pulse-slow"></div>
        <div className="absolute w-48 h-48 rounded-full bg-blue-500/5 border border-blue-500/20 pulse-slower"></div>

        {/* Center Icon */}
        <div className="relative z-10 w-16 h-16 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
          <Database className="w-8 h-8 text-blue-400" />
        </div>

        {/* Orbiting Data Points */}
        {dataPoints.map((point, index) => {
          const radius = 90;
          const x = Math.cos((point.angle * Math.PI) / 180) * radius;
          const y = Math.sin((point.angle * Math.PI) / 180) * radius;

          return (
            <div
              key={index}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                marginLeft: x,
                marginTop: y,
                animationDelay: `${index * 0.2}s`,
              }}
              className="relative animate-float"
            >
              {/* Connecting Line */}
              <div
                className="absolute pulse-line"
                style={{
                  width: Math.sqrt(x * x + y * y),
                  height: '2px',
                  background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.5), transparent)',
                  transformOrigin: '0 50%',
                  transform: `rotate(${Math.atan2(-y, -x)}rad)`,
                  right: '50%',
                  top: '50%',
                }}
              ></div>

              {/* Data Point */}
              <div className="w-12 h-12 rounded-lg bg-slate-800/80 border border-blue-500/30 flex flex-col items-center justify-center gap-1 transform -translate-x-1/2 -translate-y-1/2 hover:scale-110 transition-transform">
                <point.Icon className="w-4 h-4 text-blue-400" />
                <span className="text-[8px] text-blue-400/80">{point.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Backtester Animation Component
function BacktesterAnimation() {
  const [signals, setSignals] = useState<Array<{ id: number; type: 'buy' | 'sell'; x: number; y: number }>>([]);

  // Generate price data
  const generatePriceData = () => {
    const points = [];
    let price = 100;
    for (let i = 0; i < 50; i++) {
      price += (Math.random() - 0.48) * 8;
      points.push({ x: i * 6, y: price });
    }
    return points;
  };

  const [priceData] = useState(generatePriceData());

  const minY = Math.min(...priceData.map(p => p.y));
  const maxY = Math.max(...priceData.map(p => p.y));
  const normalizeY = (y: number) => {
    return 200 - ((y - minY) / (maxY - minY)) * 160 + 20;
  };

  const pricePath = priceData.map((point, i) => {
    const x = point.x;
    const y = normalizeY(point.y);
    return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
  }).join(' ');

  useEffect(() => {
    const interval = setInterval(() => {
      const randomIndex = Math.floor(Math.random() * (priceData.length - 10)) + 5;
      const point = priceData[randomIndex];
      const type: 'buy' | 'sell' = Math.random() > 0.5 ? 'buy' : 'sell';

      setSignals(prev => {
        const newSignals = [...prev, {
          id: Date.now(),
          type,
          x: point.x,
          y: normalizeY(point.y)
        }];
        return newSignals.slice(-4);
      });
    }, 2500);

    return () => clearInterval(interval);
  }, [priceData, normalizeY]);

  return (
    <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-emerald-500/20 p-8 h-[420px] relative overflow-hidden animate-slide-in opacity-0" style={{ animationDelay: '0.5s' }}>
      {/* Title */}
      <div className="relative mb-6 z-10">
        <h4 className="text-lg font-semibold text-emerald-400">Strategy Testing</h4>
        <p className="text-slate-500 text-sm mt-1">Simulated trading signals</p>
      </div>

      {/* Chart Area */}
      <div className="relative h-[280px] flex items-center justify-center">
        <svg className="w-full h-full max-w-[380px]" viewBox="0 0 300 240" preserveAspectRatio="xMidYMid meet">
          {/* Grid */}
          {[0, 1, 2, 3, 4].map(i => (
            <line key={`h-${i}`} x1="0" y1={20 + i * 50} x2="300" y2={20 + i * 50} stroke="rgba(16, 185, 129, 0.1)" strokeWidth="1" />
          ))}
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <line key={`v-${i}`} x1={i * 37.5} y1="0" x2={i * 37.5} y2="240" stroke="rgba(16, 185, 129, 0.1)" strokeWidth="1" />
          ))}

          {/* Price Line */}
          <path d={pricePath} fill="none" stroke="url(#priceGradient)" strokeWidth="3" className="price-line" />

          {/* Area */}
          <path d={`${pricePath} L ${priceData[priceData.length - 1].x} 240 L 0 240 Z`} fill="url(#areaGradient)" />

          {/* Gradients */}
          <defs>
            <linearGradient id="priceGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(16, 185, 129, 0.5)" />
              <stop offset="50%" stopColor="rgba(16, 185, 129, 1)" />
              <stop offset="100%" stopColor="rgba(52, 211, 153, 0.8)" />
            </linearGradient>
            <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(16, 185, 129, 0.2)" />
              <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
            </linearGradient>
          </defs>

          {/* Signals */}
          {signals.map((signal) => (
            <g key={signal.id} className="signal-marker">
              <circle
                cx={signal.x}
                cy={signal.y}
                r="8"
                fill={signal.type === 'buy' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}
                stroke={signal.type === 'buy' ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)'}
                strokeWidth="2"
              />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// Live Prices Animation Component
function LivePricesAnimation() {
  const [stocks, setStocks] = useState([
    { symbol: 'AAPL', price: 178.52, change: 2.34, trend: 'up' as const, sparkline: [175, 176, 175.5, 177, 178, 178.5] },
    { symbol: 'GOOGL', price: 142.18, change: -1.12, trend: 'down' as const, sparkline: [144, 143.5, 143, 142.5, 142.2, 142.18] },
    { symbol: 'TSLA', price: 248.93, change: 5.67, trend: 'up' as const, sparkline: [243, 244, 246, 247, 248, 248.9] },
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      setStocks(prev => prev.map(stock => {
        const changeAmount = (Math.random() - 0.5) * 0.5;
        const newPrice = stock.price + changeAmount;
        const newChange = stock.change + changeAmount;
        const newSparkline = [...stock.sparkline.slice(1), newPrice];

        return {
          ...stock,
          price: newPrice,
          change: newChange,
          trend: (newChange > 0 ? 'up' : 'down') as 'up' | 'down',
          sparkline: newSparkline
        };
      }));
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-orange-500/20 p-8 h-[420px] relative overflow-hidden animate-slide-in opacity-0" style={{ animationDelay: '0.6s' }}>
      {/* Title */}
      <div className="relative mb-6 z-10">
        <h4 className="text-lg font-semibold text-orange-400">Real-time Monitoring</h4>
        <p className="text-slate-500 text-sm mt-1">Live market data feed</p>
      </div>

      {/* Market Status */}
      <div className="mb-4 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></div>
        <span className="text-orange-400 text-xs">Market Open</span>
      </div>

      {/* Stock List */}
      <div className="space-y-3 max-w-[520px] mx-auto">
        {stocks.map((stock) => (
          <div
            key={stock.symbol}
            className="bg-slate-800/50 rounded-xl border border-orange-500/10 p-4 hover:border-orange-500/30 transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 flex-1">
                <div>
                  <p className="text-white/90 font-mono font-bold">{stock.symbol}</p>
                  <p className="text-slate-400 text-sm">${stock.price.toFixed(2)}</p>
                </div>

                {/* Sparkline */}
                <div className="flex-1 h-8 relative max-w-[100px]">
                  <svg className="w-full h-full" viewBox="0 0 100 20" preserveAspectRatio="none">
                    <polyline
                      points={stock.sparkline.map((value, i) => {
                        const x = (i / (stock.sparkline.length - 1)) * 100;
                        const min = Math.min(...stock.sparkline);
                        const max = Math.max(...stock.sparkline);
                        const y = 20 - ((value - min) / (max - min)) * 18 - 1;
                        return `${x},${y}`;
                      }).join(' ')}
                      fill="none"
                      stroke={stock.trend === 'up' ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)'}
                      strokeWidth="2"
                    />
                  </svg>
                </div>

                {/* Change */}
                <div className="flex items-center gap-2 min-w-[100px] justify-end">
                  {stock.trend === 'up' ? (
                    <TrendingUp className="w-4 h-4 text-green-400" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-400" />
                  )}
                  <span className={`text-sm font-semibold ${stock.trend === 'up' ? 'text-green-400' : 'text-red-400'}`}>
                    {stock.trend === 'up' ? '+' : ''}{stock.change.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
