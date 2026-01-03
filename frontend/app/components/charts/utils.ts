/**
 * Utility functions for chart data conversion and manipulation
 */

import { OHLCData, VolumeData } from './types'

/**
 * Convert close-only price data to OHLC format
 * This is a temporary solution until backend provides real OHLC data
 */
export function convertPricesToOHLC(
  timestamps: number[],
  prices: number[]
): OHLCData[] {
  if (timestamps.length !== prices.length) {
    console.warn('Timestamps and prices length mismatch')
    return []
  }

  return timestamps.map((time, i) => {
    const price = prices[i]
    // When we only have close price, use it for all OHLC values
    // This creates a flat candlestick (line), but maintains compatibility
    return {
      time: Math.floor(time / 1000), // Convert to seconds for Lightweight Charts
      open: price,
      high: price,
      low: price,
      close: price,
    }
  })
}

/**
 * Convert price data with simulated intrabar movement to OHLC
 * Adds realistic high/low variation based on volatility
 */
export function convertPricesToOHLCWithVariation(
  timestamps: number[],
  prices: number[],
  volatilityPercent: number = 0.5 // Default 0.5% variation
): OHLCData[] {
  if (timestamps.length !== prices.length) {
    console.warn('Timestamps and prices length mismatch')
    return []
  }

  return timestamps.map((time, i) => {
    const close = prices[i]
    const prevClose = i > 0 ? prices[i - 1] : close

    // Determine if this is an up or down bar
    const isUp = close >= prevClose

    // Calculate variation range
    const variation = close * (volatilityPercent / 100)

    // Simulate realistic OHLC
    const open = prevClose
    const high = isUp
      ? Math.max(open, close) + Math.random() * variation
      : Math.max(open, close) + Math.random() * variation * 0.5
    const low = isUp
      ? Math.min(open, close) - Math.random() * variation * 0.5
      : Math.min(open, close) - Math.random() * variation

    return {
      time: Math.floor(time / 1000),
      open,
      high,
      low,
      close,
    }
  })
}

/**
 * Create volume data from price data
 * Generates realistic volume bars based on price movement
 */
export function generateVolumeData(
  timestamps: number[],
  prices: number[],
  baseVolume: number = 100000
): VolumeData[] {
  if (timestamps.length !== prices.length) {
    return []
  }

  return timestamps.map((time, i) => {
    const priceChange = i > 0 ? Math.abs(prices[i] - prices[i - 1]) / prices[i - 1] : 0
    // Volume increases with larger price movements
    const volumeMultiplier = 1 + (priceChange * 10)
    const volume = baseVolume * volumeMultiplier * (0.5 + Math.random())

    return {
      time: Math.floor(time / 1000),
      value: Math.round(volume),
    }
  })
}

/**
 * Format timestamp for display
 */
export function formatChartTime(timestamp: number, includeTime: boolean = false): string {
  const date = new Date(timestamp * 1000) // Convert from seconds to milliseconds

  if (includeTime) {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Calculate price statistics from OHLC data
 */
export function calculatePriceStats(data: OHLCData[]) {
  if (data.length === 0) {
    return {
      highest: 0,
      lowest: 0,
      average: 0,
      currentPrice: 0,
      change: 0,
      changePercent: 0,
    }
  }

  const highest = Math.max(...data.map(d => d.high))
  const lowest = Math.min(...data.map(d => d.low))
  const average = data.reduce((sum, d) => sum + d.close, 0) / data.length
  const currentPrice = data[data.length - 1].close
  const firstPrice = data[0].open
  const change = currentPrice - firstPrice
  const changePercent = (change / firstPrice) * 100

  return {
    highest,
    lowest,
    average,
    currentPrice,
    change,
    changePercent,
  }
}

/**
 * Aggregate OHLC data to higher timeframe
 * Example: Convert 1-minute bars to 5-minute bars
 */
export function aggregateOHLC(
  data: OHLCData[],
  barsPerPeriod: number
): OHLCData[] {
  const aggregated: OHLCData[] = []

  for (let i = 0; i < data.length; i += barsPerPeriod) {
    const slice = data.slice(i, i + barsPerPeriod)
    if (slice.length === 0) continue

    aggregated.push({
      time: slice[0].time,
      open: slice[0].open,
      high: Math.max(...slice.map(d => d.high)),
      low: Math.min(...slice.map(d => d.low)),
      close: slice[slice.length - 1].close,
    })
  }

  return aggregated
}

/**
 * Create trade markers from trade data
 */
export function createTradeMarkers(
  trades: Array<{
    timestamp: number
    price: number
    action: 'buy' | 'sell'
    quantity: number
  }>
) {
  return trades.map(trade => ({
    time: Math.floor(trade.timestamp / 1000),
    position: (trade.action === 'buy' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
    color: trade.action === 'buy' ? '#26A69A' : '#EF5350',
    shape: (trade.action === 'buy' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
    text: `${trade.action.toUpperCase()} ${trade.quantity}`,
    size: 1,
  }))
}
