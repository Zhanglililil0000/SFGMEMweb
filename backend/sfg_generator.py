import numpy as np

try:
    from spectrum_models import compute_intensity, compute_total_chi
except ImportError:
    from .spectrum_models import compute_intensity, compute_total_chi


def normalize_peak_options(n_peaks, phases=None, peak_options=None):
    if phases is None:
        phases = [0.0] * n_peaks
    elif len(phases) != n_peaks:
        raise ValueError(f"phases length ({len(phases)}) != n_peaks ({n_peaks})")

    normalized = []
    for q in range(n_peaks):
        options = dict(peak_options[q]) if peak_options and q < len(peak_options) else {}
        options.setdefault("profile_type", "lorentzian")
        if "gaussian_hwhm" in options and "gaussian_fwhm" not in options:
            options["gaussian_fwhm"] = 2.0 * float(options["gaussian_hwhm"])
        options.setdefault("gaussian_fwhm", 0.0)
        options.setdefault("gaussian_hwhm", float(options["gaussian_fwhm"]) / 2.0)
        options["phase"] = phases[q]
        normalized.append(options)
    return normalized


def compute_sfg_spectrum(wavenumbers, params, phases=None, peak_options=None):
    """
    Compute SFG spectrum from Lorentzian or Voigt peak parameters.

    Formula:
        chi(omega) = A_NR + sum_q (A_q * e^(i*phi_q) / (omega_q - omega - i*Gamma_q))

    params: [NR_Real, NR_Imag, A1, omega1, Gamma1, A2, omega2, Gamma2, ...].
    Gamma keeps the original project convention: Lorentzian HWHM.
    phases: [phi1, phi2, ...]  — one per peak. If None, all default to 0.
    peak_options: optional profile_type / gaussian_hwhm or gaussian_fwhm metadata per peak.
    """
    if len(params) < 2:
        raise ValueError("Need at least NR_Real and NR_Imag")
    if (len(params) - 2) % 3 != 0:
        raise ValueError(f"Parameter count must be 3n+2, got {len(params)}")

    n_peaks = (len(params) - 2) // 3

    options = normalize_peak_options(n_peaks, phases=phases, peak_options=peak_options)
    peaks = []
    for q in range(n_peaks):
        peak = {
            "amplitude": params[2 + 3 * q],
            "center": params[2 + 3 * q + 1],
            "width": params[2 + 3 * q + 2],
            **options[q],
        }
        peaks.append(peak)

    chi, chi_peaks = compute_total_chi(wavenumbers, params[0], params[1], peaks)
    intensity = compute_intensity(chi)
    real_part = np.real(chi)
    imag_part = np.imag(chi)

    sub_components = []

    nr_intensity = params[0]**2 + params[1]**2
    sub_components.append({
        "label": "NR",
        "intensity": nr_intensity,
        "real": params[0],
        "imag": params[1],
    })

    for q, chi_q in enumerate(chi_peaks):
        sub_q_intensity = np.abs(chi_q) ** 2
        profile_type = peaks[q].get("profile_type", "lorentzian")
        gaussian_fwhm = float(peaks[q].get("gaussian_fwhm", 0.0))
        gaussian_hwhm = float(peaks[q].get("gaussian_hwhm", gaussian_fwhm / 2.0))
        width = float(peaks[q].get("width", 0.0))
        label = f"Peak {q + 1} ({profile_type}, L HWHM={width:g}"
        if profile_type == "voigt":
            label += f", G HWHM={gaussian_hwhm:g}"
        label += ")"
        sub_components.append({
            "label": label,
            "intensity": sub_q_intensity.tolist(),
            "real": np.real(chi_q).tolist(),
            "imag": np.imag(chi_q).tolist(),
        })

    return intensity, real_part, imag_part, chi, sub_components
