import { Slider, InputNumber, Button, Space, Card, Row, Col, Typography } from 'antd'
import { UndoOutlined } from '@ant-design/icons'
import ExportButton from './ExportButton'
import { degToRad, radToDeg } from '../utils/phaseUnit'

const { Text } = Typography

interface PhaseControlProps {
  phaseAngle: number
  onPhaseChange: (angle: number) => void
  onReset: () => void
  wavenumbers: number[]
  realPart: number[]
  imagPart: number[]
  referenceRealPart?: number[]
  referenceImagPart?: number[]
  referenceLabel?: string
  reNrmse?: number
  imNrmse?: number
  originalWavenumbers?: number[]
  originalIntensity?: number[]
  memInputIntensity?: number[]
  nOriginal?: number
  nMem?: number
  nn?: number
  originalFrequencyRange?: [number, number]
  memFrequencyRange?: [number, number]
  resamplingMethod?: string
  resamplingNote?: string
}

const marks: Record<number, string> = {
  0: '0\u00b0',
  90: '90\u00b0',
  180: '180\u00b0',
  270: '270\u00b0',
  360: '360\u00b0',
}

const PhaseControl: React.FC<PhaseControlProps> = ({
  phaseAngle,
  onPhaseChange,
  onReset,
  wavenumbers,
  realPart,
  imagPart,
  referenceRealPart,
  referenceImagPart,
  referenceLabel,
  reNrmse,
  imNrmse,
  originalWavenumbers,
  originalIntensity,
  memInputIntensity,
  nOriginal,
  nMem,
  nn,
  originalFrequencyRange,
  memFrequencyRange,
  resamplingMethod,
  resamplingNote,
}) => {
  const phaseDeg = radToDeg(phaseAngle)

  return (
    <Card
      title="Error Phase Adjustment"
      size="small"
      extra={
        <ExportButton
          wavenumbers={wavenumbers}
          realPart={realPart}
          imagPart={imagPart}
          referenceRealPart={referenceRealPart}
          referenceImagPart={referenceImagPart}
          referenceLabel={referenceLabel}
          reNrmse={reNrmse}
          imNrmse={imNrmse}
          originalWavenumbers={originalWavenumbers}
          originalIntensity={originalIntensity}
          memInputIntensity={memInputIntensity}
          nOriginal={nOriginal}
          nMem={nMem}
          nn={nn}
          phaseAngle={phaseAngle}
          originalFrequencyRange={originalFrequencyRange}
          memFrequencyRange={memFrequencyRange}
          resamplingMethod={resamplingMethod}
          resamplingNote={resamplingNote}
        />
      }
    >
      <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
        Drag slider or enter value to adjust error phase phi in degrees.
        The internal phase used for calculation is shown in radians.
        The imaginary part should approach zero in non-resonant regions for the physically correct solution.
      </Text>
      <Row gutter={16} align="middle">
        <Col flex="auto">
          <Slider
            min={0}
            max={360}
            step={0.5}
            value={phaseDeg}
            onChange={(value) => onPhaseChange(degToRad(value as number))}
            marks={marks}
          />
        </Col>
        <Col>
          <Space>
            <Text style={{ whiteSpace: 'nowrap' }}>Selected error phase (\u00b0)</Text>
            <InputNumber
              min={0}
              max={360}
              step={0.5}
              value={phaseDeg}
              precision={6}
              onChange={(value) => {
                if (value !== null) onPhaseChange(degToRad(value))
              }}
              style={{ width: 120 }}
            />
            <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
              {phaseDeg.toFixed(2)}\u00b0 = {phaseAngle.toFixed(6)} rad
            </Text>
            <Button icon={<UndoOutlined />} onClick={onReset} size="small">
              Reset
            </Button>
          </Space>
        </Col>
      </Row>
    </Card>
  )
}

export default PhaseControl
