import numpy as np
from scipy.special import wofz


def complex_lorentzian(wavenumbers, center, lorentzian_hwhm):
    """Complex Lorentzian using the existing convention: Gamma is HWHM."""
    return 1.0 / (center - wavenumbers - 1j * lorentzian_hwhm)


def complex_voigt(wavenumbers, center, lorentzian_hwhm, gaussian_fwhm):
    """
    Complex Voigt response from Gaussian broadening of the complex Lorentzian.

    Gaussian width is entered as FWHM and converted to sigma internally.
    This convolves the complex response, not the final intensity |chi|^2.
    As gaussian_fwhm -> 0, the result reduces to complex_lorentzian.
    """
    if gaussian_fwhm <= 0:
        return complex_lorentzian(wavenumbers, center, lorentzian_hwhm)

    sigma = gaussian_fwhm / (2.0 * np.sqrt(2.0 * np.log(2.0)))
    if sigma <= 0:
        return complex_lorentzian(wavenumbers, center, lorentzian_hwhm)

    z = (wavenumbers - center + 1j * lorentzian_hwhm) / (sigma * np.sqrt(2.0))
    return 1j * np.sqrt(np.pi) * wofz(z) / (sigma * np.sqrt(2.0))


def compute_peak_response(wavenumbers, peak):
    profile_type = str(peak.get("profile_type", "lorentzian")).lower()
    amplitude = float(peak.get("amplitude", 1.0))
    center = float(peak.get("center", 3000.0))
    lorentzian_hwhm = float(peak.get("width", 10.0))
    phase = float(peak.get("phase", 0.0))
    gaussian_fwhm = float(peak.get("gaussian_fwhm", 0.0))

    if lorentzian_hwhm <= 0:
        raise ValueError("Lorentzian HWHM Gamma must be greater than 0")
    if gaussian_fwhm < 0:
        raise ValueError("Gaussian FWHM must be non-negative")

    if profile_type == "voigt":
        profile = complex_voigt(wavenumbers, center, lorentzian_hwhm, gaussian_fwhm)
    elif profile_type == "lorentzian":
        profile = complex_lorentzian(wavenumbers, center, lorentzian_hwhm)
    else:
        raise ValueError(f"Unsupported profile_type: {profile_type}")

    return amplitude * np.exp(1j * phase) * profile


def compute_total_chi(wavenumbers, nr_real, nr_imag, peaks):
    chi = np.full_like(wavenumbers, complex(nr_real, nr_imag), dtype=complex)
    chi_peaks = []
    for peak in peaks:
        chi_q = compute_peak_response(wavenumbers, peak)
        chi += chi_q
        chi_peaks.append(chi_q)
    return chi, chi_peaks


def compute_intensity(chi):
    return np.abs(chi) ** 2
