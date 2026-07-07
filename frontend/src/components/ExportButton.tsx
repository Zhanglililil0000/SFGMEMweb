import { Button, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { radToDeg } from '../utils/phaseUnit'

interface ExportButtonProps {
  wavenumbers: number[]
  realPart: number[]
  imagPart: number[]
  originalWavenumbers?: number[]
  originalIntensity?: number[]
  memInputIntensity?: number[]
  nOriginal?: number
  nMem?: number
  nn?: number
  phaseAngle?: number
  originalFrequencyRange?: [number, number]
  memFrequencyRange?: [number, number]
  resamplingMethod?: string
  resamplingNote?: string
}

function cell(value: number | string | undefined): string {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return value
}

function rangeText(range?: [number, number]): string {
  return range ? `${range[0]} to ${range[1]}` : ''
}

function exportToCsv(props: ExportButtonProps) {
  const {
    wavenumbers,
    realPart,
    imagPart,
    originalWavenumbers = [],
    originalIntensity = [],
    memInputIntensity = [],
    nOriginal,
    nMem,
    nn,
    phaseAngle,
    originalFrequencyRange,
    memFrequencyRange,
    resamplingMethod,
    resamplingNote,
  } = props
  const lines: string[] = [
    '# N_original,' + cell(nOriginal),
    '# N_MEM,' + cell(nMem),
    '# original_frequency_range,' + rangeText(originalFrequencyRange),
    '# mem_frequency_range,' + rangeText(memFrequencyRange),
    '# resampling_method,' + cell(resamplingMethod),
    '# NN,' + cell(nn),
    '# error_phase_deg,' + cell(phaseAngle == null ? undefined : radToDeg(phaseAngle)),
    '# error_phase_rad,' + cell(phaseAngle),
    '# note,' + cell(resamplingNote),
    'frequency_original,intensity_original,frequency_mem,intensity_mem_input,Re_mem,Im_mem',
  ]
  const rowCount = Math.max(originalWavenumbers.length, wavenumbers.length)
  for (let i = 0; i < rowCount; i++) {
    lines.push([
      cell(originalWavenumbers[i]),
      cell(originalIntensity[i]),
      cell(wavenumbers[i]),
      cell(memInputIntensity[i]),
      cell(realPart[i]),
      cell(imagPart[i]),
    ].join(','))
  }
  const csv = lines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'MEM_Export.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const ExportButton: React.FC<ExportButtonProps> = ({
  wavenumbers,
  realPart,
  imagPart,
  originalWavenumbers,
  originalIntensity,
  memInputIntensity,
  nOriginal,
  nMem,
  nn,
  phaseAngle,
  originalFrequencyRange,
  memFrequencyRange,
  resamplingMethod,
  resamplingNote,
}) => {
  const handleExport = () => {
    exportToCsv({
      wavenumbers,
      realPart,
      imagPart,
      originalWavenumbers,
      originalIntensity,
      memInputIntensity,
      nOriginal,
      nMem,
      nn,
      phaseAngle,
      originalFrequencyRange,
      memFrequencyRange,
      resamplingMethod,
      resamplingNote,
    })
    message.success('Data exported')
  }

  const hasNoData = wavenumbers.length === 0

  return (
    <Button
      icon={<DownloadOutlined />}
      onClick={handleExport}
      disabled={hasNoData}
    >
      Export CSV
    </Button>
  )
}

export default ExportButton
