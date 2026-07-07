import { useState, useRef, useEffect, useMemo } from 'react'
import 'plotly.js/dist/plotly.min.js'
import {
  Row, Col, Card, InputNumber, Button, Typography, message, Space,
  Alert, Upload, Select, Slider, Empty, Switch,
} from 'antd'
import { DownloadOutlined, InboxOutlined, PlayCircleOutlined, UploadOutlined, PlusOutlined, DeleteOutlined, UndoOutlined } from '@ant-design/icons'
import * as api from '../api/mem'
import type { ColumnInfo, SfgPeakParams, FittingParams, MemCompareResult } from '../types/mem'
import {
  degToRad,
  formatParameterNumber,
  formatPhaseForUnit,
  parseParameterFields,
  phaseFromDisplay,
  phaseInputStep,
  radToDeg,
  phaseToDisplay,
  phaseUnitName,
  phaseUnitOptions,
  phaseUnitSymbol,
  type PhaseUnit,
} from '../utils/phaseUnit'
import { buildImportedPeak, importedPeakIndices, normalizeProfileType, profileTypeOptions } from '../utils/sfgPeakParams'

const Plotly = (window as any).Plotly
const { Text } = Typography

const DEFAULT_PHASE_SCAN_START_DEG = 0
const DEFAULT_PHASE_SCAN_END_DEG = 360
const DEFAULT_PHASE_SCAN_STEP_DEG = 0.5
const MAX_PHASE_SCAN_POINTS = 5000
const MAX_MEM_CALCULATION_POINTS = 20000
const NRMSE_EPSILON = 1e-12

const chartConfig = {
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  displaylogo: false,
  scrollZoom: true,
}

function emptyPeak(): SfgPeakParams {
  return { amplitude: 1.0, center: 3200, width: 10, phase: 0, profile_type: 'lorentzian', gaussian_fwhm: 0 }
}

function safeArr(arr: number[]): number[] {
  return arr.map((v) => (Number.isFinite(v) ? v : 0))
}

function countCsvDataRows(text: string): number {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return 0
  const tokens = lines[0].split(',')
  const isHeader = isNaN(Number(tokens[0]?.trim()))
  return isHeader ? Math.max(lines.length - 1, 0) : lines.length
}

function cell(value: number | string | undefined): string {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return value
}

function rangeText(range?: [number, number]): string {
  return range ? `${range[0]} to ${range[1]}` : ''
}

function buildPhaseValuesFromDegrees(
  startDeg: number | null,
  endDeg: number | null,
  stepDeg: number | null,
): { phaseValues: number[]; error: string | null } {
  if (startDeg == null || endDeg == null || stepDeg == null) {
    return { phaseValues: [], error: 'Error phase start, end and step cannot be empty.' }
  }
  if (!Number.isFinite(startDeg) || !Number.isFinite(endDeg) || !Number.isFinite(stepDeg)) {
    return { phaseValues: [], error: 'Error phase start, end and step must be finite numbers.' }
  }
  if (startDeg >= endDeg) {
    return { phaseValues: [], error: 'Error phase start must be less than error phase end.' }
  }
  if (stepDeg <= 0) {
    return { phaseValues: [], error: 'Error phase step must be greater than 0 degrees.' }
  }
  const estimatedPoints = Math.floor((endDeg - startDeg) / stepDeg) + 1
  if (estimatedPoints > MAX_PHASE_SCAN_POINTS) {
    return { phaseValues: [], error: `Error phase scan would create ${estimatedPoints} points; please use at most ${MAX_PHASE_SCAN_POINTS}.` }
  }

  const phaseValues: number[] = []
  const epsilon = Math.abs(stepDeg) * 1e-9
  for (let value = startDeg; value <= endDeg + epsilon; value += stepDeg) {
    phaseValues.push(degToRad(Number(value.toFixed(12))))
  }
  return { phaseValues, error: null }
}

function findMinIndex(values: number[]): number {
  let minIndex = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[minIndex]) minIndex = i
  }
  return minIndex
}

function rms(values: number[]): number {
  if (values.length === 0) return 0
  let sumSq = 0
  for (const value of values) sumSq += value * value
  return Math.sqrt(sumSq / values.length)
}

function buildNrmseSeries(
  result: MemCompareResult,
  phaseValues: number[],
  pointIndices: number[],
  label: string,
) {
  const idealRe = pointIndices.map((index) => result.fitting_real[index])
  const idealIm = pointIndices.map((index) => result.fitting_imag[index])
  const idealReRmsRaw = rms(idealRe)
  const idealImRmsRaw = rms(idealIm)
  const idealReRms = Math.max(idealReRmsRaw, NRMSE_EPSILON)
  const idealImRms = Math.max(idealImRmsRaw, NRMSE_EPSILON)
  const warnings: string[] = []
  if (idealReRmsRaw < NRMSE_EPSILON) warnings.push(`${label} ideal Re RMS is near zero; Re-NRMSE used epsilon normalization.`)
  if (idealImRmsRaw < NRMSE_EPSILON) warnings.push(`${label} ideal Im RMS is near zero; Im-NRMSE used epsilon normalization.`)

  const diffReal: number[] = []
  const diffImag: number[] = []
  const reResidualStd: number[] = []
  const imResidualStd: number[] = []
  const reNrmse: number[] = []
  const imNrmse: number[] = []

  for (const phi of phaseValues) {
    const cosA = Math.cos(phi)
    const sinA = Math.sin(phi)
    let sumAbsR = 0
    let sumAbsI = 0
    let sumR = 0
    let sumI = 0
    let sumSqR = 0
    let sumSqI = 0

    for (const i of pointIndices) {
      const rotatedReal = result.mem_real[i] * cosA - result.mem_imag[i] * sinA
      const rotatedImag = result.mem_real[i] * sinA + result.mem_imag[i] * cosA
      const residualReal = rotatedReal - result.fitting_real[i]
      const residualImag = rotatedImag - result.fitting_imag[i]
      sumAbsR += Math.abs(residualReal)
      sumAbsI += Math.abs(residualImag)
      sumR += residualReal
      sumI += residualImag
      sumSqR += residualReal * residualReal
      sumSqI += residualImag * residualImag
    }

    const n = pointIndices.length
    const meanR = sumR / n
    const meanI = sumI / n
    const meanSqR = sumSqR / n
    const meanSqI = sumSqI / n

    diffReal.push(sumAbsR)
    diffImag.push(sumAbsI)
    reResidualStd.push(Math.sqrt(Math.max(meanSqR - meanR * meanR, 0)))
    imResidualStd.push(Math.sqrt(Math.max(meanSqI - meanI * meanI, 0)))
    reNrmse.push(Math.sqrt(meanSqR) / idealReRms)
    imNrmse.push(Math.sqrt(meanSqI) / idealImRms)
  }

  const phaseDeg = phaseValues.map(radToDeg)
  const reMinIndex = findMinIndex(reNrmse)
  const imMinIndex = findMinIndex(imNrmse)

  return {
    diffReal,
    diffImag,
    reResidualStd,
    imResidualStd,
    reNrmse,
    imNrmse,
    idealReRmsRaw,
    idealImRmsRaw,
    warnings,
    pointCount: pointIndices.length,
    reBest: {
      index: reMinIndex,
      phaseRad: phaseValues[reMinIndex],
      phaseDeg: phaseDeg[reMinIndex],
      value: reNrmse[reMinIndex],
    },
    imBest: {
      index: imMinIndex,
      phaseRad: phaseValues[imMinIndex],
      phaseDeg: phaseDeg[imMinIndex],
      value: imNrmse[imMinIndex],
    },
  }
}

