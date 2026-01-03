'use client'

import { CrosshairData } from './types'

interface CrosshairTooltipProps {
  data: CrosshairData | null
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

export default function CrosshairTooltip({ data, position = 'top-left' }: CrosshairTooltipProps) {
  if (!data) return null

  const change = data.close - data.open
  const changePercent = (change / data.open) * 100
  const isPositive = change >= 0

  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  }

  return (
    <div className={`absolute ${positionClasses[position]} bg-gray-900/95 border border-gray-700 rounded-lg p-3 text-xs font-mono z-10 shadow-xl pointer-events-none`}>
      {/* Header with time and change */}
      <div className="flex items-center gap-4 mb-2 pb-2 border-b border-gray-700">
        <span className="text-gray-400">{data.time}</span>
        <span className={`font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
        </span>
      </div>

      {/* OHLC Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">O</span>
          <span className="text-white ml-2 font-medium">${data.open.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">H</span>
          <span className="text-white ml-2 font-medium">${data.high.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">L</span>
          <span className="text-white ml-2 font-medium">${data.low.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">C</span>
          <span className={`ml-2 font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            ${data.close.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Volume if available */}
      {data.volume !== undefined && (
        <div className="mt-2 pt-2 border-t border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Vol</span>
            <span className="text-white ml-2 font-medium">
              {data.volume >= 1000000
                ? `${(data.volume / 1000000).toFixed(2)}M`
                : data.volume >= 1000
                ? `${(data.volume / 1000).toFixed(1)}K`
                : data.volume.toFixed(0)
              }
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
