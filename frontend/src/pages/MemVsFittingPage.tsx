import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Row, Col, Card, InputNumber, Button, Typography, message, Space,
  Alert, Upload, Select, Slider, Empty, Switch, Checkbox,
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
import {
  gaussianHwhmToFwhm,
  gaussianHwhmToSigma,
  peakGaussianHwhm,
  peakWidthSummaryLines,
} from '../utils/lineShapeWidths'
import {
  NRMSE_EPSILON,
  alignReferenceToGrid,
  autoDetectReferenceColumns,
  buildReferenceSpectrumFromTable,
  parseReferenceTable,
  type ReferenceColumnSelection,
  type ReferenceSpectrum,
  type ReferenceTable,
} from '../utils/referenceSpectrum'
import { ensurePlotly, plotWhenReady, purgePlot } from '../utils/plotlyLoader'

const { Text } = Typography

const DEFAULT_PHASE_SCAN_START_DEG = 0
const DEFAULT_PHASE_SCAN_END_DEG = 360
const DEFAULT_PHASE_SCAN_STEP_DEG = 0.5
const MAX_PHASE_SCAN_POINTS = 5000
const MAX_MEM_CALCULATION_POINTS = 20000
const DEFAULT_EDGE_PADDING_WIDTH = 1000

const chartConfig = {
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  displaylogo: false,
  scrollZoom: true,
}