function buildPhaseScanData(
  result: MemCompareResult,
  phaseValues: number[],
  windowOptions?: { enabled: boolean; start: number | null; end: number | null },
) {
  const n = result.mem_real.length
  const aligned = n > 0
    && result.mem_imag.length === n
    && result.fitting_real.length === n
    && result.fitting_imag.length === n
    && result.wavenumbers.length === n
    && result.mem_wavenumbers.length === n
    && result.wavenumbers.every((value, index) => Math.abs(value - result.mem_wavenumbers[index]) < 1e-9)

  if (!aligned) {
    return {
      alignmentError: 'MEM and ideal Re/Im arrays are not on the same frequency grid; phase scan metrics were not calculated.',
    }
  }

  const phaseDeg = phaseValues.map(radToDeg)
  const fullPointIndices = result.wavenumbers.map((_, index) => index)
  const fullMetrics = buildNrmseSeries(result, phaseValues, fullPointIndices, 'Full range')
  const spectrumStart = Math.min(...result.wavenumbers)
  const spectrumEnd = Math.max(...result.wavenumbers)

  let windowMetrics: ReturnType<typeof buildNrmseSeries> | null = null
  let windowInfo: {
    requestedStart: number
    requestedEnd: number
    effectiveStart: number
    effectiveEnd: number
    pointCount: number
  } | null = null
  let windowError: string | null = null

  if (windowOptions?.enabled) {
    const requestedStart = windowOptions.start
    const requestedEnd = windowOptions.end
    if (requestedStart == null || requestedEnd == null) {
      windowError = 'Selected-window NRMSE needs both window start and window end.'
    } else if (requestedStart >= requestedEnd) {
      windowError = 'Window start must be less than window end.'
    } else {
      const effectiveStart = Math.max(requestedStart, spectrumStart)
      const effectiveEnd = Math.min(requestedEnd, spectrumEnd)
      if (effectiveStart >= effectiveEnd) {
        windowError = 'Selected window does not overlap the current spectrum range.'
      } else {
        const windowPointIndices = result.wavenumbers
          .map((value, index) => ({ value, index }))
          .filter(({ value }) => value >= effectiveStart && value <= effectiveEnd)
          .map(({ index }) => index)

        if (windowPointIndices.length < 3) {
          windowError = 'Selected window must contain at least 3 data points.'
        } else {
          windowMetrics = buildNrmseSeries(result, phaseValues, windowPointIndices, 'Selected window')
          windowInfo = {
            requestedStart,
            requestedEnd,
            effectiveStart,
            effectiveEnd,
            pointCount: windowPointIndices.length,
          }
        }
      }
    }
  }

  return {
    phaseRad: phaseValues,
    phaseDeg,
    fullRange: [spectrumStart, spectrumEnd] as [number, number],
    diffReal: fullMetrics.diffReal,
    diffImag: fullMetrics.diffImag,
    reResidualStd: fullMetrics.reResidualStd,
    imResidualStd: fullMetrics.imResidualStd,
    reNrmse: fullMetrics.reNrmse,
    imNrmse: fullMetrics.imNrmse,
    idealReRmsRaw: fullMetrics.idealReRmsRaw,
    idealImRmsRaw: fullMetrics.idealImRmsRaw,
    warnings: fullMetrics.warnings,
    reBest: fullMetrics.reBest,
    imBest: fullMetrics.imBest,
    windowMetrics,
    windowInfo,
    windowError,
  }
}

