import { useRef, useEffect } from 'react'
import 'plotly.js/dist/plotly.min.js'

const Plotly = window.Plotly

interface ComplexChartProps {
  wavenumbers: number[]
  realPart: number[]
  imagPart: number[]
  referenceRealPart?: number[]
  referenceImagPart?: number[]
  referenceLabel?: string
}

const layout = {
  title: 'Complex Susceptibility chi(omega)',
  xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
  yaxis: { title: 'chi' },
  hovermode: 'x',
  margin: { l: 60, r: 20, t: 40, b: 50 },
  legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
  font: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
}

const config = {
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  displaylogo: false,
  toImageButtonOptions: { format: 'png', filename: 'complex_spectrum' },
  scrollZoom: true,
}

const ComplexChart: React.FC<ComplexChartProps> = ({
  wavenumbers,
  realPart,
  imagPart,
  referenceRealPart,
  referenceImagPart,
  referenceLabel = 'External reference',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || wavenumbers.length === 0) return

    function safeValues(arr: number[]): number[] {
      return arr.map((v) => (Number.isFinite(v) ? v : 0))
    }

    const safeWavenumbers = safeValues(wavenumbers)
    const safeReal = safeValues(realPart)
    const safeImag = safeValues(imagPart)
    const traces: Array<Record<string, unknown>> = [
      {
        x: safeWavenumbers,
        y: safeReal,
        type: 'scatter',
        mode: 'lines',
        name: 'MEM Re[chi]',
        line: { color: '#e74c3c', width: 2 },
      },
      {
        x: safeWavenumbers,
        y: safeImag,
        type: 'scatter',
        mode: 'lines',
        name: 'MEM Im[chi]',
        line: { color: '#3498db', width: 2 },
      },
    ]

    if (
      referenceRealPart
      && referenceImagPart
      && referenceRealPart.length === wavenumbers.length
      && referenceImagPart.length === wavenumbers.length
    ) {
      traces.push(
        {
          x: safeWavenumbers,
          y: safeValues(referenceRealPart),
          type: 'scatter',
          mode: 'lines',
          name: `${referenceLabel} Re[chi]`,
          line: { color: '#e74c3c', width: 1.5, dash: 'dash' },
        },
        {
          x: safeWavenumbers,
          y: safeValues(referenceImagPart),
          type: 'scatter',
          mode: 'lines',
          name: `${referenceLabel} Im[chi]`,
          line: { color: '#3498db', width: 1.5, dash: 'dash' },
        },
      )
    }

    Plotly.newPlot(container, traces, layout, config)

    return () => {
      Plotly.purge(container)
    }
  }, [wavenumbers, realPart, imagPart, referenceRealPart, referenceImagPart, referenceLabel])

  if (wavenumbers.length === 0) {
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

export default ComplexChart
