"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
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

interface DatasetPreview {
  head: Array<Record<string, string | number | boolean | null>>;
  tail: Array<Record<string, string | number | boolean | null>>;
  total_rows: number;
  columns: string[];
  series?: { timestamp: number; close: number }[];
}

interface DataSetProfile {
  id: number;
  datasetName: string;
  displayName: string;
  startIndex: number;
  endIndex: number;
  startTimestamp: number;
  endTimestamp: number;
  startDate: string;
  endDate: string;
  initialEquity: number;
  createdAt: string;
}

const FULL_SERIES_SAMPLE = -1;

function DataSelectionPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading: authLoading } = useRequireAuth();
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DatasetPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [zoomReady, setZoomReady] = useState(false);
  const chartRef = useRef<ChartJS<"line">>(null);

  // Marker state
  const [startMarkerIndex, setStartMarkerIndex] = useState<number | null>(null);
  const [endMarkerIndex, setEndMarkerIndex] = useState<number | null>(null);

  // Profile state
  const [initialEquity, setInitialEquity] = useState<number>(10000);
  const [savedProfiles, setSavedProfiles] = useState<DataSetProfile[]>([]);
  const [showSavedProfiles, setShowSavedProfiles] = useState(true);
  const [activeProfileId, setActiveProfileId] = useState<number | null>(null);
  const [loadedProfileId, setLoadedProfileId] = useState<number | null>(null);

  // Portfolio selection state
  const [usePortfolio, setUsePortfolio] = useState(false);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null);
  const [portfolios, setPortfolios] = useState<any[]>([]);

  // Mini preview cache for dataset list
  const [datasetPreviews, setDatasetPreviews] = useState<Record<string, DatasetPreview>>({});
  const datasetPreviewsRef = useRef<Record<string, DatasetPreview>>({});
  const previewLoadingRef = useRef(false);

  const isDashboardEntry = searchParams.get("entry") === "dashboard";

  useEffect(() => {
    if (typeof window === "undefined" || authLoading) return;
    const storedProfiles = window.localStorage.getItem("priorsystems:data-profiles");
    const storedActive = window.localStorage.getItem("priorsystems:active-profile");
    const storedSelected = window.localStorage.getItem("priorsystems:selected-dataset");

    if (!storedProfiles && !storedActive && !storedSelected) return;

    const migrate = async () => {
      try {
        const profiles: DataSetProfile[] = storedProfiles ? JSON.parse(storedProfiles) : [];
        const activeProfile: DataSetProfile | null = storedActive ? JSON.parse(storedActive) : null;

        if (activeProfile) {
          const res = await apiFetch("/dataset-profiles", {
            method: "POST",
            body: JSON.stringify({
              datasetName: activeProfile.datasetName,
              displayName: activeProfile.displayName,
              startIndex: activeProfile.startIndex,
              endIndex: activeProfile.endIndex,
              startTimestamp: activeProfile.startTimestamp,
              endTimestamp: activeProfile.endTimestamp,
              startDate: activeProfile.startDate,
              endDate: activeProfile.endDate,
              initialEquity: activeProfile.initialEquity,
            }),
          });
          if (res.ok) {
            const saved = (await res.json()) as DataSetProfile;
            await apiFetch("/user-settings/active-profile-id", {
              method: "PUT",
              body: JSON.stringify({ key: "active-profile-id", value: saved.id }),
            });
            await apiFetch("/user-settings/selected-dataset", {
              method: "PUT",
              body: JSON.stringify({ key: "selected-dataset", value: saved.datasetName }),
            });
          }
        }

        const remaining = profiles.filter((p) => !activeProfile || p.datasetName !== activeProfile.datasetName);
        for (const profile of remaining) {
          await apiFetch("/dataset-profiles", {
            method: "POST",
            body: JSON.stringify({
              datasetName: profile.datasetName,
              displayName: profile.displayName,
              startIndex: profile.startIndex,
              endIndex: profile.endIndex,
              startTimestamp: profile.startTimestamp,
              endTimestamp: profile.endTimestamp,
              startDate: profile.startDate,
              endDate: profile.endDate,
              initialEquity: profile.initialEquity,
            }),
          });
        }
      } catch (error) {
        console.error("Failed to migrate local profiles:", error);
      } finally {
        window.localStorage.removeItem("priorsystems:data-profiles");
        window.localStorage.removeItem("priorsystems:active-profile");
        window.localStorage.removeItem("priorsystems:selected-dataset");
      }
    };

    migrate();
  }, [authLoading]);

  const selectedDatasetInfo = useMemo(
    () => datasets.find((dataset) => dataset.name === selectedDataset) || null,
    [datasets, selectedDataset],
  );

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

  const loadSavedProfiles = useCallback(() => {
    apiFetch("/dataset-profiles")
      .then((res) => res.json())
      .then((data) => setSavedProfiles(data.profiles || []))
      .catch((error) => {
        console.error("Failed to load saved profiles:", error);
      });
  }, []);

  useEffect(() => {
    if (authLoading) return;
    loadDatasets();
    loadSavedProfiles();

    // Load portfolios
    apiFetch("/portfolios?context=builder")
      .then((res) => res.json())
      .then((data) => {
        setPortfolios(data.portfolios || []);
      })
      .catch((error) => {
        console.error("Failed to load portfolios:", error);
      });
  }, [authLoading, loadDatasets, loadSavedProfiles]);

  useEffect(() => {
    let mounted = true;
    import("chartjs-plugin-zoom")
      .then((zoomPlugin) => {
        ChartJS.register(zoomPlugin.default);
        if (mounted) {
          setZoomReady(true);
        }
      })
      .catch((error) => {
        console.error("Failed to load zoom plugin:", error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    datasetPreviewsRef.current = datasetPreviews;
  }, [datasetPreviews]);

  useEffect(() => {
    if (datasets.length === 0 || previewLoadingRef.current) return;
    let cancelled = false;
    previewLoadingRef.current = true;

    const loadPreviews = async () => {
      for (const dataset of datasets) {
        if (cancelled) {
          previewLoadingRef.current = false;
          return;
        }
        if (datasetPreviewsRef.current[dataset.name]) continue;
        try {
          const res = await apiFetch(
            `/dataset-preview?name=${encodeURIComponent(dataset.name)}&limit=50&sample=120`,
          );
          const data = await res.json();
          if (!cancelled) {
            setDatasetPreviews((prev) => ({ ...prev, [dataset.name]: data }));
          }
        } catch (error) {
          console.error("Failed to fetch preview:", error);
        }
      }
      previewLoadingRef.current = false;
    };

    loadPreviews();
    return () => {
      cancelled = true;
      previewLoadingRef.current = false;
    };
  }, [datasets]);

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

  useEffect(() => {
    if (!isDashboardEntry) return;
    setUsePortfolio(false);
    setSelectedPortfolioId(null);
  }, [isDashboardEntry]);

  const handleSelectDataset = useCallback(async (datasetName: string) => {
    setSelectedDataset(datasetName);
    setLoadingPreview(true);
    setStartMarkerIndex(null);
    setEndMarkerIndex(null);

    try {
      const res = await apiFetch(
        `/dataset-preview?name=${encodeURIComponent(datasetName)}&limit=1000&sample=${FULL_SERIES_SAMPLE}`,
      );
      const data = await res.json();
      setPreviewData(data);
    } catch (error) {
      console.error("Failed to fetch preview:", error);
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  const resetMarkers = useCallback(() => {
    setStartMarkerIndex(null);
    setEndMarkerIndex(null);
    setLoadedProfileId(null); // Clear loaded profile when markers are reset
    // Force chart update
    if (chartRef.current) {
      chartRef.current.update();
    }
  }, []);

  const handleResetZoom = useCallback(() => {
    if (!zoomReady || !chartRef.current) return;
    chartRef.current.resetZoom();
  }, [zoomReady]);

  useEffect(() => {
    if (selectedDataset || datasets.length === 0) return;
    apiFetch("/user-settings/selected-dataset")
      .then((res) => res.json())
      .then((data) => {
        const stored = data.value as string | null;
        if (!stored) return;
        if (datasets.some((dataset) => dataset.name === stored)) {
          handleSelectDataset(stored);
        }
      })
      .catch(() => undefined);
  }, [datasets, selectedDataset, handleSelectDataset]);

  useEffect(() => {
    apiFetch("/user-settings/active-profile-id")
      .then((res) => res.json())
      .then((data) => {
        const value = data.value;
        if (typeof value === "number") {
          setActiveProfileId(value);
        }
      })
      .catch(() => undefined);
  }, []);

  const handleLoadProfile = useCallback((profile: DataSetProfile) => {
    // Find the dataset
    const dataset = datasets.find((d) => d.name === profile.datasetName);
    if (dataset) {
      setSelectedDataset(profile.datasetName);
      handleSelectDataset(profile.datasetName).then(() => {
        setStartMarkerIndex(profile.startIndex);
        setEndMarkerIndex(profile.endIndex);
        setInitialEquity(profile.initialEquity);
        setLoadedProfileId(profile.id);
      });
    }
  }, [datasets, handleSelectDataset]);

  const handleDeleteProfile = useCallback(async (profileId: number, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent loading the profile when clicking delete

    if (!confirm("Are you sure you want to delete this profile?")) {
      return;
    }

    try {
      const res = await apiFetch(`/dataset-profiles/${profileId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to delete profile");
      }

      // Update local state
      setSavedProfiles((prev) => prev.filter((p) => p.id !== profileId));

      // If this was the active profile, clear it
      if (activeProfileId === profileId) {
        setActiveProfileId(null);
      }
    } catch (error) {
      console.error("Failed to delete profile:", error);
      alert("Failed to delete profile. Please try again.");
    }
  }, [activeProfileId]);

  useEffect(() => {
    if (!activeProfileId || savedProfiles.length === 0) return;
    const profile = savedProfiles.find((item) => item.id === activeProfileId);
    if (profile) {
      handleLoadProfile(profile);
    }
  }, [activeProfileId, savedProfiles, handleLoadProfile]);

  const handleSaveAndContinue = async () => {
    if (!selectedDataset || startMarkerIndex === null || endMarkerIndex === null || previewSeries.length === 0) {
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

    // If we loaded an existing profile, just navigate to backtest without saving
    if (loadedProfileId !== null) {
      try {
        await apiFetch("/user-settings/active-profile-id", {
          method: "PUT",
          body: JSON.stringify({ key: "active-profile-id", value: loadedProfileId }),
        });
        await apiFetch("/user-settings/selected-dataset", {
          method: "PUT",
          body: JSON.stringify({ key: "selected-dataset", value: selectedDataset }),
        });
        router.push("/backtest");
      } catch (error) {
        console.error("Failed to set active profile:", error);
        alert("Failed to load profile. Please try again.");
      }
      return;
    }

    const startPoint = previewSeries[startMarkerIndex];
    const endPoint = previewSeries[endMarkerIndex];
    if (!startPoint || !endPoint) {
      alert("Invalid range selection. Please select the dataset and try again.");
      return;
    }
    const startDate = new Date(startPoint.timestamp).toISOString().slice(0, 10);
    const endDate = new Date(endPoint.timestamp).toISOString().slice(0, 10);

    try {
      const res = await apiFetch("/dataset-profiles", {
        method: "POST",
        body: JSON.stringify({
          datasetName: selectedDataset,
          displayName: selectedDatasetInfo?.display_name || selectedDatasetInfo?.symbol || selectedDataset,
          startIndex: startMarkerIndex,
          endIndex: endMarkerIndex,
          startTimestamp: startPoint.timestamp,
          endTimestamp: endPoint.timestamp,
          startDate,
          endDate,
          initialEquity,
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Failed to save profile");
      }
      const profile = (await res.json()) as DataSetProfile;
      setSavedProfiles((prev) => [profile, ...prev.filter((item) => item.id !== profile.id)].slice(0, 20));
      await apiFetch("/user-settings/active-profile-id", {
        method: "PUT",
        body: JSON.stringify({ key: "active-profile-id", value: profile.id }),
      });
      await apiFetch("/user-settings/selected-dataset", {
        method: "PUT",
        body: JSON.stringify({ key: "selected-dataset", value: selectedDataset }),
      });
      router.push("/backtest");
    } catch (error) {
      console.error("Failed to save profile:", error);
      alert("Failed to save profile. Please try again.");
    }
  };

  const handleChartClick = (_event: any, chartElements: any[]) => {
    if (!previewData || loadingPreview || !chartElements || chartElements.length === 0) {
      return;
    }

    // Get the clicked data point index
    const index = chartElements[0].index;

    if (index < 0 || index >= previewSeries.length) return;

    // Clear loaded profile when manually placing markers
    setLoadedProfileId(null);

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

    // Force chart update to redraw markers
    setTimeout(() => {
      if (chartRef.current) {
        chartRef.current.update('none');
      }
    }, 0);
  };

  const previewSeries = useMemo(() => {
    if (!previewData) return [];
    // Use series data if available (full dataset)
    if (previewData.series && previewData.series.length > 0) {
      return previewData.series;
    }
    // Fallback: combine head and tail if series not available
    // Note: This fallback should rarely be used since we request full series
    const allRows = [...(previewData.head || []), ...(previewData.tail || [])];
    return allRows
      .map((row, index) => {
        const rawTs = row.timestamp ?? row.date ?? row.Date ?? index;
        const tsNum =
          typeof rawTs === "number"
            ? rawTs
            : Number.isFinite(Number(rawTs))
              ? Number(rawTs)
              : Date.parse(String(rawTs));
        const closeVal = row.close ?? row.Close ?? 0;
        const closeNum = typeof closeVal === "number" ? closeVal : Number(closeVal);
        return {
          timestamp: Number.isFinite(tsNum) ? tsNum : index,
          close: Number.isFinite(closeNum) ? closeNum : 0,
        };
      })
      .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.close));
  }, [previewData]);

  const formatMarkerDate = useCallback(
    (index: number | null) => {
      if (index === null) return "Not placed";
      const point = previewSeries[index];
      if (!point || !Number.isFinite(point.timestamp)) return "Not placed";
      const date = new Date(point.timestamp);
      if (Number.isNaN(date.getTime())) return "Not placed";
      return date.toISOString().slice(0, 10);
    },
    [previewSeries],
  );

  const chartData = useMemo(() => {
    if (previewSeries.length === 0) return null;

    const pointBackgroundColor = previewSeries.map((_, i) => {
      if (i === startMarkerIndex) return "#3b82f6";
      if (i === endMarkerIndex) return "#ef4444";
      return "#10b981";
    });

    const pointRadius = previewSeries.map((_, i) => {
      if (i === startMarkerIndex || i === endMarkerIndex) return 8;
      return 0;
    });

    return {
      datasets: [
        {
          label: "Close Price",
          data: previewSeries.map((point) => ({ x: point.timestamp, y: point.close })),
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
  }, [previewSeries, startMarkerIndex, endMarkerIndex]);


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
              if (!previewSeries[index]) return "";
              const date = new Date(previewSeries[index].timestamp).toISOString().slice(0, 10);
              let marker = "";
              if (index === startMarkerIndex) marker = " [START]";
              if (index === endMarkerIndex) marker = " [END]";
              return `${date} | $${value.toFixed(2)}${marker}`;
            },
          },
        },
        ...(zoomReady
          ? {
              zoom: {
                zoom: {
                  wheel: {
                    enabled: true,
                  },
                  pinch: {
                    enabled: true,
                  },
                  mode: "x" as const,
                },
                pan: {
                  enabled: true,
                  mode: "x" as const,
                  modifierKey: "shift" as const,
                },
                limits: {
                  x: { min: "original" as const, max: "original" as const },
                },
              },
            }
          : {}),
      },
      scales: {
        x: {
          display: true,
          type: "linear" as const,
          grid: { color: "#1f2937" },
          min: previewSeries.length > 0 ? previewSeries[0].timestamp : undefined,
          max: previewSeries.length > 0 ? previewSeries[previewSeries.length - 1].timestamp : undefined,
          title: {
            display: true,
            text: "Date",
            color: "#9ca3af",
            font: { size: 12, weight: "bold" as const },
          },
          ticks: {
            color: "#9ca3af",
            maxTicksLimit: 8,
            autoSkip: true,
            maxRotation: 45,
            minRotation: 0,
            callback: function(value: string | number) {
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
            color: "#9ca3af",
            font: { size: 12, weight: "bold" as const },
          },
          grid: { color: "#1f2937" },
          ticks: { color: "#9ca3af" },
        },
      },
    };
  }, [handleChartClick, previewSeries, startMarkerIndex, endMarkerIndex, zoomReady]);

  const getDatasetName = (dataset: DatasetInfo) =>
    dataset.display_name || dataset.symbol || dataset.name;

  const getDatasetRange = (dataset: DatasetInfo) =>
    dataset.date_range_label ||
    (dataset.start_label && dataset.end_label
      ? `${dataset.start_label} → ${dataset.end_label}`
      : "");

  if (authLoading) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-gray-400">Loading datasets...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <nav className="border-b border-white/5 backdrop-blur-sm bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-white-full.svg" alt="Prior Systems" className="h-12 w-auto" />
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
                  const preview = datasetPreviews[dataset.name];
                  const previewPoints =
                    preview?.series && preview.series.length > 0
                      ? preview.series.map((point) => point.close)
                      : preview?.head?.map((row) => row.close || row.Close || 0) || [];
                  return (
                    <div key={dataset.name} className="relative">
                      <button
                        onClick={() => handleSelectDataset(dataset.name)}
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

                        {/* Mini chart preview */}
                        {previewPoints.length > 0 && (
                          <div className="mt-2 h-16 bg-black/50 rounded-md p-1 border border-gray-700/50">
                            <Line
                              data={{
                                labels: previewPoints.map((_, i) => i),
                                datasets: [
                                  {
                                    label: "Close",
                                    data: previewPoints,
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
                        {previewPoints.length === 0 && (
                          <div className="mt-2 h-16 bg-black/50 rounded-md p-1 border border-gray-700/50 flex items-center justify-center">
                            <span className="text-[10px] text-gray-500">Loading preview...</span>
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
                  <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-hide">
                    {savedProfiles.map((profile) => (
                      <div
                        key={profile.id}
                        className="relative group"
                      >
                        <button
                          onClick={() => handleLoadProfile(profile)}
                          className="w-full p-3 rounded-lg border border-gray-800/50 bg-gray-950/50 hover:bg-gray-900/50 text-left transition-all"
                        >
                          <p className="text-sm text-white font-medium pr-6">{profile.displayName}</p>
                          <p className="text-xs text-gray-400">{profile.startDate} → {profile.endDate}</p>
                          <p className="text-xs text-gray-500">Equity: ${profile.initialEquity.toLocaleString()}</p>
                        </button>
                        <button
                          onClick={(e) => handleDeleteProfile(profile.id, e)}
                          className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-full bg-gray-800/80 hover:bg-red-600 text-gray-400 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                          title="Delete profile"
                        >
                          ✕
                        </button>
                      </div>
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
                <div className="flex items-center gap-3">
                  {zoomReady && (
                    <button
                      onClick={handleResetZoom}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      Reset Zoom
                    </button>
                  )}
                  {(startMarkerIndex !== null || endMarkerIndex !== null) && (
                    <button
                      onClick={resetMarkers}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      Reset Markers
                    </button>
                  )}
                </div>
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
                <div>
                  <div className="h-96 bg-black/30 rounded-lg p-4">
                    <Line
                      key={selectedDataset}
                      ref={chartRef}
                      data={chartData}
                      options={chartOptions}
                    />
                  </div>
                  {/* Marker Instruction */}
                  <div className="mt-2 flex items-center justify-center gap-2 text-sm">
                    {startMarkerIndex === null ? (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-950 border border-blue-800">
                        <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                        <span className="text-blue-300 font-semibold">Click to place START marker</span>
                      </div>
                    ) : endMarkerIndex === null ? (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-950 border border-red-800">
                        <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse"></div>
                        <span className="text-red-300 font-semibold">Click to place END marker</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={resetMarkers}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-950 border border-green-800 hover:bg-green-900/70 transition"
                      >
                        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-green-300 font-semibold">Markers placed • Click to reset</span>
                      </button>
                    )}
                  </div>
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
                    {formatMarkerDate(startMarkerIndex)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-red-950/20 border border-red-900/30">
                  <p className="text-xs text-red-400 mb-1">End Marker</p>
                  <p className="text-sm text-white font-medium">
                    {formatMarkerDate(endMarkerIndex)}
                  </p>
                </div>
              </div>
            </div>

            {/* Configuration */}
            <div className="rounded-xl border border-gray-800/50 bg-gray-900/40 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Initial Configuration</h3>

              <div className="space-y-4">
                {!isDashboardEntry && (
                  <>
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
                          onChange={(e) => setSelectedPortfolioId(Number(e.target.value))}
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
                  </>
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
                    {loadedProfileId !== null ? "Start Backtesting" : "Save Profile & Continue to Backtest"}
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

export default function DataSelectionPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    }>
      <DataSelectionPageContent />
    </Suspense>
  );
}
