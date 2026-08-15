import { useEffect, useMemo, useRef, useState } from 'react'
import 'plotly.js/dist/plotly.min.js'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd'
import { DeleteOutlined, DownloadOutlined, PlayCircleOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import * as api from '../api/mem'
import type {
  ComplexVoigtAnalyzeRequest,
  ComplexVoigtPeakParams,
  ComplexVoigtProfileType,
  ComplexVoigtResult,
  ComplexVoigtZero,
} from '../types/mem'
import { parseParameterFields } from '../utils/phaseUnit'

const Plotly = window.Plotly
const { Paragraph, Text } = Typography

const chartConfig = {
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  displaylogo: false,
  scrollZoom: true,
}

type ExampleKey = 'single-lorentzian' | 'single-voigt' | 'opposite-voigt' | 'water-oh' | 'custom'

interface ExamplePreset {
  label: string
  nrReal: number
  nrImag: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  peaks: ComplexVoigtPeakParams[]
}

const profileOptions = [
  { value: 'lorentzian', label: 'Lorentzian' },
  { value: 'voigt', label: 'Voigt' },
]

const SIGMA_TO_GAUSSIAN_HWHM = Math.sqrt(2 * Math.log(2))

const examples: Record<Exclude<ExampleKey, 'custom'>, ExamplePreset> = {
  'single-lorentzian': {
    label: 'Example 1: Single Lorentzian peak',
    nrReal: 0.08,
    nrImag: 0,
    xMin: 2500,
    xMax: 4000,
    yMin: -500,
    yMax: 500,
    peaks: [
      { profile_type: 'lorentzian', amplitude: 8, center: 3200, lorentzian_hwhm: 35, gaussian_hwhm: 0, phase_deg: 0 },
    ],
  },
  'single-voigt': {
    label: 'Example 2: Single Voigt peak',
    nrReal: 0.05,
    nrImag: 0.02,
    xMin: 2500,
    xMax: 4000,
    yMin: -500,
    yMax: 500,
    peaks: [
      { profile_type: 'voigt', amplitude: 10, center: 3250, lorentzian_hwhm: 25, gaussian_hwhm: 80, phase_deg: 0 },
    ],
  },
  'opposite-voigt': {
    label: 'Example 3: Two overlapping Voigt peaks with opposite phase',
    nrReal: 0.04,
    nrImag: -0.01,
    xMin: 2700,
    xMax: 3700,
    yMin: -400,
    yMax: 400,
    peaks: [
      { profile_type: 'voigt', amplitude: 9, center: 3150, lorentzian_hwhm: 22, gaussian_hwhm: 70, phase_deg: 0 },
      { profile_type: 'voigt', amplitude: 8, center: 3290, lorentzian_hwhm: 28, gaussian_hwhm: 75, phase_deg: 180 },
    ],
  },
  'water-oh': {
    label: 'Example 4: Water OH-like multi-peak spectrum',
    nrReal: 0.03,
    nrImag: 0.01,
    xMin: 2800,
    xMax: 3800,
    yMin: -500,
    yMax: 500,
    peaks: [
      { profile_type: 'voigt', amplitude: 5.5, center: 3050, lorentzian_hwhm: 45, gaussian_hwhm: 100, phase_deg: 20 },
      { profile_type: 'voigt', amplitude: 8.5, center: 3220, lorentzian_hwhm: 35, gaussian_hwhm: 90, phase_deg: 0 },
      { profile_type: 'voigt', amplitude: 7.0, center: 3430, lorentzian_hwhm: 40, gaussian_hwhm: 110, phase_deg: -35 },
      { profile_type: 'voigt', amplitude: 4.0, center: 3600, lorentzian_hwhm: 55, gaussian_hwhm: 130, phase_deg: 65 },
    ],
  },
}

const exampleOptions = [
  ...Object.entries(examples).map(([value, preset]) => ({ value, label: preset.label })),
  { value: 'custom', label: 'Example 5: User-defined arbitrary peaks' },
]

function defaultPeak(): ComplexVoigtPeakParams {
  return { profile_type: 'voigt', amplitude: 1, center: 3200, lorentzian_hwhm: 25, gaussian_hwhm: 80, phase_deg: 0 }
}

function clonePeaks(peaks: ComplexVoigtPeakParams[]): ComplexVoigtPeakParams[] {
  return peaks.map((peak) => ({ ...peak }))
}

function finiteArray(values: number[]): number[] {
  return values.map((value) => (Number.isFinite(value) ? value : 0))
}

function csvCell(value: number | string | undefined): string {
  if (value == null) return ''
  const text = typeof value === 'number'
    ? Number.isFinite(value) ? value.toExponential(8) : ''
    : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function classifyTag(classification: string) {
  if (classification.includes('Upper')) return <Tag color="red">{classification}</Tag>
  if (classification.includes('Lower')) return <Tag color="blue">{classification}</Tag>
  return <Tag color="gold">{classification}</Tag>
}

function nearestZeroShift(zero: ComplexVoigtZero, previousZeros: ComplexVoigtZero[]): string {
  if (previousZeros.length === 0) return ''
  const nearest = previousZeros.reduce((best, previous) => {
    const distance = Math.hypot(zero.x - previous.x, zero.y - previous.y)
    return distance < best ? distance : best
  }, Number.POSITIVE_INFINITY)
  return Number.isFinite(nearest) ? nearest.toExponential(3) : ''
}

function fieldValue(fields: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (fields[key] != null) return fields[key]
  }
  const lowerFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key.toLowerCase(), value]))
  for (const key of keys) {
    const value = lowerFields[key.toLowerCase()]
    if (value != null) return value
  }
  return undefined
}

