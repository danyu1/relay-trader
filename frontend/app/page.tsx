"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  const handleGetStarted = () => {
    // For now, skip auth and go straight to datasets
    router.push("/datasets");
  };

  return (
    <div className="min-h-screen bg-black">
      {/* Navigation */}
      <nav className="border-b border-gray-800/50 backdrop-blur-sm bg-black/50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <span className="text-black font-bold text-sm">PS</span>
            </div>
            <span className="text-xl font-semibold text-white">Prior Systems</span>
          </div>
          <button
            onClick={handleGetStarted}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
          >
            Sign In
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-6 pt-20 pb-32">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
            Backtest Trading Strategies
            <span className="block text-white mt-2">
              Without the Complexity
            </span>
          </h1>
          <p className="text-xl text-gray-400 mb-12 leading-relaxed">
            Test your trading ideas on historical data with built-in strategies and simple parameters.
            No coding required.
          </p>

          <button
            onClick={handleGetStarted}
            className="px-8 py-4 bg-white hover:bg-gray-200 text-black font-semibold rounded-lg transition-all duration-200 text-lg"
          >
            Get Started
          </button>
        </div>

        {/* Features Grid */}
        <div className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-8">
          <FeatureCard
            icon={<IconStrategy />}
            title="Built-in Strategies"
            description="Choose from pre-built trading strategies like Moving Average Crossover, Mean Reversion, and more."
          />
          <FeatureCard
            icon={<IconHistory />}
            title="Historical Data"
            description="Test against real market data spanning multiple years and market conditions."
          />
          <FeatureCard
            icon={<IconSliders />}
            title="Flexible Parameters"
            description="Adjust strategy parameters to match your risk tolerance and trading style."
          />
        </div>

        {/* How It Works */}
        <div className="mt-32">
          <h2 className="text-3xl font-bold text-white text-center mb-16">
            How It Works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <StepCard
              number="1"
              title="Choose Dataset"
              description="Select a historical market dataset to backtest against"
            />
            <StepCard
              number="2"
              title="Configure Strategy"
              description="Pick a built-in strategy and adjust parameters to your needs"
            />
            <StepCard
              number="3"
              title="Analyze Results"
              description="View performance metrics, equity curves, and trade details"
            />
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-32 text-center">
          <div className="inline-block p-1 bg-white rounded-2xl">
            <div className="bg-gray-900 rounded-xl px-12 py-10">
              <h3 className="text-2xl font-bold text-white mb-4">
                Ready to start backtesting?
              </h3>
              <p className="text-gray-400 mb-6 max-w-md mx-auto">
                Join traders using data-driven strategies to make informed decisions.
              </p>
              <button
                onClick={handleGetStarted}
                className="px-8 py-3 bg-white hover:bg-gray-200 text-black font-semibold rounded-lg transition-all duration-200"
              >
                Launch Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-800/50 py-8 mt-20">
        <div className="max-w-7xl mx-auto px-6 text-center text-gray-500 text-sm">
          <p>© 2025 Prior Systems. For educational purposes only.</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="p-6 rounded-xl bg-gray-900/50 border border-gray-800/50 hover:border-gray-700/50 transition-all duration-200">
      <div className="mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white text-black font-bold text-xl mb-4">
        {number}
      </div>
      <h4 className="text-lg font-semibold text-white mb-2">{title}</h4>
      <p className="text-gray-400 text-sm">{description}</p>
    </div>
  );
}

type IconProps = { className?: string };

function IconBadge({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-white">
      {children}
    </div>
  );
}

function IconStrategy({ className }: IconProps = {}) {
  return (
    <IconBadge>
      <svg
        className={`h-6 w-6 ${className ?? ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        <path d="M7 11v2a2 2 0 0 0 2 2h2" />
        <circle cx="17" cy="7" r="2.5" />
      </svg>
    </IconBadge>
  );
}

function IconHistory({ className }: IconProps = {}) {
  return (
    <IconBadge>
      <svg
        className={`h-6 w-6 ${className ?? ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12h4l2 4 3-10 3 6h2" />
        <path d="M4 19h16" />
      </svg>
    </IconBadge>
  );
}

function IconSliders({ className }: IconProps = {}) {
  return (
    <IconBadge>
      <svg
        className={`h-6 w-6 ${className ?? ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="4" x2="20" y1="8" y2="8" />
        <line x1="4" x2="20" y1="16" y2="16" />
        <circle cx="9" cy="8" r="2" />
        <circle cx="15" cy="16" r="2" />
      </svg>
    </IconBadge>
  );
}
