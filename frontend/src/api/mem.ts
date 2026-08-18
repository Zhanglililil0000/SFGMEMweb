import axios from 'axios'
import type {
  ComplexVoigtAnalyzeRequest,
  ComplexVoigtResult,
  EdgePaddingOptions,
  FittingParams,
  LorentzianZeroFlipRequest,
  LorentzianZeroFlipResult,
  LorentzianMultiStartRequest,
  LorentzianMultiStartResult,
  MemCompareResult,
  MemResult,
  PhaseRequest,
  PhaseResponse,
  SfgGenerateRequest,
  SfgResult,
} from '../types/mem'

const api = axios.create({ baseURL: '/api' })

export function getApiErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (e.response?.status === 502) {
      return '后端服务未启动或不可访问。请确认 MEM Backend 窗口已正常运行，并检查 http://localhost:8000/api/health。'
    }
    if (e.response?.data?.detail) {
      return typeof e.response.data.detail === 'string'
        ? e.response.data.detail
        : JSON.stringify(e.response.data.detail)
    }
    if (e.message) return e.message
  }
  if (e instanceof Error) return e.message
  return 'Unknown error'
}

export async function runMem(
  file: File,
  nn?: number,
  memPoints?: number,
  column?: number,
  edgePadding?: EdgePaddingOptions,
): Promise<MemResult> {
  const formData = new FormData()
  formData.append('file', file)
  if (nn != null) formData.append('nn', String(nn))
  if (memPoints != null) formData.append('mem_points', String(memPoints))
  if (column != null) formData.append('column', String(column))
  if (edgePadding) {
    formData.append('edge_padding_enabled', String(edgePadding.enabled))
    formData.append('left_padding_width', String(edgePadding.leftWidth))
    formData.append('right_padding_width', String(edgePadding.rightWidth))
  }
  const { data } = await api.post<MemResult>('/mem/run', formData)
  return data
}

export async function applyPhase(params: PhaseRequest): Promise<PhaseResponse> {
  const { data } = await api.post<PhaseResponse>('/mem/phase', params)
  return data
}

export async function generateSfg(params: SfgGenerateRequest): Promise<SfgResult> {
  const { data } = await api.post<SfgResult>('/sfg/generate', params)
  return data
}

export async function analyzeComplexVoigt(params: ComplexVoigtAnalyzeRequest): Promise<ComplexVoigtResult> {
  const { data } = await api.post<ComplexVoigtResult>('/complex-voigt/analyze', params)
  return data
}

export async function analyzeLorentzianZeroFlip(params: LorentzianZeroFlipRequest): Promise<LorentzianZeroFlipResult> {
  const { data } = await api.post<LorentzianZeroFlipResult>('/lorentzian-zero-flip/analyze', params)
  return data
}

export async function searchLorentzianMultiStart(params: LorentzianMultiStartRequest): Promise<LorentzianMultiStartResult> {
  const { data } = await api.post<LorentzianMultiStartResult>('/lorentzian-multistart/search', params)
  return data
}

export async function runMemCompare(
  file: File,
  nn: number | undefined,
  memPoints: number | undefined,
  column: number | undefined,
  fitParams: FittingParams,
  edgePadding?: EdgePaddingOptions,
): Promise<MemCompareResult> {
  const formData = new FormData()
  formData.append('file', file)
  if (nn != null) formData.append('nn', String(nn))
  if (memPoints != null) formData.append('mem_points', String(memPoints))
  if (column != null) formData.append('column', String(column))
  if (edgePadding) {
    formData.append('edge_padding_enabled', String(edgePadding.enabled))
    formData.append('left_padding_width', String(edgePadding.leftWidth))
    formData.append('right_padding_width', String(edgePadding.rightWidth))
  }
  formData.append('params_json', JSON.stringify(fitParams))
  const { data } = await api.post<MemCompareResult>('/mem/compare', formData)
  return data
}