function emptyPeak(): SfgPeakParams {
  return { amplitude: 1.0, center: 3200, width: 10, phase: 0, profile_type: 'lorentzian', gaussian_hwhm: 0 }
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

function readOriginalRange(text: string): [number, number] | null {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const values: number[] = []
  for (const row of rows) {
    const first = row.split(',')[0]?.trim()
    const parsed = Number(first)
    if (Number.isFinite(parsed)) values.push(parsed)
  }
  if (values.length < 2) return null
  return [Math.min(...values), Math.max(...values)]
}

function valuesAtIndices(values: number[], indices: number[]): number[] {
  return indices.map((index) => values[index]).filter((value) => value != null)
}

function expandEvaluationValues(totalLength: number, indices: number[], values: number[]): number[] {
  const expanded: number[] = Array(totalLength).fill(Number.NaN)
  indices.forEach((index, valueIndex) => {
    expanded[index] = values[valueIndex]
  })
  return expanded
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

interface ComparisonReference {
  source: 'peak_parameters' | 'external_reference'
  label: string
  real: number[]
  imag: number[]
  intensity: number[]
  alignmentMethod: string
  originalPointCount?: number
  originalFrequencyRange?: [number, number]
}

function buildNrmseSeries(
  result: MemCompareResult,
  reference: ComparisonReference,
  phaseValues: number[],
  pointIndices: number[],
  label: string,
) {
  const referenceRe = pointIndices.map((index) => reference.real[index])
  const referenceIm = pointIndices.map((index) => reference.imag[index])
  const referenceReRmsRaw = rms(referenceRe)
  const referenceImRmsRaw = rms(referenceIm)
  const referenceReRms = Math.max(referenceReRmsRaw, NRMSE_EPSILON)
  const referenceImRms = Math.max(referenceImRmsRaw, NRMSE_EPSILON)
  const warnings: string[] = []
  if (referenceReRmsRaw < NRMSE_EPSILON) warnings.push(`${label} reference Re RMS is near zero; Re-NRMSE used epsilon normalization.`)
  if (referenceImRmsRaw < NRMSE_EPSILON) warnings.push(`${label} reference Im RMS is near zero; Im-NRMSE used epsilon normalization.`)

  // Legacy error metrics are kept internally but hidden from the GUI. NRMSE is the recommended metric.
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
      const residualReal = rotatedReal - reference.real[i]
      const residualImag = rotatedImag - reference.imag[i]
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
    reNrmse.push(Math.sqrt(meanSqR) / referenceReRms)
    imNrmse.push(Math.sqrt(meanSqI) / referenceImRms)
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
    idealReRmsRaw: referenceReRmsRaw,
    idealImRmsRaw: referenceImRmsRaw,
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
  reference: ComparisonReference,
  phaseValues: number[],
  windowOptions?: { enabled: boolean; start: number | null; end: number | null },
) {
  const n = result.mem_real.length
  const aligned = n > 0
    && result.mem_imag.length === n
    && reference.real.length === n
    && reference.imag.length === n
    && result.wavenumbers.length === n
    && result.mem_wavenumbers.length === n
    && result.wavenumbers.every((value, index) => Math.abs(value - result.mem_wavenumbers[index]) < 1e-9)

  if (!aligned) {
    return {
      alignmentError: 'MEM and reference Re/Im arrays are not on the same frequency grid; phase scan metrics were not calculated.',
    }
  }

  const phaseDeg = phaseValues.map(radToDeg)
  const fullPointIndices = result.evaluation_indices?.length
    ? result.evaluation_indices
    : result.wavenumbers.map((_, index) => index)
  if (fullPointIndices.length < 3) {
    return {
      alignmentError: 'Original evaluation range must contain at least 3 MEM grid points before NRMSE calculation.',
    }
  }
  const fullRangeLabel = result.edge_padding_enabled ? 'Original evaluation range' : 'Full range'
  const fullMetrics = buildNrmseSeries(result, reference, phaseValues, fullPointIndices, fullRangeLabel)
  const spectrumStart = result.evaluation_frequency_range?.[0] ?? Math.min(...result.wavenumbers)
  const spectrumEnd = result.evaluation_frequency_range?.[1] ?? Math.max(...result.wavenumbers)

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
          windowMetrics = buildNrmseSeries(result, reference, phaseValues, windowPointIndices, 'Selected window')
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
    referenceSource: reference.source,
    referenceLabel: reference.label,
    referenceAlignmentMethod: reference.alignmentMethod,
    fullRange: [spectrumStart, spectrumEnd] as [number, number],
    fullRangeLabel,
    fullPointCount: fullMetrics.pointCount,
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
  const [originalRange, setOriginalRange] = useState<[number, number] | null>(null)
  const [memPointsEdited, setMemPointsEdited] = useState(false)
  const [edgePaddingEnabled, setEdgePaddingEnabled] = useState(true)
  const [leftPaddingWidth, setLeftPaddingWidth] = useState<number | null>(DEFAULT_EDGE_PADDING_WIDTH)
  const [rightPaddingWidth, setRightPaddingWidth] = useState<number | null>(DEFAULT_EDGE_PADDING_WIDTH)

  const [nrReal, setNrReal] = useState(0.0)
  const [nrImag, setNrImag] = useState(0.0)
  const [peaks, setPeaks] = useState<SfgPeakParams[]>([])
  const [phaseUnit, setPhaseUnit] = useState<PhaseUnit>('degrees')
  const [externalReferenceTable, setExternalReferenceTable] = useState<ReferenceTable | null>(null)
  const [externalReferenceSelection, setExternalReferenceSelection] = useState<ReferenceColumnSelection | null>(null)
  const [externalReference, setExternalReference] = useState<ReferenceSpectrum | null>(null)
  const [externalReferenceError, setExternalReferenceError] = useState<string | null>(null)

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
  const nrmseRef = useRef<HTMLDivElement>(null)
  const intensityRef = useRef<HTMLDivElement>(null)

  const phaseScanConfig = useMemo(() => (
    buildPhaseValuesFromDegrees(phaseScanStartDeg, phaseScanEndDeg, phaseScanStepDeg)
  ), [phaseScanStartDeg, phaseScanEndDeg, phaseScanStepDeg])

  const phaseValues = phaseScanConfig.phaseValues

  const externalReferenceColumnOptions = externalReferenceTable?.columns.map((column) => ({
    value: column.index,
    label: `${column.index}: ${column.name}`,
  })) ?? []

  const evaluationIndices = useMemo(() => {
    if (!result) return []
    return result.evaluation_indices?.length
      ? result.evaluation_indices
      : result.wavenumbers.map((_, index) => index)
  }, [result])

  const evaluationWavenumbers = useMemo(() => (
    result ? valuesAtIndices(result.wavenumbers, evaluationIndices) : []
  ), [result, evaluationIndices])

  const alignedExternalReference = useMemo(() => {
    if (!result || !externalReference) return null
    return alignReferenceToGrid(externalReference, evaluationWavenumbers)
  }, [result, externalReference, evaluationWavenumbers])

  const activeReference = useMemo<ComparisonReference | null>(() => {
    if (!result) return null
    if (alignedExternalReference?.aligned) {
      const aligned = alignedExternalReference.aligned
      const totalLength = result.wavenumbers.length
      return {
        source: 'external_reference',
        label: `External Re/Im reference: ${aligned.name}`,
        real: expandEvaluationValues(totalLength, evaluationIndices, aligned.real),
        imag: expandEvaluationValues(totalLength, evaluationIndices, aligned.imag),
        intensity: expandEvaluationValues(totalLength, evaluationIndices, aligned.intensity),
        alignmentMethod: `${aligned.method}; evaluated only over original spectrum range`,
        originalPointCount: aligned.originalPointCount,
        originalFrequencyRange: aligned.originalFrequencyRange,
      }
    }
    return {
      source: 'peak_parameters',
      label: 'Peak-parameter ideal spectrum',
      real: result.fitting_real,
      imag: result.fitting_imag,
      intensity: result.fitting_intensity,
      alignmentMethod: 'Generated directly on the MEM output grid; evaluated only over original spectrum range',
    }
  }, [result, alignedExternalReference, evaluationIndices])

  const phaseScanData = useMemo(() => {
    if (!result || !activeReference || phaseValues.length === 0) return null
    return buildPhaseScanData(result, activeReference, phaseValues, {
      enabled: windowNrmseEnabled,
      start: windowStart,
      end: windowEnd,
    })
  }, [result, activeReference, phaseValues, windowNrmseEnabled, windowStart, windowEnd])

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
      criterionKey: result?.edge_padding_enabled ? 'minimum_im_nrmse_original_evaluation_range' : 'minimum_im_nrmse_full',
      label: `${phaseScanData.fullRangeLabel} minimum Im-NRMSE`,
      windowLabel: '',
    }
  }, [phaseScanData, windowNrmseEnabled, result])

  const displayedPhaseAngle = phaseSelectionMode === 'default' && defaultPhaseSelection
    ? defaultPhaseSelection.phaseRad
    : phaseAngle
  const selectedPhaseDeg = radToDeg(displayedPhaseAngle)
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
    const cosA = Math.cos(displayedPhaseAngle)
    const sinA = Math.sin(displayedPhaseAngle)
    const rotReal: number[] = []
    const rotImag: number[] = []
    for (let i = 0; i < result.mem_real.length; i++) {
      rotReal.push(result.mem_real[i] * cosA - result.mem_imag[i] * sinA)
      rotImag.push(result.mem_real[i] * sinA + result.mem_imag[i] * cosA)
    }
    return { real: rotReal, imag: rotImag }
  }, [result, displayedPhaseAngle])

  const currentRotatedEval = useMemo(() => {
    if (!currentRotated) return null
    return {
      real: valuesAtIndices(currentRotated.real, evaluationIndices),
      imag: valuesAtIndices(currentRotated.imag, evaluationIndices),
    }
  }, [currentRotated, evaluationIndices])

  const activeReferenceEval = useMemo(() => {
    if (!activeReference) return null
    return {
      real: valuesAtIndices(activeReference.real, evaluationIndices),
      imag: valuesAtIndices(activeReference.imag, evaluationIndices),
      intensity: valuesAtIndices(activeReference.intensity, evaluationIndices),
    }
  }, [activeReference, evaluationIndices])

  useEffect(() => {
    const container = comparisonRef.current
    if (!result || !activeReference || !activeReferenceEval || !currentRotatedEval || !container) return
    const w = safeArr(evaluationWavenumbers)
    const rot = currentRotatedEval
    const traces = [
      { x: w, y: safeArr(rot.real), type: 'scatter', mode: 'lines', name: 'MEM Re[chi]', line: { color: '#e74c3c', width: 2 } },
      { x: w, y: safeArr(activeReferenceEval.real), type: 'scatter', mode: 'lines', name: `${activeReference.label} Re[chi]`, line: { color: '#e74c3c', width: 1.5, dash: 'dash' } },
      { x: w, y: safeArr(rot.imag), type: 'scatter', mode: 'lines', name: 'MEM Im[chi]', line: { color: '#3498db', width: 2 } },
      { x: w, y: safeArr(activeReferenceEval.imag), type: 'scatter', mode: 'lines', name: `${activeReference.label} Im[chi]`, line: { color: '#3498db', width: 1.5, dash: 'dash' } },
    ]
    return plotWhenReady(container, traces, {
      title: {
        text: `MEM reconstruction at error phase = ${selectedPhaseDeg.toFixed(2)}\u00b0 (${displayedPhaseAngle.toFixed(6)} rad)<br><sup>Selection: ${currentSelectionLabel}; reference: ${activeReference.label}; residual/NRMSE only over ${result.evaluation_frequency_range[0]}-${result.evaluation_frequency_range[1]} cm^-1</sup>`,
        font: { size: 14 },
      },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: 'chi' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, chartConfig)
  }, [result, activeReference, activeReferenceEval, currentRotatedEval, evaluationWavenumbers, selectedPhaseDeg, displayedPhaseAngle, currentSelectionLabel])

  useEffect(() => {
    const container = intensityRef.current
    if (!result || !activeReference || !activeReferenceEval || !container) return
    const originalW = safeArr(result.original_wavenumbers)
    const memW = safeArr(result.mem_wavenumbers)
    const traces: PlotlyTrace[] = [
      {
        x: originalW, y: safeArr(result.original_intensity),
        type: 'scatter', mode: 'lines',
        name: 'Original spectrum',
        line: { color: '#1677ff', width: 1.8 },
      },
      {
        x: memW, y: safeArr(result.mem_input_intensity),
        type: 'scatter', mode: 'lines',
        name: result.edge_padding_enabled ? 'Padded MEM input spectrum' : 'MEM input spectrum',
        line: { color: '#f39c12', width: 1.5, dash: 'dash' },
      },
      {
        x: safeArr(evaluationWavenumbers), y: safeArr(activeReferenceEval.intensity),
        type: 'scatter', mode: 'lines',
        name: activeReference.source === 'external_reference' ? 'External reference |chi|^2 from Re/Im' : 'Ideal spectrum from peak parameters',
        line: { color: '#8e44ad', width: 1.8, dash: 'dot' },
      },
    ]
    const shapes: Array<Record<string, unknown>> = []
    if (result.edge_padding_enabled) {
      const [originalStart, originalEnd] = result.original_frequency_range
      const [memStart, memEnd] = result.mem_frequency_range
      shapes.push(
        { type: 'rect', xref: 'x', yref: 'paper', x0: memStart, x1: originalStart, y0: 0, y1: 1, fillcolor: 'rgba(243, 156, 18, 0.10)', line: { width: 0 }, layer: 'below' },
        { type: 'rect', xref: 'x', yref: 'paper', x0: originalEnd, x1: memEnd, y0: 0, y1: 1, fillcolor: 'rgba(243, 156, 18, 0.10)', line: { width: 0 }, layer: 'below' },
        { type: 'line', xref: 'x', yref: 'paper', x0: originalStart, x1: originalStart, y0: 0, y1: 1, line: { color: '#666', width: 1, dash: 'dot' } },
        { type: 'line', xref: 'x', yref: 'paper', x0: originalEnd, x1: originalEnd, y0: 0, y1: 1, line: { color: '#666', width: 1, dash: 'dot' } },
      )
    }
    return plotWhenReady(container, traces, {
      title: { text: `Intensity Comparison: Import vs ${activeReference.source === 'external_reference' ? 'External Re/Im Reference' : 'Peak-parameter Ideal'}<br><sup>Original/evaluation range: ${result.evaluation_frequency_range[0]}-${result.evaluation_frequency_range[1]} cm^-1${result.edge_padding_enabled ? '; shaded regions are edge padding' : ''}</sup>`, font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: '|chi|^2' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
      shapes,
    }, chartConfig)
  }, [result, activeReference, activeReferenceEval, evaluationWavenumbers])

  useEffect(() => {
    const nrmseContainer = nrmseRef.current as PlotlyHTMLElement | null
    if (!result || !phaseScanData || 'alignmentError' in phaseScanData || !nrmseContainer) return
    const nrmseYValues = phaseScanData.reNrmse.concat(phaseScanData.imNrmse)
      .concat(phaseScanData.windowMetrics ? phaseScanData.windowMetrics.reNrmse.concat(phaseScanData.windowMetrics.imNrmse) : [])
    const yMax = Math.max(...nrmseYValues) * 1.1 || 1
    const traces: PlotlyTrace[] = [
      {
        x: phaseScanData.phaseDeg,
        y: phaseScanData.reNrmse,
        type: 'scatter',
        mode: 'lines',
        name: `${phaseScanData.fullRangeLabel} Re-NRMSE`,
        line: { color: '#c0392b', width: 2 },
      },
      {
        x: phaseScanData.phaseDeg,
        y: phaseScanData.imNrmse,
        type: 'scatter',
        mode: 'lines',
        name: `${phaseScanData.fullRangeLabel} Im-NRMSE`,
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
    const layout = {
      title: { text: `${phaseScanData.fullRangeLabel} and Selected window NRMSE vs Error Phase<br><sup>Reference: ${phaseScanData.referenceLabel}; NRMSE evaluated only over original range ${phaseScanData.fullRange[0]}-${phaseScanData.fullRange[1]} cm^-1</sup>`, font: { size: 14 } },
      xaxis: { title: 'Error phase (\u00b0)', range: [Math.min(...phaseScanData.phaseDeg), Math.max(...phaseScanData.phaseDeg)] },
      yaxis: { title: 'NRMSE' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }
    const onClick = (eventData: PlotlyClickEvent) => {
      const rawX = eventData.points?.[0]?.x
      const x = typeof rawX === 'number' ? rawX : Number(rawX)
      if (Number.isFinite(x)) {
        setPhaseAngle(degToRad(x))
        setPhaseSelectionMode('manual')
      }
    }
    let cancelled = false
    void ensurePlotly()
      .then(async (Plotly) => {
        if (cancelled) return
        await Plotly.newPlot(nrmseContainer, traces, layout, chartConfig)
        if (cancelled) {
          purgePlot(nrmseContainer)
          return
        }
        nrmseContainer.on?.('plotly_click', onClick)
      })
      .catch((error) => {
        if (!cancelled) console.error('Unable to load Plotly', error)
      })
    return () => {
      cancelled = true
      nrmseContainer.removeAllListeners?.('plotly_click')
      purgePlot(nrmseContainer)
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
      const range = readOriginalRange(text)
      setColumns(cols)
      setSelectedColumn(1)
      setOriginalPoints(pointCount)
      setOriginalRange(range)
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
        message.warning('No valid peak parameters found')
      }
    }
    reader.readAsText(f)
    return false
  }

  const handleExportParams = () => {
    const lines = [
      '# MEM vs Fitting peak parameters',
      `# Phase unit: ${phaseUnitName(phaseUnit)}`,
      `NR_Real=${formatParameterNumber(nrReal)}`,
      `NR_Imag=${formatParameterNumber(nrImag)}`,
    ]
    peaks.forEach((peak, index) => {
      const n = index + 1
      const gaussianHwhm = peakGaussianHwhm(peak)
      lines.push(
        `Profile${n}=${peak.profile_type ?? 'lorentzian'}`,
        `A${n}=${formatParameterNumber(peak.amplitude)}`,
        `Omega${n}=${formatParameterNumber(peak.center)}`,
        `Gamma${n}=${formatParameterNumber(peak.width)}`,
        `Lorentzian_HWHM${n}=${formatParameterNumber(peak.width)}`,
        `Lorentzian_FWHM${n}=${formatParameterNumber(2 * peak.width)}`,
        `Gaussian_HWHM${n}=${formatParameterNumber(gaussianHwhm)}`,
        `Gaussian_FWHM${n}=${formatParameterNumber(gaussianHwhmToFwhm(gaussianHwhm))}`,
        `Gaussian_sigma${n}=${formatParameterNumber(gaussianHwhmToSigma(gaussianHwhm))}`,
        `Phi${n}=${formatPhaseForUnit(peak.phase, phaseUnit)}`,
      )
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'Peak_parameters.txt'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success(`Peak parameters exported (Phase unit: ${phaseUnitName(phaseUnit)})`)
  }

  const applyExternalReferenceSelection = (
    table = externalReferenceTable,
    selection = externalReferenceSelection,
    showSuccess = true,
  ) => {
    if (!table || !selection) return
    try {
      const parsed = buildReferenceSpectrumFromTable(table, selection)
      setExternalReference(parsed)
      setExternalReferenceError(null)
      setPhaseSelectionMode('default')
      if (showSuccess) {
        message.success(`Applied external Re/Im reference: ${parsed.pointCount} points`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to build external Re/Im reference from selected columns.'
      setExternalReferenceError(msg)
      message.error(msg)
    }
  }

  const handleExternalReferenceUpload = (f: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const table = parseReferenceTable(text, f.name)
        const detected = autoDetectReferenceColumns(table)
        const parsed = buildReferenceSpectrumFromTable(table, detected)
        setExternalReferenceTable(table)
        setExternalReferenceSelection(detected)
        setExternalReference(parsed)
        setExternalReferenceError(null)
        setPhaseSelectionMode('default')
        message.success(`Imported external Re/Im reference: ${parsed.pointCount} points; auto-selected columns ${detected.wavenumber}/${detected.real}/${detected.imag}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to parse external Re/Im reference file.'
        setExternalReferenceError(msg)
        message.error(msg)
      }
    }
    reader.readAsText(f)
    return false
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
    const leftWidth = leftPaddingWidth ?? 0
    const rightWidth = rightPaddingWidth ?? 0
    if (!Number.isFinite(leftWidth) || !Number.isFinite(rightWidth) || leftWidth < 0 || rightWidth < 0) {
      message.error('Left and right padding widths must be finite numbers greater than or equal to 0')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const fitParams: FittingParams = { nr_real: nrReal, nr_imag: nrImag, peaks }
      const data = await api.runMemCompare(file, nn ?? undefined, memPoints, selectedColumn, fitParams, {
        enabled: edgePaddingEnabled && (leftWidth > 0 || rightWidth > 0),
        leftWidth,
        rightWidth,
      })
      setResult(data)
      if (!windowEdited || windowStart == null || windowEnd == null) {
        setWindowStart(data.evaluation_frequency_range[0])
        setWindowEnd(data.evaluation_frequency_range[1])
      setWindowEdited(false)
      }
      setPhaseSelectionMode('default')
      setPhaseAngle(0)
      purgePlot(comparisonRef.current)
      purgePlot(nrmseRef.current)
      purgePlot(intensityRef.current)
    } catch (e: unknown) {
      setError(api.getApiErrorMessage(e))
    } finally { setTimeout(() => setLoading(false), 100) }
  }

  const handleExportNrmse = () => {
    if (!phaseScanData || 'alignmentError' in phaseScanData) return
    const lines = [
      '# N_original,' + cell(result?.n_original),
      '# N_MEM,' + cell(result?.n_mem),
      '# N_eval,' + cell(result?.n_eval),
      '# original_frequency_range,' + rangeText(result?.original_frequency_range),
      '# mem_frequency_range,' + rangeText(result?.mem_frequency_range),
      '# padded_frequency_range,' + rangeText(result?.padded_frequency_range),
      '# evaluation_frequency_range,' + rangeText(result?.evaluation_frequency_range),
      '# edge_padding_enabled,' + cell(result?.edge_padding_enabled ? 'true' : 'false'),
      '# left_padding_width_cm-1,' + cell(result?.left_padding_width),
      '# right_padding_width_cm-1,' + cell(result?.right_padding_width),
      '# resampling_method,' + cell(result?.resampling_method),
      '# NN,' + cell(result?.nn),
      '# error_phase_deg,' + cell(selectedPhaseDeg),
      '# error_phase_rad,' + cell(displayedPhaseAngle),
      '# default_display_phase_deg,' + cell(defaultPhaseSelection?.phaseDeg),
      '# default_display_phase_rad,' + cell(defaultPhaseSelection?.phaseRad),
      '# default_display_criterion,' + cell(defaultPhaseSelection?.criterionKey),
      '# primary_nrmse_source,' + (phaseScanData.windowMetrics ? 'selected_window' : 'full_range'),
      '# reference_source,' + cell(phaseScanData.referenceSource),
      '# reference_label,' + cell(phaseScanData.referenceLabel),
      '# reference_alignment_method,' + cell(phaseScanData.referenceAlignmentMethod),
      '# error_phase_scan_start_deg,' + cell(phaseScanStartDeg ?? undefined),
      '# error_phase_scan_end_deg,' + cell(phaseScanEndDeg ?? undefined),
      '# error_phase_scan_step_deg,' + cell(phaseScanStepDeg ?? undefined),
      '# note,' + cell(result?.resampling_note),
      '# evaluation_range_cm-1,' + rangeText(phaseScanData.fullRange),
      '# evaluation_points,' + cell(phaseScanData.fullPointCount),
      '# nrmse_scope,' + cell(phaseScanData.fullRangeLabel),
      '# padding_nrmse_note,Padding regions are not included in residual or NRMSE',
      '# evaluation_re_nrmse_optimal_phase_deg,' + cell(phaseScanData.reBest.phaseDeg),
      '# evaluation_re_nrmse_min,' + cell(phaseScanData.reBest.value),
      '# evaluation_im_nrmse_optimal_phase_deg,' + cell(phaseScanData.imBest.phaseDeg),
      '# evaluation_im_nrmse_min,' + cell(phaseScanData.imBest.value),
      '# NRMSE,Normalized Root Mean Square Error',
      '# NRMSE Chinese name,归一化均方根误差',
      '# NRMSE normalization,RMSE divided by RMS amplitude of the corresponding reference spectrum',
      '# NRMSE epsilon,' + NRMSE_EPSILON,
      '# reference_re_rms,' + cell(phaseScanData.idealReRmsRaw),
      '# reference_im_rms,' + cell(phaseScanData.idealImRmsRaw),
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
      're_nrmse_evaluation',
      'im_nrmse_evaluation',
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
      const row = [
        phaseScanData.phaseDeg[i].toFixed(6),
        phaseScanData.phaseRad[i].toFixed(8),
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
    const a = document.createElement('a'); a.href = url; a.download = 'MEM_vs_Fitting_NRMSE.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success('NRMSE data exported')
  }

  const handleExportComparison = () => {
    if (!result || !currentRotated || !currentRotatedEval || !activeReference || !activeReferenceEval) return
    const lines = [
      '# N_original,' + cell(result.n_original),
      '# N_MEM,' + cell(result.n_mem),
      '# N_eval,' + cell(result.n_eval),
      '# original_frequency_range,' + rangeText(result.original_frequency_range),
      '# mem_frequency_range,' + rangeText(result.mem_frequency_range),
      '# padded_frequency_range,' + rangeText(result.padded_frequency_range),
      '# evaluation_frequency_range,' + rangeText(result.evaluation_frequency_range),
      '# edge_padding_enabled,' + cell(result.edge_padding_enabled ? 'true' : 'false'),
      '# left_padding_width_cm-1,' + cell(result.left_padding_width),
      '# right_padding_width_cm-1,' + cell(result.right_padding_width),
      '# resampling_method,' + cell(result.resampling_method),
      '# NN,' + cell(result.nn),
      '# error_phase_deg,' + cell(selectedPhaseDeg),
      '# error_phase_rad,' + cell(displayedPhaseAngle),
      '# NRMSE evaluation range,' + rangeText(result.evaluation_frequency_range),
      '# padding_nrmse_note,Padding regions are not included in residual or NRMSE',
      '# phase_selection,' + currentSelectionLabel,
      '# default_display_phase_deg,' + cell(defaultPhaseSelection?.phaseDeg),
      '# default_display_phase_rad,' + cell(defaultPhaseSelection?.phaseRad),
      '# default_display_criterion,' + cell(defaultPhaseSelection?.criterionKey),
      '# reference_source,' + cell(activeReference.source),
      '# reference_label,' + cell(activeReference.label),
      '# reference_alignment_method,' + cell(activeReference.alignmentMethod),
      '# note,' + cell(result.resampling_note),
      'frequency_original,intensity_original,frequency_mem_padded,intensity_mem_input_padded,Re_MEM_padded,Im_MEM_padded,region,frequency_eval,intensity_mem_input_eval,reference_intensity_eval,Re_MEM_eval,Im_MEM_eval,Re_reference_eval,Im_reference_eval,Re_residual_eval,Im_residual_eval',
    ]
    const evalMemInputIntensity = valuesAtIndices(result.mem_input_intensity, evaluationIndices)
    const rowCount = Math.max(result.original_wavenumbers.length, result.mem_wavenumbers.length, evaluationWavenumbers.length)
    for (let i = 0; i < rowCount; i++) {
      const reResidual = currentRotatedEval.real[i] == null || activeReferenceEval.real[i] == null ? undefined : currentRotatedEval.real[i] - activeReferenceEval.real[i]
      const imResidual = currentRotatedEval.imag[i] == null || activeReferenceEval.imag[i] == null ? undefined : currentRotatedEval.imag[i] - activeReferenceEval.imag[i]
      lines.push([
        cell(result.original_wavenumbers[i]),
        cell(result.original_intensity[i]),
        cell(result.mem_wavenumbers[i]),
        cell(result.mem_input_intensity[i]),
        cell(currentRotated.real[i]),
        cell(currentRotated.imag[i]),
        cell(result.mem_regions[i]),
        cell(evaluationWavenumbers[i]),
        cell(evalMemInputIntensity[i]),
        cell(activeReferenceEval.intensity[i]),
        cell(currentRotatedEval.real[i]),
        cell(currentRotatedEval.imag[i]),
        cell(activeReferenceEval.real[i]),
        cell(activeReferenceEval.imag[i]),
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
  const paddedRange = originalRange
    ? [originalRange[0] - (edgePaddingEnabled ? (leftPaddingWidth ?? 0) : 0), originalRange[1] + (edgePaddingEnabled ? (rightPaddingWidth ?? 0) : 0)] as [number, number]
    : null

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
                setOriginalRange(null)
                setMemPoints(null)
                setMemPointsEdited(false)
                setEdgePaddingEnabled(true)
                setLeftPaddingWidth(DEFAULT_EDGE_PADDING_WIDTH)
                setRightPaddingWidth(DEFAULT_EDGE_PADDING_WIDTH)
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
        <Row gutter={[12, 8]} align="middle" style={{ marginTop: 10 }}>
          <Col xs={24} md={7}>
            <Checkbox
              checked={edgePaddingEnabled}
              onChange={(event) => setEdgePaddingEnabled(event.target.checked)}
            >
              Enable edge padding / 启用两端扩展
            </Checkbox>
          </Col>
          <Col xs={24} sm={12} md={7}>
            <InputNumber
              addonBefore="Left padding width (cm^-1)"
              min={0}
              value={leftPaddingWidth}
              disabled={!edgePaddingEnabled}
              onChange={setLeftPaddingWidth}
              style={{ width: '100%' }}
              size="small"
            />
          </Col>
          <Col xs={24} sm={12} md={7}>
            <InputNumber
              addonBefore="Right padding width (cm^-1)"
              min={0}
              value={rightPaddingWidth}
              disabled={!edgePaddingEnabled}
              onChange={setRightPaddingWidth}
              style={{ width: '100%' }}
              size="small"
            />
          </Col>
        </Row>
        {originalPoints != null && (
          <div style={{ marginTop: 4 }}>
            <Space wrap size={[8, 0]}>
              <Text type="secondary" style={{ fontSize: 12 }}>N_original: {originalPoints}</Text>
              {memPoints != null && <Text type="secondary" style={{ fontSize: 12 }}>N_MEM: {memPoints}</Text>}
              {originalRange && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Original spectrum range: {originalRange[0]}-{originalRange[1]} cm^-1
                </Text>
              )}
              {edgePaddingEnabled && paddedRange && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  MEM processing range after padding: {paddedRange[0]}-{paddedRange[1]} cm^-1
                </Text>
              )}
            </Space>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Edge padding extends the input spectrum with constant endpoint intensities. MEM is performed on the padded spectrum, while evaluation and NRMSE are calculated only in the original spectral range. 两端扩展使用原始光谱端点强度进行恒值延伸；padding 不增加原始光谱信息。
            </Text>
          </div>
        )}
        {result && (
          <Space wrap size={[8, 0]} style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Result N_original: {result.n_original}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>N_MEM: {result.n_mem}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>N_eval / NRMSE points: {result.n_eval}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Original range: {result.original_frequency_range[0]}-{result.original_frequency_range[1]} cm^-1
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              MEM processing range: {result.mem_frequency_range[0]}-{result.mem_frequency_range[1]} cm^-1
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Evaluation range: {result.evaluation_frequency_range[0]}-{result.evaluation_frequency_range[1]} cm^-1
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Edge padding: {result.edge_padding_enabled ? `on (${result.left_padding_width}/${result.right_padding_width} cm^-1)` : 'off'}
            </Text>
          </Space>
        )}
      </Card>

      <Card size="small" title="Peak Parameters" style={{ marginTop: 12 }}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Upload accept=".txt,.csv" maxCount={1} showUploadList={false} beforeUpload={handleImportParams}>
            <Button size="small" icon={<UploadOutlined />}>Import peak parameters</Button>
          </Upload>
          <Button size="small" icon={<DownloadOutlined />} onClick={handleExportParams}>Export peak parameters</Button>
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
          Lorentzian Gamma keeps the original HWHM convention; Gaussian broadening input uses HWHM for Voigt peaks.
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
                  <InputNumber addonBefore="L Gamma (HWHM)" value={p.width} onChange={(v) => {
                    if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, width: v } : pp))
                  }} step={0.5} min={0.1} style={{ width: '100%' }} size="small" />
                  <InputNumber
                    addonBefore="G HWHM"
                    value={peakGaussianHwhm(p)}
                    disabled={(p.profile_type ?? 'lorentzian') === 'lorentzian'}
                    onChange={(v) => {
                      if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, gaussian_hwhm: v } : pp))
                    }}
                    step={0.5}
                    min={0}
                    style={{ width: '100%' }}
                    size="small"
                  />
                  {(p.profile_type ?? 'lorentzian') === 'voigt' && (
                    <div style={{ color: '#8c8c8c', fontSize: 12, lineHeight: 1.45 }}>
                      {peakWidthSummaryLines(p).map((line) => (
                        <div key={line.label}>
                          {line.label}: {line.value}{line.note ? ` (${line.note})` : ''}
                        </div>
                      ))}
                    </div>
                  )}
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

      <Card size="small" title="External Re/Im Reference Spectrum" style={{ marginTop: 12 }}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Upload accept=".csv,.txt" maxCount={1} showUploadList={false} beforeUpload={handleExternalReferenceUpload}>
            <Button size="small" icon={<UploadOutlined />}>Import Re/Im reference</Button>
          </Upload>
          <Button
            size="small"
            icon={<DeleteOutlined />}
            disabled={!externalReference && !externalReferenceTable}
            onClick={() => {
              setExternalReferenceTable(null)
              setExternalReferenceSelection(null)
              setExternalReference(null)
              setExternalReferenceError(null)
              setPhaseSelectionMode('default')
            }}
          >
            Clear reference
          </Button>
          {externalReference && (
            <Text type="secondary">
              {externalReference.name} | original points: {externalReference.pointCount} | range: {externalReference.frequencyRange[0]}-{externalReference.frequencyRange[1]} cm^-1
            </Text>
          )}
        </Space>
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
          Optional. Import a CSV/TXT file and choose which columns are Wavenumber, Re and Im. The first selection is auto-detected when possible. When valid, this external spectrum replaces the peak-parameter ideal Re/Im as the NRMSE reference.
        </Text>
        {externalReferenceTable && externalReferenceSelection && (
          <Space wrap style={{ marginBottom: 8, display: 'flex' }}>
            <Text type="secondary">Rows: {externalReferenceTable.rowCount}</Text>
            <Text type="secondary">Columns: {externalReferenceTable.columns.length}</Text>
            <Text>Wavenumber</Text>
            <Select
              size="small"
              value={externalReferenceSelection.wavenumber}
              options={externalReferenceColumnOptions}
              onChange={(value) => setExternalReferenceSelection({ ...externalReferenceSelection, wavenumber: value })}
              style={{ width: 180 }}
            />
            <Text>Re</Text>
            <Select
              size="small"
              value={externalReferenceSelection.real}
              options={externalReferenceColumnOptions}
              onChange={(value) => setExternalReferenceSelection({ ...externalReferenceSelection, real: value })}
              style={{ width: 180 }}
            />
            <Text>Im</Text>
            <Select
              size="small"
              value={externalReferenceSelection.imag}
              options={externalReferenceColumnOptions}
              onChange={(value) => setExternalReferenceSelection({ ...externalReferenceSelection, imag: value })}
              style={{ width: 180 }}
            />
            <Button size="small" type="primary" onClick={() => applyExternalReferenceSelection()}>
              Apply selected columns
            </Button>
          </Space>
        )}
        {externalReferenceError && <Alert type="error" message={externalReferenceError} showIcon style={{ marginBottom: 8 }} />}
        {externalReference && !result && (
          <Alert
            type="info"
            message="External reference has been imported. Run MEM & Compare to align it to the MEM output grid."
            showIcon
          />
        )}
        {result && alignedExternalReference?.error && (
          <Alert
            type="warning"
            message={`${alignedExternalReference.error} NRMSE is still using the peak-parameter ideal spectrum.`}
            showIcon
          />
        )}
        {result && activeReference && (
          <Space wrap style={{ display: 'flex' }}>
            <Text type="secondary">Active NRMSE reference: {activeReference.label}</Text>
            <Text type="secondary">Alignment: {activeReference.alignmentMethod}</Text>
            {activeReference.originalPointCount != null && (
              <Text type="secondary">Original reference points: {activeReference.originalPointCount}</Text>
            )}
          </Space>
        )}
        {alignedExternalReference?.aligned?.warnings.map((warning) => (
          <Alert key={warning} type="info" message={warning} showIcon style={{ marginTop: 8 }} />
        ))}
      </Card>

      {!hasResult && (
        <div style={{ padding: 60, textAlign: 'center', background: '#fff', borderRadius: 8, marginTop: 12 }}>
          <Empty description="Upload a CSV and set peak parameters, then click Run" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      )}

      {hasResult && result && (
        <>
          <Card size="small" style={{ marginTop: 12 }}>
            <div ref={intensityRef} style={{ width: '100%', minHeight: 350 }} />
          </Card>

          <Card size="small" title="MEM and Reference Re/Im" style={{ marginTop: 12 }}
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
                    {selectedPhaseDeg.toFixed(2)}\u00b0 = {displayedPhaseAngle.toFixed(6)} rad
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

          <Card
            size="small"
            title="NRMSE for Error-Phase Optimization"
            style={{ marginTop: 12 }}
            extra={<Button size="small" icon={<DownloadOutlined />} onClick={handleExportNrmse} disabled={!phaseScanData || 'alignmentError' in phaseScanData}>Export NRMSE CSV</Button>}
          >
            {phaseScanData && 'alignmentError' in phaseScanData ? (
              <Alert type="error" message={phaseScanData.alignmentError} showIcon />
            ) : phaseScanData ? (
              <>
                <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
                  NRMSE = Normalized Root Mean Square Error（归一化均方根误差）
                </Text>
                <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
                  Current reference for NRMSE: {phaseScanData.referenceLabel}
                </Text>
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
                      Evaluation range: {phaseScanData.fullRange[0].toFixed(2)}-{phaseScanData.fullRange[1].toFixed(2)} cm^-1 | points: {phaseScanData.fullPointCount}
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
                    {phaseScanData.fullRangeLabel} minimum Re-NRMSE: {phaseScanData.reBest.value.toExponential(4)}
                  </Text>
                  <Text type="secondary">
                    {phaseScanData.fullRangeLabel} Re optimal phase: {phaseScanData.reBest.phaseDeg.toFixed(2)}\u00b0
                  </Text>
                  <Text type="secondary">
                    {phaseScanData.fullRangeLabel} minimum Im-NRMSE: {phaseScanData.imBest.value.toExponential(4)}
                  </Text>
                  <Text type="secondary">
                    {phaseScanData.fullRangeLabel} Im optimal phase: {phaseScanData.imBest.phaseDeg.toFixed(2)}\u00b0
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
