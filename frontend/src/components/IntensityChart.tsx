import { useRef, useEffect } from 'react'
import 'plotly.js/dist/plotly.min.js'

const Plotly = window.Plotly

interface IntensityChartProps {
  originalWavenumbers: number[]
  originalIntensity: number[]
  memWavenumbers?: number[]
  memInputIntensity?: number[]
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

    if (memWavenumbers && memInputIntensity) {
      traces.push({
        x: safeValues(memWavenumbers),
        y: safeValues(memInputIntensity),
        type: 'scatter',
        mode: 'lines',
        name: 'MEM input spectrum',
        line: { color: '#f39c12', width: 1.5, dash: 'dash' },
      })
    }

    Plotly.newPlot(container, traces, layout, config)

    return () => {
      Plotly.purge(container)
    }
  }, [originalWavenumbers, originalIntensity, memWavenumbers, memInputIntensity])

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