function parseParamsFile(text: string, phaseUnit: PhaseUnit): FittingParams | null {
  const fields = parseParameterFields(text)
  const numberValue = (key: string, fallback: number) => {
    const parsed = Number(fields[key])
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const peakIndices = importedPeakIndices(fields)
  const peaks: SfgPeakParams[] = peakIndices.length > 0
    ? peakIndices.map((n) => buildImportedPeak(fields, n, phaseUnit, 3000))
    : (fields.Amplitude != null || fields.amplitude != null || fields.profile_type != null)
      ? [buildImportedPeak(fields, null, phaseUnit, 3200)]
      : []
  return { nr_real: numberValue('NR_Real', 0), nr_imag: numberValue('NR_Imag', 0), peaks }
}

export default function MemVsFittingPage() {
  const [result, setResult] = useState<MemCompareResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState('')
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [selectedColumn, setSelectedColumn] = useState<number>(1)
  const [nn, setNn] = useState<number | null>(null)
  const [memPoints, setMemPoints] = useState<number | null>(null)
  const [originalPoints, setOriginalPoints] = useState<number | null>(null)
  const [memPointsEdited, setMemPointsEdited] = useState(false)

  const [nrReal, setNrReal] = useState(0.0)
  const [nrImag, setNrImag] = useState(0.0)
  const [peaks, setPeaks] = useState<SfgPeakParams[]>([])
  const [phaseUnit, setPhaseUnit] = useState<PhaseUnit>('degrees')

  const [phaseAngle, setPhaseAngle] = useState(0)
  const [phaseSelectionMode, setPhaseSelectionMode] = useState<'default' | 'manual'>('default')
  const [phaseScanStartDeg, setPhaseScanStartDeg] = useState<number | null>(DEFAULT_PHASE_SCAN_START_DEG)
  const [phaseScanEndDeg, setPhaseScanEndDeg] = useState<number | null>(DEFAULT_PHASE_SCAN_END_DEG)
  const [phaseScanStepDeg, setPhaseScanStepDeg] = useState<number | null>(DEFAULT_PHASE_SCAN_STEP_DEG)
  const [windowNrmseEnabled, setWindowNrmseEnabled] = useState(false)
  const [windowStart, setWindowStart] = useState<number | null>(null)
  const [windowEnd, setWindowEnd] = useState<number | null>(null)
  const [windowEdited, setWindowEdited] = useState(false)

  const comparisonRef = useRef<HTMLDivElement>(null)
  const diffRef = useRef<HTMLDivElement>(null)
  const nrmseRef = useRef<HTMLDivElement>(null)
  const intensityRef = useRef<HTMLDivElement>(null)

  const phaseScanConfig = useMemo(() => (
    buildPhaseValuesFromDegrees(phaseScanStartDeg, phaseScanEndDeg, phaseScanStepDeg)
  ), [phaseScanStartDeg, phaseScanEndDeg, phaseScanStepDeg])

  const phaseValues = phaseScanConfig.phaseValues

  const phaseScanData = useMemo(() => {
    if (!result || phaseValues.length === 0) return null
    return buildPhaseScanData(result, phaseValues, {
      enabled: windowNrmseEnabled,
      start: windowStart,
      end: windowEnd,
    })
  }, [result, phaseValues, windowNrmseEnabled, windowStart, windowEnd])

  useEffect(() => {
    if (!result) return
    if (!windowEdited || windowStart == null || windowEnd == null) {
      setWindowStart(result.mem_frequency_range[0])
      setWindowEnd(result.mem_frequency_range[1])
      setWindowEdited(false)
    }
  }, [result, windowEdited, windowStart, windowEnd])

  const defaultPhaseSelection = useMemo(() => {
    if (!phaseScanData || 'alignmentError' in phaseScanData) return null

    if (windowNrmseEnabled && phaseScanData.windowMetrics && phaseScanData.windowInfo) {
      const index = phaseScanData.windowMetrics.imBest.index
      return {
        phaseRad: phaseScanData.windowMetrics.imBest.phaseRad,
        phaseDeg: phaseScanData.windowMetrics.imBest.phaseDeg,
        imNrmse: phaseScanData.windowMetrics.imBest.value,
        reNrmseAtPhase: phaseScanData.windowMetrics.reNrmse[index],
        criterionKey: 'minimum_im_nrmse_selected_window',
        label: 'Selected-window minimum Im-NRMSE',
        windowLabel: `${phaseScanData.windowInfo.effectiveStart.toFixed(2)}-${phaseScanData.windowInfo.effectiveEnd.toFixed(2)} cm^-1`,
      }
    }

    const index = phaseScanData.imBest.index
    return {
      phaseRad: phaseScanData.imBest.phaseRad,
      phaseDeg: phaseScanData.imBest.phaseDeg,
      imNrmse: phaseScanData.imBest.value,
      reNrmseAtPhase: phaseScanData.reNrmse[index],
      criterionKey: 'minimum_im_nrmse_full',
      label: 'Full-range minimum Im-NRMSE',
      windowLabel: '',
    }
  }, [phaseScanData, windowNrmseEnabled])

  useEffect(() => {
    if (phaseSelectionMode !== 'default' || !defaultPhaseSelection) return
    setPhaseAngle(defaultPhaseSelection.phaseRad)
  }, [phaseSelectionMode, defaultPhaseSelection?.phaseRad])

  const selectedPhaseDeg = radToDeg(phaseAngle)
  const phaseSliderMinDeg = phaseScanStartDeg != null && phaseScanEndDeg != null && phaseScanStartDeg < phaseScanEndDeg
    ? phaseScanStartDeg
    : DEFAULT_PHASE_SCAN_START_DEG
  const phaseSliderMaxDeg = phaseScanStartDeg != null && phaseScanEndDeg != null && phaseScanStartDeg < phaseScanEndDeg
    ? phaseScanEndDeg
    : DEFAULT_PHASE_SCAN_END_DEG
  const currentSelectionLabel = phaseSelectionMode === 'default' && defaultPhaseSelection
    ? defaultPhaseSelection.label
    : 'Manual selection'

  const currentRotated = useMemo(() => {
    if (!result) return null
    const cosA = Math.cos(phaseAngle)
    const sinA = Math.sin(phaseAngle)
    const rotReal: number[] = []
    const rotImag: number[] = []
    for (let i = 0; i < result.mem_real.length; i++) {
      rotReal.push(result.mem_real[i] * cosA - result.mem_imag[i] * sinA)
      rotImag.push(result.mem_real[i] * sinA + result.mem_imag[i] * cosA)
    }
    return { real: rotReal, imag: rotImag }
  }, [result, phaseAngle])

  useEffect(() => {
    if (!result || !comparisonRef.current) return
    const w = safeArr(result.wavenumbers)
    const rot = currentRotated!
    const traces = [
      { x: w, y: safeArr(rot.real), type: 'scatter', mode: 'lines', name: 'MEM Re[chi]', line: { color: '#e74c3c', width: 2 } },
      { x: w, y: safeArr(result.fitting_real), type: 'scatter', mode: 'lines', name: 'Fitting Re[chi]', line: { color: '#e74c3c', width: 1.5, dash: 'dash' } },
      { x: w, y: safeArr(rot.imag), type: 'scatter', mode: 'lines', name: 'MEM Im[chi]', line: { color: '#3498db', width: 2 } },
      { x: w, y: safeArr(result.fitting_imag), type: 'scatter', mode: 'lines', name: 'Fitting Im[chi]', line: { color: '#3498db', width: 1.5, dash: 'dash' } },
    ]
    Plotly.newPlot(comparisonRef.current, traces, {
      title: {
        text: `MEM reconstruction at error phase = ${selectedPhaseDeg.toFixed(2)}\u00b0 (${phaseAngle.toFixed(6)} rad)<br><sup>Selection: ${currentSelectionLabel}</sup>`,
        font: { size: 14 },
      },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: 'chi' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, chartConfig)
  }, [result, currentRotated, selectedPhaseDeg, phaseAngle, currentSelectionLabel])

  useEffect(() => {
    if (!result || !intensityRef.current) return
    const originalW = safeArr(result.original_wavenumbers)
    const memW = safeArr(result.mem_wavenumbers)
    Plotly.newPlot(intensityRef.current, [
      {
        x: originalW, y: safeArr(result.original_intensity),
        type: 'scatter', mode: 'lines',
        name: 'Original spectrum',
        line: { color: '#1677ff', width: 1.8 },
      },
      {
        x: memW, y: safeArr(result.mem_input_intensity),
        type: 'scatter', mode: 'lines',
        name: 'MEM input spectrum',
        line: { color: '#f39c12', width: 1.5, dash: 'dash' },
      },
      {
        x: memW, y: safeArr(result.fitting_intensity),
        type: 'scatter', mode: 'lines',
        name: 'Fitting Generated Spectra',
        line: { color: '#8e44ad', width: 1.8, dash: 'dot' },
      },
    ], {
      title: { text: 'Intensity Comparison: Import vs Fitting', font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: '|chi|^2' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, chartConfig)
  }, [result])

  useEffect(() => {
    if (!result || !phaseScanData || 'alignmentError' in phaseScanData || !diffRef.current) return
    const gd = diffRef.current
    const pv = phaseScanData.phaseDeg
    const allY = phaseScanData.diffReal.concat(phaseScanData.diffImag)
    const yMax = Math.max(...allY) * 1.1 || 1
    const traces: any[] = [
      { x: pv, y: phaseScanData.diffReal, type: 'scatter', mode: 'lines', name: 'Real Part Diff', line: { color: '#e74c3c', width: 2 } },
      { x: pv, y: phaseScanData.diffImag, type: 'scatter', mode: 'lines', name: 'Imaginary Part Diff', line: { color: '#3498db', width: 2 } },
    ]
    traces.push({
      x: [selectedPhaseDeg, selectedPhaseDeg],
      y: [0, yMax],
      type: 'scatter', mode: 'lines',
      name: 'Selected phase', line: { color: '#999', width: 1, dash: 'dash' },
      showlegend: false,
    })
    Plotly.newPlot(gd, traces, {
      title: { text: 'Error Phase Difference — click to set phase', font: { size: 14 } },
      xaxis: { title: 'Error phase (\u00b0)', range: [Math.min(...pv), Math.max(...pv)] },
      yaxis: { title: 'Sum |diff|' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, chartConfig)
    const onClick = (eventData: any) => {
      if (eventData?.points?.[0]) {
        const x = eventData.points[0].x as number
        setPhaseAngle(degToRad(x))
        setPhaseSelectionMode('manual')
      }
    }
    ;(gd as any).on?.('plotly_click', onClick)
    return () => {
      ;(gd as any).removeAllListeners?.('plotly_click')
    }
  }, [phaseScanData, selectedPhaseDeg])

  useEffect(() => {
    if (!result || !phaseScanData || 'alignmentError' in phaseScanData || !nrmseRef.current) return
    const nrmseYValues = phaseScanData.reNrmse.concat(phaseScanData.imNrmse)
      .concat(phaseScanData.windowMetrics ? phaseScanData.windowMetrics.reNrmse.concat(phaseScanData.windowMetrics.imNrmse) : [])
    const yMax = Math.max(...nrmseYValues) * 1.1 || 1
    const traces: any[] = [
      {
        x: phaseScanData.phaseDeg,
        y: phaseScanData.reNrmse,
        type: 'scatter',
        mode: 'lines',
        name: 'Full range Re-NRMSE',
        line: { color: '#c0392b', width: 2 },
      },
      {
        x: phaseScanData.phaseDeg,
        y: phaseScanData.imNrmse,
        type: 'scatter',
        mode: 'lines',
        name: 'Full range Im-NRMSE',
        line: { color: '#2471a3', width: 2 },
      },
      {
        x: [phaseScanData.reBest.phaseDeg],
        y: [phaseScanData.reBest.value],
        type: 'scatter',
        mode: 'markers',
        name: 'Min Re-NRMSE',
        marker: { color: '#c0392b', size: 9, symbol: 'circle' },
      },
      {
        x: [phaseScanData.imBest.phaseDeg],
        y: [phaseScanData.imBest.value],
        type: 'scatter',
        mode: 'markers',
        name: 'Min Im-NRMSE',
        marker: { color: '#2471a3', size: 9, symbol: 'diamond' },
      },
    ]
    if (phaseScanData.windowMetrics && phaseScanData.windowInfo) {
      const windowLabel = `Selected window ${phaseScanData.windowInfo.effectiveStart.toFixed(2)}-${phaseScanData.windowInfo.effectiveEnd.toFixed(2)} cm^-1`
      traces.push(
        {
          x: phaseScanData.phaseDeg,
          y: phaseScanData.windowMetrics.reNrmse,
          type: 'scatter',
          mode: 'lines',
          name: `${windowLabel} Re-NRMSE`,
          line: { color: '#e67e22', width: 2, dash: 'dash' },
        },
        {
          x: phaseScanData.phaseDeg,
          y: phaseScanData.windowMetrics.imNrmse,
          type: 'scatter',
          mode: 'lines',
          name: `${windowLabel} Im-NRMSE`,
          line: { color: '#16a085', width: 2, dash: 'dash' },
        },
        {
          x: [phaseScanData.windowMetrics.reBest.phaseDeg],
          y: [phaseScanData.windowMetrics.reBest.value],
          type: 'scatter',
          mode: 'markers',
          name: 'Min window Re-NRMSE',
          marker: { color: '#e67e22', size: 9, symbol: 'circle-open' },
        },
        {
          x: [phaseScanData.windowMetrics.imBest.phaseDeg],
          y: [phaseScanData.windowMetrics.imBest.value],
          type: 'scatter',
          mode: 'markers',
          name: 'Min window Im-NRMSE',
          marker: { color: '#16a085', size: 9, symbol: 'diamond-open' },
        },
      )
    }
    traces.push({
      x: [selectedPhaseDeg, selectedPhaseDeg],
      y: [0, yMax],
      type: 'scatter',
      mode: 'lines',
      name: 'Selected phase',
      line: { color: '#999', width: 1, dash: 'dash' },
      showlegend: false,
    })
    Plotly.newPlot(nrmseRef.current, traces, {
      title: { text: 'Full range and Selected window NRMSE vs Error Phase', font: { size: 14 } },
      xaxis: { title: 'Error phase (\u00b0)', range: [Math.min(...phaseScanData.phaseDeg), Math.max(...phaseScanData.phaseDeg)] },
      yaxis: { title: 'NRMSE' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, chartConfig)
    const onClick = (eventData: any) => {
      if (eventData?.points?.[0]) {
        const x = eventData.points[0].x as number
        setPhaseAngle(degToRad(x))
        setPhaseSelectionMode('manual')
      }
    }
    ;(nrmseRef.current as any).on?.('plotly_click', onClick)
    return () => {
      ;(nrmseRef.current as any)?.removeAllListeners?.('plotly_click')
    }
  }, [phaseScanData, selectedPhaseDeg, result])

  const handleFileUpload = (f: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const firstLine = text.split('\n')[0]?.trim()
      if (!firstLine) return
      const tokens = firstLine.split(',')
      const isHeader = isNaN(Number(tokens[0].trim()))
      const cols: ColumnInfo[] = tokens.map((token, i) => ({
        index: i,
        name: isHeader ? token.trim() : `Column ${i + 1}`,
      }))
      const pointCount = countCsvDataRows(text)
      setColumns(cols)
      setSelectedColumn(1)
      setOriginalPoints(pointCount)
      if (!memPointsEdited) {
        setMemPoints(pointCount)
      }
      const keepManual = memPointsEdited && memPoints != null ? `; kept manual MEM points: ${memPoints}` : ''
      message.success(`Loaded: ${f.name}; N_original: ${pointCount}${keepManual}`)
    }
    reader.readAsText(f)
    setFile(f)
    setFileName(f.name)
    return false
  }

  const handleImportParams = (f: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseParamsFile(text, phaseUnit)
      if (parsed) {
        setNrReal(parsed.nr_real)
        setNrImag(parsed.nr_imag)
        setPeaks(parsed.peaks)
        message.success(`Imported ${parsed.peaks.length} peak(s); Phi interpreted as ${phaseUnitName(phaseUnit)}`)
      } else {
        message.warning('No valid parameters found')
      }
    }
    reader.readAsText(f)
    return false
  }

  const handleExportParams = () => {
    const lines = [
      '# MEM vs Fitting parameters',
      `# Phase unit: ${phaseUnitName(phaseUnit)}`,
      `NR_Real=${formatParameterNumber(nrReal)}`,
      `NR_Imag=${formatParameterNumber(nrImag)}`,
    ]
    peaks.forEach((peak, index) => {
      const n = index + 1
      lines.push(
        `Profile${n}=${peak.profile_type ?? 'lorentzian'}`,
        `A${n}=${formatParameterNumber(peak.amplitude)}`,
        `Omega${n}=${formatParameterNumber(peak.center)}`,
        `Gamma${n}=${formatParameterNumber(peak.width)}`,
        `Lorentzian_HWHM${n}=${formatParameterNumber(peak.width)}`,
        `Lorentzian_FWHM${n}=${formatParameterNumber(2 * peak.width)}`,
        `Gaussian_FWHM${n}=${formatParameterNumber(peak.gaussian_fwhm ?? 0)}`,
        `Phi${n}=${formatPhaseForUnit(peak.phase, phaseUnit)}`,
      )
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'Fitting_parameters.txt'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success(`Parameters exported (Phase unit: ${phaseUnitName(phaseUnit)})`)
  }

  const handleRun = async () => {
    if (!file) { message.warning('Please upload a CSV file'); return }
    if (memPoints == null) { message.error('MEM calculation points cannot be empty'); return }
    if (!Number.isInteger(memPoints) || memPoints <= 0) { message.error('MEM calculation points must be a positive integer'); return }
    if (memPoints < 3) { message.error('MEM calculation points must be at least 3'); return }
    if (memPoints > MAX_MEM_CALCULATION_POINTS) { message.error(`MEM calculation points must not exceed ${MAX_MEM_CALCULATION_POINTS}`); return }
    if (nn != null && (!Number.isInteger(nn) || nn < 2 || nn >= memPoints)) {
      message.error(`NN must be an integer between 2 and N_MEM - 1 (${memPoints - 1})`)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const fitParams: FittingParams = { nr_real: nrReal, nr_imag: nrImag, peaks }
      const data = await api.runMemCompare(file, nn ?? undefined, memPoints, selectedColumn, fitParams)
      setResult(data)
      setPhaseSelectionMode('default')
      setPhaseAngle(0)
      if (comparisonRef.current) Plotly.purge(comparisonRef.current)
      if (diffRef.current) Plotly.purge(diffRef.current)
      if (nrmseRef.current) Plotly.purge(nrmseRef.current)
      if (intensityRef.current) Plotly.purge(intensityRef.current)
    } catch (e: any) {
      setError(api.getApiErrorMessage(e))
    } finally { setTimeout(() => setLoading(false), 100) }
  }

  const handleExportDiff = () => {
    if (!phaseScanData || 'alignmentError' in phaseScanData) return
    const lines = [
      '# N_original,' + cell(result?.n_original),
      '# N_MEM,' + cell(result?.n_mem),
      '# original_frequency_range,' + rangeText(result?.original_frequency_range),
      '# mem_frequency_range,' + rangeText(result?.mem_frequency_range),
      '# resampling_method,' + cell(result?.resampling_method),
      '# NN,' + cell(result?.nn),
      '# error_phase_deg,' + cell(selectedPhaseDeg),
      '# error_phase_rad,' + cell(phaseAngle),
      '# default_display_phase_deg,' + cell(defaultPhaseSelection?.phaseDeg),
      '# default_display_phase_rad,' + cell(defaultPhaseSelection?.phaseRad),
      '# default_display_criterion,' + cell(defaultPhaseSelection?.criterionKey),
      '# primary_nrmse_source,' + (phaseScanData.windowMetrics ? 'selected_window' : 'full_range'),
      '# error_phase_scan_start_deg,' + cell(phaseScanStartDeg ?? undefined),
      '# error_phase_scan_end_deg,' + cell(phaseScanEndDeg ?? undefined),
      '# error_phase_scan_step_deg,' + cell(phaseScanStepDeg ?? undefined),
      '# note,' + cell(result?.resampling_note),
      '# full_range_cm-1,' + rangeText(phaseScanData.fullRange),
      '# full_re_nrmse_optimal_phase_deg,' + cell(phaseScanData.reBest.phaseDeg),
      '# full_re_nrmse_min,' + cell(phaseScanData.reBest.value),
      '# full_im_nrmse_optimal_phase_deg,' + cell(phaseScanData.imBest.phaseDeg),
      '# full_im_nrmse_min,' + cell(phaseScanData.imBest.value),
      '# NRMSE normalization,RMSE divided by RMS amplitude of the corresponding ideal spectrum',
      '# NRMSE epsilon,' + NRMSE_EPSILON,
      '# ideal_re_rms,' + cell(phaseScanData.idealReRmsRaw),
      '# ideal_im_rms,' + cell(phaseScanData.idealImRmsRaw),
      ...(windowNrmseEnabled ? [
        '# selected_window_requested_cm-1,' + rangeText(windowStart != null && windowEnd != null ? [windowStart, windowEnd] : undefined),
        '# selected_window_effective_cm-1,' + (phaseScanData.windowInfo ? rangeText([phaseScanData.windowInfo.effectiveStart, phaseScanData.windowInfo.effectiveEnd]) : ''),
        '# selected_window_points,' + cell(phaseScanData.windowInfo?.pointCount),
        '# window_re_nrmse_optimal_phase_deg,' + cell(phaseScanData.windowMetrics?.reBest.phaseDeg),
        '# window_re_nrmse_min,' + cell(phaseScanData.windowMetrics?.reBest.value),
        '# window_im_nrmse_optimal_phase_deg,' + cell(phaseScanData.windowMetrics?.imBest.phaseDeg),
        '# window_im_nrmse_min,' + cell(phaseScanData.windowMetrics?.imBest.value),
        ...(phaseScanData.windowError ? ['# selected_window_error,' + phaseScanData.windowError] : []),
      ] : []),
      ...phaseScanData.warnings.map((warning) => '# warning,' + warning),
      ...(phaseScanData.windowMetrics ? phaseScanData.windowMetrics.warnings.map((warning) => '# warning,' + warning) : []),
    ]
    const header = [
      'error_phase_deg',
      'error_phase_rad',
      're_nrmse',
      'im_nrmse',
      'RealDiff',
      'ImagDiff',
      're_absolute_error',
      'im_absolute_error',
      're_residual_std',
      'im_residual_std',
      're_nrmse_full',
      'im_nrmse_full',
    ]
    if (phaseScanData.windowMetrics && phaseScanData.windowInfo) {
      header.push(
        'window_start_cm-1',
        'window_end_cm-1',
        'window_points',
        're_nrmse_window',
        'im_nrmse_window',
      )
    }
    lines.push(header.join(','))
    for (let i = 0; i < phaseScanData.phaseRad.length; i++) {
      const primaryReNrmse = phaseScanData.windowMetrics ? phaseScanData.windowMetrics.reNrmse[i] : phaseScanData.reNrmse[i]
      const primaryImNrmse = phaseScanData.windowMetrics ? phaseScanData.windowMetrics.imNrmse[i] : phaseScanData.imNrmse[i]
      const row = [
        phaseScanData.phaseDeg[i].toFixed(6),
        phaseScanData.phaseRad[i].toFixed(8),
        primaryReNrmse.toExponential(6),
        primaryImNrmse.toExponential(6),
        phaseScanData.diffReal[i].toExponential(6),
        phaseScanData.diffImag[i].toExponential(6),
        phaseScanData.diffReal[i].toExponential(6),
        phaseScanData.diffImag[i].toExponential(6),
        phaseScanData.reResidualStd[i].toExponential(6),
        phaseScanData.imResidualStd[i].toExponential(6),
        phaseScanData.reNrmse[i].toExponential(6),
        phaseScanData.imNrmse[i].toExponential(6),
      ]
      if (phaseScanData.windowMetrics && phaseScanData.windowInfo) {
        row.push(
          String(phaseScanData.windowInfo.effectiveStart),
          String(phaseScanData.windowInfo.effectiveEnd),
          String(phaseScanData.windowInfo.pointCount),
          phaseScanData.windowMetrics.reNrmse[i].toExponential(6),
          phaseScanData.windowMetrics.imNrmse[i].toExponential(6),
        )
      }
      lines.push(row.join(','))
    }
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'MEM_vs_Fitting_Diff.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success('Difference data exported')
  }

  const handleExportComparison = () => {
    if (!result || !currentRotated) return
    const lines = [
      '# N_original,' + cell(result.n_original),
      '# N_MEM,' + cell(result.n_mem),
      '# original_frequency_range,' + rangeText(result.original_frequency_range),
      '# mem_frequency_range,' + rangeText(result.mem_frequency_range),
      '# resampling_method,' + cell(result.resampling_method),
      '# NN,' + cell(result.nn),
      '# error_phase_deg,' + cell(selectedPhaseDeg),
      '# error_phase_rad,' + cell(phaseAngle),
      '# phase_selection,' + currentSelectionLabel,
      '# default_display_phase_deg,' + cell(defaultPhaseSelection?.phaseDeg),
      '# default_display_phase_rad,' + cell(defaultPhaseSelection?.phaseRad),
      '# default_display_criterion,' + cell(defaultPhaseSelection?.criterionKey),
      '# note,' + cell(result.resampling_note),
      'frequency_original,intensity_original,frequency_mem,intensity_mem_input,fitting_intensity,Re_mem,Im_mem,Re_ideal_on_mem_grid,Im_ideal_on_mem_grid,Re_residual,Im_residual',
    ]
    const rowCount = Math.max(result.original_wavenumbers.length, result.mem_wavenumbers.length)
    for (let i = 0; i < rowCount; i++) {
      const reResidual = currentRotated.real[i] == null || result.fitting_real[i] == null ? undefined : currentRotated.real[i] - result.fitting_real[i]
      const imResidual = currentRotated.imag[i] == null || result.fitting_imag[i] == null ? undefined : currentRotated.imag[i] - result.fitting_imag[i]
      lines.push([
        cell(result.original_wavenumbers[i]),
        cell(result.original_intensity[i]),
        cell(result.mem_wavenumbers[i]),
        cell(result.mem_input_intensity[i]),
        cell(result.fitting_intensity[i]),
        cell(currentRotated.real[i]),
        cell(currentRotated.imag[i]),
        cell(result.fitting_real[i]),
        cell(result.fitting_imag[i]),
        cell(reResidual),
        cell(imResidual),
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'MEM_vs_Fitting_Comparison.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success('Comparison data exported')
  }

  const hasFile = file !== null
  const hasResult = result !== null

  return (
    <div>
      {error && <Alert type="error" message={error} closable style={{ marginBottom: 12 }} />}

      <Card size="small" title="Data Setup">
        <Row gutter={[12, 8]} align="middle">
          <Col xs={24} md={8}>
            <Upload accept=".csv" maxCount={1} showUploadList={false} beforeUpload={handleFileUpload}
              onRemove={() => {
                setFile(null)
                setFileName('')
                setColumns([])
                setOriginalPoints(null)
                setMemPoints(null)
                setMemPointsEdited(false)
                setWindowNrmseEnabled(false)
                setWindowStart(null)
                setWindowEnd(null)
                setWindowEdited(false)
              }}>
              <Button icon={<InboxOutlined />} disabled={loading}>
                {fileName || 'Select CSV File...'}
              </Button>
            </Upload>
          </Col>
          <Col xs={12} md={4}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <Text type="secondary">Column:</Text>
              <Select value={selectedColumn} onChange={(v) => setSelectedColumn(v)} style={{ width: 130 }}
                options={columns.map((c) => ({ value: c.index, label: `${c.index}: ${c.name}` }))}
                disabled={columns.length === 0} size="small" />
            </span>
          </Col>
          <Col xs={12} md={4}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <Text type="secondary">NN:</Text>
              <InputNumber min={2} max={9999} size="small" placeholder="auto" value={nn}
                onChange={(v) => setNn(v)} style={{ width: 80 }} />
            </span>
          </Col>
          <Col xs={24} md={5}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <Text type="secondary">MEM calculation points:</Text>
              <InputNumber min={3} max={MAX_MEM_CALCULATION_POINTS} size="small"
                placeholder={originalPoints != null ? String(originalPoints) : 'auto'} value={memPoints}
                onChange={(v) => { setMemPoints(v); setMemPointsEdited(true) }} style={{ width: 100 }} />
            </span>
          </Col>
          <Col xs={24} md={3} style={{ textAlign: 'right' }}>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} disabled={!hasFile}
              onClick={handleRun}>Run MEM &amp; Compare</Button>
          </Col>
        </Row>
        {originalPoints != null && (
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              N_original: {originalPoints}
              {memPoints != null ? ` | N_MEM: ${memPoints}` : ''}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              通过插值增加 MEM 计算点数不会增加原始光谱信息。
            </Text>
          </div>
        )}
      </Card>

      <Card size="small" title="Fitting Parameters" style={{ marginTop: 12 }}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Upload accept=".txt,.csv" maxCount={1} showUploadList={false} beforeUpload={handleImportParams}>
            <Button size="small" icon={<UploadOutlined />}>Import Params</Button>
          </Upload>
          <Button size="small" icon={<DownloadOutlined />} onClick={handleExportParams}>Export Params</Button>
          <Text strong>Phase unit</Text>
          <Select
            size="small"
            value={phaseUnit}
            onChange={setPhaseUnit}
            options={phaseUnitOptions}
            style={{ width: 150 }}
          />
        </Space>
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
          Phi display, manual input, parameter import and parameter export use this unit; backend calculation uses radians.
          Lorentzian width keeps the original Gamma HWHM convention; Gaussian broadening is FWHM for Voigt peaks.
        </Text>
        <Row gutter={[12, 8]}>
          <Col xs={12} md={6}>
            <InputNumber addonBefore="NR Real" value={nrReal} onChange={(v) => setNrReal(v ?? 0)}
              step={0.1} style={{ width: '100%' }} size="small" />
          </Col>
          <Col xs={12} md={6}>
            <InputNumber addonBefore="NR Imag" value={nrImag} onChange={(v) => setNrImag(v ?? 0)}
              step={0.1} style={{ width: '100%' }} size="small" />
          </Col>
          <Col>
            <Button size="small" icon={<PlusOutlined />} onClick={() => setPeaks([...peaks, emptyPeak()])}>Add Peak</Button>
          </Col>
        </Row>
        <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
          {peaks.map((p, i) => (
            <Col key={i} xs={24} sm={12} md={8} lg={6}>
              <Card size="small" title={`Peak ${i + 1}`} extra={
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setPeaks(peaks.filter((_, idx) => idx !== i))} />
              }>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Select
                    value={p.profile_type ?? 'lorentzian'}
                    onChange={(value) => setPeaks(peaks.map((pp, ii) => (
                      ii === i ? { ...pp, profile_type: normalizeProfileType(value) } : pp
                    )))}
                    options={profileTypeOptions}
                    style={{ width: '100%' }}
                    size="small"
                  />
                  <InputNumber addonBefore="A" value={p.amplitude} onChange={(v) => {
                    if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, amplitude: v } : pp))
                  }} step={0.1} style={{ width: '100%' }} size="small" />
                  <InputNumber addonBefore="Omega" value={p.center} onChange={(v) => {
                    if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, center: v } : pp))
                  }} step={1} style={{ width: '100%' }} size="small" />
                  <InputNumber addonBefore="L HWHM" value={p.width} onChange={(v) => {
                    if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, width: v } : pp))
                  }} step={0.5} min={0.1} style={{ width: '100%' }} size="small" />
                  <InputNumber
                    addonBefore="G FWHM"
                    value={p.gaussian_fwhm ?? 0}
                    disabled={(p.profile_type ?? 'lorentzian') === 'lorentzian'}
                    onChange={(v) => {
                      if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, gaussian_fwhm: v } : pp))
                    }}
                    step={0.5}
                    min={0}
                    style={{ width: '100%' }}
                    size="small"
                  />
                  <InputNumber
                    addonBefore={`Phase (${phaseUnitSymbol(phaseUnit)})`}
                    value={phaseToDisplay(p.phase, phaseUnit)}
                    onChange={(v) => {
                      if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, phase: phaseFromDisplay(v, phaseUnit) } : pp))
                    }}
                    step={phaseInputStep(phaseUnit)}
                    style={{ width: '100%' }}
                    size="small"
                  />
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      {!hasResult && (
        <div style={{ padding: 60, textAlign: 'center', background: '#fff', borderRadius: 8, marginTop: 12 }}>
          <Empty description="Upload a CSV and set fitting parameters, then click Run" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      )}

      {hasResult && result && (
        <>
          <Card size="small" style={{ marginTop: 12 }}>
            <div ref={intensityRef} style={{ width: '100%', minHeight: 350 }} />
          </Card>

          <Card size="small" title="MEM and Fitting Re/Im" style={{ marginTop: 12 }}
            extra={<Button size="small" icon={<DownloadOutlined />} onClick={handleExportComparison}>Export Comparison CSV</Button>}>
            <div ref={comparisonRef} style={{ width: '100%', minHeight: 400 }} />
          </Card>

          <Card size="small" title="Error Phase Adjustment" style={{ marginTop: 12 }}>
            <Row gutter={[12, 8]} align="middle" style={{ marginBottom: 8 }}>
              <Col>
                <InputNumber
                  addonBefore="Error phase start (\u00b0)"
                  value={phaseScanStartDeg}
                  step={0.5}
                  onChange={(v) => {
                    setPhaseScanStartDeg(v)
                    setPhaseSelectionMode('default')
                  }}
                  style={{ width: 200 }}
                  size="small"
                />
              </Col>
              <Col>
                <InputNumber
                  addonBefore="Error phase end (\u00b0)"
                  value={phaseScanEndDeg}
                  step={0.5}
                  onChange={(v) => {
                    setPhaseScanEndDeg(v)
                    setPhaseSelectionMode('default')
                  }}
                  style={{ width: 190 }}
                  size="small"
                />
              </Col>
              <Col>
                <InputNumber
                  addonBefore="Error phase step (\u00b0)"
                  value={phaseScanStepDeg}
                  min={0.000001}
                  step={0.5}
                  onChange={(v) => {
                    setPhaseScanStepDeg(v)
                    setPhaseSelectionMode('default')
                  }}
                  style={{ width: 190 }}
                  size="small"
                />
              </Col>
            </Row>
            <Row gutter={16} align="middle">
              <Col flex="auto">
                <Slider
                  min={phaseSliderMinDeg}
                  max={phaseSliderMaxDeg}
                  step={phaseScanStepDeg && phaseScanStepDeg > 0 ? phaseScanStepDeg : DEFAULT_PHASE_SCAN_STEP_DEG}
                  value={selectedPhaseDeg}
                  disabled={!!phaseScanConfig.error}
                  onChange={(v) => {
                    setPhaseAngle(degToRad(v as number))
                    setPhaseSelectionMode('manual')
                  }}
                />
              </Col>
              <Col>
                <Space wrap>
                  <Text>Selected error phase (\u00b0)</Text>
                  <InputNumber
                    min={phaseSliderMinDeg}
                    max={phaseSliderMaxDeg}
                    value={selectedPhaseDeg}
                    step={phaseScanStepDeg && phaseScanStepDeg > 0 ? phaseScanStepDeg : DEFAULT_PHASE_SCAN_STEP_DEG}
                    precision={6}
                    onChange={(v) => {
                      if (v != null) {
                        setPhaseAngle(degToRad(v))
                        setPhaseSelectionMode('manual')
                      }
                    }}
                    style={{ width: 120 }}
                    size="small"
                  />
                  <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                    {selectedPhaseDeg.toFixed(2)}\u00b0 = {phaseAngle.toFixed(6)} rad
                  </Text>
                  <Button
                    icon={<UndoOutlined />}
                    size="small"
                    onClick={() => {
                      setPhaseSelectionMode('default')
                      if (defaultPhaseSelection) setPhaseAngle(defaultPhaseSelection.phaseRad)
                    }}
                  >
                    Use Im-NRMSE default
                  </Button>
                </Space>
              </Col>
            </Row>
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 6 }}>
              GUI phase inputs and scan settings use degrees; internal MEM rotation uses radians.
            </Text>
            {phaseScanConfig.error && (
              <Alert type="warning" message={phaseScanConfig.error} showIcon style={{ marginTop: 8 }} />
            )}
          </Card>

          <Card size="small" title="Error Phase Difference" style={{ marginTop: 12 }}
            extra={<Button size="small" icon={<DownloadOutlined />} onClick={handleExportDiff} disabled={!phaseScanData || 'alignmentError' in phaseScanData}>Export CSV</Button>}>
            <div ref={diffRef} style={{ width: '100%', minHeight: 350 }} />
          </Card>

          <Card size="small" title="NRMSE for Error-Phase Optimization" style={{ marginTop: 12 }}>
            {phaseScanData && 'alignmentError' in phaseScanData ? (
              <Alert type="error" message={phaseScanData.alignmentError} showIcon />
            ) : phaseScanData ? (
              <>
                <Row gutter={[12, 8]} align="middle" style={{ marginBottom: 8 }}>
                  <Col>
                    <Space>
                      <Text>Enable selected spectral window NRMSE</Text>
                      <Switch
                        checked={windowNrmseEnabled}
                        onChange={(checked) => {
                          setWindowNrmseEnabled(checked)
                          setPhaseSelectionMode('default')
                        }}
                      />
                    </Space>
                  </Col>
                  <Col>
                    <InputNumber
                      addonBefore="Window start"
                      value={windowStart}
                      disabled={!windowNrmseEnabled}
                      onChange={(v) => {
                        setWindowStart(v)
                        setWindowEdited(true)
                        setPhaseSelectionMode('default')
                      }}
                      style={{ width: 180 }}
                      size="small"
                    />
                  </Col>
                  <Col>
                    <InputNumber
                      addonBefore="Window end"
                      value={windowEnd}
                      disabled={!windowNrmseEnabled}
                      onChange={(v) => {
                        setWindowEnd(v)
                        setWindowEdited(true)
                        setPhaseSelectionMode('default')
                      }}
                      style={{ width: 180 }}
                      size="small"
                    />
                  </Col>
                  <Col>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Full range: {phaseScanData.fullRange[0].toFixed(2)}-{phaseScanData.fullRange[1].toFixed(2)} cm^-1
                    </Text>
                  </Col>
                </Row>
                {defaultPhaseSelection && (
                  <Space wrap style={{ marginBottom: 8, display: 'flex' }}>
                    <Text type="secondary">
                      Default displayed phase: {defaultPhaseSelection.phaseDeg.toFixed(2)}\u00b0
                    </Text>
                    <Text type="secondary">
                      Equivalent internal phase: {defaultPhaseSelection.phaseRad.toFixed(6)} rad
                    </Text>
                    <Text type="secondary">
                      Selection criterion: {defaultPhaseSelection.label}
                    </Text>
                    {defaultPhaseSelection.windowLabel && (
                      <Text type="secondary">
                        Window: {defaultPhaseSelection.windowLabel}
                      </Text>
                    )}
                    <Text type="secondary">
                      Minimum Im-NRMSE: {defaultPhaseSelection.imNrmse.toExponential(4)}
                    </Text>
                    <Text type="secondary">
                      Re-NRMSE at this phase: {defaultPhaseSelection.reNrmseAtPhase.toExponential(4)}
                    </Text>
                  </Space>
                )}
                <Space wrap style={{ marginBottom: 8 }}>
                  <Text type="secondary">
                    Full range minimum Re-NRMSE: {phaseScanData.reBest.value.toExponential(4)}
                  </Text>
                  <Text type="secondary">
                    Full range Re optimal phase: {phaseScanData.reBest.phaseDeg.toFixed(2)}\u00b0
                  </Text>
                  <Text type="secondary">
                    Full range minimum Im-NRMSE: {phaseScanData.imBest.value.toExponential(4)}
                  </Text>
                  <Text type="secondary">
                    Full range Im optimal phase: {phaseScanData.imBest.phaseDeg.toFixed(2)}\u00b0
                  </Text>
                </Space>
                {windowNrmseEnabled && phaseScanData.windowInfo && phaseScanData.windowMetrics && (
                  <Space wrap style={{ marginBottom: 8, display: 'flex' }}>
                    <Text type="secondary">
                      Selected window: {phaseScanData.windowInfo.effectiveStart.toFixed(2)}-{phaseScanData.windowInfo.effectiveEnd.toFixed(2)} cm^-1
                    </Text>
                    <Text type="secondary">
                      Window points: {phaseScanData.windowInfo.pointCount}
                    </Text>
                    <Text type="secondary">
                      Window minimum Re-NRMSE: {phaseScanData.windowMetrics.reBest.value.toExponential(4)}
                    </Text>
                    <Text type="secondary">
                      Window Re optimal phase: {phaseScanData.windowMetrics.reBest.phaseDeg.toFixed(2)}\u00b0
                    </Text>
                    <Text type="secondary">
                      Window minimum Im-NRMSE: {phaseScanData.windowMetrics.imBest.value.toExponential(4)}
                    </Text>
                    <Text type="secondary">
                      Window Im optimal phase: {phaseScanData.windowMetrics.imBest.phaseDeg.toFixed(2)}\u00b0
                    </Text>
                  </Space>
                )}
                {windowNrmseEnabled && phaseScanData.windowError && (
                  <Alert
                    type="warning"
                    message={phaseScanData.windowError}
                    showIcon
                    style={{ marginBottom: 8 }}
                  />
                )}
                {phaseScanData.warnings.length > 0 && (
                  <Alert
                    type="warning"
                    message={phaseScanData.warnings.join(' ')}
                    showIcon
                    style={{ marginBottom: 8 }}
                  />
                )}
                {phaseScanData.windowMetrics && phaseScanData.windowMetrics.warnings.length > 0 && (
                  <Alert
                    type="warning"
                    message={phaseScanData.windowMetrics.warnings.join(' ')}
                    showIcon
                    style={{ marginBottom: 8 }}
                  />
                )}
                <div ref={nrmseRef} style={{ width: '100%', minHeight: 350 }} />
              </>
            ) : null}
          </Card>
        </>
      )}
    </div>
  )
}
