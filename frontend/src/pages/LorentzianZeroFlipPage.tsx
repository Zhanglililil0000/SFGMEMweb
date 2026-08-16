import { useEffect, useMemo, useRef, useState } from 'react'
import 'plotly.js/dist/plotly.min.js'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Empty,
  InputNumber,
  Modal,
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
import { DeleteOutlined, DownloadOutlined, ExperimentOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import * as api from '../api/mem'
import type {
  ComplexNumberValue,
  LorentzianParameterComparison,
  LorentzianZeroFlipOscillator,
  LorentzianZeroFlipRequest,
  LorentzianZeroFlipResult,
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

const defaultOscillators: LorentzianZeroFlipOscillator[] = [
  { amplitude: 6, phase_deg: 0, center: 2920, lorentzian_hwhm: 18 },
  { amplitude: 5, phase_deg: 95, center: 3180, lorentzian_hwhm: 24 },
  { amplitude: 4, phase_deg: -55, center: 3450, lorentzian_hwhm: 31 },
]

type ScreeningMode = 'pure-water' | 'charged-interface' | 'custom'
type ScreeningFilter = 'all' | 'physical-pass' | 'physical-fail' | 'numerical-and-physical-pass'
type CustomRuleCondition = 'near-anchors' | 'phase-range'

interface CustomPhaseRule {
  id: number
  target: 'all' | number
  condition: CustomRuleCondition
  tolerance: number
  rangeMin: number
  rangeMax: number
}

interface ScreeningFailure {
  rule: string
  oscillatorIndex: number
  center: number
  actualPhase: number
  expected: string
  deviation?: number
}

interface ScreeningResult {
  status: 'pass' | 'fail' | 'not-screened'
  checkedOscillatorCount: number
  failures: ScreeningFailure[]
}

function complexText(value: ComplexNumberValue): string {
  return `${value.real.toExponential(5)} ${value.imag < 0 ? '-' : '+'} ${Math.abs(value.imag).toExponential(5)}i`
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return ''
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toExponential(10) : '') : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function finite(values: number[]): number[] {
  return values.map((value) => Number.isFinite(value) ? value : 0)
}

function fieldValue(fields: Record<string, string>, keys: string[]): string | undefined {
  const lowered = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key.toLowerCase(), value]))
  for (const key of keys) {
    const value = fields[key] ?? lowered[key.toLowerCase()]
    if (value != null) return value
  }
  return undefined
}

function numericField(fields: Record<string, string>, keys: string[], fallback: number): number {
  const raw = fieldValue(fields, keys)
  if (raw == null) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) throw new Error(`${keys[0]} must be a finite number`)
  return parsed
}

function importedPeakIndices(fields: Record<string, string>): number[] {
  const indices = new Set<number>()
  for (const key of Object.keys(fields)) {
    const match = key.match(/^(A|Amplitude|Omega|Center|Gamma|Lorentzian_HWHM|Phi|Phase|Phase_deg|Profile|Profile_Type|Gaussian_.+)(\d+)$/i)
    if (match) indices.add(Number(match[2]))
  }
  return Array.from(indices).sort((left, right) => left - right)
}

function coefficientRows(coefficients: ComplexNumberValue[]) {
  const degree = coefficients.length - 1
  return coefficients.map((coefficient, index) => ({
    key: index,
    power: degree - index,
    coefficient,
    magnitude: Math.hypot(coefficient.real, coefficient.imag),
  }))
}

function coefficientDynamicRange(coefficients: ComplexNumberValue[]): number {
  const magnitudes = coefficients.map((coefficient) => Math.hypot(coefficient.real, coefficient.imag)).filter((value) => value > 0)
  if (magnitudes.length < 2) return 1
  return Math.max(...magnitudes) / Math.min(...magnitudes)
}

function screenAlternative(
  alternative: LorentzianZeroFlipResult['alternatives'][number],
  mode: ScreeningMode,
  anchorTolerance: number,
  chargedStart: number,
  chargedEnd: number,
  customRules: CustomPhaseRule[],
): ScreeningResult {
  const failures: ScreeningFailure[] = []
  let checkedOscillatorCount = 0

  const checkAnchors = (rows: LorentzianParameterComparison[], ruleLabel: string, tolerance: number) => {
    checkedOscillatorCount += rows.length
    for (const row of rows) {
      const deviation = distanceToZeroOr180Deg(row.alternative_phase_deg)
      if (deviation > tolerance) {
        failures.push({
          rule: ruleLabel,
          oscillatorIndex: row.oscillator_index,
          center: row.center,
          actualPhase: row.alternative_phase_deg,
          expected: `within ${tolerance} deg of 0 or 180 deg`,
          deviation,
        })
      }
    }
  }

  if (mode === 'pure-water') {
    checkAnchors(alternative.comparison, 'Pure Water: all peak phases', anchorTolerance)
  } else if (mode === 'charged-interface') {
    const minimum = Math.min(chargedStart, chargedEnd)
    const maximum = Math.max(chargedStart, chargedEnd)
    const constrained = alternative.comparison.filter((row) => row.center >= minimum && row.center <= maximum)
    checkAnchors(constrained, `Charged Interface: ${minimum}-${maximum} cm^-1`, anchorTolerance)
  } else {
    for (const rule of customRules) {
      const rows = rule.target === 'all'
        ? alternative.comparison
        : alternative.comparison.filter((row) => row.oscillator_index === rule.target)
      checkedOscillatorCount += rows.length
      for (const row of rows) {
        if (rule.condition === 'near-anchors') {
          const deviation = distanceToZeroOr180Deg(row.alternative_phase_deg)
          if (deviation > rule.tolerance) {
            failures.push({
              rule: `Custom rule ${rule.id}`,
              oscillatorIndex: row.oscillator_index,
              center: row.center,
              actualPhase: row.alternative_phase_deg,
              expected: `within ${rule.tolerance} deg of 0 or 180 deg`,
              deviation,
            })
          }
        } else if (!phaseInCircularRange(row.alternative_phase_deg, rule.rangeMin, rule.rangeMax)) {
          failures.push({
            rule: `Custom rule ${rule.id}`,
            oscillatorIndex: row.oscillator_index,
            center: row.center,
            actualPhase: row.alternative_phase_deg,
            expected: `circular phase range ${rule.rangeMin} to ${rule.rangeMax} deg`,
          })
        }
      }
    }
  }

  if (checkedOscillatorCount === 0) return { status: 'not-screened', checkedOscillatorCount, failures }
  return { status: failures.length === 0 ? 'pass' : 'fail', checkedOscillatorCount, failures }
}

function wrapPhaseDeg(value: number): number {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180
  return wrapped === -180 ? 180 : wrapped
}

function circularPhaseDistanceDeg(left: number, right: number): number {
  return Math.abs(wrapPhaseDeg(left - right))
}

function distanceToZeroOr180Deg(phase: number): number {
  return Math.min(circularPhaseDistanceDeg(phase, 0), circularPhaseDistanceDeg(phase, 180))
}

