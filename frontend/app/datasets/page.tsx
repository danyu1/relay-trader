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
import "chartjs-adapter-date-fns";
import { apiFetch } from "@/app/lib/api";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";

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

interface DatasetMetadata {
  rows: number;
  start_date?: string;
  end_date?: string;
  columns: string[];
}

type DatasetRow = Record<string, string | number | boolean | null>;

interface DatasetPreview {
  head: DatasetRow[];
  tail: DatasetRow[];
  total_rows: number;
  columns: string[];
  series?: { timestamp: number; close: number }[];
}

type DownloadJob = {
  symbol: string;
  startDate?: string;
  endDate?: string;
  period: string;
  refresh?: boolean;
};

type QueueItem = DownloadJob & {
  id: string;
  status: "pending" | "downloading" | "success" | "error";
  message?: string;
};

const PERIOD_OPTIONS = [
  { value: "1y", label: "1 Year" },
  { value: "5y", label: "5 Years" },
  { value: "10y", label: "10 Years" },
  { value: "max", label: "Max Available" },
];

const POPULAR_SYMBOLS = [
  { symbol: "SPY", name: "SPDR S&P 500 ETF", category: "Indices" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", category: "Indices" },
  { symbol: "DIA", name: "SPDR Dow Jones Industrial Average", category: "Indices" },
  { symbol: "IWM", name: "iShares Russell 2000 ETF", category: "Indices" },
  { symbol: "VTI", name: "Vanguard Total Stock Market", category: "Indices" },
  { symbol: "AAPL", name: "Apple Inc.", category: "Tech" },
  { symbol: "MSFT", name: "Microsoft Corp.", category: "Tech" },
  { symbol: "GOOGL", name: "Alphabet Inc.", category: "Tech" },
  { symbol: "AMZN", name: "Amazon.com Inc.", category: "Tech" },
  { symbol: "META", name: "Meta Platforms Inc.", category: "Tech" },
  { symbol: "NVDA", name: "NVIDIA Corp.", category: "Tech" },
  { symbol: "TSLA", name: "Tesla Inc.", category: "Tech" },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", category: "Finance" },
  { symbol: "BAC", name: "Bank of America Corp.", category: "Finance" },
  { symbol: "GS", name: "Goldman Sachs Group", category: "Finance" },
  { symbol: "V", name: "Visa Inc.", category: "Finance" },
  { symbol: "MA", name: "Mastercard Inc.", category: "Finance" },
  { symbol: "JNJ", name: "Johnson & Johnson", category: "Healthcare" },
  { symbol: "UNH", name: "UnitedHealth Group", category: "Healthcare" },
  { symbol: "PFE", name: "Pfizer Inc.", category: "Healthcare" },
  { symbol: "ABBV", name: "AbbVie Inc.", category: "Healthcare" },
  { symbol: "WMT", name: "Walmart Inc.", category: "Consumer" },
  { symbol: "HD", name: "Home Depot Inc.", category: "Consumer" },
  { symbol: "NKE", name: "Nike Inc.", category: "Consumer" },
  { symbol: "MCD", name: "McDonald's Corp.", category: "Consumer" },
  { symbol: "DIS", name: "The Walt Disney Co.", category: "Consumer" },
  { symbol: "XOM", name: "Exxon Mobil Corp.", category: "Energy" },
  { symbol: "CVX", name: "Chevron Corp.", category: "Energy" },
  { symbol: "COIN", name: "Coinbase Global", category: "Crypto Adjacent" },
  { symbol: "MSTR", name: "MicroStrategy", category: "Crypto Adjacent" },
];

const extractSymbol = (filename: string) => {
  const match = filename.match(/^([A-Z]+)/);
  return match ? match[1] : "Unknown";
};

const extractDateRange = (filename: string) => {
  const match = filename.match(/(\d{4})-(\d{4})/);
  if (match) {
    return `${match[1]} - ${match[2]}`;
  }
  return null;
};

const PREVIEW_LIMIT = 50;
const PREVIEW_SAMPLE = 400;

export default function DatasetsPage() {
  const router = useRouter();
  const { loading: authLoading } = useRequireAuth();
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DatasetMetadata | null>(null);
  const [previewData, setPreviewData] = useState<DatasetPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadSymbolInput, setDownloadSymbolInput] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [downloadStartDate, setDownloadStartDate] = useState("");
  const [downloadEndDate, setDownloadEndDate] = useState("");
  const [downloadPeriod, setDownloadPeriod] = useState("max");
  const [popularSearch, setPopularSearch] = useState("");
  const [datasetSearch, setDatasetSearch] = useState("");
  const [downloadQueue, setDownloadQueue] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("priorsystems:selected-dataset");
    if (!stored) return;
    apiFetch("/user-settings/selected-dataset", {
      method: "PUT",
      body: JSON.stringify({ key: "selected-dataset", value: stored }),
    })
      .catch(() => undefined)
      .finally(() => {
        window.localStorage.removeItem("priorsystems:selected-dataset");
      });
  }, []);

  const selectedDatasetInfo = useMemo(
    () => datasets.find((dataset) => dataset.name === selectedDataset) || null,
    [datasets, selectedDataset],
  );

  const filteredDatasets = useMemo(() => {
    const search = datasetSearch.trim().toLowerCase();
    if (!search) return datasets;
    return datasets.filter((dataset) => {
      const haystack = `${dataset.display_name ?? ""} ${dataset.symbol ?? ""} ${dataset.name} ${
        dataset.date_range_label ?? ""
      }`;
      return haystack.toLowerCase().includes(search);
    });
  }, [datasets, datasetSearch]);

  const filteredPopularSymbols = useMemo(() => {
    const search = popularSearch.trim().toLowerCase();
    if (!search) return POPULAR_SYMBOLS;
    return POPULAR_SYMBOLS.filter(
      (item) =>
        item.symbol.toLowerCase().includes(search) || item.name.toLowerCase().includes(search) || item.category.toLowerCase().includes(search),
    );
  }, [popularSearch]);

  const previewSeries = useMemo(() => {
    if (!previewData) return [];
    if (previewData.series && previewData.series.length > 0) {
      return previewData.series;
    }
    return previewData.head
      .map((row, index) => {
        const rawTs = row.timestamp ?? row.date ?? row.Date ?? index;
        const tsNum = typeof rawTs === "number" ? rawTs : Number(rawTs);
        const closeVal = row.close ?? row.Close ?? 0;
        const closeNum = typeof closeVal === "number" ? closeVal : Number(closeVal);
        return {
          timestamp: Number.isFinite(tsNum) ? tsNum : index,
          close: Number.isFinite(closeNum) ? closeNum : 0,
        };
      })
      .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.close));
  }, [previewData]);

  const queueProgress = useMemo(() => {
    if (!downloadQueue.length) return 0;
    const completed = downloadQueue.filter((item) => item.status === "success" || item.status === "error").length;
    return completed / downloadQueue.length;
  }, [downloadQueue]);

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/datasets");
      const data = await res.json();
      setDatasets(data.datasets || []);
    } catch (error) {
      console.error("Failed to fetch datasets:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  const formatTimestamp = (value?: number) => {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString().slice(0, 10);
  };

  const getDatasetName = (dataset: DatasetInfo) => dataset.display_name || dataset.symbol || extractSymbol(dataset.name);
  const getDatasetRange = (dataset: DatasetInfo) =>
    dataset.date_range_label ||
    (dataset.start_label && dataset.end_label ? `${dataset.start_label} → ${dataset.end_label}` : extractDateRange(dataset.name) || "Unknown range");

  const handleSelectDataset = async (datasetName: string) => {
    setSelectedDataset(datasetName);
    setLoadingMetadata(true);

    try {
      const selected = datasets.find((d) => d.name === datasetName);

      // Fetch metadata with some preview rows for the chart
      const res = await apiFetch(
        `/dataset-preview?name=${encodeURIComponent(datasetName)}&limit=${PREVIEW_LIMIT}&sample=${PREVIEW_SAMPLE}`,
      );
      const data = await res.json();
      const totalRows = typeof selected?.rows === "number" ? selected.rows : Number(data.total_rows ?? 0) || 0;
      setMetadata({
        rows: totalRows,
        start_date: formatTimestamp(selected?.start),
        end_date: formatTimestamp(selected?.end),
        columns: (selected?.columns && selected.columns.length > 0 ? selected.columns : data.columns) || [],
      });

      // Store preview data for chart
      setPreviewData(data);
    } catch (error) {
      console.error("Failed to fetch metadata:", error);
    } finally {
      setLoadingMetadata(false);
    }
  };

  const handleContinue = () => {
    if (selectedDataset) {
      apiFetch(`/user-settings/selected-dataset`, {
        method: "PUT",
        body: JSON.stringify({ key: "selected-dataset", value: selectedDataset }),
      })
        .then(() => {
          router.push("/data-selection");
        })
        .catch(() => {
          router.push("/data-selection");
        });
    }
  };

  const executeDownload = useCallback(
    async ({ symbol, startDate, endDate, period, refresh }: DownloadJob) => {
      const trimmedSymbol = symbol.trim();
      if (!trimmedSymbol) {
        throw new Error("Symbol is required");
      }
      const params = new URLSearchParams({
        symbol: trimmedSymbol.toUpperCase(),
        period: period || "max",
      });
      if (startDate && endDate) {
        params.set("start_date", startDate);
        params.set("end_date", endDate);
      }
      if (refresh) {
        params.set("refresh", "true");
      }
      const res = await apiFetch(`/download-symbol?${params.toString()}`, {
        method: "POST",
      });
      if (!res.ok) {
        let message = "Download failed";
        try {
          const err = await res.json();
          message = err.detail || message;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      return res.json();
    },
    [],
  );

  const handleDownload = async () => {
    if (!downloadSymbolInput.trim()) {
      setDownloadError("Please enter a symbol");
      return;
    }
    if ((downloadStartDate && !downloadEndDate) || (!downloadStartDate && downloadEndDate)) {
      setDownloadError("Provide both start and end dates, or leave both blank.");
      return;
    }
    if (downloadStartDate && downloadEndDate && downloadStartDate > downloadEndDate) {
      setDownloadError("Start date must be before end date.");
      return;
    }

    setDownloading(true);
    setDownloadError(null);
    setDownloadSuccess(null);

    try {
      const result = await executeDownload({
        symbol: downloadSymbolInput,
        startDate: downloadStartDate || undefined,
        endDate: downloadEndDate || undefined,
        period: downloadPeriod,
      });

      await loadDatasets();
      if (result?.filename) {
        setSelectedDataset(result.filename);
        await handleSelectDataset(result.filename);
      }
      const label = result?.display_name || result?.symbol || downloadSymbolInput.toUpperCase();
      setDownloadSuccess(result?.cached ? `${label} was already downloaded.` : `Downloaded ${label}.`);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const updateQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setDownloadQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const handleAddToQueue = () => {
    if (!downloadSymbolInput.trim()) {
      setDownloadError("Enter a symbol before adding to the queue.");
      return;
    }
    if ((downloadStartDate && !downloadEndDate) || (!downloadStartDate && downloadEndDate)) {
      setDownloadError("Provide both start and end dates for queued downloads.");
      return;
    }
    if (downloadStartDate && downloadEndDate && downloadStartDate > downloadEndDate) {
      setDownloadError("Start date must be before end date.");
      return;
    }
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const newItem: QueueItem = {
      id,
      symbol: downloadSymbolInput,
      startDate: downloadStartDate || undefined,
      endDate: downloadEndDate || undefined,
      period: downloadPeriod,
      status: "pending",
    };
    setDownloadQueue((prev) => [...prev, newItem]);
    setDownloadError(null);
    setDownloadSuccess("Added to download queue.");
  };

  const handleClearQueue = () => {
    if (queueRunning) return;
    setDownloadQueue([]);
  };

  const handleRunQueue = async () => {
    if (!downloadQueue.length || queueRunning) return;
    setQueueRunning(true);
    setDownloadError(null);
    setDownloadSuccess(null);
    for (const item of downloadQueue) {
      if (item.status === "success") continue;
      updateQueueItem(item.id, { status: "downloading", message: undefined });
      try {
        const result = await executeDownload(item);
        const label = result?.display_name || result?.symbol || item.symbol.toUpperCase();
        updateQueueItem(item.id, {
          status: "success",
          message: result?.cached ? `${label} already downloaded.` : `Downloaded ${label}.`,
        });
        await loadDatasets();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Download failed";
        updateQueueItem(item.id, { status: "error", message });
      }
    }
    setQueueRunning(false);
  };

  const handleRefreshSelected = async () => {
    if (!selectedDatasetInfo?.symbol) return;
    setRefreshing(true);
    setDownloadError(null);
    setDownloadSuccess(null);
    try {
      const result = await executeDownload({
        symbol: selectedDatasetInfo.symbol,
        startDate: selectedDatasetInfo.start_label || undefined,
        endDate: selectedDatasetInfo.end_label || undefined,
        period: selectedDatasetInfo.start_label && selectedDatasetInfo.end_label ? "max" : downloadPeriod,
        refresh: true,
      });
      await loadDatasets();
      if (selectedDatasetInfo.name) {
        await handleSelectDataset(selectedDatasetInfo.name);
      }
      const label = result?.display_name || result?.symbol || selectedDatasetInfo.symbol;
      setDownloadSuccess(result?.cached ? `${label} was already up to date.` : `Refreshed ${label}.`);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const closeDownloadModal = () => {
    setShowDownloadModal(false);
    setDownloadError(null);
    setDownloadSuccess(null);
    setDownloadSymbolInput("");
    setDownloadStartDate("");
    setDownloadEndDate("");
    setDownloadPeriod("max");
    setPopularSearch("");
  };

  if (authLoading) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-orange-50 to-orange-100 flex items-center justify-center">
        <div className="text-gray-700">Loading datasets...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-orange-50 to-orange-100">
      {/* Header */}
      <nav className="border-b border-orange-200 backdrop-blur-sm bg-white/50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Prior Systems" className="h-12 w-auto" />
          </div>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            ← Back
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Page Header */}
        <div className="mb-12 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-3">Choose Your Dataset</h1>
            <p className="text-lg text-gray-700">
              Select a historical dataset to backtest your trading strategies against real market conditions.
            </p>
          </div>
          <button
            onClick={() => setShowDownloadModal(true)}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 shadow-lg"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m0 0l-4-4m4 4l4-4" />
            </svg>
            Download Data
          </button>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Dataset List */}
          <div className="space-y-4 lg:col-span-2">
            <div className="flex flex-col gap-2 rounded-xl border border-gray-800/50 bg-gray-900/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                placeholder="Search your datasets by symbol, company, or range"
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-white focus:outline-none sm:flex-1"
                value={datasetSearch}
                onChange={(e) => setDatasetSearch(e.target.value)}
              />
              <span className="text-xs text-gray-500">
                Showing {filteredDatasets.length} of {datasets.length} datasets
              </span>
            </div>
            {datasets.length === 0 ? (
              <div className="rounded-xl border border-gray-800/50 bg-gray-900/50 p-8 text-center">
                <p className="mb-4 text-gray-400">No datasets found</p>
                <p className="text-sm text-gray-500">Download data or upload a CSV to get started.</p>
              </div>
            ) : filteredDatasets.length === 0 ? (
              <div className="rounded-xl border border-gray-800/50 bg-gray-900/50 p-8 text-center text-sm text-gray-400">
                No datasets match “{datasetSearch}”.
              </div>
            ) : (
              filteredDatasets.map((dataset) => {
                const symbol = dataset.symbol ?? extractSymbol(dataset.name);
                const dateRange = getDatasetRange(dataset);
                const friendlyTitle = `[${getDatasetName(dataset)}, ${dateRange}]`;
                const isSelected = selectedDataset === dataset.name;

                return (
                  <button
                    key={dataset.name}
                    onClick={() => handleSelectDataset(dataset.name)}
                    className={`w-full rounded-xl border p-6 text-left transition-all duration-200 ${
                      isSelected
                        ? "bg-white/5 border-white/50 shadow-lg"
                        : "bg-gray-900/50 border-gray-800/50 hover:border-gray-700/50"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-3">
                          <span className="rounded-md bg-white/10 px-3 py-1 text-sm font-semibold text-white">
                            {symbol}
                          </span>
                          <span className="text-sm text-gray-400">{dateRange}</span>
                        </div>
                        <h3 className="text-white font-medium">{friendlyTitle}</h3>
                        <p className="text-sm text-gray-500 break-all">{dataset.path}</p>
                        {dataset.downloaded_at && (
                          <p className="mt-2 text-xs text-gray-500">
                            Updated {new Date(dataset.downloaded_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                      {isSelected && (
                        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white">
                          <svg className="h-4 w-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Metadata Panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-6">
              <div className="p-6 rounded-xl bg-gray-900/50 border border-gray-800/50">
                {!selectedDataset ? (
                  <div className="text-center py-8">
                    <DatasetPlaceholderIcon />
                    <p className="mt-3 text-gray-400 text-sm">Select a dataset to view details</p>
                  </div>
                ) : loadingMetadata ? (
                  <div className="text-center py-8">
                    <p className="text-gray-400 text-sm">Loading metadata...</p>
                  </div>
                ) : metadata ? (
                  <div className="space-y-6">
                    {selectedDatasetInfo && (
                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-500">Selected Dataset</p>
                        <p className="text-lg font-semibold text-white">{getDatasetName(selectedDatasetInfo)}</p>
                        <p className="text-sm text-gray-400">{getDatasetRange(selectedDatasetInfo)}</p>
                      </div>
                    )}
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-white font-semibold">Dataset Information</h3>
                        {selectedDatasetInfo?.symbol && (
                          <button
                            onClick={handleRefreshSelected}
                            disabled={refreshing}
                            className="rounded-lg border border-gray-700 px-3 py-1 text-xs font-semibold text-white transition hover:border-white disabled:opacity-50"
                          >
                            {refreshing ? "Refreshing…" : "Update Dataset"}
                          </button>
                        )}
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-gray-800/50">
                          <span className="text-gray-400 text-sm">Total Rows</span>
                          <span className="text-white font-medium">{metadata.rows.toLocaleString()}</span>
                        </div>
                        {metadata.start_date && (
                          <div className="flex justify-between items-center py-2 border-b border-gray-800/50">
                            <span className="text-gray-400 text-sm">Start Date</span>
                            <span className="text-white font-medium">{metadata.start_date}</span>
                          </div>
                        )}
                        {metadata.end_date && (
                          <div className="flex justify-between items-center py-2 border-b border-gray-800/50">
                            <span className="text-gray-400 text-sm">End Date</span>
                            <span className="text-white font-medium">{metadata.end_date}</span>
                          </div>
                        )}
                        <div className="py-2">
                          <span className="text-gray-400 text-sm block mb-2">Columns</span>
                          <div className="flex flex-wrap gap-2">
                            {metadata.columns.map((col) => (
                              <span
                                key={col}
                                className="px-2 py-1 rounded bg-gray-800/50 text-gray-300 text-xs"
                              >
                                {col}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Mini Chart Preview */}
                    {previewSeries.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-white font-semibold text-sm">Price Preview</h3>
                        <div className="h-32 bg-black/30 rounded-lg p-2">
                          <Line
                            data={{
                              datasets: [
                                {
                                  label: "Close",
                                  data: previewSeries.map((point) => ({
                                    x: point.timestamp,
                                    y: point.close,
                                  })),
                                  borderColor: "#10b981",
                                  borderWidth: 1.5,
                                  pointRadius: 0,
                                  tension: 0.1,
                                  parsing: false,
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
                                x: {
                                  type: "time",
                                  display: true,
                                  grid: { display: false },
                                  ticks: {
                                    color: "#6b7280",
                                    font: { size: 9 },
                                    maxTicksLimit: 6,
                                    callback: (value) => {
                                      const ts = typeof value === "number" ? value : Number(value);
                                      if (!Number.isFinite(ts)) return String(value);
                                      return new Date(ts).toISOString().slice(0, 10);
                                    },
                                  },
                                },
                                y: {
                                  display: true,
                                  title: {
                                    display: true,
                                    text: "Price (USD)",
                                    color: "#6b7280",
                                    font: { size: 10, weight: "bold" },
                                  },
                                  grid: { display: false },
                                  ticks: {
                                    color: "#6b7280",
                                    font: { size: 9 },
                                    maxTicksLimit: 4,
                                  },
                                },
                              },
                            }}
                          />
                        </div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">
                          Showing a sampled view across the full dataset
                        </p>
                      </div>
                    )}

                    <button
                      onClick={handleContinue}
                      className="w-full px-6 py-3 bg-white hover:bg-gray-200 text-black font-semibold rounded-lg transition-all duration-200"
                    >
                      Return to Dataset Selection
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="mt-6 space-y-4 rounded-xl border border-gray-800/60 bg-gray-900/40 p-5">
                <h4 className="text-sm font-semibold text-white">yfinance Capacity & Practical Limits</h4>
                <ul className="space-y-2 text-xs text-gray-400">
                  <li>1 year of daily bars ≈ 20–30 KB (2–3s download)</li>
                  <li>5 years ≈ 100–150 KB (3–5s); full history 400–600 KB (5–10s)</li>
                  <li>Unofficial rate limits: ~200–300 requests/hour, 2,000/day per IP</li>
                  <li>We enforce 10s spacing, caching, and 24h refresh windows to avoid throttling</li>
                  <li>Pre-seed 20–50 popular symbols (~30 MB total) and reuse cached datasets whenever possible</li>
                  <li>Storage guide: 100 datasets ≈ 50 MB, 1,000 datasets ≈ 500 MB</li>
                </ul>
                <p className="text-[11px] text-gray-500">
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Download Modal */}
      {showDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-xl rounded-xl border border-gray-800 bg-gray-950 p-6 shadow-2xl">
            <button onClick={closeDownloadModal} className="absolute right-4 top-4 text-gray-400 transition-colors hover:text-white">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h2 className="mb-2 text-2xl font-bold text-white">Download Market Data</h2>
            <p className="mb-6 text-sm text-gray-400">
              Queue up symbols for yfinance downloads. We cache every dataset, add 10-second gaps between requests, and block refreshes for 24 hours to avoid throttling.
            </p>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">Symbol</label>
                <input
                  type="text"
                  value={downloadSymbolInput}
                  onChange={(e) => setDownloadSymbolInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !downloading) {
                      handleDownload();
                    }
                  }}
                  placeholder="e.g., SPY, AAPL, TSLA"
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-white focus:outline-none"
                  disabled={downloading || queueRunning}
                />
                <p className="mt-2 text-xs text-gray-500">Cached datasets return immediately when already downloaded.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-400">Start Date</label>
                  <input
                    type="date"
                    value={downloadStartDate}
                    onChange={(e) => setDownloadStartDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white focus:border-white focus:outline-none"
                    disabled={downloading || queueRunning}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-400">End Date</label>
                  <input
                    type="date"
                    value={downloadEndDate}
                    onChange={(e) => setDownloadEndDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white focus:border-white focus:outline-none"
                    disabled={downloading || queueRunning}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-400">Quick Period</label>
                <select
                  value={downloadPeriod}
                  onChange={(e) => setDownloadPeriod(e.target.value)}
                  disabled={(downloadStartDate && downloadEndDate ? true : false) || downloading || queueRunning}
                  className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white focus:border-white focus:outline-none disabled:opacity-50"
                >
                  {PERIOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-gray-500">Provide both dates for a custom window. Otherwise we request the selected period.</p>
              </div>

              {downloadError && (
                <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">{downloadError}</div>
              )}

              {downloadSuccess && (
                <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">{downloadSuccess}</div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={closeDownloadModal}
                  disabled={downloading}
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDownload}
                  disabled={downloading || queueRunning || !downloadSymbolInput.trim()}
                  className="flex-1 rounded-lg bg-white px-4 py-3 font-semibold text-black transition-all hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {downloading ? "Downloading…" : "Download Now"}
                </button>
                <button
                  onClick={handleAddToQueue}
                  disabled={!downloadSymbolInput.trim() || queueRunning}
                  className="w-full rounded-lg border border-white/30 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
                >
                  Add to Queue
                </button>
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-4">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-400">Popular Symbols</p>
                    <p className="text-[11px] text-gray-500">Tap to auto-fill or queue them.</p>
                  </div>
                  <input
                    type="text"
                    value={popularSearch}
                    onChange={(e) => setPopularSearch(e.target.value)}
                    placeholder="Search pre-seeded list"
                    className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-1.5 text-xs text-white focus:border-white focus:outline-none"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredPopularSymbols.map((item) => (
                    <button
                      key={item.symbol}
                      onClick={() => setDownloadSymbolInput(item.symbol)}
                      disabled={downloading || queueRunning}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-white transition hover:bg-white/10 disabled:opacity-50"
                    >
                      <div>
                        <span className="font-semibold">{item.symbol}</span>
                        <span className="ml-2 text-xs text-gray-400">{item.name}</span>
                      </div>
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">{item.category}</span>
                    </button>
                  ))}
                </div>
              </div>

              {downloadQueue.length > 0 && (
                <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Download Queue</p>
                      <p className="text-xs text-gray-500">Runs sequentially with enforced delays.</p>
                    </div>
                    <button
                      onClick={handleClearQueue}
                      disabled={queueRunning}
                      className="text-xs font-semibold text-gray-400 hover:text-white disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {downloadQueue.map((item) => (
                      <div key={item.id} className="rounded-lg border border-gray-800/60 bg-gray-950/60 p-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold text-white">{item.symbol.toUpperCase()}</span>
                          <span
                            className={`text-xs font-semibold ${
                              item.status === "success"
                                ? "text-emerald-400"
                                : item.status === "error"
                                ? "text-rose-400"
                                : item.status === "downloading"
                                ? "text-white"
                                : "text-gray-400"
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                        {item.startDate && item.endDate ? (
                          <p className="text-xs text-gray-400">
                            {item.startDate} → {item.endDate}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-400">Period: {item.period}</p>
                        )}
                        {item.message && <p className="mt-1 text-xs text-gray-300">{item.message}</p>}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="h-2 rounded-full bg-gray-800">
                      <div
                        className="h-2 rounded-full bg-white transition-all"
                        style={{ width: `${Math.min(100, Math.round(queueProgress * 100))}%` }}
                      />
                    </div>
                    <button
                      onClick={handleRunQueue}
                      disabled={queueRunning || downloadQueue.every((item) => item.status === "success")}
                      className="w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {queueRunning ? "Processing Queue…" : "Start Download Queue"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DatasetPlaceholderIcon() {
  return (
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-white/80">
      <svg
        className="h-7 w-7"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M4 12h16" />
        <path d="M12 4v16" />
      </svg>
    </div>
  );
}
