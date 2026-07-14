import { Button, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { MemRegion } from '../types/mem'
import { radToDeg } from '../utils/phaseUnit'

interface ExportButtonProps {
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
  memRegions?: MemRegion[]
  evaluationWavenumbers?: number[]
  evaluationRealPart?: number[]
  evaluationImagPart?: number[]
  evaluationMemInputIntensity?: number[]
  nOriginal?: number
  nMem?: number
  nEval?: number
  nn?: number
  phaseAngle?: number
  originalFrequencyRange?: [number, number]
  memFrequencyRange?: [number, number]
  paddedFrequencyRange?: [number, number]
  evaluationFrequencyRange?: [number, number]
  edgePaddingEnabled?: boolean
  leftPaddingWidth?: number
  rightPaddingWidth?: number
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
    referenceRealPart,
    referenceImagPart,
    referenceLabel,
    reNrmse,
    imNrmse,
    originalWavenumbers = [],
    originalIntensity = [],
    memInputIntensity = [],
    memRegions = [],
    evaluationWavenumbers,
    evaluationRealPart,
    evaluationImagPart,
    evaluationMemInputIntensity,
    nOriginal,
    nMem,
    nEval,
    nn,
    phaseAngle,
    originalFrequencyRange,
    memFrequencyRange,
    paddedFrequencyRange,
    evaluationFrequencyRange,
    edgePaddingEnabled,
    leftPaddingWidth,
    rightPaddingWidth,
    resamplingMethod,
    resamplingNote,
  } = props
  const evalW = evaluationWavenumbers ?? wavenumbers
  const evalRe = evaluationRealPart ?? realPart
  const evalIm = evaluationImagPart ?? imagPart
  const evalInput = evaluationMemInputIntensity ?? memInputIntensity
  const lines: string[] = [
    '# N_original,' + cell(nOriginal),
    '# N_MEM,' + cell(nMem),
    '# N_eval,' + cell(nEval ?? evalW.length),
    '# original_frequency_range,' + rangeText(originalFrequencyRange),
    '# mem_frequency_range,' + rangeText(memFrequencyRange),
    '# padded_frequency_range,' + rangeText(paddedFrequencyRange ?? memFrequencyRange),
    '# evaluation_frequency_range,' + rangeText(evaluationFrequencyRange ?? originalFrequencyRange),
    '# edge_padding_enabled,' + cell(edgePaddingEnabled ? 'true' : 'false'),
    '# left_padding_width_cm-1,' + cell(leftPaddingWidth),
    '# right_padding_width_cm-1,' + cell(rightPaddingWidth),
    '# resampling_method,' + cell(resamplingMethod),
    '# NN,' + cell(nn),
    '# error_phase_deg,' + cell(phaseAngle == null ? undefined : radToDeg(phaseAngle)),
    '# error_phase_rad,' + cell(phaseAngle),
    ...(referenceRealPart && referenceImagPart ? [
      '# reference_source,' + cell(referenceLabel ?? 'External Re/Im reference'),
      '# Re_NRMSE,' + cell(reNrmse),
      '# Im_NRMSE,' + cell(imNrmse),
      '# NRMSE evaluation range,' + rangeText(evaluationFrequencyRange ?? originalFrequencyRange),
      '# NRMSE note,Padding regions are not included in residual or NRMSE',
      '# NRMSE,Normalized Root Mean Square Error',
      '# NRMSE Chinese name,归一化均方根误差',
      '# NRMSE normalization,RMSE divided by RMS amplitude of the corresponding reference spectrum',
    ] : []),
    '# note,' + cell(resamplingNote),
    referenceRealPart && referenceImagPart
      ? 'frequency_original,intensity_original,frequency_mem_padded,intensity_mem_input_padded,Re_MEM_padded,Im_MEM_padded,region,frequency_eval,intensity_mem_input_eval,Re_MEM_eval,Im_MEM_eval,Re_reference_eval,Im_reference_eval,Re_residual_eval,Im_residual_eval'
      : 'frequency_original,intensity_original,frequency_mem_padded,intensity_mem_input_padded,Re_MEM_padded,Im_MEM_padded,region,frequency_eval,intensity_mem_input_eval,Re_MEM_eval,Im_MEM_eval',
  ]
  const rowCount = Math.max(originalWavenumbers.length, wavenumbers.length, evalW.length)
  for (let i = 0; i < rowCount; i++) {
    const row = [
      cell(originalWavenumbers[i]),
      cell(originalIntensity[i]),
      cell(wavenumbers[i]),
      cell(memInputIntensity[i]),
      cell(realPart[i]),
      cell(imagPart[i]),
      cell(memRegions[i]),
      cell(evalW[i]),
      cell(evalInput[i]),
      cell(evalRe[i]),
      cell(evalIm[i]),
    ]
    if (referenceRealPart && referenceImagPart) {
      const reResidual = evalRe[i] == null || referenceRealPart[i] == null ? undefined : evalRe[i] - referenceRealPart[i]
      const imResidual = evalIm[i] == null || referenceImagPart[i] == null ? undefined : evalIm[i] - referenceImagPart[i]
      row.push(
        cell(referenceRealPart[i]),
        cell(referenceImagPart[i]),
        cell(reResidual),
        cell(imResidual),
      )
    }
    lines.push(row.join(','))
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
  referenceRealPart,
  referenceImagPart,
  referenceLabel,
  reNrmse,
  imNrmse,
  originalWavenumbers,
  originalIntensity,
  memInputIntensity,
  memRegions,
  evaluationWavenumbers,
  evaluationRealPart,
  evaluationImagPart,
  evaluationMemInputIntensity,
  nOriginal,
  nMem,
  nEval,
  nn,
  phaseAngle,
  originalFrequencyRange,
  memFrequencyRange,
  paddedFrequencyRange,
  evaluationFrequencyRange,
  edgePaddingEnabled,
  leftPaddingWidth,
  rightPaddingWidth,
  resamplingMethod,
  resamplingNote,
}) => {
  const handleExport = () => {
    exportToCsv({
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
      memRegions,
      evaluationWavenumbers,
      evaluationRealPart,
      evaluationImagPart,
      evaluationMemInputIntensity,
      nOriginal,
      nMem,
      nEval,
      nn,
      phaseAngle,
      originalFrequencyRange,
      memFrequencyRange,
      paddedFrequencyRange,
      evaluationFrequencyRange,
      edgePaddingEnabled,
      leftPaddingWidth,
      rightPaddingWidth,
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
