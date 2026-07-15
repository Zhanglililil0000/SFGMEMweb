import { useRef, useEffect } from 'react'
import { plotWhenReady } from '../utils/plotlyLoader'

interface IntensityChartProps {
  originalWavenumbers: number[]
  originalIntensity: number[]
  memWavenumbers?: number[]
  memInputIntensity?: number[]
  originalFrequencyRange?: [number, number]
  edgePaddingEnabled?: boolean
}

const layout = {
  title: 'Intensity Spectrum |chi|^2',
  xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
  yaxis: { title: '|chi|^2' },
  hovermode: 'x',
  margin: { l: 60, r: 20, t: 40, b: 50 },
  legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
  font: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
}

const config = {
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  displaylogo: false,
  toImageButtonOptions: { format: 'png', filename: 'intensity_spectrum' },
  scrollZoom: true,
}

export default function IntensityChart({
  originalWavenumbers,
  originalIntensity,
  memWavenumbers,
  memInputIntensity,
  originalFrequencyRange,
  edgePaddingEnabled = false,
}: IntensityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || originalWavenumbers.length === 0) return

    function safeValues(arr: number[]): number[] {
      return arr.map((v) => (Number.isFinite(v) ? v : 0))
    }

    const safeOriginalWavenumbers = safeValues(originalWavenumbers)
    const safeOriginal = safeValues(originalIntensity)
    const traces: PlotlyTrace[] = [
      {
        x: safeOriginalWavenumbers,
        y: safeOriginal,
        type: 'scatter',
        mode: 'lines',
        name: 'Original spectrum',
        line: { color: '#1677ff', width: 1.5 },
      },
    ]

    const safeMemWavenumbers = memWavenumbers ? safeValues(memWavenumbers) : undefined
    if (safeMemWavenumbers && memInputIntensity) {
      traces.push({
        x: safeMemWavenumbers,
        y: safeValues(memInputIntensity),
        type: 'scatter',
        mode: 'lines',
        name: edgePaddingEnabled ? 'Padded MEM input spectrum' : 'MEM input spectrum',
        line: { color: '#f39c12', width: 1.5, dash: 'dash' },
      })
    }

    const dynamicLayout: Record<string, unknown> = { ...layout }
    if (edgePaddingEnabled && safeMemWavenumbers && originalFrequencyRange) {
      const memStart = safeMemWavenumbers[0]
      const memEnd = safeMemWavenumbers[safeMemWavenumbers.length - 1]
      const [originalStart, originalEnd] = originalFrequencyRange
      dynamicLayout.shapes = [
        {
          type: 'rect',
          xref: 'x',
          yref: 'paper',
          x0: memStart,
          x1: originalStart,
          y0: 0,
          y1: 1,
          fillcolor: 'rgba(243, 156, 18, 0.10)',
          line: { width: 0 },
          layer: 'below',
        },
        {
          type: 'rect',
          xref: 'x',
          yref: 'paper',
          x0: originalEnd,
          x1: memEnd,
          y0: 0,
          y1: 1,
          fillcolor: 'rgba(243, 156, 18, 0.10)',
          line: { width: 0 },
          layer: 'below',
        },
        {
          type: 'line',
          xref: 'x',
          yref: 'paper',
          x0: originalStart,
          x1: originalStart,
          y0: 0,
          y1: 1,
          line: { color: '#666', width: 1, dash: 'dot' },
        },
        {
          type: 'line',
          xref: 'x',
          yref: 'paper',
          x0: originalEnd,
          x1: originalEnd,
          y0: 0,
          y1: 1,
          line: { color: '#666', width: 1, dash: 'dot' },
        },
      ]
      dynamicLayout.title = {
        text: `Intensity Spectrum |chi|^2<br><sup>Original range: ${originalStart}-${originalEnd} cm^-1; shaded regions are edge padding</sup>`,
      }
    }

    return plotWhenReady(container, traces, dynamicLayout, config)
  }, [originalWavenumbers, originalIntensity, memWavenumbers, memInputIntensity, originalFrequencyRange, edgePaddingEnabled])

  if (originalWavenumbers.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          minHeight: 400,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999',
          fontSize: 16,
        }}
      >
        No data
      </div>
    )
  }

  return <div ref={containerRef} style={{ width: '100%', minHeight: 400 }} />
}
