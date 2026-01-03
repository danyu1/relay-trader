# Prior Systems - Professional Charting Upgrade Plan

## Executive Summary

After comprehensive research of TradingView and NinjaTrader platforms, this document outlines a strategic plan to upgrade Prior Systems' charting capabilities to professional trading platform standards.

**Goal:** Transform the current Chart.js line charts into professional-grade financial charts with candlestick data, crosshair functionality, and interactive controls.

**Recommended Library:** TradingView Lightweight Charts (Apache 2.0, free)

---

## Research Findings Summary

### What Professional Platforms Have That We're Missing

#### 1. **Candlestick Charts (CRITICAL)**
- Industry standard for financial data visualization
- Shows OHLC (Open, High, Low, Close) in single visual element
- Color-coded: Green for bullish, Red for bearish
- Provides more information than line charts at a glance

#### 2. **Professional Crosshair**
- Follows mouse cursor with horizontal and vertical lines
- Displays exact OHLC values at cursor position
- Shows precise time and price coordinates
- Magnetic snapping to nearest data point

#### 3. **Volume Bars**
- Separate panel below main chart
- Color-coded to match price direction
- Essential for confirming price movements

#### 4. **Interactive Controls**
- Smooth zoom (mouse wheel)
- Pan (click and drag)
- Timeframe switching (1m, 5m, 1h, 1D)
- Chart type toggle (line vs candlestick)

