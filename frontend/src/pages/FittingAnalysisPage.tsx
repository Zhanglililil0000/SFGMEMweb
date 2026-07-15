import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Button, Card, Col, Empty, InputNumber, Row, Select, Space,
  Spin, Typography, Upload, message,
} from 'antd'
import { DeleteOutlined, DownloadOutlined, PlayCircleOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import * as api from '../api/mem'
import type { SfgPeakParams, SfgResult } from '../types/mem'
import {
  formatParameterNumber,
  formatPhaseForUnit,
  parseParameterFields,
  phaseFromDisplay,
  phaseInputStep,
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
  alignScalarReferenceToGrid,
  autoDetectReferenceColumns,
  autoDetectScalarColumns,
  buildReferenceSpectrumFromTable,
  buildScalarReferenceFromTable,
  computeNrmseAgainstReference,
  parseReferenceTable,
  type ReferenceSpectrum,
  type ReferenceTable,
  type ScalarReference,
} from '../utils/referenceSpectrum'
import { plotWhenReady } from '../utils/plotlyLoader'

const { Text } = Typography
const MAX_FITTING_POINTS = 10000

type PeakSetKind = 'fitted' | 'ideal'

interface CombinedReferenceColumnSelection {
  wavenumber: number
  intensity: number
  real: number
  imag: number
}

interface ScalarNrmse {
  nrmse: number
  rmsRaw: number
  pointCount: number
  warnings: string[]
}

function emptyPeak(): SfgPeakParams {
  return { amplitude: 1.0, center: 3200, width: 10, phase: 0, profile_type: 'lorentzian', gaussian_hwhm: 0 }
}

function stripPeakLabel(peak: SfgPeakParams): SfgPeakParams {
  return {
    amplitude: peak.amplitude,
    center: peak.center,
    width: peak.width,
    phase: peak.phase,
    profile_type: peak.profile_type ?? 'lorentzian',
    gaussian_hwhm: peakGaussianHwhm(peak),
  }
}

function safeArr(values: number[]): number[] {
  return values.map((value) => (Number.isFinite(value) ? value : 0))
}

function cell(value: number | string | undefined): string {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return value
}

function rangeText(range?: [number, number]): string {
  return range ? `${range[0]} to ${range[1]}` : ''
}

function resultRange(result: SfgResult): [number, number] {
  return [result.wavenumbers[0], result.wavenumbers[result.wavenumbers.length - 1]]
}

function referenceFromResult(result: SfgResult, name: string): ReferenceSpectrum {
  return {
    name,
    wavenumbers: result.wavenumbers,
    real: result.real_part,
    imag: result.imag_part,
    pointCount: result.wavenumbers.length,
    frequencyRange: resultRange(result),
  }
}

function scalarReferenceFromResult(result: SfgResult, name: string): ScalarReference {
  return {
    name,
    wavenumbers: result.wavenumbers,
    values: result.intensity,
    pointCount: result.wavenumbers.length,
    frequencyRange: resultRange(result),
  }
}

function computeScalarNrmse(
  values: number[],
  referenceValues: number[],
  label: string,
): { metrics?: ScalarNrmse; error?: string } {
  const n = values.length
  if (n === 0 || referenceValues.length !== n) {
    return { error: 'Intensity and reference intensity arrays must have the same non-zero length before NRMSE calculation.' }
  }

  let residualSumSq = 0
  let referenceSumSq = 0
  for (let i = 0; i < n; i++) {
    const residual = values[i] - referenceValues[i]
    residualSumSq += residual * residual
    referenceSumSq += referenceValues[i] * referenceValues[i]
  }

  const rmsRaw = Math.sqrt(referenceSumSq / n)
  const rms = Math.max(rmsRaw, NRMSE_EPSILON)
  const warnings = rmsRaw < NRMSE_EPSILON
    ? [`${label} intensity RMS is near zero; Intensity-NRMSE used epsilon normalization.`]
    : []

  return {
    metrics: {
      nrmse: Math.sqrt(residualSumSq / n) / rms,
      rmsRaw,
      pointCount: n,
      warnings,
    },
  }
}

function parseParamsFile(text: string, phaseUnit: PhaseUnit): { nrReal: number; nrImag: number; peaks: SfgPeakParams[] } {
  const fields = parseParameterFields(text)
  const numberValue = (key: string, fallback: number) => {
    const parsed = Number(fields[key])
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const peakIndices = importedPeakIndices(fields)
  const importedPeaks = peakIndices.length > 0
    ? peakIndices.map((index) => buildImportedPeak(fields, index, phaseUnit, 3200))
    : (fields.Amplitude != null || fields.amplitude != null || fields.profile_type != null)
      ? [buildImportedPeak(fields, null, phaseUnit, 3200)]
      : []
  return {
    nrReal: numberValue('NR_Real', 0),
    nrImag: numberValue('NR_Imag', 0),
    peaks: importedPeaks.map(stripPeakLabel),
  }
}

function kindTitle(kind: PeakSetKind): string {
  return kind === 'fitted' ? 'Fitted Peak Parameters' : 'Ideal Peak Parameters'
}

function kindFilePrefix(kind: PeakSetKind): string {
  return kind === 'fitted' ? 'fitted' : 'ideal'
}

function autoDetectCombinedReferenceColumns(table: ReferenceTable): CombinedReferenceColumnSelection {
  if (!table.hasHeader && table.columns.length >= 4) {
    return { wavenumber: 0, intensity: 1, real: 2, imag: 3 }
  }

  const reImSelection = autoDetectReferenceColumns(table)
  const intensitySelection = autoDetectScalarColumns(table)
  return {
    wavenumber: reImSelection.wavenumber,
    intensity: intensitySelection.value,
    real: reImSelection.real,
    imag: reImSelection.imag,
  }
}

export default function FittingAnalysisPage() {
  const [xmin, setXmin] = useState(2800)
  const [xmax, setXmax] = useState(3800)
  const [npoints, setNpoints] = useState(1000)
  const [phaseUnit, setPhaseUnit] = useState<PhaseUnit>('degrees')

  const [fittedNrReal, setFittedNrReal] = useState(0)
  const [fittedNrImag, setFittedNrImag] = useState(0)
  const [fittedPeaks, setFittedPeaks] = useState<SfgPeakParams[]>([emptyPeak()])

  const [idealNrReal, setIdealNrReal] = useState(0)
  const [idealNrImag, setIdealNrImag] = useState(0)
  const [idealPeaks, setIdealPeaks] = useState<SfgPeakParams[]>([emptyPeak()])

  const [fittedResult, setFittedResult] = useState<SfgResult | null>(null)
  const [idealGeneratedResult, setIdealGeneratedResult] = useState<SfgResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [referenceTable, setReferenceTable] = useState<ReferenceTable | null>(null)
  const [referenceSelection, setReferenceSelection] = useState<CombinedReferenceColumnSelection | null>(null)
  const [idealSpectrum, setIdealSpectrum] = useState<ReferenceSpectrum | null>(null)
  const [intensitySpectrum, setIntensitySpectrum] = useState<ScalarReference | null>(null)
  const [referenceError, setReferenceError] = useState<string | null>(null)

  const reRef = useRef<HTMLDivElement>(null)
  const imRef = useRef<HTMLDivElement>(null)
  const residualRef = useRef<HTMLDivElement>(null)
  const intensityRef = useRef<HTMLDivElement>(null)

  const referenceColumnOptions = referenceTable?.columns.map((column) => ({
    value: column.index,
    label: `${column.index}: ${column.name}`,
  })) ?? []

  const generatedIdealReference = useMemo(() => (
    idealGeneratedResult ? referenceFromResult(idealGeneratedResult, 'Generated ideal peak parameters') : null
  ), [idealGeneratedResult])

  const activeIdealReference = idealSpectrum ?? generatedIdealReference
  const activeIdealSource = idealSpectrum ? 'imported_ideal_re_im' : generatedIdealReference ? 'generated_ideal_peak_parameters' : ''
  const activeIdealLabel = idealSpectrum
    ? `Imported ideal Re/Im: ${idealSpectrum.name}`
    : generatedIdealReference
      ? 'Generated ideal peak parameters'
      : ''

  const generatedIntensityReference = useMemo(() => (
    idealGeneratedResult ? scalarReferenceFromResult(idealGeneratedResult, 'Generated ideal intensity from ideal peak parameters') : null
  ), [idealGeneratedResult])

  const activeIntensityReference = intensitySpectrum ?? generatedIntensityReference
  const activeIntensitySource = intensitySpectrum ? 'imported_intensity_reference' : generatedIntensityReference ? 'generated_ideal_peak_parameters' : ''
  const activeIntensityLabel = intensitySpectrum
    ? `Imported intensity reference: ${intensitySpectrum.name}`
    : generatedIntensityReference
      ? 'Generated ideal intensity from ideal peak parameters'
      : ''

  const alignedIdeal = useMemo(() => {
    if (!fittedResult || !activeIdealReference) return null
    return alignReferenceToGrid(activeIdealReference, fittedResult.wavenumbers)
  }, [fittedResult, activeIdealReference])

  const alignedIntensity = useMemo(() => {
    if (!fittedResult || !activeIntensityReference) return null
    return alignScalarReferenceToGrid(activeIntensityReference, fittedResult.wavenumbers, 'Intensity reference')
  }, [fittedResult, activeIntensityReference])

  const idealAlignmentMethod = alignedIdeal?.aligned
    ? idealSpectrum ? alignedIdeal.aligned.method : 'Direct use of generated ideal peak-parameter grid'
    : ''
  const intensityAlignmentMethod = alignedIntensity?.aligned
    ? intensitySpectrum ? alignedIntensity.aligned.method : 'Direct use of generated ideal peak-parameter grid'
    : ''

  const nrmse = useMemo(() => {
    if (!fittedResult || !alignedIdeal?.aligned) return null
    return computeNrmseAgainstReference(
      fittedResult.real_part,
      fittedResult.imag_part,
      alignedIdeal.aligned.real,
      alignedIdeal.aligned.imag,
      activeIdealLabel || 'Ideal spectrum',
    )
  }, [fittedResult, alignedIdeal, activeIdealLabel])

  const intensityNrmse = useMemo(() => {
    if (!fittedResult || !alignedIntensity?.aligned) return null
    return computeScalarNrmse(
      fittedResult.intensity,
      alignedIntensity.aligned.values,
      activeIntensityLabel || 'Intensity reference',
    )
  }, [fittedResult, alignedIntensity, activeIntensityLabel])

  const residual = useMemo(() => {
    if (!fittedResult || !alignedIdeal?.aligned) return null
    const re = fittedResult.real_part.map((value, index) => value - alignedIdeal.aligned!.real[index])
    const im = fittedResult.imag_part.map((value, index) => value - alignedIdeal.aligned!.imag[index])
    const magnitude = re.map((value, index) => Math.sqrt(value * value + im[index] * im[index]))
    return { re, im, magnitude }
  }, [fittedResult, alignedIdeal])

  const intensityResidual = useMemo(() => {
    if (!fittedResult || !alignedIntensity?.aligned) return null
    return fittedResult.intensity.map((value, index) => value - alignedIntensity.aligned!.values[index])
  }, [fittedResult, alignedIntensity])

  const applyReferenceSelection = (
    table = referenceTable,
    selection = referenceSelection,
    showSuccess = true,
  ) => {
    if (!table || !selection) return
    const messages: string[] = []
    let parsedIdeal: ReferenceSpectrum | null = null
    let parsedIntensity: ScalarReference | null = null

    try {
      parsedIdeal = buildReferenceSpectrumFromTable(table, {
        wavenumber: selection.wavenumber,
        real: selection.real,
        imag: selection.imag,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unable to build ideal Re/Im spectrum from selected columns.'
      messages.push(msg)
    }

    try {
      parsedIntensity = buildScalarReferenceFromTable(table, {
        wavenumber: selection.wavenumber,
        value: selection.intensity,
      }, 'intensity')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unable to build intensity reference from selected columns.'
      messages.push(msg)
    }

    setIdealSpectrum(parsedIdeal)
    setIntensitySpectrum(parsedIntensity)
    setReferenceError(messages.length > 0 ? messages.join(' ') : null)

    if (!showSuccess) return
    if (messages.length > 0) {
      message.warning(messages.join(' '))
    } else {
      message.success(`Applied reference spectrum: Re/Im ${parsedIdeal?.pointCount ?? 0} points; intensity ${parsedIntensity?.pointCount ?? 0} points`)
    }
  }

  const handleReferenceUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        const table = parseReferenceTable(text, file.name)
        const detected = autoDetectCombinedReferenceColumns(table)
        setReferenceTable(table)
        setReferenceSelection(detected)
        applyReferenceSelection(table, detected, true)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unable to parse reference spectrum file.'
        setReferenceError(msg)
        message.error(msg)
      }
    }
    reader.readAsText(file)
    return false
  }

  const handleImportParams = (file: File, kind: PeakSetKind) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const parsed = parseParamsFile(text, phaseUnit)
      const importedPeaks = parsed.peaks.length > 0 ? parsed.peaks : [emptyPeak()]
      if (kind === 'fitted') {
        setFittedNrReal(parsed.nrReal)
        setFittedNrImag(parsed.nrImag)
        setFittedPeaks(importedPeaks)
      } else {
        setIdealNrReal(parsed.nrReal)
        setIdealNrImag(parsed.nrImag)
        setIdealPeaks(importedPeaks)
      }
      message.success(`Imported ${parsed.peaks.length} ${kindFilePrefix(kind)} peak(s); Phi interpreted as ${phaseUnitName(phaseUnit)}`)
    }
    reader.readAsText(file)
    return false
  }

  const exportParams = (kind: PeakSetKind) => {
    const nrReal = kind === 'fitted' ? fittedNrReal : idealNrReal
    const nrImag = kind === 'fitted' ? fittedNrImag : idealNrImag
    const peaks = kind === 'fitted' ? fittedPeaks : idealPeaks
    const lines = [
      `# Fitting Analysis ${kindFilePrefix(kind)} peak parameters`,
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
    const a = document.createElement('a')
    a.href = url
    a.download = `Fitting_Analysis_${kindFilePrefix(kind)}_peak_parameters.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success(`${kindTitle(kind)} exported (Phase unit: ${phaseUnitName(phaseUnit)})`)
  }

  const handleGenerate = async () => {
    if (xmin >= xmax) { message.error('Frequency start must be less than frequency end'); return }
    if (!Number.isInteger(npoints) || npoints < 10 || npoints > MAX_FITTING_POINTS) {
      message.error(`Number of points must be an integer between 10 and ${MAX_FITTING_POINTS}`)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [fittedData, idealData] = await Promise.all([
        api.generateSfg({ xmin, xmax, npoints, nr_real: fittedNrReal, nr_imag: fittedNrImag, peaks: fittedPeaks }),
        api.generateSfg({ xmin, xmax, npoints, nr_real: idealNrReal, nr_imag: idealNrImag, peaks: idealPeaks }),
      ])
      setFittedResult(fittedData)
      setIdealGeneratedResult(idealData)
    } catch (e) {
      setError(api.getApiErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const handleExportCsv = () => {
    if (!fittedResult) return
    const metrics = nrmse?.metrics
    const intensityMetrics = intensityNrmse?.metrics
    const lines = [
      '# page,Fitting Analysis',
      '# frequency_range,' + rangeText([xmin, xmax]),
      '# number_of_points,' + cell(fittedResult.wavenumbers.length),
      '# phase_unit,' + phaseUnitName(phaseUnit),
      '# fitted_peak_count,' + cell(fittedPeaks.length),
      '# fitted_nr_real,' + cell(fittedNrReal),
      '# fitted_nr_imag,' + cell(fittedNrImag),
      '# ideal_peak_count,' + cell(idealPeaks.length),
      '# ideal_nr_real,' + cell(idealNrReal),
      '# ideal_nr_imag,' + cell(idealNrImag),
      '# ideal_re_im_source,' + cell(activeIdealSource),
      '# ideal_re_im_label,' + cell(activeIdealLabel),
      '# ideal_re_im_original_range,' + rangeText(activeIdealReference?.frequencyRange),
      '# ideal_re_im_alignment_method,' + cell(idealAlignmentMethod),
      '# intensity_reference_source,' + cell(activeIntensitySource),
      '# intensity_reference_label,' + cell(activeIntensityLabel),
      '# intensity_reference_original_range,' + rangeText(activeIntensityReference?.frequencyRange),
      '# intensity_reference_alignment_method,' + cell(intensityAlignmentMethod),
      '# comparison_range,' + rangeText(alignedIdeal?.aligned?.frequencyRange ?? alignedIntensity?.aligned?.frequencyRange),
      '# nrmse_points,' + cell(metrics?.pointCount),
      '# Re_NRMSE,' + cell(metrics?.reNrmse),
      '# Im_NRMSE,' + cell(metrics?.imNrmse),
      '# complex_NRMSE,' + cell(metrics?.complexNrmse),
      '# intensity_NRMSE,' + cell(intensityMetrics?.nrmse),
      '# NRMSE,Normalized Root Mean Square Error',
      '# NRMSE Chinese name,归一化均方根误差',
      '# NRMSE normalization,RMSE divided by RMS amplitude of the corresponding reference spectrum',
      ...fittedPeaks.flatMap((peak, index) => [
        `# fitted_peak_${index + 1}_profile,${cell(peak.profile_type ?? 'lorentzian')}`,
        `# fitted_peak_${index + 1}_amplitude,${cell(peak.amplitude)}`,
        `# fitted_peak_${index + 1}_center,${cell(peak.center)}`,
        `# fitted_peak_${index + 1}_lorentzian_gamma_hwhm,${cell(peak.width)}`,
        `# fitted_peak_${index + 1}_lorentzian_fwhm,${cell(2 * peak.width)}`,
        `# fitted_peak_${index + 1}_gaussian_hwhm,${cell(peakGaussianHwhm(peak))}`,
        `# fitted_peak_${index + 1}_gaussian_fwhm,${cell(gaussianHwhmToFwhm(peakGaussianHwhm(peak)))}`,
        `# fitted_peak_${index + 1}_gaussian_sigma,${cell(gaussianHwhmToSigma(peakGaussianHwhm(peak)))}`,
        `# fitted_peak_${index + 1}_phase_${phaseUnit},${formatPhaseForUnit(peak.phase, phaseUnit)}`,
      ]),
      ...idealPeaks.flatMap((peak, index) => [
        `# ideal_peak_${index + 1}_profile,${cell(peak.profile_type ?? 'lorentzian')}`,
        `# ideal_peak_${index + 1}_amplitude,${cell(peak.amplitude)}`,
        `# ideal_peak_${index + 1}_center,${cell(peak.center)}`,
        `# ideal_peak_${index + 1}_lorentzian_gamma_hwhm,${cell(peak.width)}`,
        `# ideal_peak_${index + 1}_lorentzian_fwhm,${cell(2 * peak.width)}`,
        `# ideal_peak_${index + 1}_gaussian_hwhm,${cell(peakGaussianHwhm(peak))}`,
        `# ideal_peak_${index + 1}_gaussian_fwhm,${cell(gaussianHwhmToFwhm(peakGaussianHwhm(peak)))}`,
        `# ideal_peak_${index + 1}_gaussian_sigma,${cell(gaussianHwhmToSigma(peakGaussianHwhm(peak)))}`,
        `# ideal_peak_${index + 1}_phase_${phaseUnit},${formatPhaseForUnit(peak.phase, phaseUnit)}`,
      ]),
      'frequency,Re_fitted,Im_fitted,Re_reference_on_fitted_grid,Im_reference_on_fitted_grid,Re_residual,Im_residual,intensity_fitted,intensity_reference_on_fitted_grid,intensity_residual,complex_residual_magnitude',
    ]
    for (let i = 0; i < fittedResult.wavenumbers.length; i++) {
      lines.push([
        cell(fittedResult.wavenumbers[i]),
        cell(fittedResult.real_part[i]),
        cell(fittedResult.imag_part[i]),
        cell(alignedIdeal?.aligned?.real[i]),
        cell(alignedIdeal?.aligned?.imag[i]),
        cell(residual?.re[i]),
        cell(residual?.im[i]),
        cell(fittedResult.intensity[i]),
        cell(alignedIntensity?.aligned?.values[i]),
        cell(intensityResidual?.[i]),
        cell(residual?.magnitude[i]),
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Fitting_Analysis_Result.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success('Fitting Analysis CSV exported')
  }

  const renderPeakParameterCard = (kind: PeakSetKind) => {
    const isFitted = kind === 'fitted'
    const nrReal = isFitted ? fittedNrReal : idealNrReal
    const nrImag = isFitted ? fittedNrImag : idealNrImag
    const peaks = isFitted ? fittedPeaks : idealPeaks
    const setNrReal = isFitted ? setFittedNrReal : setIdealNrReal
    const setNrImag = isFitted ? setFittedNrImag : setIdealNrImag
    const setPeaks = isFitted ? setFittedPeaks : setIdealPeaks

    return (
      <Card size="small" title={kindTitle(kind)}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Upload accept=".txt,.csv" maxCount={1} showUploadList={false} beforeUpload={(file) => handleImportParams(file, kind)}>
            <Button size="small" icon={<UploadOutlined />}>Import {kindFilePrefix(kind)} peak parameters</Button>
          </Upload>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => exportParams(kind)}>Export {kindFilePrefix(kind)} peak parameters</Button>
          <Button size="small" icon={<PlusOutlined />} onClick={() => setPeaks([...peaks, emptyPeak()])}>Add peak</Button>
        </Space>
        <Row gutter={[12, 8]} style={{ marginBottom: 8 }}>
          <Col xs={12}>
            <InputNumber addonBefore="NR Real" value={nrReal} onChange={(value) => setNrReal(value ?? 0)} step={0.1} style={{ width: '100%' }} size="small" />
          </Col>
          <Col xs={12}>
            <InputNumber addonBefore="NR Imag" value={nrImag} onChange={(value) => setNrImag(value ?? 0)} step={0.1} style={{ width: '100%' }} size="small" />
          </Col>
        </Row>
        <Row gutter={[8, 8]}>
          {peaks.map((peak, index) => (
            <Col key={index} xs={24} md={12} xl={8}>
              <Card
                size="small"
                title={`Peak ${index + 1}`}
                extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => setPeaks(peaks.filter((_, i) => i !== index))} />}
              >
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Select
                    value={peak.profile_type ?? 'lorentzian'}
                    onChange={(value) => setPeaks(peaks.map((item, i) => i === index ? { ...item, profile_type: normalizeProfileType(value) } : item))}
                    options={profileTypeOptions}
                    style={{ width: '100%' }}
                    size="small"
                  />
                  <InputNumber addonBefore="A" value={peak.amplitude} onChange={(value) => value != null && setPeaks(peaks.map((item, i) => i === index ? { ...item, amplitude: value } : item))} step={0.1} style={{ width: '100%' }} size="small" />
                  <InputNumber addonBefore="Omega" value={peak.center} onChange={(value) => value != null && setPeaks(peaks.map((item, i) => i === index ? { ...item, center: value } : item))} step={1} style={{ width: '100%' }} size="small" />
                  <InputNumber addonBefore="L Gamma (HWHM)" value={peak.width} onChange={(value) => value != null && setPeaks(peaks.map((item, i) => i === index ? { ...item, width: value } : item))} step={0.5} min={0.1} style={{ width: '100%' }} size="small" />
                  <InputNumber
                    addonBefore="G HWHM"
                    value={peakGaussianHwhm(peak)}
                    disabled={(peak.profile_type ?? 'lorentzian') === 'lorentzian'}
                    onChange={(value) => value != null && setPeaks(peaks.map((item, i) => i === index ? { ...item, gaussian_hwhm: value } : item))}
                    step={0.5}
                    min={0}
                    style={{ width: '100%' }}
                    size="small"
                  />
                  {(peak.profile_type ?? 'lorentzian') === 'voigt' && (
                    <div style={{ color: '#8c8c8c', fontSize: 12, lineHeight: 1.45 }}>
                      {peakWidthSummaryLines(peak).map((line) => (
                        <div key={line.label}>
                          {line.label}: {line.value}{line.note ? ` (${line.note})` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                  <InputNumber
                    addonBefore={`Phase (${phaseUnitSymbol(phaseUnit)})`}
                    value={phaseToDisplay(peak.phase, phaseUnit)}
                    onChange={(value) => value != null && setPeaks(peaks.map((item, i) => i === index ? { ...item, phase: phaseFromDisplay(value, phaseUnit) } : item))}
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
    )
  }

  useEffect(() => {
    const container = reRef.current
    if (!container || !fittedResult) return
    const traces: PlotlyTrace[] = [
      { x: safeArr(fittedResult.wavenumbers), y: safeArr(fittedResult.real_part), type: 'scatter', mode: 'lines', name: 'Fitted Re[chi]', line: { color: '#c0392b', width: 2 } },
    ]
    if (alignedIdeal?.aligned) {
      traces.push({ x: safeArr(fittedResult.wavenumbers), y: safeArr(alignedIdeal.aligned.real), type: 'scatter', mode: 'lines', name: `${activeIdealLabel} Re[chi]`, line: { color: '#c0392b', width: 1.5, dash: 'dash' } })
    }
    return plotWhenReady(container, traces, {
      title: { text: 'Re Comparison: fitted vs reference', font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: 'Re[chi]' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, { displayModeBar: true, displaylogo: false, scrollZoom: true })
  }, [fittedResult, alignedIdeal, activeIdealLabel])

  useEffect(() => {
    const container = imRef.current
    if (!container || !fittedResult) return
    const traces: PlotlyTrace[] = [
      { x: safeArr(fittedResult.wavenumbers), y: safeArr(fittedResult.imag_part), type: 'scatter', mode: 'lines', name: 'Fitted Im[chi]', line: { color: '#2471a3', width: 2 } },
    ]
    if (alignedIdeal?.aligned) {
      traces.push({ x: safeArr(fittedResult.wavenumbers), y: safeArr(alignedIdeal.aligned.imag), type: 'scatter', mode: 'lines', name: `${activeIdealLabel} Im[chi]`, line: { color: '#2471a3', width: 1.5, dash: 'dash' } })
    }
    return plotWhenReady(container, traces, {
      title: { text: 'Im Comparison: fitted vs reference', font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: 'Im[chi]' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, { displayModeBar: true, displaylogo: false, scrollZoom: true })
  }, [fittedResult, alignedIdeal, activeIdealLabel])

  useEffect(() => {
    const container = residualRef.current
    if (!container || !fittedResult || !residual) return
    const w = safeArr(fittedResult.wavenumbers)
    return plotWhenReady(container, [
      { x: w, y: safeArr(residual.re), type: 'scatter', mode: 'lines', name: 'Re residual', line: { color: '#c0392b', width: 1.8 } },
      { x: w, y: safeArr(residual.im), type: 'scatter', mode: 'lines', name: 'Im residual', line: { color: '#2471a3', width: 1.8 } },
      { x: [w[0], w[w.length - 1]], y: [0, 0], type: 'scatter', mode: 'lines', name: 'Zero baseline', line: { color: '#777', width: 1, dash: 'dot' } },
    ], {
      title: { text: 'Residuals: fitted - reference', font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: 'Residual' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, { displayModeBar: true, displaylogo: false, scrollZoom: true })
  }, [fittedResult, residual])

  useEffect(() => {
    const container = intensityRef.current
    if (!container || !fittedResult) return
    const traces: PlotlyTrace[] = [
      { x: safeArr(fittedResult.wavenumbers), y: safeArr(fittedResult.intensity), type: 'scatter', mode: 'lines', name: 'Fitted intensity |chi|^2', line: { color: '#8e44ad', width: 2 } },
    ]
    if (alignedIntensity?.aligned) {
      traces.push({ x: safeArr(fittedResult.wavenumbers), y: safeArr(alignedIntensity.aligned.values), type: 'scatter', mode: 'lines', name: activeIntensityLabel, line: { color: '#16a085', width: 1.7, dash: 'dash' } })
    }
    return plotWhenReady(container, traces, {
      title: { text: 'Intensity Comparison: fitted vs reference', font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: '|chi|^2' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, { displayModeBar: true, displaylogo: false, scrollZoom: true })
  }, [fittedResult, alignedIntensity, activeIntensityLabel])

  return (
    <div>
      {error && <Alert type="error" message={error} closable showIcon style={{ marginBottom: 12 }} />}

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="Frequency Axis">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <InputNumber addonBefore="Start" value={xmin} onChange={(value) => setXmin(value ?? xmin)} style={{ width: '100%' }} />
              <InputNumber addonBefore="End" value={xmax} onChange={(value) => setXmax(value ?? xmax)} style={{ width: '100%' }} />
              <InputNumber addonBefore="Points" min={10} max={MAX_FITTING_POINTS} value={npoints} onChange={(value) => setNpoints(value ?? npoints)} style={{ width: '100%' }} />
              <Space wrap>
                <Text strong>Phase unit</Text>
                <Select size="small" value={phaseUnit} onChange={setPhaseUnit} options={phaseUnitOptions} style={{ width: 150 }} />
              </Space>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Phi display, manual input, parameter import and parameter export use this unit; backend calculation uses radians.
              </Text>
              <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} onClick={handleGenerate}>
                Generate fitted and ideal spectra
              </Button>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card size="small" title="Imported Reference Spectrum (Intensity / Re / Im)">
            <Space wrap style={{ marginBottom: 8 }}>
              <Upload accept=".csv,.txt" maxCount={1} showUploadList={false} beforeUpload={handleReferenceUpload}>
                <Button size="small" icon={<UploadOutlined />}>Import reference spectrum</Button>
              </Upload>
              <Button
                size="small"
                icon={<DeleteOutlined />}
                disabled={!referenceTable && !idealSpectrum && !intensitySpectrum}
                onClick={() => {
                  setReferenceTable(null)
                  setReferenceSelection(null)
                  setIdealSpectrum(null)
                  setIntensitySpectrum(null)
                  setReferenceError(null)
                }}
              >
                Clear imported reference
              </Button>
            </Space>
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
              Optional. Import one CSV/TXT file that contains Wavenumber, Intensity, ideal Re and ideal Im columns. Imported columns are used for comparison and NRMSE; missing imports fall back to the ideal peak parameters.
            </Text>
            {(idealSpectrum || intensitySpectrum) && (
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                {referenceTable?.name ?? idealSpectrum?.name ?? intensitySpectrum?.name}
                {idealSpectrum && ` | Re/Im points: ${idealSpectrum.pointCount} | Re/Im range: ${idealSpectrum.frequencyRange[0]}-${idealSpectrum.frequencyRange[1]} cm^-1`}
                {intensitySpectrum && ` | intensity points: ${intensitySpectrum.pointCount} | intensity range: ${intensitySpectrum.frequencyRange[0]}-${intensitySpectrum.frequencyRange[1]} cm^-1`}
              </Text>
            )}
            {referenceTable && referenceSelection && (
              <Space wrap style={{ display: 'flex', marginBottom: 8 }}>
                <Text type="secondary">Rows: {referenceTable.rowCount}</Text>
                <Text>Wavenumber</Text>
                <Select size="small" value={referenceSelection.wavenumber} options={referenceColumnOptions} onChange={(value) => setReferenceSelection({ ...referenceSelection, wavenumber: value })} style={{ width: 190 }} />
                <Text>Intensity</Text>
                <Select size="small" value={referenceSelection.intensity} options={referenceColumnOptions} onChange={(value) => setReferenceSelection({ ...referenceSelection, intensity: value })} style={{ width: 190 }} />
                <Text>Ideal Re</Text>
                <Select size="small" value={referenceSelection.real} options={referenceColumnOptions} onChange={(value) => setReferenceSelection({ ...referenceSelection, real: value })} style={{ width: 190 }} />
                <Text>Ideal Im</Text>
                <Select size="small" value={referenceSelection.imag} options={referenceColumnOptions} onChange={(value) => setReferenceSelection({ ...referenceSelection, imag: value })} style={{ width: 190 }} />
                <Button size="small" type="primary" onClick={() => applyReferenceSelection()}>Apply selected columns</Button>
              </Space>
            )}
            {referenceError && <Alert type="warning" message={referenceError} showIcon style={{ marginBottom: 8 }} />}
            {alignedIdeal?.error && <Alert type="warning" message={alignedIdeal.error} showIcon style={{ marginBottom: 8 }} />}
            {alignedIntensity?.error && <Alert type="warning" message={alignedIntensity.error} showIcon style={{ marginBottom: 8 }} />}
            {alignedIdeal?.aligned?.warnings.map((warning) => (
              <Alert key={warning} type="info" message={warning} showIcon style={{ marginTop: 8 }} />
            ))}
            {alignedIntensity?.aligned?.warnings.map((warning) => (
              <Alert key={warning} type="info" message={warning} showIcon style={{ marginTop: 8 }} />
            ))}
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} xl={12}>{renderPeakParameterCard('fitted')}</Col>
        <Col xs={24} xl={12}>{renderPeakParameterCard('ideal')}</Col>
      </Row>

      <Spin spinning={loading}>
        {!fittedResult ? (
          <div style={{ padding: 60, textAlign: 'center', background: '#fff', borderRadius: 8, marginTop: 12 }}>
            <Empty description="Set fitted and ideal peak parameters, then generate spectra" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <>
            <Card
              size="small"
              title="Fitting Analysis Results"
              style={{ marginTop: 12 }}
              extra={<Button size="small" icon={<DownloadOutlined />} onClick={handleExportCsv}>Export CSV</Button>}
            >
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
                NRMSE = Normalized Root Mean Square Error（归一化均方根误差）
              </Text>
              <Space wrap style={{ display: 'flex' }}>
                <Text type="secondary">Fitted range: {fittedResult.wavenumbers[0]}-{fittedResult.wavenumbers[fittedResult.wavenumbers.length - 1]} cm^-1</Text>
                <Text type="secondary">Points: {fittedResult.wavenumbers.length}</Text>
                <Text type="secondary">Fitted peaks: {fittedPeaks.length}</Text>
                <Text type="secondary">Ideal peaks: {idealPeaks.length}</Text>
                <Text type="secondary">Phase unit: {phaseUnitName(phaseUnit)}</Text>
                <Text type="secondary">Re/Im reference: {activeIdealLabel || 'none'}</Text>
                <Text type="secondary">Intensity reference: {activeIntensityLabel || 'none'}</Text>
                {alignedIdeal?.aligned && (
                  <>
                    <Text type="secondary">Re/Im comparison points: {alignedIdeal.aligned.pointCount}</Text>
                    <Text type="secondary">Re/Im alignment: {idealAlignmentMethod}</Text>
                  </>
                )}
                {alignedIntensity?.aligned && (
                  <>
                    <Text type="secondary">Intensity comparison points: {alignedIntensity.aligned.pointCount}</Text>
                    <Text type="secondary">Intensity alignment: {intensityAlignmentMethod}</Text>
                  </>
                )}
                {nrmse?.metrics && (
                  <>
                    <Text type="secondary">Re-NRMSE: {nrmse.metrics.reNrmse.toExponential(4)}</Text>
                    <Text type="secondary">Im-NRMSE: {nrmse.metrics.imNrmse.toExponential(4)}</Text>
                    <Text type="secondary">Complex NRMSE: {nrmse.metrics.complexNrmse.toExponential(4)}</Text>
                  </>
                )}
                {intensityNrmse?.metrics && (
                  <Text type="secondary">Intensity-NRMSE: {intensityNrmse.metrics.nrmse.toExponential(4)}</Text>
                )}
              </Space>
              {nrmse?.metrics?.warnings.map((warning) => (
                <Alert key={warning} type="warning" message={warning} showIcon style={{ marginTop: 8 }} />
              ))}
              {intensityNrmse?.metrics?.warnings.map((warning) => (
                <Alert key={warning} type="warning" message={warning} showIcon style={{ marginTop: 8 }} />
              ))}
              {nrmse?.error && <Alert type="warning" message={nrmse.error} showIcon style={{ marginTop: 8 }} />}
              {intensityNrmse?.error && <Alert type="warning" message={intensityNrmse.error} showIcon style={{ marginTop: 8 }} />}
            </Card>
            <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
              <Col xs={24} lg={12}><Card size="small"><div ref={reRef} style={{ width: '100%', minHeight: 340 }} /></Card></Col>
              <Col xs={24} lg={12}><Card size="small"><div ref={imRef} style={{ width: '100%', minHeight: 340 }} /></Card></Col>
              <Col xs={24} lg={12}><Card size="small"><div ref={intensityRef} style={{ width: '100%', minHeight: 320 }} /></Card></Col>
              <Col xs={24} lg={12}>
                <Card size="small">
                  {residual ? <div ref={residualRef} style={{ width: '100%', minHeight: 320 }} /> : <Empty description="No aligned Re/Im reference for residuals" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Spin>
    </div>
  )
}
