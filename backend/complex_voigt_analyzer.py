import math

import numpy as np
from scipy.optimize import root
from scipy.special import wofz


SQRT_TWO = math.sqrt(2.0)
SQRT_PI = math.sqrt(math.pi)
GAUSSIAN_HWHM_TO_SIGMA = 1.0 / math.sqrt(2.0 * math.log(2.0))
MAX_COMPLEX_GRID_POINTS = 120000


def gaussian_hwhm_to_sigma(gaussian_hwhm):
    """Convert Gaussian HWHM to the standard deviation used by Faddeeva w(z)."""
    gaussian_hwhm = float(gaussian_hwhm)
    if gaussian_hwhm <= 0:
        return 0.0
    return gaussian_hwhm * GAUSSIAN_HWHM_TO_SIGMA


def complex_lorentzian_response(z, center, lorentzian_hwhm):
    """
    Complex Lorentzian with the existing project convention.

    L(z) = 1 / (omega0 - z - i Gamma)
         = -1 / (z - omega0 + i Gamma)

    The pole is therefore at z = omega0 - i Gamma, in the lower half-plane.
    """
    return 1.0 / (center - z - 1j * lorentzian_hwhm)


def complex_voigt_response(z, center, lorentzian_hwhm, gaussian_hwhm):
    """
    Complex Voigt response using Gaussian HWHM input converted to sigma.

    The Faddeeva argument follows the same sign convention as the existing SFG
    Voigt implementation:

        u = (z - omega0 + i Gamma) / (sigma * sqrt(2))
        V(z) = i * sqrt(pi) * w(u) / (sigma * sqrt(2))

    With this normalization, V(z) approaches the current Lorentzian convention
    as Gaussian HWHM -> 0.
    """
    sigma = gaussian_hwhm_to_sigma(gaussian_hwhm)
    if sigma <= 0:
        return complex_lorentzian_response(z, center, lorentzian_hwhm)

    u = (z - center + 1j * lorentzian_hwhm) / (sigma * SQRT_TWO)
    return 1j * SQRT_PI * wofz(u) / (sigma * SQRT_TWO)


def _normalize_peak(peak, index):
    profile_type = str(peak.get("profile_type", "voigt")).lower()
    if profile_type not in {"lorentzian", "voigt"}:
        raise ValueError(f"Peak {index}: profile_type must be lorentzian or voigt")

    amplitude = float(peak.get("amplitude", 1.0))
    center = float(peak.get("center", 3200.0))
    lorentzian_hwhm = float(peak.get("lorentzian_hwhm", peak.get("width", 10.0)))
    gaussian_hwhm = float(peak.get("gaussian_hwhm", 0.0))
    phase_deg = float(peak.get("phase_deg", 0.0))

    values = [amplitude, center, lorentzian_hwhm, gaussian_hwhm, phase_deg]
    if not all(np.isfinite(values)):
        raise ValueError(f"Peak {index}: all parameters must be finite numbers")
    if lorentzian_hwhm <= 0:
        raise ValueError(f"Peak {index}: Lorentzian HWHM must be greater than 0")
    if gaussian_hwhm < 0:
        raise ValueError(f"Peak {index}: Gaussian HWHM must be greater than or equal to 0")

    if profile_type == "lorentzian":
        gaussian_hwhm = 0.0

    return {
        "profile_type": profile_type,
        "amplitude": amplitude,
        "center": center,
        "lorentzian_hwhm": lorentzian_hwhm,
        "gaussian_hwhm": gaussian_hwhm,
        "gaussian_sigma": gaussian_hwhm_to_sigma(gaussian_hwhm),
        "phase_deg": phase_deg,
        "phase_rad": math.radians(phase_deg),
    }


def normalize_peaks(peaks):
    if len(peaks) > 20:
        raise ValueError("Peak count must not exceed 20")
    return [_normalize_peak(peak, index + 1) for index, peak in enumerate(peaks)]


def compute_complex_chi(z, nr_real, nr_imag, peaks):
    z_arr = np.asarray(z, dtype=complex)
    chi = np.full(z_arr.shape, complex(nr_real, nr_imag), dtype=complex)
    components = []

    for peak in peaks:
        if peak["profile_type"] == "lorentzian":
            response = complex_lorentzian_response(
                z_arr,
                peak["center"],
                peak["lorentzian_hwhm"],
            )
        else:
            response = complex_voigt_response(
                z_arr,
                peak["center"],
                peak["lorentzian_hwhm"],
                peak["gaussian_hwhm"],
            )
        component = peak["amplitude"] * np.exp(1j * peak["phase_rad"]) * response
        chi = chi + component
        components.append(component)

    return chi, components


def _safe_float_array(values):
    arr = np.asarray(values, dtype=float)
    finite = np.isfinite(arr)
    if finite.all():
        return arr
    finite_abs = np.abs(arr[finite])
    cap = float(np.max(finite_abs)) if finite_abs.size else 1.0
    cap = max(cap, 1.0) * 10.0
    return np.nan_to_num(arr, nan=0.0, posinf=cap, neginf=-cap)


