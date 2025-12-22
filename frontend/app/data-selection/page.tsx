"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
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

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, TimeScale, Tooltip, Legend, Filler);

interface DatasetInfo {
  name: string;
  path: string;
  rows?: number;
  start?: number;
  end?: number;
  columns?: string[];
  symbol?: string;
  company_name?: string;
  display_name?: string;
  start_label?: string;
  end_label?: string;
  date_range_label?: string;
  downloaded_at?: string;
}

interface DatasetPreview {
  head: Array<Record<string, string | number | boolean | null>>;
  tail: Array<Record<string, string | number | boolean | null>>;
  total_rows: number;
  columns: string[];
}

interface DataSetProfile {
  id: string;
  datasetName: string;
  displayName: string;
  startIndex: number;
  endIndex: number;
  startDate: string;
  endDate: string;
  initialEquity: number;
  createdAt: string;
}

const STORAGE_KEY = "priorsystems:data-profiles";

export default function DataSelectionPage() {
  const router = useRouter();
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DatasetPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Marker state
  const [startMarkerIndex, setStartMarkerIndex] = useState<number | null>(null);
  const [endMarkerIndex, setEndMarkerIndex] = useState<number | null>(null);

  // Profile state
  const [initialEquity, setInitialEquity] = useState<number>(10000);
  const [savedProfiles, setSavedProfiles] = useState<DataSetProfile[]>([]);
  const [showSavedProfiles, setShowSavedProfiles] = useState(true);

  // Portfolio selection state
  const [usePortfolio, setUsePortfolio] = useState(false);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [portfolios, setPortfolios] = useState<any[]>([]);

  // Hover preview state
  const [hoveredDataset, setHoveredDataset] = useState<string | null>(null);
  const [hoverPreviewData, setHoverPreviewData] = useState<DatasetPreview | null>(null);
  const [loadingHoverPreview, setLoadingHoverPreview] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8002";

  const selectedDatasetInfo = useMemo(
    () => datasets.find((dataset) => dataset.name === selectedDataset) || null,
    [datasets, selectedDataset],
  );

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/datasets`);
      const data = await res.json();
      setDatasets(data.datasets || []);
    } catch (error) {
      console.error("Failed to fetch datasets:", error);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const loadSavedProfiles = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const profiles = JSON.parse(stored) as DataSetProfile[];
        setSavedProfiles(profiles);
      }
    } catch (error) {
      console.error("Failed to load saved profiles:", error);
    }
  }, []);

  useEffect(() => {
    loadDatasets();
    loadSavedProfiles();

    // Load portfolios
    const saved = localStorage.getItem("priorsystems:portfolios");
    if (saved) {
      setPortfolios(JSON.parse(saved));
    }
  }, [loadDatasets, loadSavedProfiles]);

  // Update initial equity when portfolio is selected
  useEffect(() => {
    if (usePortfolio && selectedPortfolioId) {
      const portfolio = portfolios.find(p => p.id === selectedPortfolioId);
      if (portfolio) {
        const portfolioValue = portfolio.cash + portfolio.holdings.reduce(
          (sum: number, h: any) => sum + (h.currentValue || h.shares * h.avgCost),
          0
        );
        setInitialEquity(portfolioValue);
      }
    }
  }, [usePortfolio, selectedPortfolioId, portfolios]);

  const handleSelectDataset = async (datasetName: string) => {
    setSelectedDataset(datasetName);
    setLoadingPreview(true);
    setStartMarkerIndex(null);
    setEndMarkerIndex(null);

    try {
      const res = await fetch(
        `${apiBase}/dataset-preview?name=${encodeURIComponent(datasetName)}&limit=1000`,
      );
      const data = await res.json();
      setPreviewData(data);
    } catch (error) {
      console.error("Failed to fetch preview:", error);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleDatasetHover = async (datasetName: string) => {
    setHoveredDataset(datasetName);
    setLoadingHoverPreview(true);

    try {
      const res = await fetch(
        `${apiBase}/dataset-preview?name=${encodeURIComponent(datasetName)}&limit=50`,
      );
      const data = await res.json();
      setHoverPreviewData(data);
    } catch (error) {
      console.error("Failed to fetch hover preview:", error);
    } finally {
      setLoadingHoverPreview(false);
    }
  };

  const handleDatasetHoverEnd = () => {
    setHoveredDataset(null);
    setHoverPreviewData(null);
  };

  const handleLoadProfile = (profile: DataSetProfile) => {
    // Find the dataset
    const dataset = datasets.find((d) => d.name === profile.datasetName);
    if (dataset) {
      setSelectedDataset(profile.datasetName);
      handleSelectDataset(profile.datasetName).then(() => {
        setStartMarkerIndex(profile.startIndex);
        setEndMarkerIndex(profile.endIndex);
        setInitialEquity(profile.initialEquity);
        setShowSavedProfiles(false);
      });
    }
  };

  const handleSaveAndContinue = () => {
    if (!selectedDataset || startMarkerIndex === null || endMarkerIndex === null || !previewData) {
      alert("Please select a dataset and place both start and end markers on the chart.");
      return;
    }

    if (startMarkerIndex >= endMarkerIndex) {
      alert("Start marker must be before end marker.");
      return;
    }

    if (initialEquity <= 0) {
      alert("Initial equity must be greater than 0.");
      return;
    }

    // Get the date values from preview data
    const startRow = previewData.head[startMarkerIndex];
    const endRow = previewData.head[endMarkerIndex];
    const dateCol = previewData.columns.find(
      (col) => col.toLowerCase() === "date" || col.toLowerCase() === "timestamp"
    );
    const startDate = dateCol ? String(startRow[dateCol]) : "";
    const endDate = dateCol ? String(endRow[dateCol]) : "";

    // Create profile
    const profile: DataSetProfile = {
      id: crypto.randomUUID(),
      datasetName: selectedDataset,
      displayName: selectedDatasetInfo?.display_name || selectedDatasetInfo?.symbol || selectedDataset,
      startIndex: startMarkerIndex,
      endIndex: endMarkerIndex,
      startDate,
      endDate,
      initialEquity,
      createdAt: new Date().toISOString(),
    };

    // Save to localStorage
    try {
      const existing = savedProfiles;
      const updated = [profile, ...existing].slice(0, 20); // Keep last 20 profiles
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

      // Also save for backtest page
      localStorage.setItem("priorsystems:selected-dataset", selectedDataset);
      localStorage.setItem("priorsystems:active-profile", JSON.stringify(profile));

      // Navigate to backtest
      router.push("/backtest");
    } catch (error) {
      console.error("Failed to save profile:", error);
      alert("Failed to save profile. Please try again.");
    }
  };

  const handleChartClick = (event: any, chartElements: any[]) => {
    if (!previewData || loadingPreview || !chartElements || chartElements.length === 0) {
      return;
    }

    // Get the clicked data point index
    const index = chartElements[0].index;

    if (index < 0 || index >= previewData.head.length) return;

    // Place markers
    if (startMarkerIndex === null) {
      setStartMarkerIndex(index);
    } else if (endMarkerIndex === null) {
      if (index > startMarkerIndex) {
        setEndMarkerIndex(index);
      } else {
        // Replace start marker
        setStartMarkerIndex(index);
      }
    } else {
      // Both markers placed, reset and start over
      setStartMarkerIndex(index);
      setEndMarkerIndex(null);
    }
  };

  const chartData = useMemo(() => {
    if (!previewData || !previewData.head) return null;

    const closeData = previewData.head.map((row) => row.close || row.Close || 0);

    // Get date labels from the data
    const dateCol = previewData.columns.find(
      (col) => col.toLowerCase() === "date" || col.toLowerCase() === "timestamp"
    );
    const labels = previewData.head.map((row, i) => {
      if (dateCol) {
        const dateStr = String(row[dateCol]);
        // Format date to just show YYYY-MM-DD
        try {
          const date = new Date(dateStr);
          return date.toISOString().split('T')[0];
        } catch {
          return dateStr;
        }
      }
      return String(i);
    });

    // Create point colors and radii to highlight markers
    const pointBackgroundColor = labels.map((_, i) => {
      if (i === startMarkerIndex) return "#3b82f6";
      if (i === endMarkerIndex) return "#ef4444";
      return "#10b981";
    });

    const pointRadius = labels.map((_, i) => {
      if (i === startMarkerIndex || i === endMarkerIndex) return 8;
      return 0;
    });

    return {
      labels,
      datasets: [
        {
          label: "Close Price",
          data: closeData,
          borderColor: "#10b981",
          borderWidth: 2,
          pointRadius,
          pointBackgroundColor,
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          tension: 0.1,
          fill: false,
        },
      ],
    };
  }, [previewData, startMarkerIndex, endMarkerIndex]);

  // Plugin to draw vertical lines at markers
  const verticalLinePlugin = useMemo(() => ({
    id: "verticalMarkerLines",
    afterDraw: (chart: any) => {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x) return;

      ctx.save();

      // Draw start marker line
      if (startMarkerIndex !== null) {
        const x = scales.x.getPixelForValue(startMarkerIndex);

        // Draw vertical line
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw label background and text
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#3b82f6";
        ctx.fillRect(x - 28, chartArea.top - 2, 56, 18);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("START", x, chartArea.top + 7);
      }

      // Draw end marker line
      if (endMarkerIndex !== null) {
        const x = scales.x.getPixelForValue(endMarkerIndex);

        // Draw vertical line
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw label background and text
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(x - 22, chartArea.top - 2, 44, 18);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("END", x, chartArea.top + 7);
      }

      ctx.restore();
    },
  }), [startMarkerIndex, endMarkerIndex]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: handleChartClick,
      interaction: {
        mode: "nearest" as const,
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: "index" as const,
          intersect: false,
          callbacks: {
            label: (context: any) => {
              const value = context.parsed.y;
              const index = context.dataIndex;
              if (!previewData) return "";
              const row = previewData.head[index];
              const dateCol = previewData.columns.find(
                (col) => col.toLowerCase() === "date" || col.toLowerCase() === "timestamp"
              );
              const date = dateCol ? String(row[dateCol]) : "";
              let marker = "";
              if (index === startMarkerIndex) marker = " [START]";
              if (index === endMarkerIndex) marker = " [END]";
              return `${date} | $${value.toFixed(2)}${marker}`;
            },
          },
        },
      },
      scales: {
        x: {
          display: true,
          grid: { color: "#1f2937" },
          ticks: {
            color: "#9ca3af",
            maxTicksLimit: 8,
            autoSkip: true,
            maxRotation: 45,
            minRotation: 0,
          },
        },
        y: {
          display: true,
          grid: { color: "#1f2937" },
          ticks: { color: "#9ca3af" },
        },
      },
    };
  }, [handleChartClick, previewData, startMarkerIndex, endMarkerIndex]);

  const getDatasetName = (dataset: DatasetInfo) =>
    dataset.display_name || dataset.symbol || dataset.name;

  const getDatasetRange = (dataset: DatasetInfo) =>
    dataset.date_range_label ||
    (dataset.start_label && dataset.end_label
      ? `${dataset.start_label} → ${dataset.end_label}`
      : "");

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-gray-400">Loading datasets...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <nav className="border-b border-gray-800/50 backdrop-blur-sm bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Prior Systems" className="h-12 w-auto" />
          </div>
          <button
            onClick={() => router.push("/datasets")}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← Back to Data Suite
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Page Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-white mb-3">Configure Your Data Set Profile</h1>
          <p className="text-lg text-gray-400">
            Select a dataset, place start and end markers to define your time range, and set your initial equity.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Left Column - Dataset Selection & Saved Profiles */}
          <div className="space-y-6 lg:col-span-1">
            {/* Dataset Selection */}
            <div className="rounded-xl border border-gray-800/50 bg-gray-900/40 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Select Dataset</h3>
                <button
                  onClick={() => router.push("/datasets")}
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
                >
                  + Download Data
                </button>
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-hide">
                {datasets.map((dataset) => {
                  const isSelected = selectedDataset === dataset.name;
                  const isHovered = hoveredDataset === dataset.name;
                  return (
                    <div key={dataset.name} className="relative">
                      <button
                        onClick={() => handleSelectDataset(dataset.name)}
                        onMouseEnter={() => handleDatasetHover(dataset.name)}
                        onMouseLeave={handleDatasetHoverEnd}
                        className={`w-full p-4 rounded-lg border text-left transition-all ${
                          isSelected
                            ? "bg-white/10 border-white/50"
                            : "bg-gray-900/50 border-gray-800/50 hover:border-gray-700/50"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 rounded bg-white/10 text-xs font-semibold text-white">
                            {dataset.symbol || "DATA"}
                          </span>
                        </div>
                        <p className="text-sm text-white font-medium">{getDatasetName(dataset)}</p>
                        <p className="text-xs text-gray-500">{getDatasetRange(dataset)}</p>

                        {/* Mini chart preview on hover */}
                        {isHovered && hoverPreviewData && hoverPreviewData.head && hoverPreviewData.head.length > 0 && (
                          <div className="mt-2 h-16 bg-black/50 rounded-md p-1 border border-gray-700/50">
                            <Line
                              data={{
                                labels: hoverPreviewData.head.map((_, i) => i),
                                datasets: [
                                  {
                                    label: "Close",
                                    data: hoverPreviewData.head.map((row) => row.close || row.Close || 0),
                                    borderColor: "#10b981",
                                    borderWidth: 1,
                                    pointRadius: 0,
                                    tension: 0.1,
                                    fill: false,
                                  },
                                ],
                              }}
                              options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                  legend: { display: false },
                                  tooltip: { enabled: false },
                                },
                                scales: {
                                  x: { display: false },
                                  y: { display: false },
                                },
                              }}
                            />
                          </div>
                        )}
                        {isHovered && loadingHoverPreview && (
                          <div className="mt-2 h-16 bg-black/50 rounded-md p-1 border border-gray-700/50 flex items-center justify-center">
                            <span className="text-[10px] text-gray-500">Loading...</span>
                          </div>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Saved Profiles */}
            {savedProfiles.length > 0 && (
              <div className="rounded-xl border border-gray-800/50 bg-gray-900/40 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">Saved Profiles</h3>
                  <button
                    onClick={() => setShowSavedProfiles(!showSavedProfiles)}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    {showSavedProfiles ? "Hide" : "Show"}
                  </button>
                </div>
                {showSavedProfiles && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {savedProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        onClick={() => handleLoadProfile(profile)}
                        className="w-full p-3 rounded-lg border border-gray-800/50 bg-gray-950/50 hover:bg-gray-900/50 text-left transition-all"
                      >
                        <p className="text-sm text-white font-medium">{profile.displayName}</p>
                        <p className="text-xs text-gray-400">{profile.startDate} → {profile.endDate}</p>
                        <p className="text-xs text-gray-500">Equity: ${profile.initialEquity.toLocaleString()}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column - Chart & Configuration */}
          <div className="space-y-6 lg:col-span-2">
            {/* Chart */}
            <div className="rounded-xl border border-gray-800/50 bg-gray-900/40 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Price Chart - Click to Place Markers</h3>
                {(startMarkerIndex !== null || endMarkerIndex !== null) && (
                  <button
                    onClick={() => {
                      setStartMarkerIndex(null);
                      setEndMarkerIndex(null);
                    }}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    Reset Markers
                  </button>
                )}
              </div>

              {!selectedDataset ? (
                <div className="h-96 flex items-center justify-center border border-gray-800/50 rounded-lg bg-black/30">
                  <p className="text-gray-500">Select a dataset to view the chart</p>
                </div>
              ) : loadingPreview ? (
                <div className="h-96 flex items-center justify-center border border-gray-800/50 rounded-lg bg-black/30">
                  <p className="text-gray-400">Loading chart...</p>
                </div>
              ) : chartData ? (
                <div className="h-96 bg-black/30 rounded-lg p-4">
                  <Line data={chartData} options={chartOptions} plugins={[verticalLinePlugin]} />
                </div>
              ) : (
                <div className="h-96 flex items-center justify-center border border-gray-800/50 rounded-lg bg-black/30">
                  <p className="text-gray-500">No data available</p>
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-blue-950/20 border border-blue-900/30">
                  <p className="text-xs text-blue-400 mb-1">Start Marker</p>
                  <p className="text-sm text-white font-medium">
                    {startMarkerIndex !== null ? `Index ${startMarkerIndex}` : "Not placed"}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-red-950/20 border border-red-900/30">
                  <p className="text-xs text-red-400 mb-1">End Marker</p>
                  <p className="text-sm text-white font-medium">
                    {endMarkerIndex !== null ? `Index ${endMarkerIndex}` : "Not placed"}
                  </p>
                </div>
              </div>
            </div>

            {/* Configuration */}
            <div className="rounded-xl border border-gray-800/50 bg-gray-900/40 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Initial Configuration</h3>

              <div className="space-y-4">
                {/* Portfolio Selection Toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-950 border border-gray-800">
                  <span className="text-sm text-gray-300">Use Portfolio Equity</span>
                  <button
                    onClick={() => {
                      setUsePortfolio(!usePortfolio);
                      if (!usePortfolio && portfolios.length > 0) {
                        setSelectedPortfolioId(portfolios[0].id);
                      }
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      usePortfolio
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {usePortfolio ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* Portfolio Selector */}
                {usePortfolio && portfolios.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Select Portfolio
                    </label>
                    <select
                      value={selectedPortfolioId || ""}
                      onChange={(e) => setSelectedPortfolioId(e.target.value)}
                      className="w-full px-4 py-3 rounded-lg border border-gray-700 bg-gray-950 text-white focus:border-purple-500 focus:outline-none"
                    >
                      {portfolios.map((portfolio) => (
                        <option key={portfolio.id} value={portfolio.id}>
                          {portfolio.name} (${(portfolio.cash + portfolio.holdings.reduce(
                            (sum: number, h: any) => sum + (h.currentValue || h.shares * h.avgCost),
                            0
                          )).toLocaleString()})
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-gray-500">
                      Portfolio equity will be used as starting capital.
                    </p>
                  </div>
                )}

                {/* Initial Equity Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Initial Equity (USD)
                  </label>
                  <input
                    type="number"
                    value={initialEquity}
                    onChange={(e) => setInitialEquity(Number(e.target.value))}
                    disabled={usePortfolio}
                    min="1"
                    step="100"
                    className={`w-full px-4 py-3 rounded-lg border border-gray-700 bg-gray-950 text-white focus:border-white focus:outline-none ${
                      usePortfolio ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    {usePortfolio
                      ? 'Using portfolio equity as starting capital.'
                      : 'This is the starting capital for your backtest.'}
                  </p>
                </div>

                <div className="pt-4 border-t border-gray-800">
                  <button
                    onClick={handleSaveAndContinue}
                    disabled={!selectedDataset || startMarkerIndex === null || endMarkerIndex === null}
                    className="w-full px-6 py-4 bg-white hover:bg-gray-200 text-black font-semibold rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save Profile & Continue to Backtest
                  </button>
                </div>
              </div>
            </div>

            {/* Instructions */}
            <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-5">
              <h4 className="text-sm font-semibold text-white mb-3">How to Use</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                <li>1. Select a dataset from the left panel</li>
                <li>2. Click on the chart to place your START marker (blue)</li>
                <li>3. Click again to place your END marker (red)</li>
                <li>4. Set your initial equity amount</li>
                <li>5. Click "Save Profile & Continue" to proceed to backtesting</li>
                <li>• Your configuration will be saved for future use</li>
                <li>• Click "Reset Markers" to reposition them</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
