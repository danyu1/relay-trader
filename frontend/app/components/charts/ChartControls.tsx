'use client'

import { TbChartCandle, TbChartLine, TbChartArea } from 'react-icons/tb'
import { ChartType, Timeframe } from './types'

interface ChartControlsProps {
  chartType: ChartType
  onChartTypeChange: (type: ChartType) => void
  timeframe?: Timeframe
  onTimeframeChange?: (tf: Timeframe) => void
  showTimeframeSelector?: boolean
}

export default function ChartControls({
  chartType,
  onChartTypeChange,
  timeframe,
  onTimeframeChange,
  showTimeframeSelector = true,
}: ChartControlsProps) {
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M']

  return (
    <div className="flex items-center gap-4 mb-4 flex-wrap">
      {/* Chart Type Toggle */}
      <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800">
        <button
          onClick={() => onChartTypeChange('candlestick')}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 ${
            chartType === 'candlestick'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
          title="Candlestick Chart (Shows OHLC data)"
        >
          <TbChartCandle className="w-4 h-4" />
          Candles
        </button>
        <button
          onClick={() => onChartTypeChange('line')}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 ${
            chartType === 'line'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
          title="Line Chart (Close prices only)"
        >
          <TbChartLine className="w-4 h-4" />
          Line
        </button>
        <button
          onClick={() => onChartTypeChange('area')}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 ${
            chartType === 'area'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
          title="Area Chart (Filled line chart)"
        >
          <TbChartArea className="w-4 h-4" />
          Area
        </button>
      </div>

      {/* Timeframe Selector */}
      {showTimeframeSelector && onTimeframeChange && timeframe && (
        <>
          <div className="h-6 w-px bg-gray-700"></div>
          <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800">
            {timeframes.map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
                  timeframe === tf
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
                title={`Switch to ${tf} timeframe`}
              >
                {tf}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
