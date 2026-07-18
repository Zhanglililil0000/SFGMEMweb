import { useState } from 'react'
import { Upload, Button, InputNumber, Select, Typography, Alert, message, Row, Col, Card, Checkbox, Space } from 'antd'
import { InboxOutlined, PlayCircleOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload/interface'
import type { ColumnInfo, EdgePaddingOptions } from '../types/mem'

const { Text } = Typography
const MAX_MEM_CALCULATION_POINTS = 20000
const DEFAULT_EDGE_PADDING_WIDTH = 1000

interface UploadPanelProps {
  onRun: (
    file: File,
    nn: number | undefined,
    memPoints: number | undefined,
    column: number,
    edgePadding?: EdgePaddingOptions,
  ) => void
  loading: boolean
  error: string | null
}

function countCsvDataRows(text: string): number {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return 0
  const firstTokens = lines[0].split(',')
  const hasHeader = isNaN(Number(firstTokens[0]?.trim()))
  return hasHeader ? Math.max(lines.length - 1, 0) : lines.length
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

function UploadPanel({ onRun, loading, error }: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [selectedColumn, setSelectedColumn] = useState<number>(1)
  const [nn, setNn] = useState<number | null>(null)
  const [memPoints, setMemPoints] = useState<number | null>(null)
  const [originalPoints, setOriginalPoints] = useState<number | null>(null)
  const [originalRange, setOriginalRange] = useState<[number, number] | null>(null)
  const [memPointsEdited, setMemPointsEdited] = useState(false)
  const [fileName, setFileName] = useState<string>('')
  const [edgePaddingEnabled, setEdgePaddingEnabled] = useState(false)
  const [leftPaddingWidth, setLeftPaddingWidth] = useState<number | null>(DEFAULT_EDGE_PADDING_WIDTH)
  const [rightPaddingWidth, setRightPaddingWidth] = useState<number | null>(DEFAULT_EDGE_PADDING_WIDTH)

  const handleBeforeUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const firstLine = text.split('\n')[0]?.trim()
      if (!firstLine) {
        message.warning('File is empty or unreadable')
        return
      }
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
      // 新光谱导入时，若用户已手动设置 N_MEM，则保留该值，避免无提示覆盖。
      if (!memPointsEdited) {
        setMemPoints(pointCount)
      }
      const keepManual = memPointsEdited && memPoints != null ? `; kept manual MEM points: ${memPoints}` : ''
      message.success(`Parsed ${cols.length} columns, ${pointCount} points${isHeader ? ' (with header)' : ''}${keepManual}`)
    }
    reader.readAsText(file)
    setFile(file)
    setFileName(file.name)
    setFileList([{ uid: '-1', name: file.name, status: 'done' } as UploadFile])
    return false
  }

  const handleRemove = () => {
    setFile(null)
    setColumns([])
    setFileList([])
    setFileName('')
    setOriginalPoints(null)
    setOriginalRange(null)
    setMemPoints(null)
    setMemPointsEdited(false)
    setEdgePaddingEnabled(false)
    setLeftPaddingWidth(DEFAULT_EDGE_PADDING_WIDTH)
    setRightPaddingWidth(DEFAULT_EDGE_PADDING_WIDTH)
  }

  const handleRun = () => {
    if (!file) {
      message.warning('Please upload a CSV file first')
      return
    }
    if (memPoints == null) {
      message.error('MEM calculation points cannot be empty')
      return
    }
    if (!Number.isInteger(memPoints) || memPoints <= 0) {
      message.error('MEM calculation points must be a positive integer')
      return
    }
    if (memPoints < 3) {
      message.error('MEM calculation points must be at least 3')
      return
    }
    if (memPoints > MAX_MEM_CALCULATION_POINTS) {
      message.error(`MEM calculation points must not exceed ${MAX_MEM_CALCULATION_POINTS}`)
      return
    }
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
    onRun(file, nn ?? undefined, memPoints, selectedColumn, {
      enabled: edgePaddingEnabled && (leftWidth > 0 || rightWidth > 0),
      leftWidth,
      rightWidth,
    })
  }

  const hasFile = file !== null
  const paddedRange = originalRange
    ? [originalRange[0] - (edgePaddingEnabled ? (leftPaddingWidth ?? 0) : 0), originalRange[1] + (edgePaddingEnabled ? (rightPaddingWidth ?? 0) : 0)] as [number, number]
    : null

  return (
    <Card title="Data Setup" size="small">
      {error && <Alert type="error" message={error} closable showIcon style={{ marginBottom: 12 }} />}
      <Row gutter={[16, 12]} align="middle">
        <Col xs={24} sm={24} md={10} lg={10}>
          <Upload
            accept=".csv"
            maxCount={1}
            fileList={fileList}
            beforeUpload={handleBeforeUpload}
            onRemove={handleRemove}
            showUploadList={{ showPreviewIcon: false }}
          >
            <Button icon={<InboxOutlined />} disabled={loading}>
              {fileName || 'Select CSV File...'}
            </Button>
          </Upload>
        </Col>

        <Col xs={24} sm={12} md={5} lg={4}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <Text type="secondary">Column:</Text>
            <Select
              value={selectedColumn}
              onChange={(v) => setSelectedColumn(v)}
              style={{ width: 140 }}
              options={columns.map((col) => ({
                value: col.index,
                label: `${col.index}: ${col.name}`,
              }))}
              disabled={columns.length === 0}
              size="small"
            />
          </span>
        </Col>

        <Col xs={24} sm={12} md={5} lg={3}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <Text type="secondary">NN:</Text>
            <InputNumber
              min={2}
              max={9999}
              size="small"
              placeholder="auto"
              value={nn}
              onChange={(v) => setNn(v)}
              style={{ width: 80 }}
            />
          </span>
        </Col>

        <Col xs={24} sm={12} md={8} lg={4}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <Text type="secondary">MEM calculation points:</Text>
            <InputNumber
              min={3}
              max={MAX_MEM_CALCULATION_POINTS}
              size="small"
              placeholder={originalPoints != null ? String(originalPoints) : 'auto'}
              value={memPoints}
              onChange={(v) => {
                setMemPoints(v)
                setMemPointsEdited(true)
              }}
              style={{ width: 100 }}
            />
          </span>
        </Col>

        <Col xs={24} sm={12} md={6} lg={3} style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={loading}
            disabled={loading || !hasFile}
            onClick={handleRun}
          >
            Run MEM
          </Button>
        </Col>
      </Row>
      <Row gutter={[16, 8]} align="middle" style={{ marginTop: 10 }}>
        <Col xs={24} md={7}>
          <Checkbox
            checked={edgePaddingEnabled}
            onChange={(event) => setEdgePaddingEnabled(event.target.checked)}
          >
            Enable edge padding / 启用两端扩展
          </Checkbox>
        </Col>
        <Col xs={24} sm={12} md={6}>
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
        <Col xs={24} sm={12} md={6}>
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
      {columns.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <Space wrap size={[8, 0]}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {fileName} — {columns.length} columns
            </Text>
            {originalPoints != null && <Text type="secondary" style={{ fontSize: 12 }}>N_original: {originalPoints}</Text>}
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
    </Card>
  )
}

export default UploadPanel
