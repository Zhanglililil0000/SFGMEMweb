import { useMemo, useState } from 'react'
import { Layout, Typography, Row, Col, Empty, Spin, Card, Upload, Button, Alert, Space, message, Select } from 'antd'
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import { useMemResult } from '../hooks/useMemResult'
import ErrorBoundary from '../components/ErrorBoundary'
import UploadPanel from '../components/UploadPanel'
import IntensityChart from '../components/IntensityChart'
import ComplexChart from '../components/ComplexChart'
import PhaseControl from '../components/PhaseControl'
import {
  alignReferenceToGrid,
  autoDetectReferenceColumns,
  buildReferenceSpectrumFromTable,
  computeNrmseAgainstReference,
  parseReferenceTable,
  type ReferenceColumnSelection,
  type ReferenceSpectrum,
  type ReferenceTable,
} from '../utils/referenceSpectrum'

const { Footer } = Layout
const { Text } = Typography

function MemAnalyzerPage() {
  const { result, loading, error, phaseAngle, runMem, setPhase, resetPhase } = useMemResult()
  const [referenceTable, setReferenceTable] = useState<ReferenceTable | null>(null)
  const [referenceSelection, setReferenceSelection] = useState<ReferenceColumnSelection | null>(null)
  const [referenceSpectrum, setReferenceSpectrum] = useState<ReferenceSpectrum | null>(null)
  const [referenceImportError, setReferenceImportError] = useState<string | null>(null)

  const hasResult = result !== null
  const alignedReference = useMemo(() => {
    if (!result || !referenceSpectrum) return null
    return alignReferenceToGrid(referenceSpectrum, result.wavenumbers)
  }, [result, referenceSpectrum])

  const referenceNrmse = useMemo(() => {
    if (!result || !alignedReference?.aligned) return null
    return computeNrmseAgainstReference(
      result.real_part,
      result.imag_part,
      alignedReference.aligned.real,
      alignedReference.aligned.imag,
      'External reference',
    )
  }, [result, alignedReference])

  const referenceColumnOptions = referenceTable?.columns.map((column) => ({
    value: column.index,
    label: `${column.index}: ${column.name}`,
  })) ?? []

  const applyReferenceSelection = (
    table = referenceTable,
    selection = referenceSelection,
    showSuccess = true,
  ) => {
    if (!table || !selection) return
    try {
      const parsed = buildReferenceSpectrumFromTable(table, selection)
      setReferenceSpectrum(parsed)
      setReferenceImportError(null)
      if (showSuccess) {
        message.success(`Applied external Re/Im reference: ${parsed.pointCount} points`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unable to build external Re/Im reference from selected columns.'
      setReferenceImportError(msg)
      message.error(msg)
    }
  }

  const handleReferenceUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        const table = parseReferenceTable(text, file.name)
        const detected = autoDetectReferenceColumns(table)
        const parsed = buildReferenceSpectrumFromTable(table, detected)
        setReferenceTable(table)
        setReferenceSelection(detected)
        setReferenceSpectrum(parsed)
        setReferenceImportError(null)
        message.success(`Imported external Re/Im reference: ${parsed.pointCount} points; auto-selected columns ${detected.wavenumber}/${detected.real}/${detected.imag}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unable to parse external Re/Im reference file.'
        setReferenceImportError(msg)
        message.error(msg)
      }
    }
    reader.readAsText(file)
    return false
  }

  return (
    <>
      <ErrorBoundary>
        <UploadPanel onRun={runMem} loading={loading} error={error} />

        <Spin spinning={loading && !hasResult} style={{ display: 'block', marginTop: 16 }}>
          {hasResult && result ? (
            <>
              <Row gutter={16} style={{ marginTop: 0 }}>
                <Col xs={24} lg={12}>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16 }}>
                    <IntensityChart
                      originalWavenumbers={result.original_wavenumbers}
                      originalIntensity={result.original_intensity}
                      memWavenumbers={result.mem_wavenumbers}
                      memInputIntensity={result.mem_input_intensity}
                    />
                  </div>
                </Col>
                <Col xs={24} lg={12}>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16 }}>
                    <ComplexChart
                      wavenumbers={result.wavenumbers}
                      realPart={result.real_part}
                      imagPart={result.imag_part}
                      referenceRealPart={alignedReference?.aligned?.real}
                      referenceImagPart={alignedReference?.aligned?.imag}
                      referenceLabel="Reference"
                    />
                  </div>
                </Col>
              </Row>

              <Card size="small" title="External Re/Im Reference Spectrum" style={{ marginTop: 16 }}>
                <Space wrap style={{ marginBottom: 8 }}>
                  <Upload accept=".csv,.txt" maxCount={1} showUploadList={false} beforeUpload={handleReferenceUpload}>
                    <Button size="small" icon={<UploadOutlined />}>Import Re/Im reference</Button>
                  </Upload>
                  <Button
                    size="small"
                    icon={<DeleteOutlined />}
                    disabled={!referenceSpectrum && !referenceTable}
                    onClick={() => {
                      setReferenceTable(null)
                      setReferenceSelection(null)
                      setReferenceSpectrum(null)
                      setReferenceImportError(null)
                    }}
                  >
                    Clear reference
                  </Button>
                  {referenceSpectrum && (
                    <Text type="secondary">
                      {referenceSpectrum.name} | original points: {referenceSpectrum.pointCount} | range: {referenceSpectrum.frequencyRange[0]}-{referenceSpectrum.frequencyRange[1]} cm^-1
                    </Text>
                  )}
                </Space>
                <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
                  Reference file format is flexible. Select which columns are Wavenumber, Re and Im; the first selection is auto-detected when possible.
                </Text>
                {referenceTable && referenceSelection && (
                  <Space wrap style={{ marginBottom: 8, display: 'flex' }}>
                    <Text type="secondary">Rows: {referenceTable.rowCount}</Text>
                    <Text type="secondary">Columns: {referenceTable.columns.length}</Text>
                    <Text>Wavenumber</Text>
                    <Select
                      size="small"
                      value={referenceSelection.wavenumber}
                      options={referenceColumnOptions}
                      onChange={(value) => setReferenceSelection({ ...referenceSelection, wavenumber: value })}
                      style={{ width: 180 }}
                    />
                    <Text>Re</Text>
                    <Select
                      size="small"
                      value={referenceSelection.real}
                      options={referenceColumnOptions}
                      onChange={(value) => setReferenceSelection({ ...referenceSelection, real: value })}
                      style={{ width: 180 }}
                    />
                    <Text>Im</Text>
                    <Select
                      size="small"
                      value={referenceSelection.imag}
                      options={referenceColumnOptions}
                      onChange={(value) => setReferenceSelection({ ...referenceSelection, imag: value })}
                      style={{ width: 180 }}
                    />
                    <Button size="small" type="primary" onClick={() => applyReferenceSelection()}>
                      Apply selected columns
                    </Button>
                  </Space>
                )}
                {referenceImportError && <Alert type="error" message={referenceImportError} showIcon style={{ marginBottom: 8 }} />}
                {alignedReference?.error && <Alert type="warning" message={alignedReference.error} showIcon style={{ marginBottom: 8 }} />}
                {alignedReference?.aligned && referenceNrmse?.metrics && (
                  <>
                    <Space wrap style={{ display: 'flex', marginBottom: 6 }}>
                      <Text type="secondary">Alignment: {alignedReference.aligned.method}</Text>
                      <Text type="secondary">MEM-grid points: {alignedReference.aligned.pointCount}</Text>
                      <Text type="secondary">Re-NRMSE: {referenceNrmse.metrics.reNrmse.toExponential(4)}</Text>
                      <Text type="secondary">Im-NRMSE: {referenceNrmse.metrics.imNrmse.toExponential(4)}</Text>
                    </Space>
                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      NRMSE = Normalized Root Mean Square Error（归一化均方根误差），computed at the current selected error phase.
                    </Text>
                  </>
                )}
                {alignedReference?.aligned?.warnings.map((warning) => (
                  <Alert key={warning} type="info" message={warning} showIcon style={{ marginTop: 8 }} />
                ))}
                {referenceNrmse?.metrics?.warnings.map((warning) => (
                  <Alert key={warning} type="warning" message={warning} showIcon style={{ marginTop: 8 }} />
                ))}
                {referenceNrmse?.error && <Alert type="warning" message={referenceNrmse.error} showIcon style={{ marginTop: 8 }} />}
              </Card>

              <div style={{ marginTop: 16 }}>
                <PhaseControl
                  phaseAngle={phaseAngle}
                  onPhaseChange={setPhase}
                  onReset={resetPhase}
                  wavenumbers={result.wavenumbers}
                  realPart={result.real_part}
                  imagPart={result.imag_part}
                  referenceRealPart={alignedReference?.aligned?.real}
                  referenceImagPart={alignedReference?.aligned?.imag}
                  referenceLabel={alignedReference?.aligned ? `External reference: ${alignedReference.aligned.name}` : undefined}
                  reNrmse={referenceNrmse?.metrics?.reNrmse}
                  imNrmse={referenceNrmse?.metrics?.imNrmse}
                  originalWavenumbers={result.original_wavenumbers}
                  originalIntensity={result.original_intensity}
                  memInputIntensity={result.mem_input_intensity}
                  nOriginal={result.n_original}
                  nMem={result.n_mem}
                  nn={result.nn}
                  originalFrequencyRange={result.original_frequency_range}
                  memFrequencyRange={result.mem_frequency_range}
                  resamplingMethod={result.resampling_method}
                  resamplingNote={result.resampling_note}
                />
              </div>
            </>
          ) : (
            !loading && (
              <div
                style={{
                  padding: 80,
                  textAlign: 'center',
                  background: '#fff',
                  borderRadius: 8,
                }}
              >
                <Empty
                  description="Upload a CSV file and click Run MEM to begin analysis"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              </div>
            )
          )}
        </Spin>
      </ErrorBoundary>

      {hasResult && result && (
        <Footer style={{ textAlign: 'center', padding: '8px 24px', background: '#f0f2f5' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            N_original: {result.n_original} | N_MEM: {result.n_mem} | NN: {result.nn} | Original range: {result.original_frequency_range[0]} - {result.original_frequency_range[1]} | MEM range: {result.mem_frequency_range[0]} - {result.mem_frequency_range[1]} | {result.resampling_method} | Peak: {result.peak_intensity.toExponential(4)}
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            通过插值增加 MEM 计算点数不会增加原始光谱信息。
          </Text>
        </Footer>
      )}
    </>
  )
}

export default MemAnalyzerPage