function numberField(fields: Record<string, string>, keys: string[], fallback: number): number {
  const value = fieldValue(fields, keys)
  if (value == null) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringField(fields: Record<string, string>, keys: string[], fallback: string): string {
  return fieldValue(fields, keys) ?? fallback
}

function normalizeComplexProfile(value: string | undefined): ComplexVoigtProfileType {
  return value?.trim().toLowerCase() === 'lorentzian' ? 'lorentzian' : 'voigt'
}

function importedComplexPeakIndices(fields: Record<string, string>): number[] {
  const indices = new Set<number>()
  for (const key of Object.keys(fields)) {
    const match = key.match(/^(A|Amplitude|Omega|Center|Gamma|Phi|Phase|Phase_deg|Profile|Profile_Type|Lorentzian_HWHM|Lorentzian_FWHM|Gaussian_HWHM|GaussianHWHM|Gaussian_FWHM|GaussianFWHM|Gaussian_Sigma|Sigma)(\d+)$/i)
    if (match) indices.add(Number(match[2]))
  }
  return Array.from(indices).sort((a, b) => a - b)
}

function buildImportedComplexPeak(
  fields: Record<string, string>,
  index: number | null,
  defaultCenter: number,
): ComplexVoigtPeakParams {
  const suffix = index == null ? '' : String(index)
  const profile = normalizeComplexProfile(stringField(fields, [`Profile${suffix}`, `Profile_Type${suffix}`, `profile_type${suffix}`], 'voigt'))
  const lorentzianFwhm = numberField(fields, [`Lorentzian_FWHM${suffix}`, `lorentzian_fwhm_cm-1${suffix}`], NaN)
  const gaussianFwhm = numberField(fields, [`Gaussian_FWHM${suffix}`, `GaussianFWHM${suffix}`, `gaussian_fwhm_cm-1${suffix}`], NaN)
  const gaussianSigma = numberField(fields, [`Gaussian_Sigma${suffix}`, `Sigma${suffix}`, `sigma${suffix}`], NaN)
  const gaussianHwhm = numberField(
    fields,
    [`Gaussian_HWHM${suffix}`, `GaussianHWHM${suffix}`, `gaussian_hwhm_cm-1${suffix}`, `gaussian_hwhm${suffix}`],
    Number.isFinite(gaussianFwhm)
      ? gaussianFwhm / 2
      : Number.isFinite(gaussianSigma)
        ? gaussianSigma * SIGMA_TO_GAUSSIAN_HWHM
        : 0,
  )

  return {
    profile_type: profile,
    amplitude: numberField(fields, [`A${suffix}`, `Amplitude${suffix}`, `amplitude${suffix}`], 1),
    center: numberField(fields, [`Omega${suffix}`, `Center${suffix}`, `center_cm-1${suffix}`, `center${suffix}`], defaultCenter),
    lorentzian_hwhm: numberField(
      fields,
      [`Gamma${suffix}`, `Lorentzian_HWHM${suffix}`, `lorentzian_hwhm_cm-1${suffix}`, `width${suffix}`],
      Number.isFinite(lorentzianFwhm) ? lorentzianFwhm / 2 : 25,
    ),
    gaussian_hwhm: profile === 'lorentzian' ? 0 : gaussianHwhm,
    phase_deg: numberField(fields, [`Phi${suffix}`, `Phase_deg${suffix}`, `Phase${suffix}`, `phase_deg${suffix}`, `phase${suffix}`], 0),
  }
}

export default function ComplexVoigtAnalyzerPage() {
  const initial = examples['single-voigt']
  const [exampleKey, setExampleKey] = useState<ExampleKey>('single-voigt')
  const [xMin, setXMin] = useState(initial.xMin)
  const [xMax, setXMax] = useState(initial.xMax)
  const [npoints, setNpoints] = useState(1000)
  const [yMin, setYMin] = useState(initial.yMin)
  const [yMax, setYMax] = useState(initial.yMax)
  const [gridX, setGridX] = useState(181)
  const [gridY, setGridY] = useState(161)
  const [nrReal, setNrReal] = useState(initial.nrReal)
  const [nrImag, setNrImag] = useState(initial.nrImag)
  const [peaks, setPeaks] = useState<ComplexVoigtPeakParams[]>(clonePeaks(initial.peaks))
  const [rootTolerance, setRootTolerance] = useState(1e-7)
  const [maxRoots, setMaxRoots] = useState(12)
  const [result, setResult] = useState<ComplexVoigtResult | null>(null)
  const [previousZeros, setPreviousZeros] = useState<ComplexVoigtZero[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spectrumRef = useRef<HTMLDivElement>(null)
  const intensityRef = useRef<HTMLDivElement>(null)
  const planeRef = useRef<HTMLDivElement>(null)
  const nyquistRef = useRef<HTMLDivElement>(null)

  const zeroRows = useMemo(() => result?.zeros.map((zero, index) => ({
    key: `${zero.x}-${zero.y}-${index}`,
    index: index + 1,
    x: zero.x,
    y: zero.y,
    absChi: zero.abs_chi,
    classification: zero.classification,
    shift: nearestZeroShift(zero, previousZeros),
  })) ?? [], [result, previousZeros])

  const applyExample = (value: ExampleKey) => {
    setExampleKey(value)
    if (value === 'custom') return
    const preset = examples[value]
    setXMin(preset.xMin)
    setXMax(preset.xMax)
    setYMin(preset.yMin)
    setYMax(preset.yMax)
    setNrReal(preset.nrReal)
    setNrImag(preset.nrImag)
    setPeaks(clonePeaks(preset.peaks))
  }

  const updatePeakProfile = (index: number, value: ComplexVoigtProfileType) => {
    setExampleKey('custom')
    setPeaks(peaks.map((peak, i) => (
      i === index ? { ...peak, profile_type: value, gaussian_hwhm: value === 'lorentzian' ? 0 : peak.gaussian_hwhm } : peak
    )))
  }

  const updatePeakNumber = (
    index: number,
    field: 'amplitude' | 'center' | 'lorentzian_hwhm' | 'gaussian_hwhm' | 'phase_deg',
    value: number | null,
  ) => {
    if (value == null) return
    setExampleKey('custom')
    setPeaks(peaks.map((peak, i) => (i === index ? { ...peak, [field]: value } : peak)))
  }

  const addPeak = () => {
    setExampleKey('custom')
    setPeaks([...peaks, defaultPeak()])
  }

  const removePeak = (index: number) => {
    setExampleKey('custom')
    setPeaks(peaks.filter((_, i) => i !== index))
  }

  const handleImportParams = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        const fields = parseParameterFields(text)
        if (Object.keys(fields).length === 0) {
          throw new Error('No parameter fields found in the selected file')
        }

        const peakIndices = importedComplexPeakIndices(fields)
        const importedPeaks = peakIndices.length > 0
          ? peakIndices.map((index) => buildImportedComplexPeak(fields, index, 3200 + index * 50))
          : (fieldValue(fields, ['A', 'Amplitude', 'amplitude', 'Profile', 'profile', 'Omega', 'Center', 'center']) != null)
            ? [buildImportedComplexPeak(fields, null, 3200)]
            : []

        if (importedPeaks.some((peak) => peak.lorentzian_hwhm <= 0 || peak.gaussian_hwhm < 0)) {
          throw new Error('Imported widths are invalid: Lorentzian HWHM must be > 0 and Gaussian HWHM must be >= 0')
        }

        setExampleKey('custom')
        setXMin(numberField(fields, ['XMin', 'xmin', 'x_min', 'Real_Start', 'RealFrequencyStart', 'Frequency_Start'], xMin))
        setXMax(numberField(fields, ['XMax', 'xmax', 'x_max', 'Real_End', 'RealFrequencyEnd', 'Frequency_End'], xMax))
        setNpoints(Math.round(numberField(fields, ['NPoints', 'npoints', 'Points', 'Real_Frequency_Points'], npoints)))
        setYMin(numberField(fields, ['YMin', 'ymin', 'y_min', 'Imag_Start', 'Imaginary_Start', 'Imaginary_Frequency_Start'], yMin))
        setYMax(numberField(fields, ['YMax', 'ymax', 'y_max', 'Imag_End', 'Imaginary_End', 'Imaginary_Frequency_End'], yMax))
        setGridX(Math.round(numberField(fields, ['GridX', 'grid_x', 'XGrid', 'X_Grid', 'Complex_Grid_X'], gridX)))
        setGridY(Math.round(numberField(fields, ['GridY', 'grid_y', 'YGrid', 'Y_Grid', 'Complex_Grid_Y'], gridY)))
        setNrReal(numberField(fields, ['NR_Real', 'nr_real', 'Nonresonant_Real'], nrReal))
        setNrImag(numberField(fields, ['NR_Imag', 'nr_imag', 'Nonresonant_Imag'], nrImag))
        setRootTolerance(numberField(fields, ['Root_Tolerance', 'root_tolerance', 'Tolerance', 'tolerance'], rootTolerance))
        setMaxRoots(Math.round(numberField(fields, ['Max_Roots', 'max_roots', 'MaxZeros', 'Max_Zeros'], maxRoots)))

        if (importedPeaks.length > 0) {
          setPeaks(importedPeaks)
        }

        message.success(importedPeaks.length > 0
          ? `Imported ${importedPeaks.length} oscillator(s)`
          : 'Imported analyzer settings')
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Unable to import custom parameters')
      }
    }
    reader.readAsText(file)
    return false
  }

  const handleAnalyze = async () => {
    if (xMin >= xMax) { message.error('Real frequency start must be less than end'); return }
    if (yMin >= yMax) { message.error('Imaginary frequency start must be less than end'); return }
    if (gridX * gridY > 120000) { message.error('Complex-plane grid must not exceed 120000 points'); return }
    if (peaks.some((peak) => peak.lorentzian_hwhm <= 0 || peak.gaussian_hwhm < 0)) {
      message.error('Peak widths must be valid: Lorentzian HWHM > 0 and Gaussian HWHM >= 0')
      return
    }

    const payload: ComplexVoigtAnalyzeRequest = {
      x_min: xMin,
      x_max: xMax,
      npoints,
      y_min: yMin,
      y_max: yMax,
      grid_x: gridX,
      grid_y: gridY,
      nr_real: nrReal,
      nr_imag: nrImag,
      peaks,
      root_tolerance: rootTolerance,
      max_roots: maxRoots,
    }

    setLoading(true)
    setError(null)
    try {
      if (result) setPreviousZeros(result.zeros)
      const data = await api.analyzeComplexVoigt(payload)
      setResult(data)
    } catch (e) {
      setError(api.getApiErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const handleExportCsv = () => {
    if (!result) { message.warning('Run the analysis first'); return }
    const lines = [
      '# page,Complex Voigt Response & Minimum Phase Analyzer',
      `# summary,${csvCell(result.summary)}`,
      `# real_frequency_range,${csvCell(xMin)},${csvCell(xMax)}`,
      `# imaginary_frequency_range,${csvCell(yMin)},${csvCell(yMax)}`,
      `# real_frequency_points,${csvCell(result.wavenumbers.length)}`,
      `# complex_plane_grid,${csvCell(result.complex_plane.x.length)},${csvCell(result.complex_plane.y.length)}`,
      `# nr_real,${csvCell(nrReal)}`,
      `# nr_imag,${csvCell(nrImag)}`,
      `# gaussian_conversion,${csvCell(result.metadata.gaussian_conversion)}`,
      `# lorentzian_convention,${csvCell(result.metadata.lorentzian_convention)}`,
      `# voigt_convention,${csvCell(result.metadata.voigt_convention)}`,
      `# pole_convention,${csvCell(result.metadata.pole_convention)}`,
      `# fourier_sign_convention,${csvCell(result.metadata.fourier_sign_convention)}`,
      '',
      'peak,profile,amplitude,center_cm-1,lorentzian_hwhm_cm-1,gaussian_hwhm_cm-1,gaussian_sigma_cm-1,phase_deg,phase_rad',
      ...result.normalized_peaks.map((peak, index) => [
        index + 1,
        peak.profile_type,
        peak.amplitude,
        peak.center,
        peak.lorentzian_hwhm,
        peak.gaussian_hwhm,
        peak.gaussian_sigma,
        peak.phase_deg,
        peak.phase_rad,
      ].map(csvCell).join(',')),
      '',
      'zero,Re_z_cm-1,Im_z_cm-1,Re_chi,Im_chi,abs_chi,classification',
      ...result.zeros.map((zero, index) => [
        index + 1,
        zero.x,
        zero.y,
        zero.real_chi,
        zero.imag_chi,
        zero.abs_chi,
        zero.classification,
      ].map(csvCell).join(',')),
      '',
      'wavenumber_cm-1,Re_chi,Im_chi,intensity_abs_chi_squared',
      ...result.wavenumbers.map((wavenumber, index) => [
        wavenumber,
        result.real_part[index],
        result.imag_part[index],
        result.intensity[index],
      ].map(csvCell).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Complex_Voigt_Minimum_Phase_Analysis.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success('Complex Voigt analysis CSV exported')
  }

  useEffect(() => {
    const container = spectrumRef.current
    if (!container || !result) return
    Plotly.newPlot(container, [
      { x: finiteArray(result.wavenumbers), y: finiteArray(result.real_part), type: 'scatter', mode: 'lines', name: 'Re[chi]', line: { color: '#1f77b4', width: 2 } },
      { x: finiteArray(result.wavenumbers), y: finiteArray(result.imag_part), type: 'scatter', mode: 'lines', name: 'Im[chi]', line: { color: '#2ca02c', width: 2 } },
    ], {
      title: { text: 'Complex Response on Real Frequency Axis', font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: 'chi' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, chartConfig)
    return () => Plotly.purge(container)
  }, [result])

  useEffect(() => {
    const container = intensityRef.current
    if (!container || !result) return
    Plotly.newPlot(container, [
      { x: finiteArray(result.wavenumbers), y: finiteArray(result.intensity), type: 'scatter', mode: 'lines', name: '|chi|^2', line: { color: '#d62728', width: 2 } },
    ], {
      title: { text: 'Intensity Spectrum |chi(omega)|^2', font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: '|chi|<sup>2</sup>' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
    }, chartConfig)
    return () => Plotly.purge(container)
  }, [result])

  useEffect(() => {
    const container = planeRef.current
    if (!container || !result) return
    const plane = result.complex_plane
    const zeros = result.zeros
    const traces: PlotlyTrace[] = [
      {
        x: plane.x,
        y: plane.y,
        z: plane.log_abs_chi,
        type: 'heatmap',
        colorscale: 'Viridis',
        colorbar: { title: 'log10 |chi|' },
        name: 'log10 |chi|',
      },
      {
        x: [plane.x[0], plane.x[plane.x.length - 1]],
        y: [0, 0],
        type: 'scatter',
        mode: 'lines',
        name: 'Im(z)=0',
        line: { color: '#fff', width: 1.5, dash: 'dash' },
      },
    ]
    if (zeros.length > 0) {
      traces.push({
        x: zeros.map((zero) => zero.x),
        y: zeros.map((zero) => zero.y),
        text: zeros.map((zero) => zero.classification),
        type: 'scatter',
        mode: 'markers',
        name: 'Detected zeros',
        marker: { color: '#ff1744', size: 10, symbol: 'x', line: { color: '#fff', width: 1 } },
      })
    }
    Plotly.newPlot(container, traces, {
      title: { text: 'Complex Frequency Plane: log10 |chi(z)|', font: { size: 14 } },
      xaxis: { title: 'Re(z) (cm<sup>-1</sup>)' },
      yaxis: { title: 'Im(z) (cm<sup>-1</sup>)' },
      hovermode: 'closest',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, chartConfig)
    return () => Plotly.purge(container)
  }, [result])

  useEffect(() => {
    const container = nyquistRef.current
    if (!container || !result) return
    const re = finiteArray(result.real_part)
    const im = finiteArray(result.imag_part)
    Plotly.newPlot(container, [
      { x: re, y: im, type: 'scatter', mode: 'lines', name: 'chi(omega)', line: { color: '#7b1fa2', width: 2 } },
      { x: [re[0]], y: [im[0]], type: 'scatter', mode: 'markers', name: 'Start', marker: { color: '#2e7d32', size: 8 } },
      { x: [re[re.length - 1]], y: [im[im.length - 1]], type: 'scatter', mode: 'markers', name: 'End', marker: { color: '#c62828', size: 8 } },
    ], {
      title: { text: 'Nyquist Plot of chi(omega)', font: { size: 14 } },
      xaxis: { title: 'Re[chi]' },
      yaxis: { title: 'Im[chi]' },
      hovermode: 'closest',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, chartConfig)
    return () => Plotly.purge(container)
  }, [result])

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} lg={8}>
        <Card size="small" title="Complex Voigt Response & Minimum Phase Analyzer" style={{ height: 'calc(100vh - 100px)', overflow: 'auto' }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Select value={exampleKey} onChange={applyExample} options={exampleOptions} style={{ width: '100%' }} />
            <Upload accept=".txt,.csv" maxCount={1} showUploadList={false} beforeUpload={handleImportParams}>
              <Button size="small" icon={<UploadOutlined />}>Import custom parameters</Button>
            </Upload>

            <Text strong>Real Frequency Axis</Text>
            <Row gutter={[8, 8]}>
              <Col span={12}><InputNumber addonBefore="Start" value={xMin} onChange={(value) => { setExampleKey('custom'); setXMin(value ?? xMin) }} style={{ width: '100%' }} /></Col>
              <Col span={12}><InputNumber addonBefore="End" value={xMax} onChange={(value) => { setExampleKey('custom'); setXMax(value ?? xMax) }} style={{ width: '100%' }} /></Col>
              <Col span={24}><InputNumber addonBefore="Points" min={10} max={10000} value={npoints} onChange={(value) => setNpoints(value ?? npoints)} style={{ width: '100%' }} /></Col>
            </Row>

            <Text strong>Complex Plane Grid</Text>
            <Row gutter={[8, 8]}>
              <Col span={12}><InputNumber addonBefore="Im Start" value={yMin} onChange={(value) => { setExampleKey('custom'); setYMin(value ?? yMin) }} style={{ width: '100%' }} /></Col>
              <Col span={12}><InputNumber addonBefore="Im End" value={yMax} onChange={(value) => { setExampleKey('custom'); setYMax(value ?? yMax) }} style={{ width: '100%' }} /></Col>
              <Col span={12}><InputNumber addonBefore="X Grid" min={21} max={501} value={gridX} onChange={(value) => setGridX(value ?? gridX)} style={{ width: '100%' }} /></Col>
              <Col span={12}><InputNumber addonBefore="Y Grid" min={21} max={501} value={gridY} onChange={(value) => setGridY(value ?? gridY)} style={{ width: '100%' }} /></Col>
            </Row>

            <Text strong>Non-Resonant Term</Text>
            <Row gutter={[8, 8]}>
              <Col span={12}><InputNumber addonBefore="NR Real" value={nrReal} onChange={(value) => { setExampleKey('custom'); setNrReal(value ?? nrReal) }} step={0.01} style={{ width: '100%' }} /></Col>
              <Col span={12}><InputNumber addonBefore="NR Imag" value={nrImag} onChange={(value) => { setExampleKey('custom'); setNrImag(value ?? nrImag) }} step={0.01} style={{ width: '100%' }} /></Col>
            </Row>

            <Text strong>Zero Search</Text>
            <Row gutter={[8, 8]}>
              <Col span={12}><InputNumber addonBefore="Tolerance" value={rootTolerance} onChange={(value) => setRootTolerance(value ?? rootTolerance)} min={1e-12} step={1e-7} style={{ width: '100%' }} /></Col>
              <Col span={12}><InputNumber addonBefore="Max Zeros" value={maxRoots} onChange={(value) => setMaxRoots(value ?? maxRoots)} min={1} max={50} style={{ width: '100%' }} /></Col>
            </Row>

            <Space wrap>
              <Text strong>Oscillators ({peaks.length})</Text>
              <Button size="small" icon={<PlusOutlined />} onClick={addPeak}>Add</Button>
            </Space>

            {peaks.map((peak, index) => (
              <Card
                key={index}
                size="small"
                title={`Oscillator ${index + 1}`}
                extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => removePeak(index)} disabled={peaks.length === 1} />}
              >
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Select
                    value={peak.profile_type}
                    onChange={(value) => updatePeakProfile(index, value)}
                    options={profileOptions}
                    style={{ width: '100%' }}
                    size="small"
                  />
                  <InputNumber addonBefore="Amplitude" value={peak.amplitude} onChange={(value) => updatePeakNumber(index, 'amplitude', value)} step={0.1} style={{ width: '100%' }} size="small" />
                  <InputNumber addonBefore="Center" value={peak.center} onChange={(value) => updatePeakNumber(index, 'center', value)} step={1} style={{ width: '100%' }} size="small" />
                  <InputNumber addonBefore="Lorentzian HWHM" value={peak.lorentzian_hwhm} onChange={(value) => updatePeakNumber(index, 'lorentzian_hwhm', value)} min={0.1} step={0.5} style={{ width: '100%' }} size="small" />
                  <InputNumber
                    addonBefore="Gaussian HWHM"
                    value={peak.gaussian_hwhm}
                    onChange={(value) => updatePeakNumber(index, 'gaussian_hwhm', value)}
                    min={0}
                    step={0.5}
                    disabled={peak.profile_type === 'lorentzian'}
                    style={{ width: '100%' }}
                    size="small"
                  />
                  <InputNumber addonBefore="Phase (deg)" value={peak.phase_deg} onChange={(value) => updatePeakNumber(index, 'phase_deg', value)} step={1} style={{ width: '100%' }} size="small" />
                </Space>
              </Card>
            ))}

            {error && <Alert type="error" message={error} showIcon closable />}
            <Button type="primary" block icon={<PlayCircleOutlined />} loading={loading} onClick={handleAnalyze}>Analyze Complex Voigt Response</Button>
            <Button block icon={<DownloadOutlined />} disabled={!result} onClick={handleExportCsv}>Export CSV</Button>
          </Space>
        </Card>
      </Col>

      <Col xs={24} lg={16}>
        <Card size="small" title="Minimum Phase Status" style={{ marginBottom: 12 }}>
          {result ? (
            <>
              <Alert
                type={result.upper_zero_count > 0 ? 'error' : result.zeros.length > 0 ? 'info' : 'success'}
                message={result.summary}
                showIcon
                style={{ marginBottom: 12 }}
              />
              <Row gutter={[12, 12]}>
                <Col xs={8}><Statistic title="Upper zeros" value={result.upper_zero_count} /></Col>
                <Col xs={8}><Statistic title="Lower zeros" value={result.lower_zero_count} /></Col>
                <Col xs={8}><Statistic title="Grid points" value={result.metadata.grid_point_count} /></Col>
              </Row>
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
                {result.metadata.gaussian_conversion}. {result.metadata.pole_convention}.
              </Text>
            </>
          ) : (
            <Empty description="Choose parameters and run the complex-plane analysis" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>

        <Card size="small" title="Minimum Phase Explanation" style={{ marginBottom: 12 }}>
          <Paragraph style={{ marginBottom: 0 }}>
            A causal susceptibility is analytic in the upper complex frequency plane. If chi(z) has no zeros
            in that upper half-plane, the scanned response is consistent with the minimum-phase condition.
            Upper-half-plane zeros can introduce Blaschke phase ambiguity. This module is a finite-region
            numerical exploration and does not prove the global minimum-phase property.
          </Paragraph>
        </Card>

        {result && (
          <Card size="small" title="Detected Zeros" style={{ marginBottom: 12 }}>
            <Table
              size="small"
              pagination={false}
              dataSource={zeroRows}
              columns={[
                { title: '#', dataIndex: 'index', key: 'index', width: 48 },
                { title: 'Re(z)', dataIndex: 'x', key: 'x', render: (value: number) => value.toFixed(5) },
                { title: 'Im(z)', dataIndex: 'y', key: 'y', render: (value: number) => value.toFixed(5) },
                { title: '|chi|', dataIndex: 'absChi', key: 'absChi', render: (value: number) => value.toExponential(3) },
                { title: 'Classification', dataIndex: 'classification', key: 'classification', render: classifyTag },
                { title: 'Shift vs previous', dataIndex: 'shift', key: 'shift' },
              ]}
              locale={{ emptyText: 'No zeros detected in scanned region' }}
            />
          </Card>
        )}

        {!result ? (
          <div style={{ padding: 60, textAlign: 'center', background: '#fff', borderRadius: 8 }}>
            <Empty description="Run the analyzer to render spectra, complex-plane heatmap, and Nyquist plot" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <Row gutter={[12, 12]}>
            <Col xs={24} xl={12}><Card size="small"><div ref={spectrumRef} style={{ width: '100%', minHeight: 330 }} /></Card></Col>
            <Col xs={24} xl={12}><Card size="small"><div ref={intensityRef} style={{ width: '100%', minHeight: 330 }} /></Card></Col>
            <Col xs={24} xl={12}><Card size="small"><div ref={planeRef} style={{ width: '100%', minHeight: 360 }} /></Card></Col>
            <Col xs={24} xl={12}><Card size="small"><div ref={nyquistRef} style={{ width: '100%', minHeight: 360 }} /></Card></Col>
          </Row>
        )}
      </Col>
    </Row>
  )
}
