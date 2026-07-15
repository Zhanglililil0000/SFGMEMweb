import type { SfgPeakParams } from '../types/mem'
import { formatParameterNumber } from './phaseUnit'

const SQRT_2_LN_2 = Math.sqrt(2 * Math.log(2))

export interface WidthSummaryLine {
  label: string
  value: string
  note?: string
}

function finiteOrZero(value: number | undefined): number {
  return Number.isFinite(value) ? value as number : 0
}

function formatCm(value: number): string {
  return `${formatParameterNumber(value)} cm^-1`
}

export function gaussianHwhmToFwhm(hwhm: number): number {
  return 2 * hwhm
}

export function gaussianFwhmToHwhm(fwhm: number): number {
  return fwhm / 2
}

export function gaussianHwhmToSigma(hwhm: number): number {
  return hwhm / SQRT_2_LN_2
}

export function gaussianFwhmToSigma(fwhm: number): number {
  return fwhm / (2 * SQRT_2_LN_2)
}

export function gaussianSigmaToHwhm(sigma: number): number {
  return sigma * SQRT_2_LN_2
}

export function approximateVoigtFwhm(lorentzianHwhmValue: number | undefined, gaussianHwhmValue: number | undefined): number {
  const lorentzianFwhm = 2 * finiteOrZero(lorentzianHwhmValue)
  const gaussianFwhm = gaussianHwhmToFwhm(finiteOrZero(gaussianHwhmValue))
  return 0.5346 * lorentzianFwhm
    + Math.sqrt(0.2166 * lorentzianFwhm * lorentzianFwhm + gaussianFwhm * gaussianFwhm)
}

export function approximateVoigtHwhm(lorentzianHwhmValue: number | undefined, gaussianHwhmValue: number | undefined): number {
  return approximateVoigtFwhm(lorentzianHwhmValue, gaussianHwhmValue) / 2
}

export function peakGaussianHwhm(peak: Pick<SfgPeakParams, 'gaussian_hwhm' | 'gaussian_fwhm'>): number {
  if (peak.gaussian_hwhm != null) return finiteOrZero(peak.gaussian_hwhm)
  if (peak.gaussian_fwhm != null) return gaussianFwhmToHwhm(finiteOrZero(peak.gaussian_fwhm))
  return 0
}

export function peakWidthSummaryLines(peak: Pick<SfgPeakParams, 'width' | 'gaussian_hwhm' | 'gaussian_fwhm'>): WidthSummaryLine[] {
  const lorentzianHwhm = finiteOrZero(peak.width)
  const lorentzianFwhm = 2 * lorentzianHwhm
  const gaussianHwhm = peakGaussianHwhm(peak)
  const gaussianFwhm = gaussianHwhmToFwhm(gaussianHwhm)
  const gaussianSigma = gaussianHwhmToSigma(gaussianHwhm)
  const voigtHwhm = approximateVoigtHwhm(lorentzianHwhm, gaussianHwhm)
  const voigtFwhm = approximateVoigtFwhm(lorentzianHwhm, gaussianHwhm)
  const voigtEquivalentSigma = gaussianFwhmToSigma(voigtFwhm)

  return [
    { label: 'Lorentzian FWHM', value: formatCm(lorentzianFwhm) },
    { label: 'Gaussian FWHM', value: formatCm(gaussianFwhm) },
    { label: 'Gaussian standard deviation (sigma)', value: formatCm(gaussianSigma) },
    { label: 'Voigt HWHM', value: `≈ ${formatCm(voigtHwhm)}`, note: 'Olivero-Longbothum' },
    { label: 'Voigt FWHM', value: `≈ ${formatCm(voigtFwhm)}`, note: 'Olivero-Longbothum' },
    { label: 'Voigt equivalent Gaussian sigma', value: `≈ ${formatCm(voigtEquivalentSigma)}`, note: 'from approximate Voigt FWHM' },
  ]
}

export function peaksForBackend(peaks: SfgPeakParams[]): SfgPeakParams[] {
  return peaks.map((peak) => {
    const gaussianHwhm = peakGaussianHwhm(peak)
    return {
      ...peak,
      gaussian_hwhm: gaussianHwhm,
      gaussian_fwhm: gaussianHwhmToFwhm(gaussianHwhm),
    }
  })
}
