export type MemRegion = 'left_padding' | 'original' | 'right_padding'

export interface EdgePaddingOptions {
  enabled: boolean
  leftWidth: number
  rightWidth: number
}

export interface MemResult {
  wavenumbers: number[]
  original_wavenumbers: number[]
  mem_wavenumbers: number[]
  evaluation_wavenumbers: number[]
  original_intensity: number[]
  mem_input_intensity: number[]
  mem_input_intensity_eval: number[]
  reconstructed_intensity: number[]
  reconstructed_intensity_eval: number[]
  real_part: number[]
  imag_part: number[]
  real_part_eval: number[]
  imag_part_eval: number[]
  peak_intensity: number
  n_points: number
  n_original: number
  n_mem: number
  n_eval: number
  nn: number
  original_frequency_range: [number, number]
  mem_frequency_range: [number, number]
  padded_frequency_range: [number, number]
  evaluation_frequency_range: [number, number]
  edge_padding_enabled: boolean
  left_padding_width: number
  right_padding_width: number
  evaluation_indices: number[]
  mem_regions: MemRegion[]
  left_padding_points: number
  original_region_points: number
  right_padding_points: number
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
  evaluation_wavenumbers: number[]
  original_intensity: number[]
  import_intensity: number[]
  mem_input_intensity: number[]
  mem_input_intensity_eval: number[]
  fitting_intensity: number[]
  fitting_intensity_eval: number[]
  mem_real: number[]
  mem_imag: number[]
  mem_real_eval: number[]
  mem_imag_eval: number[]
  fitting_real: number[]
  fitting_imag: number[]
  fitting_real_eval: number[]
  fitting_imag_eval: number[]
  n_points: number
  n_original: number
  n_mem: number
  n_eval: number
  nn: number
  original_frequency_range: [number, number]
  mem_frequency_range: [number, number]
  padded_frequency_range: [number, number]
  evaluation_frequency_range: [number, number]
  edge_padding_enabled: boolean
  left_padding_width: number
  right_padding_width: number
  evaluation_indices: number[]
  mem_regions: MemRegion[]
  left_padding_points: number
  original_region_points: number
  right_padding_points: number
  resampling_method: string
  original_grid_uniform: boolean
  resampling_note: string
  columns_info?: ColumnInfo[]
}
