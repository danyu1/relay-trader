'use client'

import { useEffect, useRef, useMemo } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  createSeriesMarkers
} from 'lightweight-charts'
import type { Time, IChartApi } from 'lightweight-charts'
import { OHLCData, VolumeData, ChartType, DARK_THEME, LIGHT_THEME, TradeMarker, CrosshairData, ChartAnnotation, AnnotationMode } from './types'

interface CandlestickChartProps {
  data: OHLCData[]
  volumeData?: VolumeData[]
  chartType?: ChartType
  theme?: 'dark' | 'light'
  height?: number
  onCrosshairMove?: (data: CrosshairData | null) => void  // Uses CrosshairData for display
  onClick?: (time: number, price: number, index: number) => void  // Added index parameter
  tradeMarkers?: TradeMarker[]
  showVolume?: boolean
  resetSignal?: number
  annotations?: ChartAnnotation[]
  annotationMode?: AnnotationMode
  onAnnotationsChange?: (annotations: ChartAnnotation[]) => void
}

// Helper to format timestamp for display
const formatTimeForDisplay = (timestamp: number): string => {
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function CandlestickChart({
  data,
  volumeData = [],
  chartType = 'candlestick',
  theme = 'dark',
  height = 600,
  onCrosshairMove,
  onClick,
  tradeMarkers = [],
  showVolume = true,
  resetSignal,
  annotations = [],
  annotationMode = 'none',
  onAnnotationsChange,
}: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<any>(null)
  const markersRef = useRef<any>(null)
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null)
  const onCrosshairMoveRef = useRef(onCrosshairMove)
  const onClickRef = useRef(onClick)
  const tradeMarkersRef = useRef<TradeMarker[]>(tradeMarkers)
  const annotationsRef = useRef<ChartAnnotation[]>(annotations)
  const annotationModeRef = useRef<AnnotationMode>(annotationMode)
  const draftRef = useRef<{ start: { time: number; price: number }; current?: { time: number; price: number } } | null>(
    null,
  )

  // Keep refs up to date
  useEffect(() => {
    onCrosshairMoveRef.current = onCrosshairMove
    onClickRef.current = onClick
  }, [onCrosshairMove, onClick])

  useEffect(() => {
    annotationsRef.current = annotations
  }, [annotations])

  useEffect(() => {
    annotationModeRef.current = annotationMode
    if (annotationMode === 'none') {
      draftRef.current = null
      drawAnnotations()
    }
  }, [annotationMode])

  const currentTheme = useMemo(() => theme === 'dark' ? DARK_THEME : LIGHT_THEME, [theme])

  const applyMarkers = (markers: TradeMarker[]) => {
    const mapped = markers.map((marker) => ({
      time: marker.time as Time,
      position: marker.position,
      color: marker.color,
      shape: marker.shape,
      text: marker.text,
      size: marker.size,
    }))
    if (markersRef.current && typeof markersRef.current.setMarkers === 'function') {
      markersRef.current.setMarkers(mapped)
      return
    }
    if (seriesRef.current && typeof seriesRef.current.setMarkers === 'function') {
      seriesRef.current.setMarkers(mapped)
    }
  }

  const resizeAnnotationCanvas = () => {
    const canvas = annotationCanvasRef.current
    const container = chartContainerRef.current
    if (!canvas || !container) return
    const ratio = window.devicePixelRatio || 1
    const width = container.clientWidth
    const heightPx = container.clientHeight
    canvas.width = Math.max(1, Math.floor(width * ratio))
    canvas.height = Math.max(1, Math.floor(heightPx * ratio))
    canvas.style.width = `${width}px`
    canvas.style.height = `${heightPx}px`
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
  }

  const drawAnnotations = () => {
    const canvas = annotationCanvasRef.current
    const chart = chartRef.current
    const series = seriesRef.current
    if (!canvas || !chart || !series) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()

    const timeScale = chart.timeScale()
    const visibleRange = timeScale.getVisibleRange()

    const drawLine = (x1: number, y1: number, x2: number, y2: number, color: string, width = 1.5, dashed = false) => {
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.setLineDash(dashed ? [6, 6] : [])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.restore()
    }

    const drawPoint = (x: number, y: number, color: string) => {
      ctx.save()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    const renderTrend = (start: { time: number; price: number }, end: { time: number; price: number }, dashed = false) => {
      const x1 = timeScale.timeToCoordinate(start.time as Time)
      const x2 = timeScale.timeToCoordinate(end.time as Time)
      const y1 = series.priceToCoordinate(start.price)
      const y2 = series.priceToCoordinate(end.price)
      if (x1 == null || x2 == null || y1 == null || y2 == null) return
      drawLine(x1, y1, x2, y2, '#38bdf8', 2, dashed)
      drawPoint(x1, y1, '#38bdf8')
      drawPoint(x2, y2, '#38bdf8')
    }

    const renderHorizontal = (price: number) => {
      if (!visibleRange) return
      const y = series.priceToCoordinate(price)
      if (y == null) return
      const x1 = timeScale.timeToCoordinate(visibleRange.from as Time)
      const x2 = timeScale.timeToCoordinate(visibleRange.to as Time)
      if (x1 == null || x2 == null) return
      drawLine(x1, y, x2, y, '#f87171', 2)
    }

    annotationsRef.current.forEach((annotation) => {
      if (annotation.type === 'trend') {
        renderTrend(annotation.start, annotation.end)
      } else {
        renderHorizontal(annotation.price)
      }
    })

    if (draftRef.current && draftRef.current.current) {
      renderTrend(draftRef.current.start, draftRef.current.current, true)
    }
  }

  // Initialize and manage chart
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: currentTheme.background },
        textColor: currentTheme.textColor,
      },
      grid: {
        vertLines: { color: currentTheme.gridColor },
        horzLines: { color: currentTheme.gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal, // Changed from Magnet to Normal for smoother tracking
        vertLine: {
          color: currentTheme.crosshairColor,
          width: 1,
          style: 0,
          labelBackgroundColor: currentTheme.crosshairColor,
        },
        horzLine: {
          color: currentTheme.crosshairColor,
          width: 1,
          style: 0,
          labelBackgroundColor: currentTheme.crosshairColor,
        },
      },
      rightPriceScale: {
        borderColor: currentTheme.gridColor,
        scaleMargins: {
          top: 0.1,
          bottom: showVolume ? 0.25 : 0.1,
        },
      },
      timeScale: {
        borderColor: currentTheme.gridColor,
        timeVisible: true,
        secondsVisible: false,
      },
      // Enable drag and zoom
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
    })

    chartRef.current = chart

    // Add main price series using v5 API
    let mainSeries: any

    if (chartType === 'candlestick') {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: currentTheme.upColor,
        downColor: currentTheme.downColor,
        borderUpColor: currentTheme.upColor,
        borderDownColor: currentTheme.downColor,
        wickUpColor: currentTheme.upColor,
        wickDownColor: currentTheme.downColor,
      })
      mainSeries.setData(data.map(d => ({
        time: d.time as Time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      })))
    } else if (chartType === 'line') {
      mainSeries = chart.addSeries(LineSeries, {
        color: '#2196F3',
        lineWidth: 2,
      })
      mainSeries.setData(data.map(d => ({
        time: d.time as Time,
        value: d.close,
      })))
    } else {
      mainSeries = chart.addSeries(AreaSeries, {
        topColor: 'rgba(33, 150, 243, 0.4)',
        bottomColor: 'rgba(33, 150, 243, 0.0)',
        lineColor: '#2196F3',
        lineWidth: 2,
      })
      mainSeries.setData(data.map(d => ({
        time: d.time as Time,
        value: d.close,
      })))
    }

    seriesRef.current = mainSeries
    markersRef.current = createSeriesMarkers(mainSeries, [])
    applyMarkers(tradeMarkersRef.current)

    resizeAnnotationCanvas()
    drawAnnotations()

    // Add volume series
    if (showVolume && volumeData.length > 0) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: currentTheme.upColor,
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: '',
      })

      const coloredVolumeData = volumeData.map((v, i) => {
        const correspondingPrice = data[i]
        let color = currentTheme.upColor

        if (correspondingPrice) {
          color = correspondingPrice.close >= correspondingPrice.open
            ? currentTheme.upColor + '80'
            : currentTheme.downColor + '80'
        }

        return {
          time: v.time as Time,
          value: v.value,
          color: v.color || color,
        }
      })

      volumeSeries.setData(coloredVolumeData)

      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      })
    }

    // Crosshair move handler - use ref to avoid re-renders
    // Throttle crosshair updates to prevent flickering
    let lastCrosshairTime: number | null = null
    let throttleTimeout: ReturnType<typeof setTimeout> | null = null

    chart.subscribeCrosshairMove((param) => {
      // Clear pending timeout
      if (throttleTimeout) {
        clearTimeout(throttleTimeout)
        throttleTimeout = null
      }

      if (param.time && onCrosshairMoveRef.current) {
        const currentTime = Number(param.time)

        // Only update if we moved to a different data point
        if (currentTime !== lastCrosshairTime) {
          lastCrosshairTime = currentTime

          const seriesData = param.seriesData.get(mainSeries)
          if (seriesData) {
            if ('open' in seriesData && 'high' in seriesData && 'low' in seriesData && 'close' in seriesData) {
              onCrosshairMoveRef.current({
                time: currentTime,
                open: seriesData.open,
                high: seriesData.high,
                low: seriesData.low,
                close: seriesData.close,
              })
            } else if ('value' in seriesData) {
              onCrosshairMoveRef.current({
                time: currentTime,
                open: seriesData.value,
                high: seriesData.value,
                low: seriesData.value,
                close: seriesData.value,
              })
            }
          }
        }
        if (param.point && annotationModeRef.current === 'trend' && draftRef.current) {
          const price = mainSeries.coordinateToPrice(param.point.y)
          if (price !== null) {
            draftRef.current.current = { time: currentTime, price }
            drawAnnotations()
          }
        }
      } else if (onCrosshairMoveRef.current) {
        // Delay clearing to prevent flicker when mouse briefly leaves chart
        throttleTimeout = setTimeout(() => {
          onCrosshairMoveRef.current?.(null)
          lastCrosshairTime = null
        }, 100)
      }
    })

    // Click handler - use ref to avoid re-renders
    chart.subscribeClick((param) => {
      if (param.time && param.point && onClickRef.current) {
        const price = mainSeries.coordinateToPrice(param.point.y)
        if (price !== null) {
          // Find the index in the data array
          const timeValue = Number(param.time)
          const dataIndex = data.findIndex(d => d.time === timeValue)
          onClickRef.current(timeValue, price, dataIndex >= 0 ? dataIndex : 0)
        }
      }
      if (param.time && param.point && annotationModeRef.current !== 'none' && onAnnotationsChange) {
        const timeValue = Number(param.time)
        const price = mainSeries.coordinateToPrice(param.point.y)
        if (price === null) return
        if (annotationModeRef.current === 'trend') {
          if (!draftRef.current) {
            draftRef.current = { start: { time: timeValue, price }, current: { time: timeValue, price } }
            drawAnnotations()
            return
          }
          const nextAnnotation: ChartAnnotation = {
            id: `trend-${Date.now()}`,
            type: 'trend',
            start: draftRef.current.start,
            end: { time: timeValue, price },
          }
          draftRef.current = null
          const nextAnnotations = [...annotationsRef.current, nextAnnotation]
          annotationsRef.current = nextAnnotations
          onAnnotationsChange(nextAnnotations)
          drawAnnotations()
          return
        }
        const nextAnnotation: ChartAnnotation = {
          id: `h-${Date.now()}`,
          type: 'horizontal',
          price,
        }
        const nextAnnotations = [...annotationsRef.current, nextAnnotation]
        annotationsRef.current = nextAnnotations
        onAnnotationsChange(nextAnnotations)
        drawAnnotations()
      }
    })

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        })
      }
      resizeAnnotationCanvas()
      drawAnnotations()
    }

    window.addEventListener('resize', handleResize)
    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: height,
      })
      resizeAnnotationCanvas()
      drawAnnotations()
    })
    resizeObserver.observe(chartContainerRef.current)

    // Fit content
    chart.timeScale().fitContent()

    return () => {
      if (markersRef.current && typeof markersRef.current.detach === 'function') {
        markersRef.current.detach()
      }
      markersRef.current = null
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      chart.remove()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, volumeData, chartType, theme, height, showVolume, currentTheme])

  useEffect(() => {
    tradeMarkersRef.current = tradeMarkers
    applyMarkers(tradeMarkers)
  }, [tradeMarkers])

  useEffect(() => {
    drawAnnotations()
  }, [annotations, height, chartType, currentTheme])

  useEffect(() => {
    if (resetSignal === undefined) return
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent()
    }
  }, [resetSignal])

  return (
    <div
      ref={chartContainerRef}
      className="relative w-full"
      style={{ height: `${height}px` }}
    >
      <canvas ref={annotationCanvasRef} className="absolute inset-0 z-10 pointer-events-none" />
    </div>
  )
}
