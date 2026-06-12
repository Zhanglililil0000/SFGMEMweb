export interface MemResult {
  wavenumbers: number[]
  original_intensity: number[]
  reconstructed_intensity: number[]
  real_part: number[]
  imag_part: number[]
  peak_intensity: number
  n_points: number
  nn: number
  columns_info?: ColumnInfo[]
}

export interface PhaseRequest {
  phase_angle: number
  real_part: number[]
  imag_part: number[]
}

export interface PhaseResponse {
  real_part: number[]
  imag_part: number[]
}

export interface ColumnInfo {
  index: number
  name: string
}

export interface SfgPeakParams {
  amplitude: number
  center: number
  width: number
  phase: number
}

export interface SfgGenerateRequest {
  xmin: number
  xmax: number
  npoints: number
  nr_real: number
  nr_imag: number
  peaks: SfgPeakParams[]
}

export interface SfgSubComponent {
  label: string
  intensity: number[] | number
  real: number[] | number
  imag: number[] | number
}

export interface SfgResult {
  wavenumbers: number[]
  intensity: number[]
  real_part: number[]
  imag_part: number[]
  sub_components: SfgSubComponent[]
}

export interface FittingParams {
  nr_real: number
  nr_imag: number
  peaks: SfgPeakParams[]
}

export interface MemCompareResult {
  wavenumbers: number[]
  import_intensity: number[]
  fitting_intensity: number[]
  mem_real: number[]
  mem_imag: number[]
  fitting_real: number[]
  fitting_imag: number[]
  n_points: number
  nn: number
  columns_info?: ColumnInfo[]
}
