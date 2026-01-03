'use client'

/**
 * Demo/Test component for CandlestickChart
 * Use this to verify the chart works before integration
 */

import { useState } from 'react'
import CandlestickChart from './CandlestickChart'
import CrosshairTooltip from './CrosshairTooltip'
import ChartControls from './ChartControls'
import { ChartType, OHLCData, CrosshairData, VolumeData } from './types'
import { formatChartTime } from './utils'

// Generate sample data for testing
function generateSampleData(bars: number = 100): { ohlc: OHLCData[], volume: VolumeData[] } {
  const ohlc: OHLCData[] = []
  const volume: VolumeData[] = []

  let price = 150
  const startTime = Math.floor(Date.now() / 1000) - (bars * 86400) // bars days ago

  for (let i = 0; i < bars; i++) {
    const time = startTime + (i * 86400) // Daily bars

    // Random walk with trend
    const change = (Math.random() - 0.48) * 5 // Slight upward bias
    price = Math.max(100, price + change)

    const open = price
    const close = price + (Math.random() - 0.5) * 4
    const high = Math.max(open, close) + Math.random() * 2
    const low = Math.min(open, close) - Math.random() * 2

    ohlc.push({ time, open, high, low, close })

    // Volume
    const vol = Math.floor(50000 + Math.random() * 100000)
    volume.push({ time, value: vol })
  }

  return { ohlc, volume }
}

export default function ChartDemo() {
  const [chartType, setChartType] = useState<ChartType>('candlestick')
  const [crosshairData, setCrosshairData] = useState<CrosshairData | null>(null)

  const { ohlc, volume } = generateSampleData(100)

  const handleCrosshairMove = (data: CrosshairData | null) => {
    setCrosshairData(data)
  }

  const handleChartClick = (time: number, price: number, index: number) => {
    console.log('Clicked:', { time: formatChartTime(time), price, index })
  }

  return (
    <div className="p-8 bg-black min-h-screen">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">
          TradingView Lightweight Charts Demo
        </h1>
        <p className="text-gray-400 mb-6">
          Professional candlestick charts with crosshair and volume panel
        </p>

        <ChartControls
          chartType={chartType}
          onChartTypeChange={setChartType}
          showTimeframeSelector={false}
        />

        <div className="relative">
          <CandlestickChart
            data={ohlc}
            volumeData={volume}
            chartType={chartType}
            theme="dark"
            height={600}
            onCrosshairMove={handleCrosshairMove}
            onClick={handleChartClick}
            showVolume={true}
          />
          <CrosshairTooltip data={crosshairData} position="top-left" />
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4 text-white">
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="text-gray-400 text-sm mb-1">Chart Type</div>
            <div className="text-xl font-bold capitalize">{chartType}</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="text-gray-400 text-sm mb-1">Data Points</div>
            <div className="text-xl font-bold">{ohlc.length}</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="text-gray-400 text-sm mb-1">Current Price</div>
            <div className="text-xl font-bold text-green-400">
              ${ohlc[ohlc.length - 1].close.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
