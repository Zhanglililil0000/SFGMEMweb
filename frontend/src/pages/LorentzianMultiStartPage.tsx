import { useEffect, useMemo, useRef, useState } from 'react'
import 'plotly.js/dist/plotly.min.js'
import { Alert, Button, Card, Checkbox, Col, Empty, InputNumber, Row, Select, Space, Statistic, Table, Typography, Upload, message } from 'antd'
import { DeleteOutlined, DownloadOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import * as api from '../api/mem'
import type { LorentzianMultiStartPeak, LorentzianMultiStartRequest, LorentzianMultiStartResult } from '../types/mem'
import { parseParameterFields } from '../utils/phaseUnit'

const Plotly = window.Plotly
const { Paragraph, Text } = Typography
type PeakKey = 'amplitude' | 'phase_deg' | 'center' | 'hwhm'
type Bounds = Record<PeakKey, [number, number]>

const initialPeaks: LorentzianMultiStartPeak[] = [
  { amplitude: 6, phase_deg: 0, center: 2920, hwhm: 18 },
  { amplitude: 5, phase_deg: 95, center: 3180, hwhm: 24 },
  { amplitude: 4, phase_deg: -55, center: 3450, hwhm: 31 },
]

function boundsFor(peak: LorentzianMultiStartPeak): Bounds {
  return {
    amplitude: [-Math.max(Math.abs(peak.amplitude) * 3, 1), Math.max(Math.abs(peak.amplitude) * 3, 1)],
    phase_deg: [-180, 180],
    center: [peak.center - 100, peak.center + 100],
    hwhm: [0.1, Math.max(peak.hwhm * 3, 1)],
  }
}

function csv(value: unknown) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
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

export default function LorentzianMultiStartPage() {
  const [xMin, setXMin] = useState(2700)
  const [xMax, setXMax] = useState(3700)
  const [npoints, setNpoints] = useState(1000)
  const [nrReal, setNrReal] = useState(0.08)
  const [nrImag, setNrImag] = useState(-0.01)
  const [nrBounds, setNrBounds] = useState({ nr_real: [-0.2, 0.3] as [number, number], nr_imag: [-0.2, 0.2] as [number, number] })
  const [peaks, setPeaks] = useState(initialPeaks)
  const [peakBounds, setPeakBounds] = useState(initialPeaks.map(boundsFor))
  const [free, setFree] = useState<Record<string, boolean>>({ nr_real: true, nr_imag: true, amplitude: true, phase_deg: true, center: true, hwhm: true })
  const [perturbation, setPerturbation] = useState<Record<string, number>>({ nr_real: 0.25, nr_imag: 0.25, amplitude: 0.25, phase_deg: 0.25, center: 0.25, hwhm: 0.25 })
  const [nStarts, setNStarts] = useState(20)
  const [seed, setSeed] = useState(12345)
  const [maxNfev, setMaxNfev] = useState(3000)
  const [clusterTolerance, setClusterTolerance] = useState(1e-3)
  const [acceptanceMode, setAcceptanceMode] = useState<'nrmse' | 'relative-rss'>('nrmse')
  const [nrmseThreshold, setNrmseThreshold] = useState(1e-6)
  const [relativeEpsilon, setRelativeEpsilon] = useState(0.05)
  const [result, setResult] = useState<LorentzianMultiStartResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intensityRef = useRef<HTMLDivElement>(null)
  const residualRef = useRef<HTMLDivElement>(null)
  const realRef = useRef<HTMLDivElement>(null)
  const imagRef = useRef<HTMLDivElement>(null)
  const distributionRef = useRef<HTMLDivElement>(null)
  const displayedAccepted = useMemo(() => {
    if (!result) return []
    if (acceptanceMode === 'nrmse') return result.solutions.filter((solution) => solution.nrmse <= nrmseThreshold)
    const best = result.best_rss ?? 0
    return result.solutions.filter((solution) => solution.rss <= best * (1 + relativeEpsilon) + Number.EPSILON)
  }, [result, acceptanceMode, nrmseThreshold, relativeEpsilon])
  const displayedAcceptedStarts = useMemo(() => new Set(displayedAccepted.map((solution) => solution.start_index)), [displayedAccepted])

  const updatePeak = (index: number, key: PeakKey, value: number) => setPeaks(peaks.map((peak, i) => i === index ? { ...peak, [key]: value } : peak))
  const updateBound = (index: number, key: PeakKey, side: 0 | 1, value: number) => setPeakBounds(peakBounds.map((item, i) => i === index ? { ...item, [key]: item[key].map((old, j) => j === side ? value : old) as [number, number] } : item))
  const addPeak = () => {
    const peak = { amplitude: 1, phase_deg: 0, center: 3200, hwhm: 20 }
    setPeaks([...peaks, peak]); setPeakBounds([...peakBounds, boundsFor(peak)])
  }

  const importParameters = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const fields = parseParameterFields(String(event.target?.result ?? ''))
        if (Object.keys(fields).length === 0) throw new Error('No key=value parameter fields were found')
        const indices = importedPeakIndices(fields)
        if (indices.length === 0) throw new Error('No indexed Lorentzian peak parameters were found')
        const phaseUnit = fieldValue(fields, ['Phase_Unit', 'PhaseUnit', 'phase_unit'])
        if (phaseUnit && !phaseUnit.toLowerCase().startsWith('deg')) throw new Error('Imported Phi values must be in degrees')
        const imported = indices.map((index) => {
          const profile = fieldValue(fields, [`Profile${index}`, `Profile_Type${index}`])?.trim().toLowerCase()
          const gaussian = numericField(fields, [`Gaussian_HWHM${index}`, `Gaussian_FWHM${index}`, `Gaussian_Sigma${index}`], 0)
          if ((profile && profile !== 'lorentzian') || gaussian !== 0) throw new Error(`Peak ${index} is not a pure Lorentzian peak`)
          const peak = {
            amplitude: numericField(fields, [`A${index}`, `Amplitude${index}`], NaN),
            phase_deg: numericField(fields, [`Phi${index}`, `Phase_deg${index}`, `Phase${index}`], 0),
            center: numericField(fields, [`Omega${index}`, `Center${index}`], NaN),
            hwhm: numericField(fields, [`Gamma${index}`, `Lorentzian_HWHM${index}`], NaN),
          }
          if (!Object.values(peak).every(Number.isFinite)) throw new Error(`Peak ${index} is missing A, Omega/Center, or Gamma`)
          if (peak.hwhm <= 0) throw new Error(`Peak ${index} has a non-positive Lorentzian HWHM`)
          return peak
        })
        const importedNrReal = numericField(fields, ['NR_Real', 'C0_Real', 'c0_real'], nrReal)
        const importedNrImag = numericField(fields, ['NR_Imag', 'C0_Imag', 'c0_imag'], nrImag)
        const nrRealSpan = Math.max(Math.abs(importedNrReal) * 2, 0.1)
        const nrImagSpan = Math.max(Math.abs(importedNrImag) * 2, 0.1)
        setNrReal(importedNrReal); setNrImag(importedNrImag)
        setNrBounds({ nr_real: [importedNrReal - nrRealSpan, importedNrReal + nrRealSpan], nr_imag: [importedNrImag - nrImagSpan, importedNrImag + nrImagSpan] })
        setXMin(numericField(fields, ['XMin', 'x_min', 'Frequency_Start'], xMin))
        setXMax(numericField(fields, ['XMax', 'x_max', 'Frequency_End'], xMax))
        setNpoints(Math.round(numericField(fields, ['NPoints', 'npoints', 'Points'], npoints)))
        setPeaks(imported); setPeakBounds(imported.map(boundsFor)); setResult(null); setError(null)
        message.success(`Imported ${imported.length} pure Lorentzian peak(s); signed amplitudes were preserved.`)
      } catch (importError) {
        message.error(importError instanceof Error ? importError.message : 'Unable to import Lorentzian parameters')
      }
    }
    reader.readAsText(file)
    return false
  }

  const run = async () => {
    const payload: LorentzianMultiStartRequest = {
      x_min: xMin, x_max: xMax, npoints,
      reference: { nr_real: nrReal, nr_imag: nrImag, peaks },
      free, bounds: { ...nrBounds, peaks: peakBounds }, perturbation,
      n_starts: nStarts, random_seed: seed, max_nfev: maxNfev,
      cluster_tolerance: clusterTolerance, acceptance_mode: acceptanceMode,
      nrmse_threshold: nrmseThreshold, relative_rss_epsilon: relativeEpsilon,
    }
    setLoading(true); setError(null)
    try { setResult(await api.searchLorentzianMultiStart(payload)) }
    catch (requestError) { setError(api.getApiErrorMessage(requestError)) }
    finally { setLoading(false) }
  }

  const exportAccepted = () => {
    if (!result) return
    const peakHeaders = peaks.flatMap((_, i) => [`p${i + 1}_amplitude`, `p${i + 1}_phase_deg`, `p${i + 1}_effective_phase_deg`, `p${i + 1}_center`, `p${i + 1}_hwhm`])
    const header = ['start_index', 'rss', 'rmse', 'nrmse', 'max_abs_intensity_deviation', 'parameter_distance', 'complex_deviation', 'real_deviation', 'imag_deviation', 'nr_real', 'nr_imag', ...peakHeaders]
    const rows = displayedAccepted.map((solution) => [solution.start_index, solution.rss, solution.rmse, solution.nrmse, solution.max_abs_intensity_deviation, solution.parameter_distance, solution.complex_deviation, solution.real_deviation, solution.imag_deviation, solution.parameters.nr_real, solution.parameters.nr_imag, ...solution.parameters.peaks.flatMap((peak) => [peak.amplitude, peak.phase_deg, peak.effective_phase_deg, peak.center, peak.hwhm])])
    download('lorentzian_multistart_accepted.csv', [header, ...rows].map((row) => row.map(csv).join(',')).join('\n'))
  }

  useEffect(() => {
    if (!result) return
    if (!intensityRef.current || !residualRef.current || !realRef.current || !imagRef.current || !distributionRef.current) return
    const accepted = displayedAccepted
    const common = { margin: { l: 60, r: 20, t: 45, b: 45 }, hovermode: 'x' }
    Plotly.newPlot(intensityRef.current, [{ x: result.frequency, y: result.reference.intensity, name: 'Reference', type: 'scatter', mode: 'lines', line: { color: 'black', width: 3 } }, ...accepted.map((item, i) => ({ x: result.frequency, y: item.intensity, name: `Solution ${i + 1}`, type: 'scatter', mode: 'lines' }))], { ...common, title: 'Accepted intensity fits', xaxis: { title: 'Wavenumber (cm⁻¹)' }, yaxis: { title: '|χ|²' } })
    Plotly.newPlot(residualRef.current, accepted.map((item, i) => ({ x: result.frequency, y: item.residual, name: `Solution ${i + 1}`, type: 'scatter', mode: 'lines' })), { ...common, title: 'Intensity residuals', xaxis: { title: 'Wavenumber (cm⁻¹)' }, yaxis: { title: 'S − S₀' } })
    Plotly.newPlot(realRef.current, [{ x: result.frequency, y: result.reference.real_part, name: 'Reference', type: 'scatter', mode: 'lines', line: { color: 'black', width: 3 } }, ...accepted.map((item, i) => ({ x: result.frequency, y: item.real_part, name: `Solution ${i + 1}`, type: 'scatter', mode: 'lines' }))], { ...common, title: 'Accepted Re χ', xaxis: { title: 'Wavenumber (cm⁻¹)' }, yaxis: { title: 'Re χ' } })
    Plotly.newPlot(imagRef.current, [{ x: result.frequency, y: result.reference.imag_part, name: 'Reference', type: 'scatter', mode: 'lines', line: { color: 'black', width: 3 } }, ...accepted.map((item, i) => ({ x: result.frequency, y: item.imag_part, name: `Solution ${i + 1}`, type: 'scatter', mode: 'lines' }))], { ...common, title: 'Accepted Im χ', xaxis: { title: 'Wavenumber (cm⁻¹)' }, yaxis: { title: 'Im χ' } })
    Plotly.newPlot(distributionRef.current, result.variable_labels.map((label, index) => ({ y: accepted.map((item) => item.scaled_vector[index]), name: label, type: 'box', boxpoints: 'all' })), { ...common, title: 'Accepted scaled parameter deviations', xaxis: { title: 'Free parameter' }, yaxis: { title: '(value − reference) / scale' } })
    return () => [intensityRef, residualRef, realRef, imagRef, distributionRef].forEach((ref) => { if (ref.current) Plotly.purge(ref.current) })
  }, [result, displayedAccepted])

  return <Row gutter={[12, 12]}>
    <Col xs={24} lg={9}><Card size="small" title="Lorentzian Multi-Start Intensity Refitting" style={{ maxHeight: 'calc(100vh - 100px)', overflow: 'auto' }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Alert type="info" showIcon message="Mathematical search only" description="This module fits intensity only and does not determine physical admissibility or use zero-flip solutions." />
        <Upload accept=".txt,.csv" maxCount={1} showUploadList={false} beforeUpload={importParameters}><Button icon={<UploadOutlined />}>Import fitted Lorentzian parameters</Button></Upload>
        <Text type="secondary" style={{ fontSize: 12 }}>Supports NR_Real, NR_Imag, A1, Omega1, Gamma1 and Phi1 in key=value or two-column CSV format. Signed amplitudes are retained.</Text>
        <Text strong>Frequency grid</Text><Row gutter={6}><Col span={8}><InputNumber value={xMin} onChange={(v) => setXMin(v ?? xMin)} addonBefore="Start" style={{ width: '100%' }} /></Col><Col span={8}><InputNumber value={xMax} onChange={(v) => setXMax(v ?? xMax)} addonBefore="End" style={{ width: '100%' }} /></Col><Col span={8}><InputNumber value={npoints} min={10} max={10000} onChange={(v) => setNpoints(v ?? npoints)} addonBefore="Points" style={{ width: '100%' }} /></Col></Row>
        <Text strong>Free parameter types</Text><Checkbox.Group value={Object.keys(free).filter((key) => free[key])} onChange={(values) => setFree(Object.fromEntries(Object.keys(free).map((key) => [key, values.includes(key)])))} options={[['nr_real', 'NR real'], ['nr_imag', 'NR imag'], ['amplitude', 'Amplitude'], ['phase_deg', 'Phase'], ['center', 'Center'], ['hwhm', 'HWHM']].map(([value, label]) => ({ value, label }))} />
        <Text strong>Nonresonant reference and bounds</Text>
        {(['nr_real', 'nr_imag'] as const).map((key) => <Row gutter={6} key={key}><Col span={8}><InputNumber addonBefore={key} value={key === 'nr_real' ? nrReal : nrImag} onChange={(v) => key === 'nr_real' ? setNrReal(v ?? nrReal) : setNrImag(v ?? nrImag)} style={{ width: '100%' }} /></Col><Col span={8}><InputNumber addonBefore="Lower" value={nrBounds[key][0]} onChange={(v) => setNrBounds({ ...nrBounds, [key]: [v ?? nrBounds[key][0], nrBounds[key][1]] })} style={{ width: '100%' }} /></Col><Col span={8}><InputNumber addonBefore="Upper" value={nrBounds[key][1]} onChange={(v) => setNrBounds({ ...nrBounds, [key]: [nrBounds[key][0], v ?? nrBounds[key][1]] })} style={{ width: '100%' }} /></Col></Row>)}
        <Space><Text strong>Peaks ({peaks.length})</Text><Button size="small" icon={<PlusOutlined />} onClick={addPeak}>Add</Button></Space>
        {peaks.map((peak, index) => <Card key={index} size="small" title={`Peak ${index + 1}`} extra={<Button size="small" danger icon={<DeleteOutlined />} disabled={peaks.length === 1} onClick={() => { setPeaks(peaks.filter((_, i) => i !== index)); setPeakBounds(peakBounds.filter((_, i) => i !== index)) }} />}>
          {(['amplitude', 'phase_deg', 'center', 'hwhm'] as PeakKey[]).map((key) => <Row gutter={4} key={key} style={{ marginBottom: 4 }}><Col span={8}><InputNumber addonBefore={key} value={peak[key]} onChange={(v) => updatePeak(index, key, v ?? peak[key])} style={{ width: '100%' }} /></Col><Col span={8}><InputNumber addonBefore="L" value={peakBounds[index][key][0]} onChange={(v) => updateBound(index, key, 0, v ?? peakBounds[index][key][0])} style={{ width: '100%' }} /></Col><Col span={8}><InputNumber addonBefore="U" value={peakBounds[index][key][1]} onChange={(v) => updateBound(index, key, 1, v ?? peakBounds[index][key][1])} style={{ width: '100%' }} /></Col></Row>)}
        </Card>)}
        <Text strong>Multi-start settings</Text><Row gutter={[6, 6]}><Col span={12}><InputNumber addonBefore="Starts" min={1} max={500} value={nStarts} onChange={(v) => setNStarts(v ?? nStarts)} style={{ width: '100%' }} /></Col><Col span={12}><InputNumber addonBefore="Seed" value={seed} onChange={(v) => setSeed(v ?? seed)} style={{ width: '100%' }} /></Col><Col span={12}><InputNumber addonBefore="Max evaluations" value={maxNfev} min={1} onChange={(v) => setMaxNfev(v ?? maxNfev)} style={{ width: '100%' }} /></Col><Col span={12}><InputNumber addonBefore="Cluster tol." value={clusterTolerance} min={0} step={1e-3} onChange={(v) => setClusterTolerance(v ?? clusterTolerance)} style={{ width: '100%' }} /></Col></Row>
        <Text>Random perturbation σ in scaled coordinates</Text><Row gutter={[6, 6]}>{Object.keys(perturbation).map((key) => <Col span={12} key={key}><InputNumber addonBefore={key} value={perturbation[key]} min={0} step={0.05} onChange={(v) => setPerturbation({ ...perturbation, [key]: v ?? perturbation[key] })} style={{ width: '100%' }} /></Col>)}</Row>
        <Text strong>Acceptance</Text><Select value={acceptanceMode} onChange={setAcceptanceMode} options={[{ value: 'nrmse', label: 'NRMSE threshold' }, { value: 'relative-rss', label: 'RSS ≤ best × (1 + ε)' }]} style={{ width: '100%' }} />
        {acceptanceMode === 'nrmse' ? <InputNumber addonBefore="NRMSE ≤" value={nrmseThreshold} min={0} step={1e-6} onChange={(v) => setNrmseThreshold(v ?? nrmseThreshold)} style={{ width: '100%' }} /> : <InputNumber addonBefore="ε" value={relativeEpsilon} min={0} step={0.01} onChange={(v) => setRelativeEpsilon(v ?? relativeEpsilon)} style={{ width: '100%' }} />}
        {error && <Alert type="error" showIcon message={error} />}
        <Button type="primary" block loading={loading} onClick={run}>Run constrained multi-start search</Button>
      </Space>
    </Card></Col>
    <Col xs={24} lg={15}>{!result ? <Card><Empty description="Configure reference parameters and run the search" /></Card> : <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small" title="Search summary" extra={<Button icon={<DownloadOutlined />} disabled={displayedAccepted.length === 0} onClick={exportAccepted}>Export accepted parameters</Button>}><Row gutter={[12, 12]}><Col xs={12} md={6}><Statistic title="Converged" value={result.converged_count} /></Col><Col xs={12} md={6}><Statistic title="Failed" value={result.failed_count} /></Col><Col xs={12} md={6}><Statistic title="Distinct" value={result.distinct_count} /></Col><Col xs={12} md={6}><Statistic title="Currently accepted" value={displayedAccepted.length} /></Col></Row>{acceptanceMode === 'nrmse' && <Row gutter={12} align="middle" style={{ marginTop: 12 }}><Col><Text strong>Interactive NRMSE threshold</Text></Col><Col flex="240px"><InputNumber value={nrmseThreshold} min={0} step={1e-4} onChange={(value) => setNrmseThreshold(value ?? nrmseThreshold)} style={{ width: '100%' }} /></Col><Col flex="auto"><Text type="secondary">Changes the table, plots and export immediately; the fits are not rerun.</Text></Col></Row>}<Paragraph type="secondary" style={{ margin: '10px 0 0' }}>Independent bounded intensity-only fits. No physical admissibility classification is applied.</Paragraph></Card>
      <Card size="small" title="Distinct converged solutions"><Table size="small" rowKey={(row) => `${row.start_index}`} dataSource={result.solutions} pagination={{ pageSize: 10 }} columns={[{ title: 'Start', dataIndex: 'start_index' }, { title: 'Accepted', key: 'accepted', render: (_, row) => displayedAcceptedStarts.has(row.start_index) ? 'Yes' : 'No' }, { title: 'RSS', dataIndex: 'rss', render: (v: number) => v.toExponential(4) }, { title: 'NRMSE', dataIndex: 'nrmse', render: (v: number) => v.toExponential(4) }, { title: 'Max |ΔS|', dataIndex: 'max_abs_intensity_deviation', render: (v: number) => v.toExponential(4) }, { title: 'Parameter distance', dataIndex: 'parameter_distance', render: (v: number) => v.toFixed(4) }, { title: 'Dχ', dataIndex: 'complex_deviation', render: (v: number) => v.toExponential(4) }, { title: 'Re dev.', dataIndex: 'real_deviation', render: (v: number) => v.toExponential(4) }, { title: 'Im dev.', dataIndex: 'imag_deviation', render: (v: number) => v.toExponential(4) }]} /></Card>
      <Row gutter={[12, 12]}><Col span={24}><Card size="small" title="Accepted Intensity Fits over Reference"><div ref={intensityRef} style={{ minHeight: 330 }} /></Card></Col><Col span={24}><Card size="small" title="Intensity Residuals: S(ω) − S₀(ω)"><div ref={residualRef} style={{ minHeight: 300 }} /></Card></Col><Col xs={24} xl={12}><Card size="small" title="Accepted Real-Part Responses: Re χ"><div ref={realRef} style={{ minHeight: 320 }} /></Card></Col><Col xs={24} xl={12}><Card size="small" title="Accepted Imaginary-Part Responses: Im χ"><div ref={imagRef} style={{ minHeight: 320 }} /></Card></Col><Col span={24}><Card size="small" title="Accepted Parameter Distributions (Scaled Deviations)"><div ref={distributionRef} style={{ minHeight: 350 }} /></Card></Col></Row>
    </Space>}</Col>
  </Row>
}