#### 5. **Clean Dark Mode UI**
- Deep black/dark gray background (#0D0D0D)
- Subtle grid lines (#2A2A2A)
- Professional color scheme
- Minimal chrome, maximum chart space

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

#### 1.1 Backend: OHLC Data Structure

**Current State:**
- CSV data with Close prices only
- No OHLC structure in database

**Target State:**
```python
# backend/relaytrader/models/dataset.py
class OHLCBar(BaseModel):
    """OHLC candlestick data"""
    timestamp: int  # Unix milliseconds
    open: float
    high: float
    low: float
    close: float
    volume: int
```

**Implementation Steps:**

1. **Modify CSV ingestion to extract OHLC**
   - File: `backend/relaytrader/api/routes/data.py`
   - Parse CSV columns: Date, Open, High, Low, Close, Volume
   - Store full OHLC data instead of just Close

2. **Create new API endpoint**
   ```python
   @router.get("/datasets/{dataset_id}/ohlc")
   async def get_ohlc_data(
       dataset_id: int,
       timeframe: str = "1D",  # 1m, 5m, 15m, 1h, 4h, 1D
       start_bar: int = 0,
       max_bars: int = 1000
   ):
       """Return OHLC candlestick data"""
       # Query database for OHLC bars
       # Apply timeframe aggregation if needed
       # Return in Lightweight Charts format
       pass
   ```

3. **Timeframe aggregation logic**
   - For 1-minute data aggregated to 5-minute:
     - Open = first bar's open
     - High = max of all highs
     - Low = min of all lows
     - Close = last bar's close
     - Volume = sum of all volumes

**Files to Modify:**
- `backend/relaytrader/api/routes/data.py`
- `backend/relaytrader/core/database.py` (new OHLC table schema)
- `backend/relaytrader/models/dataset.py`

---

#### 1.2 Frontend: Install TradingView Lightweight Charts

**Installation:**
```bash
cd frontend
npm install lightweight-charts --save
npm install --save-dev @types/lightweight-charts  # TypeScript types
```

**Why Lightweight Charts:**
- ✅ **Free & Open Source** (Apache 2.0 license)
- ✅ **Fastest performance** (Canvas-based, not SVG)
- ✅ **Professional appearance** (used by TradingView)
- ✅ **Mobile-friendly**
- ✅ **TypeScript support**
- ✅ **Active development** (regular updates)
- ✅ **Small bundle size** (45KB gzipped)
- ✅ **Multi-pane support** (volume panel)

**Comparison vs Current Chart.js:**
| Feature | Chart.js | Lightweight Charts |
|---------|----------|-------------------|
| Candlestick support | Plugin required | Native |
| Performance (10K bars) | Slower | Faster (60fps) |
| Financial features | Limited | Extensive |
| Crosshair | Basic | Professional |
| File size | ~200KB | ~45KB |
| Built for finance | No | Yes |

---

#### 1.3 Frontend: Create Candlestick Chart Component

**New Component Structure:**
```
frontend/app/components/charts/
├── ProfessionalChart.tsx         # Main wrapper component
├── CandlestickChart.tsx          # Core chart logic
├── ChartControls.tsx             # Timeframe/type selectors
├── CrosshairTooltip.tsx          # OHLC display on hover
└── types.ts                      # TypeScript interfaces
```

**Core Implementation:**

```typescript
// frontend/app/components/charts/CandlestickChart.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts'

interface OHLCData {
  time: number
  open: number
  high: number
  low: number
  close: number
}

interface VolumeData {
  time: number
  value: number
  color: string
}

interface CandlestickChartProps {
  data: OHLCData[]
  volumeData: VolumeData[]
  chartType: 'candlestick' | 'line' | 'area'
  theme: 'dark' | 'light'
  onCrosshairMove?: (data: OHLCData | null) => void
  onClick?: (time: number, price: number) => void
}

export default function CandlestickChart({
  data,
  volumeData,
  chartType = 'candlestick',
  theme = 'dark',
  onCrosshairMove,
  onClick
}: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 600,
      layout: {
        background: { color: theme === 'dark' ? '#0D0D0D' : '#FFFFFF' },
        textColor: theme === 'dark' ? '#D9D9D9' : '#191919',
      },
      grid: {
        vertLines: { color: theme === 'dark' ? '#2A2A2A' : '#E6E6E6' },
        horzLines: { color: theme === 'dark' ? '#2A2A2A' : '#E6E6E6' },
      },
      crosshair: {
        mode: 1, // Magnet mode
        vertLine: {
          color: '#888888',
          width: 1,
          style: 0, // Solid
          labelBackgroundColor: '#888888',
        },
        horzLine: {
          color: '#888888',
          width: 1,
          style: 0,
          labelBackgroundColor: '#888888',
        },
      },
      rightPriceScale: {
        borderColor: theme === 'dark' ? '#2A2A2A' : '#E6E6E6',
      },
      timeScale: {
        borderColor: theme === 'dark' ? '#2A2A2A' : '#E6E6E6',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    chartRef.current = chart

    // Add candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26A69A',      // Green for bullish
      downColor: '#EF5350',    // Red for bearish
      borderUpColor: '#26A69A',
      borderDownColor: '#EF5350',
      wickUpColor: '#26A69A',
      wickDownColor: '#EF5350',
    })

    candlestickSeriesRef.current = candlestickSeries
    candlestickSeries.setData(data)

    // Add volume series (separate panel)
    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // Create separate price scale
    })

    volumeSeriesRef.current = volumeSeries
    volumeSeries.setData(volumeData)

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // Volume panel in bottom 20%
        bottom: 0,
      },
    })

    // Crosshair move handler
    chart.subscribeCrosshairMove((param) => {
      if (param.time && onCrosshairMove) {
        const data = param.seriesData.get(candlestickSeries) as OHLCData | undefined
        onCrosshairMove(data || null)
      } else if (onCrosshairMove) {
        onCrosshairMove(null)
      }
    })

    // Click handler
    chart.subscribeClick((param) => {
      if (param.time && param.point && onClick) {
        const price = candlestickSeries.coordinateToPrice(param.point.y)
        onClick(param.time as number, price)
      }
    })

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [theme])

  // Update data when it changes
  useEffect(() => {
    if (candlestickSeriesRef.current) {
      candlestickSeriesRef.current.setData(data)
    }
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(volumeData)
    }
  }, [data, volumeData])

  // Handle chart type changes
  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current) return

    // Remove old series
    chartRef.current.removeSeries(candlestickSeriesRef.current)

    // Add new series based on type
    if (chartType === 'candlestick') {
      const series = chartRef.current.addCandlestickSeries({
        upColor: '#26A69A',
        downColor: '#EF5350',
        borderUpColor: '#26A69A',
        borderDownColor: '#EF5350',
        wickUpColor: '#26A69A',
        wickDownColor: '#EF5350',
      })
      series.setData(data)
      candlestickSeriesRef.current = series as any
    } else if (chartType === 'line') {
      const series = chartRef.current.addLineSeries({
        color: '#2196F3',
        lineWidth: 2,
      })
      // Convert OHLC to line data (use close prices)
      const lineData = data.map(d => ({ time: d.time, value: d.close }))
      series.setData(lineData)
      candlestickSeriesRef.current = series as any
    } else if (chartType === 'area') {
      const series = chartRef.current.addAreaSeries({
        topColor: 'rgba(33, 150, 243, 0.4)',
        bottomColor: 'rgba(33, 150, 243, 0.0)',
        lineColor: '#2196F3',
        lineWidth: 2,
      })
      const lineData = data.map(d => ({ time: d.time, value: d.close }))
      series.setData(lineData)
      candlestickSeriesRef.current = series as any
    }
  }, [chartType, data])

  return (
    <div
      ref={chartContainerRef}
      className="relative w-full"
      style={{ height: '600px' }}
    />
  )
}
```

---

### Phase 2: Interactive Features (Week 2)

#### 2.1 Crosshair Tooltip with OHLC Display

**Component:**
```typescript
// frontend/app/components/charts/CrosshairTooltip.tsx
interface CrosshairTooltipProps {
  data: {
    time: string
    open: number
    high: number
    low: number
    close: number
    volume: number
  } | null
}

export default function CrosshairTooltip({ data }: CrosshairTooltipProps) {
  if (!data) return null

  const change = data.close - data.open
  const changePercent = (change / data.open) * 100
  const isPositive = change >= 0

  return (
    <div className="absolute top-4 left-4 bg-gray-900/95 border border-gray-700 rounded-lg p-3 text-xs font-mono z-10">
      <div className="flex items-center gap-4 mb-2">
        <span className="text-gray-400">{data.time}</span>
        <span className={isPositive ? 'text-green-400' : 'text-red-400'}>
          {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div>
          <span className="text-gray-500">O</span>
          <span className="text-white ml-2">${data.open.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-gray-500">H</span>
          <span className="text-white ml-2">${data.high.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-gray-500">L</span>
          <span className="text-white ml-2">${data.low.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-gray-500">C</span>
          <span className="text-white ml-2">${data.close.toFixed(2)}</span>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-gray-700">
        <span className="text-gray-500">Vol</span>
        <span className="text-white ml-2">{(data.volume / 1000).toFixed(1)}K</span>
      </div>
    </div>
  )
}
```

#### 2.2 Chart Controls

**Component:**
```typescript
// frontend/app/components/charts/ChartControls.tsx
interface ChartControlsProps {
  chartType: 'candlestick' | 'line' | 'area'
  onChartTypeChange: (type: 'candlestick' | 'line' | 'area') => void
  timeframe: string
  onTimeframeChange: (tf: string) => void
}

export default function ChartControls({
  chartType,
  onChartTypeChange,
  timeframe,
  onTimeframeChange
}: ChartControlsProps) {
  const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M']

  return (
    <div className="flex items-center gap-4 mb-4">
      {/* Chart Type Toggle */}
      <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-1">
        <button
          onClick={() => onChartTypeChange('candlestick')}
          className={`px-3 py-1.5 rounded text-xs font-medium transition ${
            chartType === 'candlestick'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
          title="Candlestick Chart"
        >
          📊 Candles
        </button>
        <button
          onClick={() => onChartTypeChange('line')}
          className={`px-3 py-1.5 rounded text-xs font-medium transition ${
            chartType === 'line'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
          title="Line Chart"
        >
          📈 Line
        </button>
        <button
          onClick={() => onChartTypeChange('area')}
          className={`px-3 py-1.5 rounded text-xs font-medium transition ${
            chartType === 'area'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
          title="Area Chart"
        >
          📉 Area
        </button>
      </div>

      {/* Timeframe Selector */}
      <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-1">
        {timeframes.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`px-2.5 py-1.5 rounded text-xs font-medium transition ${
              timeframe === tf
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>
    </div>
  )
}
```

---

### Phase 3: Integration (Week 2-3)

#### 3.1 Replace Chart.js in Backtest Page

**File:** `frontend/app/backtest/page.tsx`

**Changes:**
1. Remove Chart.js import and usage
2. Import new CandlestickChart component
3. Fetch OHLC data from new endpoint
4. Pass data to CandlestickChart

**Before (lines ~1000-1100):**
```typescript
import { Line } from 'react-chartjs-2'
// ... Chart.js configuration
```

**After:**
```typescript
import CandlestickChart from '@/components/charts/CandlestickChart'
import ChartControls from '@/components/charts/ChartControls'
import CrosshairTooltip from '@/components/charts/CrosshairTooltip'

// State for chart
const [chartType, setChartType] = useState<'candlestick' | 'line' | 'area'>('candlestick')
const [timeframe, setTimeframe] = useState('1D')
const [ohlcData, setOhlcData] = useState<OHLCData[]>([])
const [volumeData, setVolumeData] = useState<VolumeData[]>([])
const [crosshairData, setCrosshairData] = useState<OHLCData | null>(null)

// Fetch OHLC data
useEffect(() => {
  if (csvPath) {
    fetchOHLCData(csvPath, timeframe)
  }
}, [csvPath, timeframe])

const fetchOHLCData = async (path: string, tf: string) => {
  const res = await fetch(`/api/datasets/ohlc?path=${path}&timeframe=${tf}`)
  const data = await res.json()
  setOhlcData(data.ohlc)
  setVolumeData(data.volume)
}

// Render
<div className="relative">
  <ChartControls
    chartType={chartType}
    onChartTypeChange={setChartType}
    timeframe={timeframe}
    onTimeframeChange={setTimeframe}
  />
  <CandlestickChart
    data={ohlcData}
    volumeData={volumeData}
    chartType={chartType}
    theme="dark"
    onCrosshairMove={setCrosshairData}
    onClick={handleChartClick}
  />
  <CrosshairTooltip data={crosshairData} />
</div>
```

#### 3.2 Update Live Prices Page

**File:** `frontend/app/live-prices/page.tsx`

Similar integration, but with real-time price updates:

```typescript
// Update OHLC data on price refresh
const updateLastCandle = (newPrice: number) => {
  setOhlcData(prev => {
    const updated = [...prev]
    const last = updated[updated.length - 1]
    if (last) {
      last.close = newPrice
      last.high = Math.max(last.high, newPrice)
      last.low = Math.min(last.low, newPrice)
    }
    return updated
  })
}
```

---

### Phase 4: Advanced Features (Week 3-4)

#### 4.1 Technical Indicator Overlays

**Implementation:**
```typescript
// Add indicator series to chart
const addIndicator = (type: 'SMA' | 'EMA' | 'Bollinger') => {
  if (!chartRef.current) return

  if (type === 'SMA') {
    const smaSeries = chartRef.current.addLineSeries({
      color: '#2196F3',
      lineWidth: 2,
      title: 'SMA(20)',
    })

    const smaData = calculateSMA(ohlcData, 20)
    smaSeries.setData(smaData)
  }
  // Similar for EMA, Bollinger, etc.
}

const calculateSMA = (data: OHLCData[], period: number) => {
  const result = []
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1)
    const sum = slice.reduce((acc, d) => acc + d.close, 0)
    const avg = sum / period
    result.push({ time: data[i].time, value: avg })
  }
  return result
}
```

#### 4.2 Drawing Tools

**Basic Implementation:**
- Horizontal line tool (support/resistance)
- Trend line tool
- Fibonacci retracement

**State Management:**
```typescript
const [drawingMode, setDrawingMode] = useState<'none' | 'horizontal' | 'trend' | 'fib'>('none')
const [drawings, setDrawings] = useState<Drawing[]>([])

interface Drawing {
  type: 'horizontal' | 'trend' | 'fib'
  points: { time: number; price: number }[]
  color: string
}
```

**Rendering:**
```typescript
// Use Lightweight Charts price lines and shapes API
const addHorizontalLine = (price: number) => {
  if (!candlestickSeriesRef.current) return

  const priceLine = candlestickSeriesRef.current.createPriceLine({
    price,
    color: '#2196F3',
    lineWidth: 2,
    lineStyle: 2, // Dashed
    axisLabelVisible: true,
    title: 'Resistance',
  })

  return priceLine
}
```

---

## Migration Strategy

### Option 1: Big Bang (Recommended for MVP)
- Replace Chart.js completely in one PR
- Migrate all pages at once
- Faster to implement
- Cleaner codebase

### Option 2: Gradual Migration
- Keep Chart.js for existing features
- Add Lightweight Charts for new candlestick views
- Migrate page by page
- Less risky but more complex

**Recommendation:** Option 1 (Big Bang)
- Lightweight Charts is superior in every way
- No reason to maintain both libraries
- Better user experience
- Cleaner code

---

## Performance Considerations

### Data Loading Strategy

**Problem:** Loading 100K+ candles at once is slow

**Solution: Lazy Loading**
```typescript
const [visibleRange, setVisibleRange] = useState({ from: 0, to: 1000 })

// Load more data when user scrolls
chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
  if (range && shouldLoadMore(range)) {
    loadMoreData(range)
  }
})

const loadMoreData = async (range: TimeRange) => {
  const newData = await fetchOHLCData(range.from, range.to)
  setOhlcData(prev => mergeSorted(prev, newData))
}
```

### Bundle Size Optimization

**Current:** Chart.js (~200KB) + plugins
**After:** Lightweight Charts (~45KB)
**Savings:** ~155KB reduction

---

## Testing Plan

### Unit Tests
```typescript
// tests/components/CandlestickChart.test.tsx
describe('CandlestickChart', () => {
  it('renders candlestick data correctly', () => {
    const data = [
      { time: 1000, open: 100, high: 110, low: 95, close: 105 }
    ]
    render(<CandlestickChart data={data} volumeData={[]} />)
    // Assertions
  })

  it('switches between chart types', () => {
    // Test candlestick -> line -> area transitions
  })

  it('handles crosshair move events', () => {
    // Test onCrosshairMove callback
  })
})
```

### Integration Tests
- Backtest page with candlestick chart
- Live prices with real-time updates
- Chart controls functionality
- Timeframe switching with data refetch

### Performance Tests
- Render 10,000 candles < 100ms
- Smooth 60fps zoom/pan
- No memory leaks on chart recreation

---

## Timeline & Milestones

### Week 1: Foundation
- [ ] Backend OHLC data structure (2 days)
- [ ] Backend API endpoint (1 day)
- [ ] Install Lightweight Charts (0.5 days)
- [ ] Basic candlestick component (2.5 days)

### Week 2: Features
- [ ] Crosshair tooltip (1 day)
- [ ] Chart controls (1 day)
- [ ] Integrate into backtest page (2 days)
- [ ] Volume panel styling (1 day)

### Week 3: Polish
- [ ] Dark mode theming (1 day)
- [ ] Integrate into live prices (2 days)
- [ ] Technical indicators (2 days)

### Week 4: Advanced
- [ ] Drawing tools (2 days)
- [ ] Performance optimization (1 day)
- [ ] Testing & bug fixes (2 days)

**Total Estimated Time:** 3-4 weeks for complete implementation

---

## Success Metrics

### Quantitative
- ✅ Render 10K+ candles at 60fps
- ✅ Bundle size reduction: ~155KB saved
- ✅ API response time: <200ms for OHLC data
- ✅ Zero Chart.js dependencies

### Qualitative
- ✅ Professional appearance matching TradingView
- ✅ Smooth, responsive interactions
- ✅ Intuitive crosshair and tooltips
- ✅ Clean dark mode aesthetic

### User Experience
- ✅ Users can switch between candles and lines
- ✅ OHLC data visible on hover
- ✅ Easy timeframe switching
- ✅ Professional trader look-and-feel

---

## Risks & Mitigations

### Risk 1: Data Migration Complexity
**Mitigation:** Write migration script to convert existing close-only data to OHLC format (fill OHLC with close price as fallback)

### Risk 2: Learning Curve with New Library
**Mitigation:** Lightweight Charts has excellent docs and examples. Budget 1 day for learning.

### Risk 3: Breaking Existing Features
**Mitigation:** Comprehensive testing. Keep Chart.js code in git history for reference.

### Risk 4: Performance Issues with Large Datasets
**Mitigation:** Implement lazy loading and data windowing from day 1.

---

## Cost-Benefit Analysis

### Costs
- **Development Time:** 3-4 weeks
- **Testing Time:** 1 week
- **Migration Risk:** Low (new library is well-documented)

### Benefits
- **Professional Appearance:** Matches industry leaders (TradingView, NinjaTrader)
- **Better UX:** Candlesticks show more information than lines
- **Performance:** Faster rendering, smaller bundle
- **Portfolio Value:** Makes project more impressive to recruiters
- **User Adoption:** 10+ current users get professional tools
- **Competitive Advantage:** Differentiates from basic backtesters

### ROI
**High** - This upgrade transforms Prior Systems from a "demo project" to a "professional trading platform"

---

## References & Resources

### Documentation
- [Lightweight Charts Docs](https://tradingview.github.io/lightweight-charts/)
- [Lightweight Charts Examples](https://tradingview.github.io/lightweight-charts/docs/examples)
- [GitHub Repository](https://github.com/tradingview/lightweight-charts)

### Tutorials
- [Building a Trading Chart with React](https://dev.to/tradingview/building-a-trading-chart-with-react-4ne7)
- [Candlestick Chart Tutorial](https://www.tradingview.com/HTML5-stock-forex-bitcoin-charting-library/)

### Inspiration
- [TradingView Charts](https://www.tradingview.com/)
- [NinjaTrader Charts](https://ninjatrader.com/charting)

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Get approval** for 3-4 week timeline
3. **Start with Phase 1** (Backend OHLC structure)
4. **Prototype** basic candlestick chart
5. **Iterate** based on user feedback

---

## Conclusion

This upgrade will transform Prior Systems from a good backtesting platform into a **professional-grade trading tool** that rivals TradingView and NinjaTrader in visual quality and user experience.

The investment of 3-4 weeks will:
- ✅ Make the platform more impressive for portfolio/recruiting
- ✅ Provide better tools for current users
- ✅ Differentiate from competitors
- ✅ Establish professional credibility

**Recommendation:** Proceed with implementation using TradingView Lightweight Charts.
