import { useState, useRef, useEffect, useMemo } from 'react'
import 'plotly.js/dist/plotly.min.js'
import {
  Row, Col, Card, InputNumber, Button, Typography, message, Space,
  Alert, Upload, Select, Slider, Empty,
} from 'antd'
import { DownloadOutlined, InboxOutlined, PlayCircleOutlined, UploadOutlined, PlusOutlined, DeleteOutlined, UndoOutlined } from '@ant-design/icons'
import * as api from '../api/mem'
import type { ColumnInfo, SfgPeakParams, FittingParams, MemCompareResult } from '../types/mem'

const Plotly = (window as any).Plotly
const { Text } = Typography

const PHASE_SAMPLES = 100

const chartConfig = {
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  displaylogo: false,
  scrollZoom: true,
}

const marks: Record<number, string> = {
  0: '0',
  1.57: 'pi/2',
  3.14: 'pi',
  4.71: '3pi/2',
  6.28: '2pi',
}

function emptyPeak(): SfgPeakParams {
  return { amplitude: 1.0, center: 3200, width: 10, phase: 0 }
}

function safeArr(arr: number[]): number[] {
  return arr.map((v) => (Number.isFinite(v) ? v : 0))
}

function parseParamsFile(text: string): FittingParams | null {
  const kv: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = parseFloat(trimmed.slice(eq + 1).trim())
    if (isNaN(val)) continue
    kv[key] = val
  }
  const peakIndices: number[] = []
  for (const key of Object.keys(kv)) {
    const m = key.match(/^A(\d+)$/)
    if (m) peakIndices.push(parseInt(m[1]))
  }
  peakIndices.sort((a, b) => a - b)
  const peaks: SfgPeakParams[] = peakIndices.map((n) => ({
    amplitude: kv[`A${n}`] ?? 1.0,
    center: kv[`Omega${n}`] ?? 3000,
    width: kv[`Gamma${n}`] ?? 10,
    phase: kv[`Phi${n}`] ?? 0,
  }))
  return { nr_real: kv.NR_Real ?? 0, nr_imag: kv.NR_Imag ?? 0, peaks }
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

  const [nrReal, setNrReal] = useState(0.0)
  const [nrImag, setNrImag] = useState(0.0)
  const [peaks, setPeaks] = useState<SfgPeakParams[]>([])

  const [phaseAngle, setPhaseAngle] = useState(0)

  const comparisonRef = useRef<HTMLDivElement>(null)
  const diffRef = useRef<HTMLDivElement>(null)
  const intensityRef = useRef<HTMLDivElement>(null)

  const phaseValues = useMemo(() => {
    const arr: number[] = []
    for (let i = 0; i <= PHASE_SAMPLES; i++) {
      arr.push((2 * Math.PI * i) / PHASE_SAMPLES)
    }
    return arr
  }, [])

  const phaseDiffData = useMemo(() => {
    if (!result) return null
    const diffReal: number[] = []
    const diffImag: number[] = []
    const memReal = result.mem_real
    const memImag = result.mem_imag
    const fitReal = result.fitting_real
    const fitImag = result.fitting_imag
    for (const phi of phaseValues) {
      const cosA = Math.cos(phi)
      const sinA = Math.sin(phi)
      let sumR = 0
      let sumI = 0
      for (let i = 0; i < memReal.length; i++) {
        const rotatedReal = memReal[i] * cosA - memImag[i] * sinA
        const rotatedImag = memReal[i] * sinA + memImag[i] * cosA
        sumR += Math.abs(rotatedReal - fitReal[i])
        sumI += Math.abs(rotatedImag - fitImag[i])
      }
      diffReal.push(sumR)
      diffImag.push(sumI)
    }
    return { diffReal, diffImag }
  }, [result, phaseValues])

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
      title: { text: 'Comparison: MEM vs Fitting', font: { size: 14 } },
      xaxis: { title: 'Wavenumber (cm<sup>-1</sup>)' },
      yaxis: { title: 'chi' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, chartConfig)
  }, [result, currentRotated])

  useEffect(() => {
    if (!result || !intensityRef.current) return
    const w = safeArr(result.wavenumbers)
    Plotly.newPlot(intensityRef.current, [
      {
        x: w, y: safeArr(result.import_intensity),
        type: 'scatter', mode: 'lines',
        name: 'Import Spectra',
        line: { color: '#1677ff', width: 1.8 },
      },
      {
        x: w, y: safeArr(result.fitting_intensity),
        type: 'scatter', mode: 'lines',
        name: 'Fitting Generated Spectra',
        line: { color: '#f39c12', width: 1.8, dash: 'dash' },
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
    if (!result || !phaseDiffData || !diffRef.current) return
    const gd = diffRef.current
    const pv = phaseValues
    const allY = phaseDiffData.diffReal.concat(phaseDiffData.diffImag)
    const yMax = Math.max(...allY) * 1.1
    const traces: any[] = [
      { x: pv, y: phaseDiffData.diffReal, type: 'scatter', mode: 'lines', name: 'Real Part Diff', line: { color: '#e74c3c', width: 2 } },
      { x: pv, y: phaseDiffData.diffImag, type: 'scatter', mode: 'lines', name: 'Imaginary Part Diff', line: { color: '#3498db', width: 2 } },
    ]
    if (phaseAngle > 0) {
      traces.push({
        x: [phaseAngle, phaseAngle],
        y: [0, yMax],
        type: 'scatter', mode: 'lines',
        name: 'current', line: { color: '#999', width: 1, dash: 'dash' },
        showlegend: false,
      })
    }
    Plotly.newPlot(gd, traces, {
      title: { text: 'Error Phase Difference — click to set phase', font: { size: 14 } },
      xaxis: { title: 'Error phase (rad)', range: [0, 2 * Math.PI] },
      yaxis: { title: 'Sum |diff|' },
      hovermode: 'x',
      margin: { l: 60, r: 20, t: 50, b: 45 },
      legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    }, chartConfig)
    const onClick = (eventData: any) => {
      if (eventData?.points?.[0]) {
        const x = eventData.points[0].x as number
        if (x >= 0 && x <= 2 * Math.PI) {
          setPhaseAngle(Math.round(x * 100) / 100)
        }
      }
    }
    gd.on('plotly_click', onClick)
    return () => {
      gd.removeAllListeners?.('plotly_click')
    }
  }, [phaseDiffData, phaseAngle, phaseValues])

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
      setColumns(cols)
      setSelectedColumn(1)
      message.success(`Loaded: ${f.name}`)
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
      const parsed = parseParamsFile(text)
      if (parsed) {
        setNrReal(parsed.nr_real)
        setNrImag(parsed.nr_imag)
        setPeaks(parsed.peaks)
        message.success(`Imported ${parsed.peaks.length} peak(s)`)
      } else {
        message.warning('No valid parameters found')
      }
    }
    reader.readAsText(f)
    return false
  }

  const handleRun = async () => {
    if (!file) { message.warning('Please upload a CSV file'); return }
    setLoading(true)
    setError(null)
    try {
      const fitParams: FittingParams = { nr_real: nrReal, nr_imag: nrImag, peaks }
      const data = await api.runMemCompare(file, nn ?? undefined, selectedColumn, fitParams)
      setResult(data)
      setPhaseAngle(0)
      if (comparisonRef.current) Plotly.purge(comparisonRef.current)
      if (diffRef.current) Plotly.purge(diffRef.current)
      if (intensityRef.current) Plotly.purge(intensityRef.current)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || 'Error')
    } finally { setTimeout(() => setLoading(false), 100) }
  }

  const handleExportDiff = () => {
    if (!phaseDiffData) return
    const lines = ['ErrorPhase,RealDiff,ImagDiff']
    for (let i = 0; i < phaseValues.length; i++) {
      lines.push(`${phaseValues[i].toFixed(6)},${phaseDiffData.diffReal[i].toExponential(6)},${phaseDiffData.diffImag[i].toExponential(6)}`)
    }
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'MEM_vs_Fitting_Diff.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success('Difference data exported')
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
              onRemove={() => { setFile(null); setFileName(''); setColumns([]) }}>
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
          <Col xs={24} md={8} style={{ textAlign: 'right' }}>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} disabled={!hasFile}
              onClick={handleRun}>Run MEM &amp; Compare</Button>
          </Col>
        </Row>
      </Card>

      <Card size="small" title="Fitting Parameters" style={{ marginTop: 12 }}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Upload accept=".txt" maxCount={1} showUploadList={false} beforeUpload={handleImportParams}>
            <Button size="small" icon={<UploadOutlined />}>Import .txt</Button>
          </Upload>
        </Space>
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
                  <InputNumber addonBefore="A" value={p.amplitude} onChange={(v) => {
                    if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, amplitude: v } : pp))
                  }} step={0.1} style={{ width: '100%' }} size="small" />
                  <InputNumber addonBefore="Omega" value={p.center} onChange={(v) => {
                    if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, center: v } : pp))
                  }} step={1} style={{ width: '100%' }} size="small" />
                  <InputNumber addonBefore="Gamma" value={p.width} onChange={(v) => {
                    if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, width: v } : pp))
                  }} step={0.5} min={0.1} style={{ width: '100%' }} size="small" />
                  <InputNumber addonBefore="Phase" value={p.phase} onChange={(v) => {
                    if (v != null) setPeaks(peaks.map((pp, ii) => ii === i ? { ...pp, phase: v } : pp))
                  }} step={0.01} style={{ width: '100%' }} size="small" />
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

          <Card size="small" style={{ marginTop: 12 }}>
            <div ref={comparisonRef} style={{ width: '100%', minHeight: 400 }} />
          </Card>

          <Card size="small" title="Error Phase Adjustment" style={{ marginTop: 12 }}>
            <Row gutter={16} align="middle">
              <Col flex="auto">
                <Slider min={0} max={2 * Math.PI} step={0.01} value={phaseAngle}
                  onChange={(v) => setPhaseAngle(v as number)} marks={marks} />
              </Col>
              <Col>
                <Space>
                  <Text>phi =</Text>
                  <InputNumber min={0} max={2 * Math.PI} step={0.01} value={phaseAngle}
                    precision={4} onChange={(v) => { if (v != null) setPhaseAngle(v) }}
                    style={{ width: 100 }} size="small" />
                  <Text type="secondary" style={{ width: 50 }}>{(phaseAngle * 180 / Math.PI).toFixed(1)} deg</Text>
                  <Button icon={<UndoOutlined />} size="small" onClick={() => setPhaseAngle(0)}>Reset</Button>
                </Space>
              </Col>
            </Row>
          </Card>

          <Card size="small" title="Error Phase Difference" style={{ marginTop: 12 }}
            extra={<Button size="small" icon={<DownloadOutlined />} onClick={handleExportDiff} disabled={!phaseDiffData}>Export CSV</Button>}>
            <div ref={diffRef} style={{ width: '100%', minHeight: 350 }} />
          </Card>
        </>
      )}
    </div>
  )
}
