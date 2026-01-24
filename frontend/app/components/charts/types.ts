/**
 * Type definitions for TradingView Lightweight Charts
 */

export interface OHLCData {
  time: number  // Unix timestamp in seconds
  open: number
  high: number
  low: number
  close: number
}

export interface VolumeData {
  time: number  // Unix timestamp in seconds
  value: number
  color?: string  // Optional: will be calculated based on price direction
}

export interface CandlestickDataPoint extends OHLCData {
  volume?: number
}

export type ChartType = 'candlestick' | 'line' | 'area'

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1M'

export interface ChartTheme {
  background: string
  textColor: string
  gridColor: string
  crosshairColor: string
  upColor: string      // Bullish candle color
  downColor: string    // Bearish candle color
}

export const DARK_THEME: ChartTheme = {
  background: '#FFFFFF',
  textColor: '#1F2937',
  gridColor: '#FED7AA',
  crosshairColor: '#EA580C',
  upColor: '#15803D',    // Green
  downColor: '#DC2626',  // Red
}

export const LIGHT_THEME: ChartTheme = {
  background: '#FFFFFF',
  textColor: '#1F2937',
  gridColor: '#FED7AA',
  crosshairColor: '#EA580C',
  upColor: '#15803D',
  downColor: '#DC2626',
}

export interface CrosshairData {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface TradeMarker {
  time: number
  position: 'aboveBar' | 'belowBar' | 'inBar'
  color: string
  shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown'
  text?: string
  size?: number
}

export type AnnotationMode = 'none' | 'trend' | 'horizontal'

export type ChartAnnotation =
  | {
      id: string
      type: 'trend'
      start: { time: number; price: number }
      end: { time: number; price: number }
    }
  | {
      id: string
      type: 'horizontal'
      price: number
    }