function phaseInCircularRange(phase: number, minimum: number, maximum: number): boolean {
  const value = wrapPhaseDeg(phase)
  const start = wrapPhaseDeg(minimum)
  const end = wrapPhaseDeg(maximum)
  return start <= end ? value >= start && value <= end : value >= start || value <= end
}

export default function LorentzianZeroFlipPage() {
  const [xMin, setXMin] = useState(2700)
  const [xMax, setXMax] = useState(3700)
  const [npoints, setNpoints] = useState(2000)
  const [c0Real, setC0Real] = useState(0.08)
  const [c0Imag, setC0Imag] = useState(-0.01)
  const [oscillators, setOscillators] = useState(defaultOscillators)
  const [realZeroTolerance, setRealZeroTolerance] = useState(1e-8)
  const [ratioThreshold, setRatioThreshold] = useState(1e-12)
  const [nearDistanceTolerance, setNearDistanceTolerance] = useState(1e-7)
  const [enumerationWindowMargin, setEnumerationWindowMargin] = useState(200)
  const [minimumPhaseEffectDeg, setMinimumPhaseEffectDeg] = useState(1)
  const [maxEnumerationZeros, setMaxEnumerationZeros] = useState(8)
  const [selectedZeros, setSelectedZeros] = useState<number[]>([])
  const [result, setResult] = useState<LorentzianZeroFlipResult | null>(null)
  const [selectedAlternativeId, setSelectedAlternativeId] = useState<string>()
  const [unwrapPhase, setUnwrapPhase] = useState(true)
  const [screeningMode, setScreeningMode] = useState<ScreeningMode>('pure-water')
  const [phaseAnchorTolerance, setPhaseAnchorTolerance] = useState(10)
  const [chargedRegionStart, setChargedRegionStart] = useState(2700)
  const [chargedRegionEnd, setChargedRegionEnd] = useState(3000)
  const [customRules, setCustomRules] = useState<CustomPhaseRule[]>([
    { id: 1, target: 'all', condition: 'near-anchors', tolerance: 10, rangeMin: -10, rangeMax: 10 },
  ])
  const [nextCustomRuleId, setNextCustomRuleId] = useState(2)
  const [screeningFilter, setScreeningFilter] = useState<ScreeningFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const poleZeroRef = useRef<HTMLDivElement>(null)
  const intensityRef = useRef<HTMLDivElement>(null)
  const realRef = useRef<HTMLDivElement>(null)
  const imagRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<HTMLDivElement>(null)

  const selectedAlternative = useMemo(
    () => result?.alternatives.find((alternative) => alternative.configuration_id === selectedAlternativeId)
      ?? result?.alternatives[0],
    [result, selectedAlternativeId],
  )

  const screeningRows = useMemo(() => (result?.alternatives ?? []).map((alternative) => ({
    alternative,
    screening: screenAlternative(
      alternative,
      screeningMode,
      phaseAnchorTolerance,
      chargedRegionStart,
      chargedRegionEnd,
      customRules,
    ),
  })), [result, screeningMode, phaseAnchorTolerance, chargedRegionStart, chargedRegionEnd, customRules])

  const filteredScreeningRows = useMemo(() => screeningRows.filter(({ alternative, screening }) => {
    if (screeningFilter === 'physical-pass') return screening.status === 'pass'
    if (screeningFilter === 'physical-fail') return screening.status === 'fail'
    if (screeningFilter === 'numerical-and-physical-pass') return alternative.numerically_valid && screening.status === 'pass'
    return true
  }), [screeningRows, screeningFilter])

  const screeningCounts = useMemo(() => ({
    pass: screeningRows.filter((row) => row.screening.status === 'pass').length,
    fail: screeningRows.filter((row) => row.screening.status === 'fail').length,
    notScreened: screeningRows.filter((row) => row.screening.status === 'not-screened').length,
    numericalAndPhysicalPass: screeningRows.filter((row) => row.alternative.numerically_valid && row.screening.status === 'pass').length,
  }), [screeningRows])

  const selectedScreening = screeningRows.find((row) => row.alternative.configuration_id === selectedAlternative?.configuration_id)?.screening

  const updateOscillator = (index: number, field: keyof LorentzianZeroFlipOscillator, value: number | null) => {
    if (value == null) return
    setOscillators((current) => current.map((oscillator, oscillatorIndex) => (
      oscillatorIndex === index ? { ...oscillator, [field]: value } : oscillator
    )))
  }

  const updateCustomRule = <K extends keyof CustomPhaseRule>(id: number, field: K, value: CustomPhaseRule[K]) => {
    setCustomRules((current) => current.map((rule) => rule.id === id ? { ...rule, [field]: value } : rule))
  }

  const addCustomRule = () => {
    setCustomRules((current) => [...current, {
      id: nextCustomRuleId,
      target: 'all',
      condition: 'near-anchors',
      tolerance: 10,
      rangeMin: -10,
      rangeMax: 10,
    }])
    setNextCustomRuleId((current) => current + 1)
  }

  const importParameters = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const fields = parseParameterFields(String(event.target?.result ?? ''))
        if (Object.keys(fields).length === 0) throw new Error('No key=value parameter fields were found')
        const indices = importedPeakIndices(fields)
        if (indices.length === 0) throw new Error('No indexed Lorentzian oscillator parameters were found')

        const normalizedSignedAmplitudeIndices: number[] = []
        const imported = indices.map((index) => {
          const profile = fieldValue(fields, [`Profile${index}`, `Profile_Type${index}`])?.trim().toLowerCase()
          const gaussianKeys = [`Gaussian_HWHM${index}`, `Gaussian_FWHM${index}`, `Gaussian_Sigma${index}`]
          const gaussianValue = numericField(fields, gaussianKeys, 0)
          if ((profile && profile !== 'lorentzian') || gaussianValue !== 0) {
            throw new Error(`Oscillator ${index} contains Voigt/Gaussian broadening. This analyzer accepts pure Lorentzian models only.`)
          }
          const signedAmplitude = numericField(fields, [`A${index}`, `Amplitude${index}`], NaN)
          const importedPhase = numericField(fields, [`Phi${index}`, `Phase_deg${index}`, `Phase${index}`], 0)
          const oscillator = {
            amplitude: Math.abs(signedAmplitude),
            phase_deg: signedAmplitude < 0 ? wrapPhaseDeg(importedPhase + 180) : wrapPhaseDeg(importedPhase),
            center: numericField(fields, [`Omega${index}`, `Center${index}`], NaN),
            lorentzian_hwhm: numericField(fields, [`Gamma${index}`, `Lorentzian_HWHM${index}`], NaN),
          }
          if (!Object.values(oscillator).every(Number.isFinite)) throw new Error(`Oscillator ${index} is missing A, Omega/Center, or Gamma`)
          if (oscillator.lorentzian_hwhm <= 0) throw new Error(`Oscillator ${index} has invalid Lorentzian HWHM`)
          if (signedAmplitude < 0) normalizedSignedAmplitudeIndices.push(index)
          return oscillator
        })

        const phaseUnit = fieldValue(fields, ['Phase_Unit', 'PhaseUnit', 'phase_unit'])
        if (phaseUnit && !phaseUnit.toLowerCase().startsWith('deg')) {
          throw new Error('Imported Phi values must be in degrees for this analyzer')
        }
        setC0Real(numericField(fields, ['NR_Real', 'C0_Real', 'c0_real'], c0Real))
        setC0Imag(numericField(fields, ['NR_Imag', 'C0_Imag', 'c0_imag'], c0Imag))
        setXMin(numericField(fields, ['XMin', 'x_min', 'Frequency_Start'], xMin))
        setXMax(numericField(fields, ['XMax', 'x_max', 'Frequency_End'], xMax))
        setNpoints(Math.round(numericField(fields, ['NPoints', 'npoints', 'Points'], npoints)))
        setOscillators(imported)
        setResult(null)
        setSelectedZeros([])
        const normalizationNote = normalizedSignedAmplitudeIndices.length > 0
          ? ` Negative amplitudes for oscillator(s) ${normalizedSignedAmplitudeIndices.join(', ')} were converted to |A| with +180 deg phase.`
          : ''
        message.success(`Imported ${imported.length} pure Lorentzian oscillator(s); Phi interpreted as degrees.${normalizationNote}`, 8)
      } catch (importError) {
        message.error(importError instanceof Error ? importError.message : 'Unable to import Lorentzian parameters')
      }
    }
    reader.readAsText(file)
    return false
  }

  const makeRequest = (
    flipConfigurations: number[][] = [],
    enumerateAll = false,
  ): LorentzianZeroFlipRequest => ({
    x_min: xMin,
    x_max: xMax,
    npoints,
    c0_real: c0Real,
    c0_imag: c0Imag,
    oscillators,
    real_zero_tolerance: realZeroTolerance,
    ratio_threshold: ratioThreshold,
    near_distance_tolerance: nearDistanceTolerance,
    pole_tolerance: 1e-12,
    validation_tolerance: 1e-9,
    flip_configurations: flipConfigurations,
    enumerate_all: enumerateAll,
    max_flippable_for_enumeration: maxEnumerationZeros,
    enumeration_window_margin: enumerationWindowMargin,
    minimum_phase_effect_deg: minimumPhaseEffectDeg,
  })

  const runRequest = async (flipConfigurations: number[][] = [], enumerateAll = false) => {
    if (xMin >= xMax) { message.error('Frequency start must be less than end'); return }
    if (oscillators.length === 0) { message.error('At least one Lorentzian oscillator is required'); return }
    if (oscillators.some((oscillator) => oscillator.amplitude < 0 || oscillator.lorentzian_hwhm <= 0)) {
      message.error('Amplitude must be non-negative and Lorentzian HWHM must be greater than zero')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await api.analyzeLorentzianZeroFlip(makeRequest(flipConfigurations, enumerateAll))
      setResult(data)
      setSelectedZeros([])
      setSelectedAlternativeId(data.alternatives[0]?.configuration_id)
    } catch (requestError) {
      setError(api.getApiErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  const enumerateAll = () => {
    if (!result) return
    const count = result.enumeration_configuration_count
    Modal.confirm({
      title: `Generate ${count} ranked zero-flip alternative${count === 1 ? '' : 's'}?`,
      content: `This enumerates the ${result.enumeration_flippable_zero_count} selected zeros only. Manual selection remains available for every flippable zero.`,
      okText: 'Generate',
      onOk: () => runRequest([], true),
    })
  }

  const exportFrequencyData = () => {
    if (!result || !selectedAlternative) return
    const lines = [
      `# configuration_id,${csvCell(selectedAlternative.configuration_id)}`,
      `# original_C0,${csvCell(complexText(result.original.c0))}`,
      `# alternative_C0,${csvCell(complexText(selectedAlternative.c0))}`,
      `# max_intensity_error,${csvCell(selectedAlternative.metrics.max_intensity_error)}`,
      `# normalized_rms_intensity_error,${csvCell(selectedAlternative.metrics.normalized_rms_intensity_error)}`,
      `# partial_fraction_max_abs_error,${csvCell(selectedAlternative.metrics.partial_fraction_max_abs_error)}`,
      'frequency,original_Re,original_Im,original_intensity,alternative_Re,alternative_Im,alternative_intensity,phase_difference_rad,phase_difference_unwrapped_rad,abs_B,ratio_defined',
      ...result.frequency.map((frequency, index) => [
        frequency,
        result.original.real_part[index],
        result.original.imag_part[index],
        result.original.intensity[index],
        selectedAlternative.real_part[index],
        selectedAlternative.imag_part[index],
        selectedAlternative.intensity[index],
        selectedAlternative.phase_difference_rad[index],
        selectedAlternative.phase_difference_unwrapped_rad[index],
        selectedAlternative.ratio_magnitude[index],
        selectedAlternative.ratio_defined[index] ? 1 : 0,
      ].map(csvCell).join(',')),
    ]
    downloadCsv(`${selectedAlternative.configuration_id}_spectra.csv`, lines)
    message.success('Frequency-resolved CSV exported')
  }

  const exportParameterData = () => {
    if (!result || !selectedAlternative) return
    const lines = [
      `# configuration_id,${csvCell(selectedAlternative.configuration_id)}`,
      `# flipped_zero_indices,${csvCell(selectedAlternative.flipped_zero_indices.map((index) => index + 1).join(';'))}`,
      `# sign_convention,${csvCell(result.convention.recovery)}`,
      `# original_C0_real,${csvCell(result.original.c0.real)}`,
      `# original_C0_imag,${csvCell(result.original.c0.imag)}`,
      `# alternative_C0_real,${csvCell(selectedAlternative.c0.real)}`,
      `# alternative_C0_imag,${csvCell(selectedAlternative.c0.imag)}`,
      `# max_intensity_error,${csvCell(selectedAlternative.metrics.max_intensity_error)}`,
      `# normalized_rms_intensity_error,${csvCell(selectedAlternative.metrics.normalized_rms_intensity_error)}`,
      `# max_ratio_magnitude_error,${csvCell(selectedAlternative.metrics.max_ratio_magnitude_error)}`,
      `# partial_fraction_max_abs_error,${csvCell(selectedAlternative.metrics.partial_fraction_max_abs_error)}`,
      `# partial_fraction_normalized_rms_error,${csvCell(selectedAlternative.metrics.partial_fraction_normalized_rms_error)}`,
      '',
      'oscillator,center,lorentzian_hwhm,original_D_real,original_D_imag,original_amplitude,original_phase_deg,alternative_D_real,alternative_D_imag,alternative_amplitude,alternative_phase_deg,amplitude_change,phase_change_deg',
      ...selectedAlternative.comparison.map((row) => [
        row.oscillator_index,
        row.center,
        row.lorentzian_hwhm,
        row.original_fitted_complex_amplitude.real,
        row.original_fitted_complex_amplitude.imag,
        row.original_amplitude,
        row.original_phase_deg,
        row.alternative_fitted_complex_amplitude.real,
        row.alternative_fitted_complex_amplitude.imag,
        row.alternative_amplitude,
        row.alternative_phase_deg,
        row.amplitude_change,
        row.phase_change_deg,
      ].map(csvCell).join(',')),
      '',
      'zero_id,original_real,original_imag,reflected_real,reflected_imag',
      ...selectedAlternative.flipped_zeros.map((zero) => [
        zero.id, zero.original.real, zero.original.imag, zero.reflected.real, zero.reflected.imag,
      ].map(csvCell).join(',')),
      '',
      'polynomial,coefficient_order,power,real,imag,magnitude',
      ...[
        ['original_P', result.original.numerator_coefficients] as const,
        ['original_Q', result.original.denominator_coefficients] as const,
        ['alternative_P', selectedAlternative.numerator_coefficients] as const,
        ['alternative_Q', selectedAlternative.denominator_coefficients] as const,
      ].flatMap(([label, coefficients]) => coefficientRows(coefficients).map((row, order) => [
        label, order, row.power, row.coefficient.real, row.coefficient.imag, row.magnitude,
      ].map(csvCell).join(','))),
      '',
      'pole_index,real,imag,center,lorentzian_hwhm',
      ...result.original.poles.map((pole, index) => [index + 1, pole.real, pole.imag, pole.real, -pole.imag].map(csvCell).join(',')),
      '',
      'oscillator,original_R_real,original_R_imag,alternative_R_real,alternative_R_imag,residue_convention',
      ...selectedAlternative.comparison.map((row) => [
        row.oscillator_index,
        -row.original_fitted_complex_amplitude.real,
        -row.original_fitted_complex_amplitude.imag,
        -row.alternative_fitted_complex_amplitude.real,
        -row.alternative_fitted_complex_amplitude.imag,
        'R=-D',
      ].map(csvCell).join(',')),
      '',
      `# ratio_masked_points,${csvCell(selectedAlternative.ratio_defined.filter((defined) => !defined).length)}`,
      `# warnings,${csvCell([...result.warnings, ...selectedAlternative.warnings].join('; '))}`,
    ]
    downloadCsv(`${selectedAlternative.configuration_id}_parameters.csv`, lines)
    message.success('Alternative parameter CSV exported')
  }

  const exportAllAlternatives = () => {
    if (!result || result.alternatives.length === 0) return
    const screeningById = new Map(screeningRows.map((row) => [row.alternative.configuration_id, row.screening]))
    const screeningDescription = screeningMode === 'pure-water'
      ? `Pure Water Interface: all phases within ${phaseAnchorTolerance} deg of 0 or 180 deg`
      : screeningMode === 'charged-interface'
        ? `Charged Interface: ${chargedRegionStart}-${chargedRegionEnd} cm^-1 phases within ${phaseAnchorTolerance} deg of 0 or 180 deg`
        : `Custom rules: ${customRules.length}`
    const lines = [
      `# sign_convention,${csvCell(result.convention.recovery)}`,
      `# original_C0,${csvCell(complexText(result.original.c0))}`,
      `# physical_screening,${csvCell(screeningDescription)}`,
      'configuration_id,flipped_zero_ids,alternative_C0_real,alternative_C0_imag,numerically_valid,physical_screening_status,screened_oscillator_count,physical_failure_count,physical_failures,max_intensity_error,intensity_nrmse,max_abs_B_minus_1,partial_fraction_max_error,partial_fraction_nrmse,ratio_masked_points,warnings',
      ...result.alternatives.map((alternative) => {
        const screening = screeningById.get(alternative.configuration_id)
        return [
          alternative.configuration_id,
          alternative.flipped_zeros.map((zero) => zero.id).join(';'),
          alternative.c0.real,
          alternative.c0.imag,
          alternative.numerically_valid ? 1 : 0,
          screening?.status ?? 'not-screened',
          screening?.checkedOscillatorCount ?? 0,
          screening?.failures.length ?? 0,
          screening?.failures.map((failure) => `osc ${failure.oscillatorIndex}: ${failure.actualPhase.toFixed(4)} deg; ${failure.expected}`).join(' | ') ?? '',
          alternative.metrics.max_intensity_error,
          alternative.metrics.normalized_rms_intensity_error,
          alternative.metrics.max_ratio_magnitude_error,
          alternative.metrics.partial_fraction_max_abs_error,
          alternative.metrics.partial_fraction_normalized_rms_error,
          alternative.ratio_defined.filter((defined) => !defined).length,
          alternative.warnings.join('; '),
        ].map(csvCell).join(',')
      }),
      '',
      'configuration_id,oscillator,center,lorentzian_hwhm,original_D_real,original_D_imag,alternative_D_real,alternative_D_imag,original_A,alternative_A,original_phase_deg,alternative_phase_deg,amplitude_change,phase_change_deg',
      ...result.alternatives.flatMap((alternative) => alternative.comparison.map((row) => [
        alternative.configuration_id,
        row.oscillator_index,
        row.center,
        row.lorentzian_hwhm,
        row.original_fitted_complex_amplitude.real,
        row.original_fitted_complex_amplitude.imag,
        row.alternative_fitted_complex_amplitude.real,
        row.alternative_fitted_complex_amplitude.imag,
        row.original_amplitude,
        row.alternative_amplitude,
        row.original_phase_deg,
        row.alternative_phase_deg,
        row.amplitude_change,
        row.phase_change_deg,
      ].map(csvCell).join(','))),
    ]
    downloadCsv('lorentzian_zero_flip_all_alternatives.csv', lines)
    message.success(`Exported summary for ${result.alternatives.length} alternative(s)`)
  }

  useEffect(() => {
    const container = poleZeroRef.current
    if (!container || !result) return
    const alternative = selectedAlternative
    const traces: PlotlyTrace[] = [
      {
        x: result.original.zeros.map((zero) => zero.real),
        y: result.original.zeros.map((zero) => zero.imag),
        text: result.original.zeros.map((zero) => zero.id),
        type: 'scatter', mode: 'markers', name: 'Original zeros',
        marker: { color: '#1677ff', size: 10, symbol: 'circle-open', line: { width: 2 } },
      },
      {
        x: result.original.poles.map((pole) => pole.real),
        y: result.original.poles.map((pole) => pole.imag),
        type: 'scatter', mode: 'markers', name: 'Poles',
        marker: { color: '#d62728', size: 11, symbol: 'x' },
      },
    ]
    if (alternative) {
      traces.push({
        x: alternative.zeros.map((zero) => zero.real),
        y: alternative.zeros.map((zero) => zero.imag),
        type: 'scatter', mode: 'markers', name: 'Alternative zeros',
        marker: { color: '#2ca02c', size: 9, symbol: 'diamond-open', line: { width: 2 } },
      })
    }
    Plotly.newPlot(container, traces, {
      title: { text: 'Pole-Zero Map', font: { size: 14 } },
      xaxis: { title: 'Re(z) (cm<sup>-1</sup>)' }, yaxis: { title: 'Im(z) (cm<sup>-1</sup>)', zeroline: true },
      hovermode: 'closest', margin: { l: 60, r: 20, t: 50, b: 45 },
    }, chartConfig)
    return () => Plotly.purge(container)
  }, [result, selectedAlternative])

  useEffect(() => {
    if (!result || !selectedAlternative) return
    const plots: Array<{
      ref: React.RefObject<HTMLDivElement | null>
      title: string
      yTitle: string
      original: number[]
      alternative: number[]
    }> = [
      { ref: intensityRef, title: 'Intensity Comparison', yTitle: '|chi|<sup>2</sup>', original: result.original.intensity, alternative: selectedAlternative.intensity },
      { ref: realRef, title: 'Real-Part Comparison', yTitle: 'Re[chi]', original: result.original.real_part, alternative: selectedAlternative.real_part },
      { ref: imagRef, title: 'Imaginary-Part Comparison', yTitle: 'Im[chi]', original: result.original.imag_part, alternative: selectedAlternative.imag_part },
    ]
    for (const plot of plots) {
      if (!plot.ref.current) continue
      Plotly.newPlot(plot.ref.current, [
        { x: finite(result.frequency), y: finite(plot.original), type: 'scatter', mode: 'lines', name: 'Original', line: { color: '#1677ff', width: 2 } },
        { x: finite(result.frequency), y: finite(plot.alternative), type: 'scatter', mode: 'lines', name: 'Alternative', line: { color: '#ff7a00', width: 2, dash: 'dash' } },
      ], {
        title: { text: plot.title, font: { size: 14 } }, xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
        yaxis: { title: plot.yTitle }, hovermode: 'x', margin: { l: 60, r: 20, t: 50, b: 45 },
      }, chartConfig)
    }
    return () => plots.forEach((plot) => { if (plot.ref.current) Plotly.purge(plot.ref.current) })
  }, [result, selectedAlternative])

  useEffect(() => {
    const container = phaseRef.current
    if (!container || !result || !selectedAlternative) return
    const phase = unwrapPhase
      ? selectedAlternative.phase_difference_unwrapped_rad
      : selectedAlternative.phase_difference_rad
    Plotly.newPlot(container, [{
      x: result.frequency,
      y: phase.map((value) => value == null ? null : value * 180 / Math.PI),
      type: 'scatter', mode: 'lines', name: unwrapPhase ? 'Unwrapped phase difference' : 'Wrapped phase difference',
      line: { color: '#722ed1', width: 2 },
    }], {
      title: { text: 'Phase Difference arg(chi_alt / chi_orig)', font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' }, yaxis: { title: 'Phase difference (deg)' },
      hovermode: 'x', margin: { l: 60, r: 20, t: 50, b: 45 },
    }, chartConfig)
    return () => Plotly.purge(container)
  }, [result, selectedAlternative, unwrapPhase])

  const comparisonColumns = [
    { title: '#', dataIndex: 'oscillator_index', key: 'index', fixed: 'left' as const, width: 48 },
    { title: 'Center', dataIndex: 'center', key: 'center', render: (value: number) => value.toFixed(4) },
    { title: 'L HWHM', dataIndex: 'lorentzian_hwhm', key: 'width', render: (value: number) => value.toFixed(4) },
    { title: 'Original D', dataIndex: 'original_fitted_complex_amplitude', key: 'originalD', render: complexText, width: 210 },
    { title: 'Original A', dataIndex: 'original_amplitude', key: 'originalA', render: (value: number) => value.toExponential(5) },
    { title: 'Original phase (deg)', dataIndex: 'original_phase_deg', key: 'originalPhase', render: (value: number) => value.toFixed(5) },
    { title: 'Alternative D', dataIndex: 'alternative_fitted_complex_amplitude', key: 'alternativeD', render: complexText, width: 210 },
    { title: 'Alternative A', dataIndex: 'alternative_amplitude', key: 'alternativeA', render: (value: number) => value.toExponential(5) },
    { title: 'Alternative phase (deg)', dataIndex: 'alternative_phase_deg', key: 'alternativePhase', render: (value: number) => value.toFixed(5) },
    { title: 'Delta A', dataIndex: 'amplitude_change', key: 'amplitudeChange', render: (value: number) => value.toExponential(5) },
    { title: 'Delta phase (deg)', dataIndex: 'phase_change_deg', key: 'phaseChange', render: (value: number) => value.toFixed(5) },
  ]

  const coefficientColumns = [
    { title: 'Power', dataIndex: 'power', key: 'power', width: 70 },
    { title: 'Complex coefficient', dataIndex: 'coefficient', key: 'coefficient', render: complexText },
    { title: 'Magnitude', dataIndex: 'magnitude', key: 'magnitude', render: (value: number) => value.toExponential(6) },
  ]

  const maskedRatioPoints = selectedAlternative?.ratio_defined.filter((defined) => !defined).length ?? 0
  const originalNumeratorRange = result ? coefficientDynamicRange(result.original.numerator_coefficients) : 1
  const originalDenominatorRange = result ? coefficientDynamicRange(result.original.denominator_coefficients) : 1

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} lg={8}>
        <Card size="small" title="Lorentzian Zero-Flip Analyzer" style={{ height: 'calc(100vh - 100px)', overflow: 'auto' }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Alert type="info" showIcon message="Pure mathematical analysis for finite Lorentzian models only" description="No C-H/O-H labels or physical admissibility classification are applied." />
            <Upload accept=".txt,.csv" maxCount={1} showUploadList={false} beforeUpload={importParameters}>
              <Button icon={<UploadOutlined />}>Import fitted Lorentzian parameters</Button>
            </Upload>
            <Text type="secondary" style={{ fontSize: 12 }}>Key=value format: NR_Real, NR_Imag, A1, Omega1, Gamma1, Phi1. Gamma is HWHM and Phi is degrees.</Text>
            <Text strong>Real Frequency Grid</Text>
            <Row gutter={[8, 8]}>
              <Col span={12}><InputNumber addonBefore="Start" value={xMin} onChange={(value) => setXMin(value ?? xMin)} style={{ width: '100%' }} /></Col>
              <Col span={12}><InputNumber addonBefore="End" value={xMax} onChange={(value) => setXMax(value ?? xMax)} style={{ width: '100%' }} /></Col>
              <Col span={24}><InputNumber addonBefore="Points" min={10} max={20000} value={npoints} onChange={(value) => setNpoints(value ?? npoints)} style={{ width: '100%' }} /></Col>
            </Row>
            <Text strong>Constant Nonresonant Term C0</Text>
            <Row gutter={[8, 8]}>
              <Col span={12}><InputNumber addonBefore="Real" value={c0Real} step={0.01} onChange={(value) => setC0Real(value ?? c0Real)} style={{ width: '100%' }} /></Col>
              <Col span={12}><InputNumber addonBefore="Imag" value={c0Imag} step={0.01} onChange={(value) => setC0Imag(value ?? c0Imag)} style={{ width: '100%' }} /></Col>
            </Row>
            <Text strong>Numerical Tolerances</Text>
            <InputNumber addonBefore="Effectively real zero" value={realZeroTolerance} min={1e-14} step={1e-8} onChange={(value) => setRealZeroTolerance(value ?? realZeroTolerance)} style={{ width: '100%' }} />
            <InputNumber addonBefore="Ratio threshold" value={ratioThreshold} min={1e-16} step={1e-12} onChange={(value) => setRatioThreshold(value ?? ratioThreshold)} style={{ width: '100%' }} />
            <InputNumber addonBefore="Near-distance warning" value={nearDistanceTolerance} min={1e-12} step={1e-7} onChange={(value) => setNearDistanceTolerance(value ?? nearDistanceTolerance)} style={{ width: '100%' }} />
            <Text strong>Automatic Enumeration</Text>
            <InputNumber addonBefore="Window margin" addonAfter="cm⁻¹" value={enumerationWindowMargin} min={0} step={50} onChange={(value) => setEnumerationWindowMargin(value ?? enumerationWindowMargin)} style={{ width: '100%' }} />
            <InputNumber addonBefore="Minimum phase effect" addonAfter="deg" value={minimumPhaseEffectDeg} min={0} step={0.5} onChange={(value) => setMinimumPhaseEffectDeg(value ?? minimumPhaseEffectDeg)} style={{ width: '100%' }} />
            <InputNumber addonBefore="Maximum ranked zeros" value={maxEnumerationZeros} min={1} max={8} step={1} onChange={(value) => setMaxEnumerationZeros(value ?? maxEnumerationZeros)} style={{ width: '100%' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>Zeros outside the extended frequency window or below the phase-effect threshold are excluded from automatic enumeration, but remain available for manual flipping.</Text>
            <Space wrap>
              <Text strong>Oscillators ({oscillators.length})</Text>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setOscillators([...oscillators, { amplitude: 1, phase_deg: 0, center: 3200, lorentzian_hwhm: 20 }])}>Add</Button>
            </Space>
            {oscillators.map((oscillator, index) => (
              <Card key={index} size="small" title={`Oscillator ${index + 1}`} extra={<Button size="small" danger icon={<DeleteOutlined />} disabled={oscillators.length === 1} onClick={() => setOscillators(oscillators.filter((_, oscillatorIndex) => oscillatorIndex !== index))} />}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <InputNumber addonBefore="Amplitude" value={oscillator.amplitude} min={0} step={0.1} onChange={(value) => updateOscillator(index, 'amplitude', value)} style={{ width: '100%' }} />
                  <InputNumber addonBefore="Phase (deg)" value={oscillator.phase_deg} step={1} onChange={(value) => updateOscillator(index, 'phase_deg', value)} style={{ width: '100%' }} />
                  <InputNumber addonBefore="Center" value={oscillator.center} step={1} onChange={(value) => updateOscillator(index, 'center', value)} style={{ width: '100%' }} />
                  <InputNumber addonBefore="Lorentzian HWHM" value={oscillator.lorentzian_hwhm} min={0.001} step={0.5} onChange={(value) => updateOscillator(index, 'lorentzian_hwhm', value)} style={{ width: '100%' }} />
                </Space>
              </Card>
            ))}
            {error && <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />}
            <Button type="primary" block icon={<ExperimentOutlined />} loading={loading} onClick={() => runRequest()}>Analyze Rational Model</Button>
          </Space>
        </Card>
      </Col>

      <Col xs={24} lg={16}>
        {!result ? (
          <Card><Empty description="Analyze a pure Lorentzian model to obtain algebraic zeros" /></Card>
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {result.warnings.map((warning, index) => <Alert key={index} type="warning" message={warning} showIcon />)}
            <Card size="small" title="Exact Rational Representation">
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}><Statistic title="Poles" value={result.original.poles.length} /></Col>
                <Col xs={12} md={6}><Statistic title="Zeros" value={result.original.zeros.length} /></Col>
                <Col xs={12} md={6}><Statistic title="Flippable zeros" value={result.flippable_zero_count} /></Col>
                <Col xs={12} md={6}><Statistic title="Possible alternatives" value={result.possible_configuration_count} /></Col>
                <Col xs={12} md={6}><Statistic title="Ranked zeros" value={result.enumeration_flippable_zero_count} /></Col>
                <Col xs={12} md={6}><Statistic title="Ranked alternatives" value={result.enumeration_configuration_count} /></Col>
              </Row>
              <Paragraph style={{ margin: '10px 0 0' }}><Text code>{result.convention.response}</Text></Paragraph>
              <Text type="secondary">{result.convention.recovery}. Maximum P/Q reconstruction error: {result.original.reconstruction.max_abs_complex_error.toExponential(4)}</Text>
              <Collapse
                size="small"
                style={{ marginTop: 12 }}
                items={[
                  {
                    key: 'polynomials',
                    label: 'Original P(z) and Q(z) coefficients (descending powers)',
                    children: (
                      <Row gutter={[12, 12]}>
                        <Col xs={24} xl={12}>
                          <Text strong>P(z), degree {result.original.numerator_coefficients.length - 1}</Text>
                          <Table size="small" pagination={false} dataSource={coefficientRows(result.original.numerator_coefficients)} columns={coefficientColumns} />
                        </Col>
                        <Col xs={24} xl={12}>
                          <Text strong>Q(z), degree {result.original.denominator_coefficients.length - 1}</Text>
                          <Table size="small" pagination={false} dataSource={coefficientRows(result.original.denominator_coefficients)} columns={coefficientColumns} />
                        </Col>
                      </Row>
                    ),
                  },
                  {
                    key: 'poles',
                    label: 'Unchanged Lorentzian poles',
                    children: (
                      <Table
                        size="small"
                        pagination={false}
                        rowKey="index"
                        dataSource={result.original.poles.map((pole, index) => ({ index: index + 1, pole, center: pole.real, hwhm: -pole.imag }))}
                        columns={[
                          { title: '#', dataIndex: 'index', key: 'index' },
                          { title: 'Pole p', dataIndex: 'pole', key: 'pole', render: complexText },
                          { title: 'Center', dataIndex: 'center', key: 'center', render: (value: number) => value.toFixed(6) },
                          { title: 'Lorentzian HWHM', dataIndex: 'hwhm', key: 'hwhm', render: (value: number) => value.toFixed(6) },
                        ]}
                      />
                    ),
                  },
                ]}
              />
            </Card>

            <Card size="small" title="Numerical Diagnostics">
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}><Statistic title="P coefficient range" value={originalNumeratorRange} precision={3} /></Col>
                <Col xs={12} md={6}><Statistic title="Q coefficient range" value={originalDenominatorRange} precision={3} /></Col>
                <Col xs={12} md={6}><Statistic title="Ratio masked points" value={maskedRatioPoints} /></Col>
                <Col xs={12} md={6}><Statistic title="Model warnings" value={result.warnings.length + (selectedAlternative?.warnings.length ?? 0)} /></Col>
              </Row>
              <Space wrap style={{ marginTop: 10 }}>
                <Tag color={result.original.reconstruction.normalized_rms_complex_error <= 1e-9 ? 'green' : 'red'}>Original P/Q reconstruction</Tag>
                {selectedAlternative && <Tag color={selectedAlternative.numerically_valid ? 'green' : 'red'}>Alternative partial fractions</Tag>}
                {maskedRatioPoints > 0 && <Tag color="gold">Phase ratio masked near zeros</Tag>}
                {Math.max(originalNumeratorRange, originalDenominatorRange) > 1e12 && <Tag color="orange">Large coefficient dynamic range</Tag>}
              </Space>
            </Card>

            <Card size="small" title="Algebraic Numerator Zeros">
              <Table
                size="small"
                pagination={false}
                rowKey="index"
                dataSource={result.original.zeros}
                rowSelection={{
                  selectedRowKeys: selectedZeros,
                  getCheckboxProps: (zero) => ({ disabled: !zero.flippable }),
                  onChange: (keys) => setSelectedZeros(keys.map(Number)),
                }}
                columns={[
                  { title: 'ID', dataIndex: 'id', key: 'id' },
                  { title: 'Re(z)', dataIndex: 'real', key: 'real', render: (value: number) => value.toFixed(7) },
                  { title: 'Im(z)', dataIndex: 'imag', key: 'imag', render: (value: number) => value.toFixed(7) },
                  { title: '|chi(z)| direct', dataIndex: 'abs_chi_direct', key: 'residual', render: (value: number) => value.toExponential(4) },
                  { title: 'Phase effect', dataIndex: 'phase_effect_deg', key: 'phaseEffect', render: (value: number) => `${value.toFixed(2)}°` },
                  { title: 'Auto enumeration', key: 'enumeration', render: (_, zero) => zero.enumeration_selected ? <Tag color="green">Selected</Tag> : zero.flippable ? <Tag color="gold">Manual only</Tag> : <Tag>Effectively real</Tag> },
                ]}
              />
              <Space wrap style={{ marginTop: 10 }}>
                <Button type="primary" disabled={selectedZeros.length === 0} loading={loading} onClick={() => runRequest([selectedZeros])}>Generate Selected Combination</Button>
                <Button disabled={result.enumeration_flippable_zero_count === 0} loading={loading} onClick={enumerateAll}>Enumerate Ranked Set</Button>
              </Space>
            </Card>

            {result.alternatives.length > 0 && (
              <Card size="small" title="Physical Pre-Screening (post-generation only)">
                <Alert
                  type="info"
                  showIcon
                  message="Physical screening does not change zero flipping or numerical validation"
                  description="Rules are applied only to recovered alternative phases. All candidates remain available."
                  style={{ marginBottom: 12 }}
                />
                <Row gutter={[12, 12]}>
                  <Col xs={24} md={8}>
                    <Text strong>Screening model</Text>
                    <Select<ScreeningMode>
                      value={screeningMode}
                      onChange={setScreeningMode}
                      style={{ width: '100%', marginTop: 4 }}
                      options={[
                        { value: 'pure-water', label: 'Pure Water Interface' },
                        { value: 'charged-interface', label: 'Charged Interface' },
                        { value: 'custom', label: 'Custom Phase Rules' },
                      ]}
                    />
                  </Col>
                  {screeningMode !== 'custom' && (
                    <Col xs={24} md={8}>
                      <Text strong>Phase tolerance around 0/180°</Text>
                      <InputNumber min={0} max={90} value={phaseAnchorTolerance} onChange={(value) => setPhaseAnchorTolerance(value ?? phaseAnchorTolerance)} addonAfter="deg" style={{ width: '100%', marginTop: 4 }} />
                    </Col>
                  )}
                  {screeningMode === 'charged-interface' && (
                    <Col xs={24} md={8}>
                      <Text strong>Constrained C-H region</Text>
                      <Space.Compact style={{ width: '100%', marginTop: 4 }}>
                        <InputNumber value={chargedRegionStart} onChange={(value) => setChargedRegionStart(value ?? chargedRegionStart)} style={{ width: '50%' }} />
                        <InputNumber value={chargedRegionEnd} onChange={(value) => setChargedRegionEnd(value ?? chargedRegionEnd)} addonAfter="cm^-1" style={{ width: '50%' }} />
                      </Space.Compact>
                    </Col>
                  )}
                </Row>

                {screeningMode === 'pure-water' && <Paragraph type="secondary" style={{ margin: '10px 0 0' }}>Every recovered peak phase must lie within the tolerance of 0° or 180°.</Paragraph>}
                {screeningMode === 'charged-interface' && <Paragraph type="secondary" style={{ margin: '10px 0 0' }}>Only peaks whose centers lie inside the selected C-H window are constrained. Other peaks are not screened by this preset.</Paragraph>}

                {screeningMode === 'custom' && (
                  <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 12 }}>
                    {customRules.map((rule) => (
                      <Card
                        key={rule.id}
                        size="small"
                        title={`Custom rule ${rule.id}`}
                        extra={<Button size="small" danger icon={<DeleteOutlined />} disabled={customRules.length === 1} onClick={() => setCustomRules((current) => current.filter((item) => item.id !== rule.id))} />}
                      >
                        <Row gutter={[8, 8]}>
                          <Col xs={24} md={8}>
                            <Select
                              value={rule.target}
                              onChange={(value) => updateCustomRule(rule.id, 'target', value)}
                              style={{ width: '100%' }}
                              options={[
                                { value: 'all', label: 'All oscillators' },
                                ...oscillators.map((_, index) => ({ value: index + 1, label: `Oscillator ${index + 1}` })),
                              ]}
                            />
                          </Col>
                          <Col xs={24} md={8}>
                            <Select<CustomRuleCondition>
                              value={rule.condition}
                              onChange={(value) => updateCustomRule(rule.id, 'condition', value)}
                              style={{ width: '100%' }}
                              options={[
                                { value: 'near-anchors', label: 'Near 0° or 180°' },
                                { value: 'phase-range', label: 'Within circular phase range' },
                              ]}
                            />
                          </Col>
                          {rule.condition === 'near-anchors' ? (
                            <Col xs={24} md={8}><InputNumber addonBefore="Tolerance" addonAfter="deg" min={0} max={90} value={rule.tolerance} onChange={(value) => updateCustomRule(rule.id, 'tolerance', value ?? rule.tolerance)} style={{ width: '100%' }} /></Col>
                          ) : (
                            <Col xs={24} md={8}>
                              <Space.Compact style={{ width: '100%' }}>
                                <InputNumber value={rule.rangeMin} onChange={(value) => updateCustomRule(rule.id, 'rangeMin', value ?? rule.rangeMin)} style={{ width: '50%' }} />
                                <InputNumber value={rule.rangeMax} onChange={(value) => updateCustomRule(rule.id, 'rangeMax', value ?? rule.rangeMax)} addonAfter="deg" style={{ width: '50%' }} />
                              </Space.Compact>
                            </Col>
                          )}
                        </Row>
                      </Card>
                    ))}
                    <Button size="small" icon={<PlusOutlined />} onClick={addCustomRule}>Add custom rule</Button>
                  </Space>
                )}

                <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                  <Col xs={12} md={6}><Statistic title="Physical pass" value={screeningCounts.pass} /></Col>
                  <Col xs={12} md={6}><Statistic title="Physical fail" value={screeningCounts.fail} /></Col>
                  <Col xs={12} md={6}><Statistic title="Not screened" value={screeningCounts.notScreened} /></Col>
                  <Col xs={12} md={6}><Statistic title="Numerical + physical pass" value={screeningCounts.numericalAndPhysicalPass} /></Col>
                </Row>
                <Select<ScreeningFilter>
                  value={screeningFilter}
                  onChange={setScreeningFilter}
                  style={{ width: 280, margin: '12px 0' }}
                  options={[
                    { value: 'all', label: 'Show all candidates' },
                    { value: 'physical-pass', label: 'Physical pass only' },
                    { value: 'physical-fail', label: 'Physical fail only' },
                    { value: 'numerical-and-physical-pass', label: 'Numerical + physical pass only' },
                  ]}
                />
                <Table
                  size="small"
                  pagination={{ pageSize: 10, showSizeChanger: true }}
                  rowKey={(row) => row.alternative.configuration_id}
                  dataSource={filteredScreeningRows}
                  columns={[
                    { title: 'Configuration', key: 'configuration', render: (_, row) => row.alternative.configuration_id },
                    { title: 'Numerical', key: 'numerical', render: (_, row) => <Tag color={row.alternative.numerically_valid ? 'green' : 'red'}>{row.alternative.numerically_valid ? 'Pass' : 'Fail'}</Tag> },
                    { title: 'Physical pre-screen', key: 'physical', render: (_, row) => <Tag color={row.screening.status === 'pass' ? 'green' : row.screening.status === 'fail' ? 'red' : 'default'}>{row.screening.status}</Tag> },
                    { title: 'Checked peaks', key: 'checked', render: (_, row) => row.screening.checkedOscillatorCount },
                    {
                      title: 'Failure details', key: 'failures', width: 420,
                      render: (_, row) => row.screening.failures.length === 0
                        ? '—'
                        : row.screening.failures.map((failure) => `Osc ${failure.oscillatorIndex} (${failure.center.toFixed(1)} cm^-1): ${failure.actualPhase.toFixed(2)}°, ${failure.expected}`).join('; '),
                    },
                    { title: 'View', key: 'view', render: (_, row) => <Button size="small" onClick={() => setSelectedAlternativeId(row.alternative.configuration_id)}>View</Button> },
                  ]}
                  scroll={{ x: 1050 }}
                />
              </Card>
            )}

            {result.alternatives.length > 0 && (
              <Card size="small" title="Selected Alternative">
                <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Select
                    value={selectedAlternative?.configuration_id}
                    onChange={setSelectedAlternativeId}
                    options={result.alternatives.map((alternative) => ({ value: alternative.configuration_id, label: alternative.configuration_id }))}
                    style={{ minWidth: 220 }}
                  />
                  <Space wrap>
                    <Checkbox checked={unwrapPhase} onChange={(event) => setUnwrapPhase(event.target.checked)}>Unwrap phase</Checkbox>
                    <Button icon={<DownloadOutlined />} onClick={exportFrequencyData}>Export spectra</Button>
                    <Button icon={<DownloadOutlined />} onClick={exportParameterData}>Export parameters</Button>
                    <Button icon={<DownloadOutlined />} onClick={exportAllAlternatives}>Export all summaries</Button>
                  </Space>
                </Space>
                {selectedAlternative && (
                  <>
                    <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                      <Col xs={12} md={6}><Statistic title="Max intensity mismatch" value={selectedAlternative.metrics.max_intensity_error} precision={5} /></Col>
                      <Col xs={12} md={6}><Statistic title="Intensity NRMSE" value={selectedAlternative.metrics.normalized_rms_intensity_error} precision={5} /></Col>
                      <Col xs={12} md={6}><Statistic title="Max |B|-1" value={selectedAlternative.metrics.max_ratio_magnitude_error} precision={5} /></Col>
                      <Col xs={12} md={6}><Statistic title="PF reconstruction error" value={selectedAlternative.metrics.partial_fraction_max_abs_error} precision={5} /></Col>
                    </Row>
                    <Alert style={{ marginTop: 12 }} type={selectedAlternative.numerically_valid ? 'success' : 'error'} showIcon message={selectedAlternative.numerically_valid ? 'Numerically valid alternative' : 'Partial-fraction validation failed'} description={`Recovered C0: ${complexText(selectedAlternative.c0)}`} />
                    {selectedScreening && (
                      <Alert
                        style={{ marginTop: 8 }}
                        type={selectedScreening.status === 'pass' ? 'success' : selectedScreening.status === 'fail' ? 'warning' : 'info'}
                        showIcon
                        message={`Physical pre-screen: ${selectedScreening.status}`}
                        description={selectedScreening.failures.length === 0
                          ? `${selectedScreening.checkedOscillatorCount} oscillator(s) checked.`
                          : selectedScreening.failures.map((failure) => `Oscillator ${failure.oscillatorIndex}: ${failure.actualPhase.toFixed(3)}°, ${failure.expected}`).join('; ')}
                      />
                    )}
                    {selectedAlternative.warnings.map((warning, index) => <Alert key={index} style={{ marginTop: 8 }} type="warning" message={warning} showIcon />)}
                  </>
                )}
              </Card>
            )}

            {selectedAlternative && (
              <>
                <Card size="small" title="Recovered Lorentzian Parameter Comparison">
                  <Table<LorentzianParameterComparison> size="small" pagination={false} rowKey="oscillator_index" dataSource={selectedAlternative.comparison} columns={comparisonColumns} scroll={{ x: 1600 }} />
                </Card>
                <Card size="small" title="Alternative Rational Representation">
                  <Row gutter={[12, 12]}>
                    <Col xs={24} xl={12}>
                      <Text strong>Alternative P(z), leading coefficient {complexText(selectedAlternative.numerator_coefficients[0])}</Text>
                      <Table size="small" pagination={false} dataSource={coefficientRows(selectedAlternative.numerator_coefficients)} columns={coefficientColumns} />
                    </Col>
                    <Col xs={24} xl={12}>
                      <Text strong>Unchanged Q(z), leading coefficient {complexText(selectedAlternative.denominator_coefficients[0])}</Text>
                      <Table size="small" pagination={false} dataSource={coefficientRows(selectedAlternative.denominator_coefficients)} columns={coefficientColumns} />
                    </Col>
                  </Row>
                  <Text type="secondary">Original C0: {complexText(result.original.c0)}; recovered alternative C0: {complexText(selectedAlternative.c0)}.</Text>
                </Card>
                <Row gutter={[12, 12]}>
                  <Col xs={24} xl={12}><Card size="small"><div ref={poleZeroRef} style={{ minHeight: 350 }} /></Card></Col>
                  <Col xs={24} xl={12}><Card size="small"><div ref={intensityRef} style={{ minHeight: 350 }} /></Card></Col>
                  <Col xs={24} xl={12}><Card size="small"><div ref={realRef} style={{ minHeight: 330 }} /></Card></Col>
                  <Col xs={24} xl={12}><Card size="small"><div ref={imagRef} style={{ minHeight: 330 }} /></Card></Col>
                  <Col xs={24}><Card size="small"><div ref={phaseRef} style={{ minHeight: 330 }} /></Card></Col>
                </Row>
              </>
            )}
          </Space>
        )}
      </Col>
    </Row>
  )
}