def _safe_magnitude(values):
    mag = np.abs(values)
    finite = np.isfinite(mag)
    if finite.all():
        return mag
    finite_values = mag[finite]
    cap = float(np.max(finite_values)) if finite_values.size else 1.0
    cap = max(cap, 1.0) * 10.0
    return np.nan_to_num(mag, nan=cap, posinf=cap, neginf=cap)


def _find_minima_candidates(x_axis, y_axis, magnitude, max_candidates=36):
    ny, nx = magnitude.shape
    flat_order = np.argsort(magnitude, axis=None)
    min_index_sep = max(2, min(nx, ny) // 45)
    candidates = []

    for flat_index in flat_order:
        iy, ix = np.unravel_index(flat_index, magnitude.shape)
        value = float(magnitude[iy, ix])
        if not np.isfinite(value):
            continue

        too_close = any(
            abs(ix - candidate["ix"]) <= min_index_sep
            and abs(iy - candidate["iy"]) <= min_index_sep
            for candidate in candidates
        )
        if too_close:
            continue

        candidates.append({
            "ix": int(ix),
            "iy": int(iy),
            "x": float(x_axis[ix]),
            "y": float(y_axis[iy]),
            "abs_chi": value,
            "log_abs_chi": float(math.log10(max(value, 1e-300))),
        })
        if len(candidates) >= max_candidates:
            break

    return candidates


def _zero_classification(y_value, zero_axis_tolerance=1e-8):
    if y_value > zero_axis_tolerance:
        return "Upper half-plane zero detected"
    if y_value < -zero_axis_tolerance:
        return "Lower half-plane zero"
    return "Real-axis zero"


def _root_function(point, nr_real, nr_imag, peaks):
    z_value = complex(float(point[0]), float(point[1]))
    chi_value, _ = compute_complex_chi(z_value, nr_real, nr_imag, peaks)
    chi_scalar = complex(np.asarray(chi_value).item())
    if not np.isfinite(chi_scalar.real) or not np.isfinite(chi_scalar.imag):
        return [1e100, 1e100]
    return [chi_scalar.real, chi_scalar.imag]


def find_zeros_from_candidates(
    candidates,
    x_range,
    y_range,
    nr_real,
    nr_imag,
    peaks,
    root_tolerance,
    max_roots,
    scale,
):
    x_min, x_max = x_range
    y_min, y_max = y_range
    x_tol = max((x_max - x_min) * 1e-7, 1e-7)
    y_tol = max((y_max - y_min) * 1e-7, 1e-7)
    duplicate_tol = max(x_tol, y_tol, 1e-5)
    effective_tolerance = max(root_tolerance, scale * 1e-9)
    zeros = []

    for candidate in candidates:
        if len(zeros) >= max_roots:
            break

        solution = root(
            lambda point: _root_function(point, nr_real, nr_imag, peaks),
            [candidate["x"], candidate["y"]],
            method="hybr",
            options={"maxfev": 300},
        )
        x0 = float(solution.x[0])
        y0 = float(solution.x[1])
        if not (np.isfinite(x0) and np.isfinite(y0)):
            continue
        if x0 < x_min - x_tol or x0 > x_max + x_tol or y0 < y_min - y_tol or y0 > y_max + y_tol:
            continue

        chi0, _ = compute_complex_chi(complex(x0, y0), nr_real, nr_imag, peaks)
        chi_scalar = complex(np.asarray(chi0).item())
        residual = abs(chi_scalar)
        if not np.isfinite(residual) or residual > effective_tolerance:
            continue

        duplicate = any(abs(complex(zero["x"] - x0, zero["y"] - y0)) <= duplicate_tol for zero in zeros)
        if duplicate:
            continue

        zeros.append({
            "x": x0,
            "y": y0,
            "real_chi": float(chi_scalar.real),
            "imag_chi": float(chi_scalar.imag),
            "abs_chi": float(residual),
            "classification": _zero_classification(y0),
            "source_seed_x": candidate["x"],
            "source_seed_y": candidate["y"],
            "solver_success": bool(solution.success),
            "solver_message": str(solution.message),
        })

    zeros.sort(key=lambda item: (item["y"], item["x"]), reverse=True)
    return zeros, effective_tolerance


def _validate_range(label, start, end):
    start = float(start)
    end = float(end)
    if not np.isfinite([start, end]).all():
        raise ValueError(f"{label} range values must be finite")
    if start >= end:
        raise ValueError(f"{label} range start must be less than end")
    return start, end


def _validate_count(label, value, minimum, maximum):
    count = int(value)
    if count < minimum or count > maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return count


def analyze_complex_voigt(request):
    x_min, x_max = _validate_range("Real frequency", request.get("x_min", 2500.0), request.get("x_max", 4000.0))
    y_min, y_max = _validate_range("Imaginary frequency", request.get("y_min", -500.0), request.get("y_max", 500.0))
    npoints = _validate_count("Real-frequency points", request.get("npoints", 1000), 10, 10000)
    grid_x = _validate_count("Complex-plane X grid points", request.get("grid_x", 181), 21, 501)
    grid_y = _validate_count("Complex-plane Y grid points", request.get("grid_y", 161), 21, 501)
    if grid_x * grid_y > MAX_COMPLEX_GRID_POINTS:
        raise ValueError(f"Complex-plane grid must not exceed {MAX_COMPLEX_GRID_POINTS} points")

    nr_real = float(request.get("nr_real", 0.0))
    nr_imag = float(request.get("nr_imag", 0.0))
    if not np.isfinite([nr_real, nr_imag]).all():
        raise ValueError("Non-resonant background values must be finite")

    root_tolerance = float(request.get("root_tolerance", 1e-7))
    if not np.isfinite(root_tolerance) or root_tolerance <= 0:
        raise ValueError("Root tolerance must be a positive finite number")
    max_roots = _validate_count("Maximum number of zeros", request.get("max_roots", 12), 1, 50)

    peaks = normalize_peaks(request.get("peaks", []))

    wavenumbers = np.linspace(x_min, x_max, npoints)
    chi_real_axis, _ = compute_complex_chi(wavenumbers, nr_real, nr_imag, peaks)
    intensity = _safe_magnitude(chi_real_axis) ** 2

    x_axis = np.linspace(x_min, x_max, grid_x)
    y_axis = np.linspace(y_min, y_max, grid_y)
    complex_grid = x_axis[None, :] + 1j * y_axis[:, None]
    chi_grid, _ = compute_complex_chi(complex_grid, nr_real, nr_imag, peaks)
    abs_chi = _safe_magnitude(chi_grid)
    log_abs_chi = np.log10(np.maximum(abs_chi, 1e-300))

    minima = _find_minima_candidates(x_axis, y_axis, abs_chi)
    finite_abs = abs_chi[np.isfinite(abs_chi)]
    scale = float(np.median(finite_abs)) if finite_abs.size else 1.0
    scale = max(scale, 1.0)
    zeros, effective_tolerance = find_zeros_from_candidates(
        minima,
        (x_min, x_max),
        (y_min, y_max),
        nr_real,
        nr_imag,
        peaks,
        root_tolerance,
        max_roots,
        scale,
    )

    upper_zero_count = sum(1 for zero in zeros if zero["y"] > 1e-8)
    lower_zero_count = sum(1 for zero in zeros if zero["y"] < -1e-8)
    real_axis_zero_count = len(zeros) - upper_zero_count - lower_zero_count
    if upper_zero_count:
        summary = "Upper half-plane zero detected"
    elif zeros:
        summary = "Lower half-plane zero" if lower_zero_count else "Real-axis zero detected"
    else:
        summary = "No zeros detected in scanned region"

    return {
        "wavenumbers": _safe_float_array(wavenumbers).tolist(),
        "real_part": _safe_float_array(np.real(chi_real_axis)).tolist(),
        "imag_part": _safe_float_array(np.imag(chi_real_axis)).tolist(),
        "intensity": _safe_float_array(intensity).tolist(),
        "complex_plane": {
            "x": _safe_float_array(x_axis).tolist(),
            "y": _safe_float_array(y_axis).tolist(),
            "abs_chi": _safe_float_array(abs_chi).tolist(),
            "log_abs_chi": _safe_float_array(log_abs_chi).tolist(),
            "minima": minima,
        },
        "zeros": zeros,
        "summary": summary,
        "upper_zero_count": upper_zero_count,
        "lower_zero_count": lower_zero_count,
        "real_axis_zero_count": real_axis_zero_count,
        "metadata": {
            "gaussian_input": "Gaussian HWHM",
            "gaussian_conversion": "sigma = Gaussian_HWHM / sqrt(2 ln 2)",
            "lorentzian_convention": "L(z) = 1 / (omega0 - z - i Gamma) = -1 / (z - omega0 + i Gamma)",
            "voigt_convention": "V(z) = i * sqrt(pi) * w((z - omega0 + i Gamma) / (sigma * sqrt(2))) / (sigma * sqrt(2))",
            "pole_convention": "Lorentzian poles lie at z = omega0 - i Gamma",
            "fourier_sign_convention": (
                "This module preserves the existing SFG generator sign convention; "
                "with exp(-i omega t)-style response notation, causal Lorentzian poles "
                "are represented in the lower complex-frequency half-plane."
            ),
            "root_tolerance": root_tolerance,
            "effective_root_tolerance": effective_tolerance,
            "grid_point_count": int(grid_x * grid_y),
        },
        "normalized_peaks": peaks,
    }
