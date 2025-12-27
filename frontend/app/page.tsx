"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Database, Activity, LineChart, Zap, Code, BarChart3, Layers, Save, RefreshCw, ChevronRight } from "lucide-react";

// InfoIcon component from backtester
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

// KeyMetricCard component from backtester
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

export default function HomePage() {
  const router = useRouter();

  const handleGetStarted = () => {
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      {/* Navigation */}
      <nav className="fixed top-0 w-full border-b border-white/5 backdrop-blur-xl bg-slate-950/30 z-50">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex h-20 items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo-white-full.svg" alt="Prior Systems" className="h-12 w-auto" />
            </div>
            <div className="flex items-center gap-8">
              <a href="#platform" className="text-sm text-slate-400 hover:text-white transition-colors">
                Platform
              </a>
              <a href="#features" className="text-sm text-slate-400 hover:text-white transition-colors">
                Features
              </a>
              <button
                onClick={handleGetStarted}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm text-white hover:bg-blue-700 transition-colors"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <Hero onGetStarted={handleGetStarted} />

      {/* Services Section */}
      <Services />

      {/* Features Section */}
      <Features />

      {/* CTA Section */}
      <CTA onGetStarted={handleGetStarted} />

      {/* Footer */}
      <footer className="border-t border-white/5 py-16 bg-slate-950">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo-white-full.svg" alt="Prior Systems" className="h-10 w-auto" />
            </div>
            <p className="text-sm text-slate-500">
              © {new Date().getFullYear()} Prior Systems.
            </p>
          </div>
        </div>
      </footer>

      {/* Global CSS Animations */}
      <style jsx global>{`
        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(40px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slide-in-left {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes slide-in-right {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes draw-path {
          from {
            stroke-dashoffset: 1000;
          }
          to {
            stroke-dashoffset: 0;
          }
        }

        @keyframes scale-in {
          from {
            opacity: 0;
            transform: scale(0);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes pulse-glow {
          0%, 100% {
            opacity: 0.3;
          }
          50% {
            opacity: 0.5;
          }
        }

        .animate-slide-up {
          animation: slide-up 0.6s ease-out forwards;
        }

        .animate-slide-in-left {
          animation: slide-in-left 0.6s ease-out forwards;
        }

        .animate-slide-in-right {
          animation: slide-in-right 0.6s ease-out forwards;
        }

        .animate-draw-path {
          stroke-dasharray: 1000;
          animation: draw-path 2s ease-out forwards;
        }

        .animate-scale-in {
          animation: scale-in 0.5s ease-out forwards;
        }

        .animate-fade-in {
          animation: fade-in 1s ease-out forwards;
        }

        .animate-pulse-glow {
          animation: pulse-glow 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

function Hero({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <section className="relative overflow-hidden pt-32 pb-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left content */}
          <div className="opacity-0 animate-slide-in-left" style={{ animationDelay: '0.1s' }}>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-500/10 border border-blue-500/20 px-4 py-2 mb-8">
              <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-sm text-blue-300">Accesible backtesting platform</span>
            </div>

            <h1 className="mb-6 text-6xl tracking-tight text-white">
              Research that
              <br />
              <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-cyan-500 bg-clip-text text-transparent">moves markets</span>
            </h1>

            <p className="mb-10 text-xl text-slate-400 leading-relaxed">
              Test mechanical strategies, simulate fundamental decisions, and track live performance, all in one unified research environment.
            </p>

            <button
              onClick={onGetStarted}
              className="group inline-flex items-center gap-3 rounded-lg bg-blue-600 px-8 py-4 text-white transition-all hover:bg-blue-700 hover:gap-4"
            >
              <span className="text-lg">Start Backtesting</span>
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>

          {/* Right visual */}
          <div className="opacity-0 animate-slide-in-right" style={{ animationDelay: '0.3s' }}>
            <HeroVisualization />
          </div>
        </div>
      </div>

      {/* Decorative elements */}
      <div className="absolute top-20 right-0 h-96 w-96 rounded-full bg-blue-600/10 blur-3xl animate-pulse-glow" />
      <div className="absolute bottom-0 left-0 h-96 w-96 rounded-full bg-purple-600/10 blur-3xl animate-pulse-glow" style={{ animationDelay: '1.5s' }} />
    </section>
  );
}

function HeroVisualization() {
  // Realistic backtest metrics based on actual performance data
  const initialCash = 100000;
  const totalReturn = 0.2847; // 28.47% return
  const finalValue = initialCash * (1 + totalReturn);
  const sharpe = 1.92;
  const winRate = 67.8;
  const maxDrawdown = -8.3;

  // Generate realistic equity curve (simulating growth with volatility)
  const equityCurve = [100000, 100500, 101200, 100800, 102400, 103800, 104200, 105800, 106200, 107500, 108200, 109800, 110500, 112100, 113500, 114200, 115800, 117200, 118600, 120100, 121500, 123200, 124800, 126400, 127800, 128470];

  // Normalize to chart coordinates (400x200 viewBox, inverted Y)
  const minEquity = Math.min(...equityCurve);
  const maxEquity = Math.max(...equityCurve);
  const points = equityCurve.map((value, index) => {
    const x = (index / (equityCurve.length - 1)) * 400;
    const normalizedY = (value - minEquity) / (maxEquity - minEquity);
    const y = 180 - (normalizedY * 160); // Map to chart height (leave margins)
    return { x, y };
  });

  // Create smooth path through points
  const pathD = points.map((p, i) =>
    i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
  ).join(' ');

  return (
    <div className="relative">
      {/* Main chart container */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/50 backdrop-blur-xl p-8 shadow-2xl shadow-blue-900/20">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-400 mb-1">Portfolio Value</div>
            <div className="text-3xl text-white">${finalValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-400 mb-1">Total Return</div>
            <div className="text-2xl text-emerald-400">+{(totalReturn * 100).toFixed(1)}%</div>
          </div>
        </div>

        {/* Enhanced chart */}
        <svg viewBox="0 0 400 200" className="w-full h-48">
          <defs>
            <linearGradient id="heroGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 1, 2, 3, 4].map((i) => (
            <line
              key={i}
              x1="0"
              y1={i * 50}
              x2="400"
              y2={i * 50}
              stroke="#334155"
              strokeWidth="1"
              opacity="0.3"
            />
          ))}

          {/* Chart area fill */}
          <path
            d={`${pathD} L 400 200 L 0 200 Z`}
            fill="url(#heroGradient)"
            className="opacity-0 animate-fade-in"
            style={{ animationDelay: '0.5s' }}
          />

          {/* Chart line */}
          <path
            d={pathD}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-draw-path"
            style={{ animationDelay: '0.5s' }}
          />

          {/* Data points - show only key points */}
          {[points[0], points[Math.floor(points.length / 4)], points[Math.floor(points.length / 2)], points[Math.floor(points.length * 3 / 4)], points[points.length - 1]].map((point, i) => (
            <circle
              key={i}
              cx={point.x}
              cy={point.y}
              r="5"
              fill="#3b82f6"
              className="opacity-0 animate-scale-in"
              style={{ animationDelay: `${0.9 + i * 0.1}s` }}
            />
          ))}
        </svg>

        {/* Stats row */}
        <div className="mt-6 grid grid-cols-3 gap-4 border-t border-slate-700/50 pt-6">
          <div>
            <div className="text-xs text-slate-400 mb-1">Sharpe Ratio</div>
            <div className="text-white">{sharpe.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Win Rate</div>
            <div className="text-white">{winRate.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Max Drawdown</div>
            <div className="text-white">{maxDrawdown.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* Floating metric cards */}
      <div
        className="absolute -bottom-4 -left-4 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur-xl px-4 py-3 shadow-xl opacity-0 animate-slide-up"
        style={{ animationDelay: '1.3s' }}
      >
        <div className="text-xs text-slate-400 mb-1">Avg Trade Duration</div>
        <div className="text-lg text-white">12.4 days</div>
      </div>

      <div
        className="absolute -top-4 -right-4 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur-xl px-4 py-3 shadow-xl opacity-0 animate-slide-up"
        style={{ animationDelay: '1.5s' }}
      >
        <div className="text-xs text-slate-400 mb-1">Total Trades</div>
        <div className="text-lg text-white">184</div>
      </div>
    </div>
  );
}

function Services() {
  const services = [
    {
      icon: Database,
      title: 'Information Suite',
      description: 'Stay informed with curated news articles on general market companies, plus tailored news feeds for the specific companies in your downloaded datasets.',
      features: ['General market news', 'Company-specific articles', 'Dataset-tailored feeds', 'Real-time updates'],
      color: 'blue',
    },
    {
      icon: Activity,
      title: 'Backtester',
      description: 'Test mechanical strategies or simulate manual fundamental decisions. Custom Python strategies, parameter presets, and comprehensive analytics.',
      features: ['Built-in & custom strategies', 'Manual trade simulation', 'Performance analytics', 'Save/load configurations'],
      color: 'purple',
    },
    {
      icon: LineChart,
      title: 'Live Prices',
      description: 'Real-time portfolio tracking with historical price lookups. Multiple portfolios, detailed charts, and customizable visualization.',
      features: ['Real-time tracking', 'Multiple portfolios', 'Custom time ranges', 'Chart styling controls'],
      color: 'emerald',
    },
  ];

  return (
    <section id="platform" className="py-32 bg-slate-950">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mb-20 max-w-3xl">
          <h2 className="mb-6 text-5xl tracking-tight text-white">
            Three integrated modules.
            <br />
            <span className="text-slate-400">One powerful platform.</span>
          </h2>
          <p className="text-xl text-slate-400 leading-relaxed">
            RelayTrader combines data management, strategy testing, and live tracking
            into a seamless research environment.
          </p>
        </div>

        <div className="space-y-32">
          {services.map((service, index) => (
            <ServiceRow key={service.title} service={service} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ServiceRow({ service, index }: { service: any; index: number }) {
  const Icon = service.icon;
  const isEven = index % 2 === 0;

  const colorClasses = {
    blue: {
      bg: 'bg-blue-500/10',
      icon: 'text-blue-400',
      border: 'border-blue-500/20',
      glow: 'from-blue-500/20',
    },
    purple: {
      bg: 'bg-purple-500/10',
      icon: 'text-purple-400',
      border: 'border-purple-500/20',
      glow: 'from-purple-500/20',
    },
    emerald: {
      bg: 'bg-emerald-500/10',
      icon: 'text-emerald-400',
      border: 'border-emerald-500/20',
      glow: 'from-emerald-500/20',
    },
  };

  const colors = colorClasses[service.color as keyof typeof colorClasses];

  return (
    <div className={`grid lg:grid-cols-2 gap-16 items-center ${isEven ? '' : 'lg:grid-flow-dense'}`}>
      {/* Content */}
      <div className={isEven ? '' : 'lg:col-start-2'}>
        <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl ${colors.bg} border ${colors.border} mb-6`}>
          <Icon className={`h-8 w-8 ${colors.icon}`} />
        </div>

        <h3 className="mb-4 text-3xl tracking-tight text-white">{service.title}</h3>
        <p className="mb-8 text-lg text-slate-400 leading-relaxed">{service.description}</p>

        <div className="space-y-3">
          {service.features.map((feature: string) => (
            <div key={feature} className="flex items-start gap-3">
              <svg className="h-6 w-6 text-slate-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-slate-300">{feature}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Visual */}
      <div className={isEven ? '' : 'lg:col-start-1 lg:row-start-1'}>
        <div className={`rounded-2xl border ${colors.border} ${colors.bg} backdrop-blur-xl p-8 lg:p-12`}>
          <ServiceVisual index={index} color={service.color} />
        </div>
      </div>
    </div>
  );
}

function ServiceVisual({ index }: { index: number; color: string }) {
  if (index === 0) {
    // Database table visualization
    return (
      <div className="space-y-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 bg-slate-800/50 rounded-lg p-4 border border-slate-700/50 opacity-0 animate-slide-in-left"
            style={{ animationDelay: `${i * 0.1}s` }}
          >
            <div className="h-10 w-10 rounded bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-300 text-sm font-medium">
              {['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA'][i]}
            </div>
            <div className="flex-1">
              <div className="h-2 w-24 bg-slate-600/50 rounded mb-2" />
              <div className="h-2 w-16 bg-slate-700/50 rounded" />
            </div>
            <div className="h-8 w-20 bg-slate-700/50 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (index === 1) {
    // Backtester visualization - using actual KeyMetricCard components
    const equityCurve = [100000, 101200, 102500, 101800, 103400, 105200, 106800, 107500, 109200, 111000, 112500, 114800, 116200, 118500, 120100, 121800, 123400, 125200, 126900, 128600];
    const minEquity = Math.min(...equityCurve);
    const maxEquity = Math.max(...equityCurve);

    // Trade markers: [index, type] - 'buy' or 'sell'
    const tradeMarkers = [
      { idx: 1, type: 'buy' },
      { idx: 3, type: 'sell' },
      { idx: 5, type: 'buy' },
      { idx: 8, type: 'sell' },
      { idx: 11, type: 'buy' },
      { idx: 14, type: 'sell' },
      { idx: 16, type: 'buy' },
      { idx: 18, type: 'sell' },
    ];

    return (
      <div className="space-y-6">
        {/* Equity Curve Chart */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm text-slate-400">Strategy Performance</div>
            <div className="text-lg text-emerald-400">+28.6%</div>
          </div>
          <svg viewBox="0 0 300 150" className="w-full h-40">
            <defs>
              <linearGradient id="backtestGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#a855f7" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Grid */}
            {[0, 1, 2, 3].map((i) => (
              <line
                key={i}
                x1="0"
                y1={i * 37.5}
                x2="300"
                y2={i * 37.5}
                stroke="#334155"
                strokeWidth="1"
                opacity="0.2"
              />
            ))}
            {/* Area fill */}
            <path
              d={equityCurve.map((value, i) => {
                const x = (i / (equityCurve.length - 1)) * 300;
                const normalizedY = (value - minEquity) / (maxEquity - minEquity);
                const y = 135 - (normalizedY * 120);
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ') + ' L 300 150 L 0 150 Z'}
              fill="url(#backtestGradient)"
              className="opacity-0 animate-fade-in"
              style={{ animationDelay: '0.3s' }}
            />
            {/* Line */}
            <path
              d={equityCurve.map((value, i) => {
                const x = (i / (equityCurve.length - 1)) * 300;
                const normalizedY = (value - minEquity) / (maxEquity - minEquity);
                const y = 135 - (normalizedY * 120);
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ')}
              fill="none"
              stroke="#a855f7"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-draw-path"
            />
            {/* Trade Markers */}
            {tradeMarkers.map((marker, i) => {
              const value = equityCurve[marker.idx];
              const x = (marker.idx / (equityCurve.length - 1)) * 300;
              const normalizedY = (value - minEquity) / (maxEquity - minEquity);
              const y = 135 - (normalizedY * 120);
              const color = marker.type === 'buy' ? '#10b981' : '#ef4444';

              return (
                <g key={`marker-${i}`}>
                  {/* Vertical line marker */}
                  <line
                    x1={x}
                    y1={y - 8}
                    x2={x}
                    y2={y + 8}
                    stroke={color}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="opacity-0 animate-fade-in"
                    style={{ animationDelay: `${0.7 + i * 0.08}s` }}
                  />
                  {/* Small circle at center */}
                  <circle
                    cx={x}
                    cy={y}
                    r="3"
                    fill={color}
                    className="opacity-0 animate-scale-in"
                    style={{ animationDelay: `${0.75 + i * 0.08}s` }}
                  />
                </g>
              );
            })}
            {/* Key points */}
            {[0, 5, 10, 15, 19].map((idx) => {
              const value = equityCurve[idx];
              const x = (idx / (equityCurve.length - 1)) * 300;
              const normalizedY = (value - minEquity) / (maxEquity - minEquity);
              const y = 135 - (normalizedY * 120);
              return (
                <circle
                  key={idx}
                  cx={x}
                  cy={y}
                  r="4"
                  fill="#a855f7"
                  className="opacity-0 animate-scale-in"
                  style={{ animationDelay: `${0.5 + idx * 0.05}s` }}
                />
              );
            })}
          </svg>
        </div>

        {/* Key Metrics Grid - using actual KeyMetricCard components */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KeyMetricCard
            label="Total Return"
            value="28.60%"
            accent
            tooltip="The total percentage gain or loss from your initial capital over the entire backtest period."
          />
          <KeyMetricCard
            label="Sharpe Ratio"
            value="1.92"
            tooltip="Risk-adjusted return metric. Measures excess return per unit of risk. Higher is better. Above 1 is good, above 2 is excellent."
          />
          <KeyMetricCard
            label="Max Drawdown"
            value="-8.30%"
            tooltip="The largest peak-to-trough decline in equity. Indicates the worst historical loss from a previous high."
          />
          <KeyMetricCard
            label="Win Rate"
            value="67.8%"
            tooltip="Percentage of trades that were profitable. Note: A high win rate doesn't guarantee profitability if losses are larger than wins."
          />
        </div>
      </div>
    );
  }

  // Portfolio tracker visualization
  return (
    <div className="space-y-4">
      {[
        { symbol: 'AAPL', shares: 125, value: 22312.50, gain: 12.8, cost: 178.50, current: 178.50, positive: true },
        { symbol: 'NVDA', shares: 50, value: 15430.00, gain: 24.3, cost: 248.60, current: 308.60, positive: true },
        { symbol: 'GOOGL', shares: 180, value: 25426.80, gain: -3.2, cost: 146.80, current: 141.26, positive: false },
      ].map((holding, i) => (
        <div
          key={holding.symbol}
          className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 opacity-0 animate-scale-in"
          style={{ animationDelay: `${i * 0.1}s` }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-lg font-medium text-white">{holding.symbol}</div>
              <div className="text-xs text-slate-400">{holding.shares} shares</div>
            </div>
            <div className="text-right">
              <div className="text-lg text-white">${holding.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className={`text-xs ${holding.positive ? 'text-emerald-400' : 'text-red-400'}`}>
                {holding.positive ? '+' : ''}{holding.gain}%
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <div className="text-slate-400">
              Avg Cost: ${holding.cost.toFixed(2)}
            </div>
            <div className="text-slate-300">
              Current: ${holding.current.toFixed(2)}
            </div>
          </div>
          <div className="mt-3 h-1 bg-slate-700/50 rounded-full overflow-hidden">
            <div
              className={`h-full ${holding.positive ? 'bg-emerald-500' : 'bg-red-500'}`}
              style={{ width: `${Math.abs(holding.gain) * 5}%`, maxWidth: '100%' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Features() {
  const features = [
    {
      icon: Zap,
      title: 'Lightning Fast',
      description: 'Optimized data caching and processing for instant backtests',
    },
    {
      icon: Code,
      title: 'Custom Strategies',
      description: 'Write your own Python strategies with full parameter control',
    },
    {
      icon: BarChart3,
      title: 'Deep Analytics',
      description: 'Comprehensive metrics including Sharpe ratio, drawdown, and more',
    },
    {
      icon: Layers,
      title: 'Multiple Portfolios',
      description: 'Track and compare unlimited portfolio configurations',
    },
    {
      icon: Save,
      title: 'Save & Load',
      description: 'Persist your strategies, profiles, and portfolios locally',
    },
    {
      icon: RefreshCw,
      title: 'Real-time Data',
      description: 'Live price tracking with historical lookups and comparisons',
    },
  ];

  return (
    <section id="features" className="py-32 bg-slate-900">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mb-20 text-center max-w-3xl mx-auto">
          <h2 className="mb-6 text-5xl tracking-tight text-white">
            Built for retail traders.
          </h2>
          <p className="text-xl text-slate-400 leading-relaxed">
            Every feature is designed to give you a competitive edge in the markets
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>

        {/* Stats banner */}
        <div className="mt-24 rounded-3xl bg-gradient-to-br from-blue-600 to-purple-600 p-12 text-white border border-blue-500/20 shadow-2xl shadow-blue-900/20">
          <div className="grid md:grid-cols-3 gap-12 text-center">
            <div>
              <div className="text-5xl mb-2 font-semibold">1000+</div>
              <div className="text-blue-100">Pre-seeded Symbols</div>
            </div>
            <div>
              <div className="text-5xl mb-2 font-semibold">Unlimited</div>
              <div className="text-blue-100">Custom Strategies</div>
            </div>
            <div>
              <div className="text-5xl mb-2 font-semibold">&lt;1s</div>
              <div className="text-blue-100">Average Backtest Time</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature }: { feature: any; index: number }) {
  const Icon = feature.icon;

  return (
    <div className="group">
      <div className="h-full rounded-2xl bg-slate-800/50 backdrop-blur-xl p-8 border border-slate-700/50 transition-all hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-900/20 hover:bg-slate-800/80">
        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 transition-all group-hover:bg-blue-500/20">
          <Icon className="h-7 w-7 text-blue-400" />
        </div>
        <h3 className="mb-3 text-xl text-white">{feature.title}</h3>
        <p className="text-slate-400 leading-relaxed mb-4">{feature.description}</p>
        <div className="inline-flex items-center gap-2 text-sm text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
          <span>Learn more</span>
          <ChevronRight className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function CTA({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <section className="py-32 bg-slate-950">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl border border-slate-700/50 px-12 py-20 text-center lg:px-20">
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-5">
            <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" strokeWidth="0.5"/>
                </pattern>
              </defs>
              <rect width="100" height="100" fill="url(#grid)" />
            </svg>
          </div>

          {/* Gradient glow */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 to-purple-600/10" />

          <div className="relative">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-blue-500/10 border border-blue-500/20 px-4 py-2">
              <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-sm text-blue-300">Start your research journey</span>
            </div>

            <h2 className="mb-6 text-5xl tracking-tight text-white">
              Ready to transform your
              <br />
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">trading research?</span>
            </h2>

            <p className="mb-10 text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Join retail traders who trust Prior Sytems for backtesting,
              decision analysis, and portfolio tracking.
            </p>

            <button
              onClick={onGetStarted}
              className="group inline-flex items-center gap-3 rounded-lg bg-blue-600 px-8 py-4 text-white transition-all hover:bg-blue-700 hover:gap-4 shadow-lg shadow-blue-900/30"
            >
              <span className="text-lg">Get Started Now</span>
              <ArrowRight className="h-5 w-5" />
            </button>

            {/* Trust indicators */}
            <div className="mt-16 flex items-center justify-center gap-12 text-slate-400">
              <div className="text-center">
                <div className="text-2xl text-white mb-1 font-semibold">Free</div>
                <div className="text-sm">No credit card</div>
              </div>
              <div className="h-12 w-px bg-slate-600" />
              <div className="text-center">
                <div className="text-2xl text-white mb-1 font-semibold">Local</div>
                <div className="text-sm">Your data stays private</div>
              </div>
              <div className="h-12 w-px bg-slate-600" />
              <div className="text-center">
                <div className="text-2xl text-white mb-1 font-semibold">Instant</div>
                <div className="text-sm">Start in seconds</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
