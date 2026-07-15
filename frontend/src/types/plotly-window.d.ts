type PlotlyTrace = Record<string, unknown>
type PlotlyLayout = Record<string, unknown>
type PlotlyConfig = Record<string, unknown>

declare module 'plotly.js/lib/core'

interface PlotlyHTMLElement extends HTMLDivElement {
  on?: (eventName: string, handler: (eventData: PlotlyClickEvent) => void) => void
  removeAllListeners?: (eventName?: string) => void
}

interface PlotlyClickEvent {
  points?: Array<{ x?: number | string }>
}

interface Window {
  Plotly?: {
    newPlot: (
      element: HTMLDivElement,
      data: PlotlyTrace[],
      layout?: PlotlyLayout,
      config?: PlotlyConfig,
    ) => Promise<PlotlyHTMLElement> | PlotlyHTMLElement
    purge: (element: HTMLDivElement) => void
    register?: (modules: unknown[]) => void
  }
}
