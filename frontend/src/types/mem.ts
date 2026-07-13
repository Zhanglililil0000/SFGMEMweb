export interface MemResult {
  wavenumbers: number[]
  original_wavenumbers: number[]
  mem_wavenumbers: number[]
  original_intensity: number[]
  mem_input_intensity: number[]
  reconstructed_intensity: number[]
  real_part: number[]
  imag_part: number[]
  peak_intensity: number
  n_points: number
  n_original: number
  n_mem: number
  nn: number
  original_frequency_range: [number, number]
  mem_frequency_range: [number, number]
  resampling_method: string
  original_grid_uniform: boolean
  resampling_note: string
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
  label?: string
  amplitude: number
  center: number
  width: number
  phase: number
  profile_type?: 'lorentzian' | 'voigt'
  gaussian_fwhm?: number
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
  original_wavenumbers: number[]
  mem_wavenumbers: number[]
  original_intensity: number[]
  import_intensity: number[]
  mem_input_intensity: number[]
  fitting_intensity: number[]
  mem_real: number[]
  mem_imag: number[]
  fitting_real: number[]
  fitting_imag: number[]
  n_points: number
  n_original: number
  n_mem: number
  nn: number
  original_frequency_range: [number, number]
  mem_frequency_range: [number, number]
  resampling_method: string
  original_grid_uniform: boolean
  resampling_note: string
  columns_info?: ColumnInfo[]
}
