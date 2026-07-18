type PlotlyApi = NonNullable<Window['Plotly']>
type PlotlyCoreApi = PlotlyApi & {
  register?: (modules: unknown[]) => void
}
type CommonJsModule<T> = { default?: T }
type BrowserGlobal = typeof globalThis & {
  global?: typeof globalThis
}

let plotlyPromise: Promise<PlotlyApi> | null = null

function ensureBrowserGlobal(): void {
  const browserGlobal = globalThis as BrowserGlobal
  browserGlobal.global ??= browserGlobal
}

export async function ensurePlotly(): Promise<PlotlyApi> {
  if (window.Plotly) return window.Plotly

  ensureBrowserGlobal()

  plotlyPromise ??= Promise.all([
    import('plotly.js/lib/core') as Promise<CommonJsModule<PlotlyCoreApi>>,
    import('plotly.js/lib/scatter') as Promise<CommonJsModule<unknown>>,
  ]).then(([coreModule, scatterModule]) => {
    const Plotly = (coreModule.default ?? coreModule) as PlotlyCoreApi
    const scatter = scatterModule.default ?? scatterModule
    Plotly.register?.([scatter])
    window.Plotly = Plotly
    return Plotly
  })

  return plotlyPromise
}

export function purgePlot(element: HTMLDivElement | null): void {
  if (element && window.Plotly) window.Plotly.purge(element)
}

export function plotWhenReady(
  element: HTMLDivElement,
  data: PlotlyTrace[],
  layout?: PlotlyLayout,
  config?: PlotlyConfig,
): () => void {
  let cancelled = false

  void ensurePlotly()
    .then(async (Plotly) => {
      if (cancelled) return
      await Plotly.newPlot(element, data, layout, config)
      if (cancelled) purgePlot(element)
    })
    .catch((error) => {
      if (!cancelled) console.error('Unable to load Plotly', error)
    })

  return () => {
    cancelled = true
    purgePlot(element)
  }
}
