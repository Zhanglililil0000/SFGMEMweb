import type { SfgPeakParams } from '../types/mem'
import type { PhaseUnit } from './phaseUnit'
import { phaseFromDisplay } from './phaseUnit'

export const profileTypeOptions = [
  { value: 'lorentzian', label: 'Lorentzian' },
  { value: 'voigt', label: 'Voigt' },
]

export function normalizeProfileType(value: string | undefined): 'lorentzian' | 'voigt' {
  return value?.trim().toLowerCase() === 'voigt' ? 'voigt' : 'lorentzian'
}

function field(fields: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (fields[key] != null) return fields[key]
  }
  const lowerFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key.toLowerCase(), value]))
  for (const key of keys) {
    const value = lowerFields[key.toLowerCase()]
    if (value != null) return value
  }
  return undefined
}

function numberField(fields: Record<string, string>, keys: string[], fallback: number): number {
  const value = field(fields, keys)
  if (value == null) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringField(fields: Record<string, string>, keys: string[], fallback: string): string {
  return field(fields, keys) ?? fallback
}

export function importedPeakIndices(fields: Record<string, string>): number[] {
  const indices = new Set<number>()
  for (const key of Object.keys(fields)) {
    const match = key.match(/^(A|Omega|Gamma|Phi|Profile|Profile_Type|Gaussian_FWHM|GaussianFWHM|Lorentzian_FWHM|Label|Mode|ModeName)(\d+)$/i)
    if (match) indices.add(Number(match[2]))
  }
  return Array.from(indices).sort((a, b) => a - b)
}

export function buildImportedPeak(
  fields: Record<string, string>,
  index: number | null,
  phaseUnit: PhaseUnit,
  defaultCenter: number,
): SfgPeakParams {
  const suffix = index == null ? '' : String(index)
  const lorentzianFwhm = numberField(fields, [`Lorentzian_FWHM${suffix}`, `lorentzian_fwhm_cm-1${suffix}`], NaN)
  const width = numberField(
    fields,
    [`Gamma${suffix}`, `Lorentzian_HWHM${suffix}`, `lorentzian_hwhm_cm-1${suffix}`, `width${suffix}`],
    Number.isFinite(lorentzianFwhm) ? lorentzianFwhm / 2 : 10,
  )

  return {
    label: stringField(fields, [`Label${suffix}`, `Mode${suffix}`, `ModeName${suffix}`, `mode_name${suffix}`], ''),
    profile_type: normalizeProfileType(stringField(fields, [`Profile${suffix}`, `Profile_Type${suffix}`, `profile_type${suffix}`], 'lorentzian')),
    amplitude: numberField(fields, [`A${suffix}`, `Amplitude${suffix}`, `amplitude${suffix}`], 1.0),
    center: numberField(fields, [`Omega${suffix}`, `Center${suffix}`, `center_cm-1${suffix}`, `center${suffix}`], defaultCenter),
    width,
    gaussian_fwhm: numberField(fields, [`Gaussian_FWHM${suffix}`, `GaussianFWHM${suffix}`, `gaussian_fwhm_cm-1${suffix}`, `gaussian_fwhm${suffix}`], 0),
    phase: phaseFromDisplay(numberField(fields, [`Phi${suffix}`, `Phase${suffix}`, `phase${suffix}`], 0), phaseUnit),
  }
}
