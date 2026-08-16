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

export type ComplexVoigtProfileType = 'lorentzian' | 'voigt'

export interface ComplexVoigtPeakParams {
  profile_type: ComplexVoigtProfileType
  amplitude: number
  center: number
  lorentzian_hwhm: number
  gaussian_hwhm: number
  phase_deg: number
}

export interface ComplexVoigtAnalyzeRequest {
  x_min: number
  x_max: number
  npoints: number
  y_min: number
  y_max: number
  grid_x: number
  grid_y: number
  nr_real: number
  nr_imag: number
  peaks: ComplexVoigtPeakParams[]
  root_tolerance: number
  max_roots: number
}

export interface ComplexVoigtZero {
  x: number
  y: number
  real_chi: number
  imag_chi: number
  abs_chi: number
  classification: string
  source_seed_x: number
  source_seed_y: number
  solver_success: boolean
  solver_message: string
}

export interface ComplexVoigtMinimum {
  ix: number
  iy: number
  x: number
  y: number
  abs_chi: number
  log_abs_chi: number
}

export interface ComplexVoigtResult {
  wavenumbers: number[]
  real_part: number[]
  imag_part: number[]
  intensity: number[]
  complex_plane: {
    x: number[]
    y: number[]
    abs_chi: number[][]
    log_abs_chi: number[][]
    minima: ComplexVoigtMinimum[]
  }
  zeros: ComplexVoigtZero[]
  summary: string
  upper_zero_count: number
  lower_zero_count: number
  real_axis_zero_count: number
  metadata: {
    gaussian_input: string
    gaussian_conversion: string
    lorentzian_convention: string
    voigt_convention: string
    pole_convention: string
    fourier_sign_convention: string
    root_tolerance: number
    effective_root_tolerance: number
    grid_point_count: number
  }
  normalized_peaks: Array<ComplexVoigtPeakParams & {
    gaussian_sigma: number
    phase_rad: number
  }>
}

export interface ComplexNumberValue {
  real: number
  imag: number
}

export interface LorentzianZeroFlipOscillator {
  amplitude: number
  phase_deg: number
  center: number
  lorentzian_hwhm: number
}

export interface LorentzianZeroFlipRequest {
  x_min: number
  x_max: number
  npoints: number
  c0_real: number
  c0_imag: number
  oscillators: LorentzianZeroFlipOscillator[]
  real_zero_tolerance: number
  ratio_threshold: number
  near_distance_tolerance: number
  pole_tolerance: number
  validation_tolerance: number
  flip_configurations: number[][]
  enumerate_all: boolean
  max_flippable_for_enumeration: number
  enumeration_window_margin: number
  minimum_phase_effect_deg: number
}

export interface LorentzianAlgebraicZero extends ComplexNumberValue {
  index: number
  id: string
  abs_chi_direct: number
  effectively_real: boolean
  flippable: boolean
  in_enumeration_window: boolean
  phase_effect_deg: number
  enumeration_eligible: boolean
  enumeration_selected: boolean
}

export interface LorentzianParameterComparison {
  oscillator_index: number
  center: number
  lorentzian_hwhm: number
  original_fitted_complex_amplitude: ComplexNumberValue
  original_amplitude: number
  original_phase_deg: number
  alternative_fitted_complex_amplitude: ComplexNumberValue
  alternative_amplitude: number
  alternative_phase_deg: number
  amplitude_change: number
  phase_change_deg: number
}

export interface LorentzianZeroFlipAlternative {
  configuration_id: string
  flipped_zero_indices: number[]
  flipped_zeros: Array<{
    index: number
    id: string
    original: ComplexNumberValue
    reflected: ComplexNumberValue
  }>
  numerator_coefficients: ComplexNumberValue[]
  denominator_coefficients: ComplexNumberValue[]
  zeros: ComplexNumberValue[]
  poles: ComplexNumberValue[]
  c0: ComplexNumberValue
  fitted_complex_amplitudes: ComplexNumberValue[]
  amplitudes: number[]
  phases_deg: number[]
  comparison: LorentzianParameterComparison[]
  real_part: number[]
  imag_part: number[]
  intensity: number[]
  ratio_magnitude: Array<number | null>
  phase_difference_rad: Array<number | null>
  phase_difference_unwrapped_rad: Array<number | null>
  ratio_defined: boolean[]
  metrics: {
    max_intensity_error: number
    normalized_rms_intensity_error: number
    max_ratio_magnitude_error: number
    partial_fraction_max_abs_error: number
    partial_fraction_normalized_rms_error: number
  }
  numerically_valid: boolean
  warnings: string[]
}

export interface LorentzianZeroFlipResult {
  convention: {
    response: string
    fitted_complex_amplitude: string
    pole: string
    conventional_residue: string
    recovery: string
  }
  frequency: number[]
  original: {
    c0: ComplexNumberValue
    fitted_complex_amplitudes: ComplexNumberValue[]
    poles: ComplexNumberValue[]
    zeros: LorentzianAlgebraicZero[]
    numerator_coefficients: ComplexNumberValue[]
    denominator_coefficients: ComplexNumberValue[]
    real_part: number[]
    imag_part: number[]
    intensity: number[]
    reconstruction: {
      max_abs_complex_error: number
      normalized_rms_complex_error: number
    }
  }
  flippable_zero_count: number
  possible_configuration_count: number
  enumeration_flippable_zero_count: number
  enumeration_configuration_count: number
  enumeration_selection: {
    max_flippable: number
    window_margin: number
    minimum_phase_effect_deg: number
  }
  alternatives: LorentzianZeroFlipAlternative[]
  tolerances: Record<string, number>
  warnings: string[]
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
