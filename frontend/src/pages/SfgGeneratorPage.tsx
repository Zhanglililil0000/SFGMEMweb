import { useState, useRef, useEffect, useCallback } from 'react'
import { Row, Col, Card, InputNumber, Button, Switch, Typography, message, Space, Divider, Alert, Upload, Select } from 'antd'
import { DownloadOutlined, PlusOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import * as api from '../api/mem'
import type { SfgPeakParams, SfgResult } from '../types/mem'
import {
  formatParameterNumber,
  formatPhaseForUnit,
  phaseFromDisplay,
  phaseInputStep,
  phaseToDisplay,
  phaseUnitName,
  phaseUnitOptions,
  phaseUnitSymbol,
  type PhaseUnit,
  parseParameterFields,
} from '../utils/phaseUnit'
import { buildImportedPeak, importedPeakIndices, normalizeProfileType, profileTypeOptions } from '../utils/sfgPeakParams'
import {
  gaussianHwhmToFwhm,
  gaussianHwhmToSigma,
  peakGaussianHwhm,
  peakWidthSummaryLines,
} from '../utils/lineShapeWidths'
import { ensurePlotly, purgePlot } from '../utils/plotlyLoader'

const { Text } = Typography

const chartConfig = {
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  displaylogo: false,
  scrollZoom: true,
}

function emptyPeak(): SfgPeakParams {
  return { amplitude: 1.0, center: 3200, width: 10, phase: 0, profile_type: 'lorentzian', gaussian_hwhm: 0 }
}

function csvCell(value: number | string): string {
  const text = typeof value === 'number' ? value.toExponential(6) : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export default function SfgGeneratorPage() {
  const [xmin, setXmin] = useState(2800)
  const [xmax, setXmax] = useState(3800)
  const [npoints, setNpoints] = useState(1000)
  const [nrReal, setNrReal] = useState(0.0)
  const [nrImag, setNrImag] = useState(0.0)
  const [peaks, setPeaks] = useState<SfgPeakParams[]>([
    { amplitude: 1.0, center: 3200, width: 10, phase: 0, profile_type: 'lorentzian', gaussian_hwhm: 0 },
    { amplitude: 0.8, center: 3400, width: 15, phase: 0, profile_type: 'lorentzian', gaussian_hwhm: 0 },
  ])
  const [phaseUnit, setPhaseUnit] = useState<PhaseUnit>('degrees')
  const [showSubpeaks, setShowSubpeaks] = useState(false)
  const [result, setResult] = useState<SfgResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const intensityRef = useRef<HTMLDivElement>(null)
  const realRef = useRef<HTMLDivElement>(null)
  const imagRef = useRef<HTMLDivElement>(null)

  const safeArr = useCallback((arr: number[]): number[] => arr.map((v) => (Number.isFinite(v) ? v : 0)), [])

  const drawCharts = useCallback(async (data: SfgResult, sub: boolean) => {
    const w = safeArr(data.wavenumbers)
    const subColors = ['#9E9E9E', '#FF9800', '#E040FB', '#00BCD4', '#8BC34A', '#F44336', '#3F51B5', '#795548', '#607D8B', '#CDDC39', '#FF5722']

    function makeData(
      yKey: 'intensity' | 'real_part' | 'imag_part',
      subKey: 'intensity' | 'real' | 'imag',
      totalColor: string,
    ) {
      const traces: PlotlyTrace[] = []
      if (sub && data.sub_components) {
        data.sub_components.forEach((comp, i) => {
          const y = Array.isArray(comp[subKey]) ? safeArr(comp[subKey]) : new Array(w.length).fill(comp[subKey])
          traces.push({
            x: w, y, type: 'scatter', mode: 'lines',
            name: comp.label, line: { dash: 'dash', color: subColors[i % subColors.length], width: 1 },
          })
        })
      }
      traces.push({
        x: w, y: safeArr(data[yKey]), type: 'scatter', mode: 'lines',
        name: 'Total', line: { color: totalColor, width: 1.8 },
      })
      return traces
    }

    const intensityTraces = makeData('intensity', 'intensity', '#E74C3C')
    const realTraces = makeData('real_part', 'real', '#2E86C1')
    const imagTraces = makeData('imag_part', 'imag', '#27AE60')

    const baseLayout = (title: string, ytitle: string) => ({
      title: { text: title, font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: ytitle },
      hovermode: 'x' as const, margin: { l: 60, r: 20, t: 50, b: 45 },
      showlegend: sub,
    })

    const Plotly = await ensurePlotly()
    if (intensityRef.current) Plotly.newPlot(intensityRef.current, intensityTraces, baseLayout('Intensity |chi(omega)|^2', '|chi|^2'), chartConfig)
    if (realRef.current) Plotly.newPlot(realRef.current, realTraces, baseLayout('Real Part Re[chi(omega)]', 'Re[chi]'), chartConfig)
    if (imagRef.current) Plotly.newPlot(imagRef.current, imagTraces, baseLayout('Imaginary Part Im[chi(omega)]', 'Im[chi]'), chartConfig)
  }, [safeArr])

  useEffect(() => {
    if (result) void drawCharts(result, showSubpeaks)
  }, [showSubpeaks, result, drawCharts])

  const handlePlot = async () => {
    if (xmin >= xmax) { message.error('xmin must be less than xmax'); return }
    if (npoints < 10 || npoints > 10000) { message.error('npoints must be 10-10000'); return }
    setLoading(true)
    setError(null)
    try {
      const data = await api.generateSfg({ xmin, xmax, npoints, nr_real: nrReal, nr_imag: nrImag, peaks })
      setResult(data)
      ;[intensityRef, realRef, imagRef].forEach((r) => purgePlot(r.current))
      setTimeout(() => { void drawCharts(data, showSubpeaks) }, 50)
    } catch (e: unknown) {
      setError(api.getApiErrorMessage(e))
    } finally { setLoading(false) }
  }

  const handleExport = () => {
    if (!result) { message.warning('Generate spectrum first'); return }
    const header = ['Wavenumber(cm-1)', 'Intensity', 'Real', 'Imag']  .concat(result.sub_components.flatMap((c) => [`${c.label}_Intensity`, `${c.label}_Real`, `${c.label}_Imag`]))
    const rows = result.wavenumbers.map((_, i) => [result.wavenumbers[i], result.intensity[i], result.real_part[i], result.imag_part[i]]
      .concat(result.sub_components.flatMap((c) => {
        const ci = (v: number[] | number) => (Array.isArray(v) ? v[i] : v)
        return [ci(c.intensity), ci(c.real), ci(c.imag)]
      })))
    const csv = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'SFG_spectrum.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success('Exported')
  }

  const addPeak = () => setPeaks([...peaks, emptyPeak()])
  const removePeak = (i: number) => setPeaks(peaks.filter((_, idx) => idx !== i))
  const updatePeak = (i: number, field: keyof SfgPeakParams, value: number | null) => {
    if (value == null) return
    setPeaks(peaks.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)))
  }

  const updatePeakPhase = (i: number, value: number | null) => {
    if (value == null) return
    setPeaks(peaks.map((p, idx) => (idx === i ? { ...p, phase: phaseFromDisplay(value, phaseUnit) } : p)))
  }

  const handleImportParams = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const fields = parseParameterFields(text)
      const kv = Object.fromEntries(
        Object.entries(fields)
          .map(([key, value]) => [key, Number(value)] as const)
          .filter(([, value]) => Number.isFinite(value)),
      )

      if (kv.NR_Real !== undefined) setNrReal(kv.NR_Real)
      if (kv.NR_Imag !== undefined) setNrImag(kv.NR_Imag)

      const peakIndices = importedPeakIndices(fields)

      if (peakIndices.length > 0) {
        const importedPeaks: SfgPeakParams[] = peakIndices.map((n) => buildImportedPeak(fields, n, phaseUnit, 3000 + n * 50))
        setPeaks(importedPeaks)
        message.success(`Imported ${importedPeaks.length} peak(s); Phi interpreted as ${phaseUnitName(phaseUnit)}`)
      } else if (fields.Amplitude != null || fields.amplitude != null || fields.profile_type != null) {
        const importedPeaks = [buildImportedPeak(fields, null, phaseUnit, 3200)]
        setPeaks(importedPeaks)
        message.success(`Imported ${importedPeaks.length} peak(s); Phi interpreted as ${phaseUnitName(phaseUnit)}`)
      } else {
        message.warning('No peak parameters found in file')
      }
    }
    reader.readAsText(file)
    return false
  }

  const handleExportParams = () => {
    const lines = [
      '# SFG peak parameters',
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
    const a = document.createElement('a'); a.href = url; a.download = 'SFG_peak_parameters.txt'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success(`Peak parameters exported (Phase unit: ${phaseUnitName(phaseUnit)})`)
  }

  return (
    <Row className="sfg-generator-page" gutter={[16, 16]} style={{ marginTop: 0 }}>
      <Col xs={24} lg={7}>
        <Card className="sfg-parameter-card" size="small" title="Parameters">
          <Text strong>Wavenumber Range</Text>
          <Space wrap style={{ marginTop: 4 }}>
            <InputNumber addonBefore="Start" value={xmin} onChange={(v) => setXmin(v ?? 0)} style={{ width: 140 }} />
            <InputNumber addonBefore="End" value={xmax} onChange={(v) => setXmax(v ?? 0)} style={{ width: 140 }} />
            <InputNumber addonBefore="Points" value={npoints} onChange={(v) => setNpoints(v ?? 1000)} min={10} max={10000} style={{ width: 140 }} />
          </Space>
          <Divider style={{ margin: '12px 0' }} />
          <Text strong>Non-Resonant Term</Text>
          <Space wrap style={{ marginTop: 4 }}>
            <InputNumber addonBefore="NR Real" value={nrReal} onChange={(v) => setNrReal(v ?? 0)} step={0.1} style={{ width: 130 }} />
            <InputNumber addonBefore="NR Imag" value={nrImag} onChange={(v) => setNrImag(v ?? 0)} step={0.1} style={{ width: 130 }} />
          </Space>
          <Divider style={{ margin: '12px 0' }} />
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>
              Peaks ({peaks.length})
            </Text>
            <Space wrap size={[6, 6]} style={{ width: '100%' }}>
              <Button size="small" icon={<PlusOutlined />} onClick={addPeak}>Add</Button>
              <Upload accept=".txt,.csv" maxCount={1} showUploadList={false} beforeUpload={handleImportParams}>
                <Button size="small" icon={<UploadOutlined />}>Import peak parameters</Button>
              </Upload>
              <Button size="small" icon={<DownloadOutlined />} onClick={handleExportParams}>Export peak parameters</Button>
            </Space>
          </div>
          <Space wrap style={{ marginTop: 8 }}>
            <Text strong>Phase unit</Text>
            <Select
              size="small"
              value={phaseUnit}
              onChange={setPhaseUnit}
              options={phaseUnitOptions}
              style={{ width: 150 }}
            />
          </Space>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
            Phi display, manual input, parameter import and parameter export use this unit; backend calculation uses radians.
          </Text>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
            Lorentzian Gamma is HWHM. Gaussian broadening input uses HWHM for Voigt peaks; FWHM and sigma are derived from it.
          </Text>
          {peaks.map((p, i) => (
            <Card key={i} size="small" style={{ marginTop: 8 }} title={<Text style={{ fontSize: 13 }}>Peak {i + 1}</Text>} extra={
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removePeak(i)} />
            }>
              <Space direction="vertical" size={4}>
                <Select
                  value={p.profile_type ?? 'lorentzian'}
                  onChange={(value) => setPeaks(peaks.map((peak, idx) => (
                    idx === i ? { ...peak, profile_type: normalizeProfileType(value) } : peak
                  )))}
                  options={profileTypeOptions}
                  style={{ width: 180 }}
                />
                <InputNumber addonBefore="Amplitude" value={p.amplitude} onChange={(v) => updatePeak(i, 'amplitude', v)} step={0.1} style={{ width: 180 }} />
                <InputNumber addonBefore="Center" value={p.center} onChange={(v) => updatePeak(i, 'center', v)} step={1} style={{ width: 180 }} />
                <InputNumber addonBefore="L Gamma (HWHM)" value={p.width} onChange={(v) => updatePeak(i, 'width', v)} step={0.5} min={0.1} style={{ width: 180 }} />
                <InputNumber
                  addonBefore="Gaussian HWHM"
                  value={peakGaussianHwhm(p)}
                  onChange={(v) => updatePeak(i, 'gaussian_hwhm', v)}
                  step={0.5}
                  min={0}
                  disabled={(p.profile_type ?? 'lorentzian') === 'lorentzian'}
                  style={{ width: 180 }}
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
                  onChange={(v) => updatePeakPhase(i, v)}
                  step={phaseInputStep(phaseUnit)}
                  style={{ width: 180 }}
                />
              </Space>
            </Card>
          ))}
          <Divider style={{ margin: '12px 0' }} />
          <Space>
            <Text>Show Sub-peaks</Text>
            <Switch checked={showSubpeaks} onChange={setShowSubpeaks} />
          </Space>
          <Divider style={{ margin: '12px 0' }} />
          {error && <Alert type="error" message={error} closable style={{ marginBottom: 8 }} />}
          <Button type="primary" block loading={loading} onClick={handlePlot}>Generate Spectrum</Button>
          <Button block icon={<DownloadOutlined />} onClick={handleExport} style={{ marginTop: 8 }} disabled={!result}>Export CSV</Button>
        </Card>
      </Col>
      <Col xs={24} lg={17}>
        <div ref={intensityRef} className="sfg-chart-panel" />
        <div ref={realRef} className="sfg-chart-panel" />
        <div ref={imagRef} className="sfg-chart-panel sfg-chart-panel-last" />
      </Col>
    </Row>
  )
}
