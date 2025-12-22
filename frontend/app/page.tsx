"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  const handleGetStarted = () => {
    // Navigate to dashboard
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-950 to-black">
      {/* Navigation */}
      <nav className="fixed top-0 w-full border-b border-white/5 backdrop-blur-xl bg-black/30 z-50">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Prior Systems" className="h-11 w-auto" />
          </div>
          <div className="flex items-center gap-6">
            <a href="/portfolio" className="text-sm text-gray-400 hover:text-white transition-colors">
              Portfolio
            </a>
            <button
              onClick={handleGetStarted}
              className="px-5 py-2.5 text-sm bg-white text-black font-medium rounded-full hover:bg-gray-100 transition-all duration-200"
            >
              Get Started →
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-6 pt-32 pb-24">
        {/* Gradient Orb Background */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gradient-radial from-blue-500/10 via-transparent to-transparent blur-3xl pointer-events-none"></div>

        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 mb-8 backdrop-blur-sm">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
            <span className="text-sm text-gray-300">Built for retail traders</span>
          </div>

          <h1 className="text-6xl md:text-7xl font-semibold text-white mb-6 leading-[1.1] tracking-tight">
            Backtest strategies
            <span className="block bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent mt-2">
              with confidence
            </span>
          </h1>
          <p className="text-xl text-gray-400 mb-10 leading-relaxed max-w-2xl mx-auto font-light">
            Test your trading ideas on real historical data. Choose from proven strategies,
            adjust parameters, and analyze results, all without writing a single line of code.
          </p>

          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handleGetStarted}
              className="group px-8 py-4 bg-white hover:bg-gray-50 text-black font-medium rounded-full transition-all duration-200 text-base shadow-lg shadow-white/10 hover:shadow-white/20 hover:scale-105"
            >
              Start backtesting
              <span className="inline-block ml-2 group-hover:translate-x-1 transition-transform">→</span>
            </button>
            <a
              href="/portfolio"
              className="px-8 py-4 border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-white font-medium rounded-full transition-all duration-200 text-base backdrop-blur-sm"
            >
              Build portfolio
            </a>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mt-40 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 relative">
          <FeatureCard
            icon={<IconStrategy />}
            title="Built-in Strategies"
            description="Pre-built strategies like SMA Crossover, Mean Reversion, RSI, and more."
          />
          <FeatureCard
            icon={<IconHistory />}
            title="Historical Data"
            description="Test against years of real market data across different conditions."
          />
          <FeatureCard
            icon={<IconSliders />}
            title="Fine-tune Parameters"
            description="Adjust parameters to match your exact risk profile and style."
          />
          <FeatureCard
            icon={<IconPortfolio />}
            title="Portfolio Builder"
            description="Track holdings and use your equity as starting capital."
            link="/portfolio"
          />
        </div>

        {/* How It Works */}
        <div className="mt-48">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-semibold text-white mb-4 tracking-tight">
              Three steps to better trading
            </h2>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto font-light">
              Get from idea to actionable insights in minutes
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 max-w-5xl mx-auto">
            <StepCard
              number="1"
              title="Choose Dataset"
              description="Select from curated historical market datasets spanning multiple years and market conditions"
            />
            <StepCard
              number="2"
              title="Configure Strategy"
              description="Pick a proven strategy and fine-tune parameters to match your trading style"
            />
            <StepCard
              number="3"
              title="Analyze Results"
              description="Review detailed performance metrics, equity curves, and individual trade breakdowns"
            />
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-48 mb-24">
          <div className="relative rounded-3xl overflow-hidden border border-white/10 bg-gradient-to-br from-white/5 via-white/[0.02] to-transparent backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5"></div>
            <div className="relative px-12 py-16 text-center">
              <h3 className="text-3xl md:text-4xl font-semibold text-white mb-4 tracking-tight">
                Ready to backtest with confidence?
              </h3>
              <p className="text-lg text-gray-400 mb-8 max-w-xl mx-auto font-light">
                Join traders making data-driven decisions with proven strategies
              </p>
              <button
                onClick={handleGetStarted}
                className="group px-8 py-4 bg-white hover:bg-gray-50 text-black font-medium rounded-full transition-all duration-200 shadow-lg shadow-white/10 hover:shadow-white/20 hover:scale-105"
              >
                Launch dashboard
                <span className="inline-block ml-2 group-hover:translate-x-1 transition-transform">→</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12">
        <div className="max-w-7xl mx-auto px-6 text-center text-gray-500 text-sm">
          <p>© 2025 Prior Systems. For educational purposes only. Not financial advice.</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description, link }: { icon: ReactNode; title: string; description: string; link?: string }) {
  const content = (
    <>
      <div className="mb-4 opacity-80">{icon}</div>
      <h3 className="text-base font-semibold text-white mb-2.5 tracking-tight">{title}</h3>
      <p className="text-gray-400 text-sm leading-relaxed font-light">{description}</p>
    </>
  );

  if (link) {
    return (
      <a href={link} className="group relative block p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] transition-all duration-300 cursor-pointer overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        <div className="relative">
          {content}
          <div className="mt-3 text-xs text-gray-500 group-hover:text-gray-400 transition-colors flex items-center gap-1">
            Learn more <span className="group-hover:translate-x-0.5 transition-transform inline-block">→</span>
          </div>
        </div>
      </a>
    );
  }

  return (
    <div className="relative p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all duration-300 overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
      <div className="relative">{content}</div>
    </div>
  );
}

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="relative">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 text-white font-semibold text-xl mb-6 backdrop-blur-sm">
        {number}
      </div>
      <h4 className="text-xl font-semibold text-white mb-3 tracking-tight">{title}</h4>
      <p className="text-gray-400 text-sm leading-relaxed font-light">{description}</p>
    </div>
  );
}

type IconProps = { className?: string };

function IconBadge({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white backdrop-blur-sm">
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

function IconPortfolio({ className }: IconProps = {}) {
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
        <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    </IconBadge>
  );
}
