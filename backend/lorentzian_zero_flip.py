"""Exact rational zero-flip analysis for finite Lorentzian SFG models.

The fitting convention is

    chi(z) = C0 + sum_q D_q / (p_q - z),
    D_q = A_q exp(i phi_q),
    p_q = omega_q - i Gamma_q.

For chi=P/Q, the conventional residue at p_q is P(p_q)/Q'(p_q)=-D_q.
This module reports and recovers the fitted complex amplitude D_q.
"""

from dataclasses import dataclass
from itertools import combinations
import math

import numpy as np


COMPLEX_DTYPE = np.complex128


@dataclass(frozen=True)
class LorentzianOscillator:
    amplitude: float
    phase_deg: float
    center: float
    lorentzian_hwhm: float

    @property
    def complex_amplitude(self):
        return complex(self.amplitude * np.exp(1j * np.deg2rad(self.phase_deg)))

    @property
    def pole(self):
        return complex(self.center, -self.lorentzian_hwhm)


@dataclass(frozen=True)
class RationalLorentzianModel:
    c0: complex
    oscillators: tuple
    fitted_amplitudes: np.ndarray
    poles: np.ndarray
    numerator: np.ndarray
    denominator: np.ndarray
    zeros: np.ndarray
    warnings: tuple


def _as_oscillator(value, index):
    if isinstance(value, LorentzianOscillator):
        oscillator = value
    else:
        try:
            oscillator = LorentzianOscillator(
                amplitude=float(value["amplitude"]),
                phase_deg=float(value.get("phase_deg", 0.0)),
                center=float(value["center"]),
                lorentzian_hwhm=float(value.get("lorentzian_hwhm", value.get("width"))),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Oscillator {index} has invalid Lorentzian parameters") from exc

    values = (
        oscillator.amplitude,
        oscillator.phase_deg,
        oscillator.center,
        oscillator.lorentzian_hwhm,
    )
    if not np.isfinite(values).all():
        raise ValueError(f"Oscillator {index} parameters must be finite")
    if oscillator.amplitude < 0:
        raise ValueError(f"Oscillator {index} amplitude must be non-negative")
    if oscillator.lorentzian_hwhm <= 0:
        raise ValueError(f"Oscillator {index} Lorentzian HWHM must be greater than zero")
    return oscillator


def _multiply_factors(factors):
    result = np.array([1.0 + 0.0j], dtype=COMPLEX_DTYPE)
    for factor in factors:
        result = np.polymul(result, factor).astype(COMPLEX_DTYPE)
    return result


def _add_aligned(left, right):
    size = max(left.size, right.size)
    result = np.zeros(size, dtype=COMPLEX_DTYPE)
    result[-left.size:] += left
    result[-right.size:] += right
    return result


def _exact_trim_leading_zeros(coefficients):
    coefficients = np.asarray(coefficients, dtype=COMPLEX_DTYPE)
    nonzero = np.flatnonzero(coefficients != 0)
    if nonzero.size == 0:
        return np.array([0.0 + 0.0j], dtype=COMPLEX_DTYPE)
    return coefficients[nonzero[0]:]


def _sorted_roots(coefficients):
    trimmed = _exact_trim_leading_zeros(coefficients)
    if trimmed.size <= 1:
        return np.array([], dtype=COMPLEX_DTYPE)
    roots = np.roots(trimmed).astype(COMPLEX_DTYPE)
    order = np.lexsort((roots.imag, roots.real))
    return roots[order]


def _coefficient_dynamic_range(coefficients):
    magnitudes = np.abs(coefficients)
    nonzero = magnitudes[magnitudes > 0]
    if nonzero.size < 2:
        return 1.0
    return float(np.max(nonzero) / np.min(nonzero))


def _pair_distances(values):
    values = np.asarray(values, dtype=COMPLEX_DTYPE)
    if values.size < 2:
        return []
    return [
        (i, j, float(abs(values[i] - values[j])))
        for i in range(values.size)
        for j in range(i + 1, values.size)
    ]


def construct_rational_model(c0, oscillators, near_distance_tolerance=1e-7):
    """Construct exact finite polynomial P/Q from Lorentzian fitting parameters."""
    c0 = complex(c0)
    if not np.isfinite([c0.real, c0.imag]).all():
        raise ValueError("C0 must be finite")
    if not np.isfinite(near_distance_tolerance) or near_distance_tolerance <= 0:
        raise ValueError("near_distance_tolerance must be positive and finite")

    normalized = tuple(_as_oscillator(value, index + 1) for index, value in enumerate(oscillators))
    if not normalized:
        raise ValueError("At least one Lorentzian oscillator is required")

    poles = np.asarray([oscillator.pole for oscillator in normalized], dtype=COMPLEX_DTYPE)
    fitted_amplitudes = np.asarray(
        [oscillator.complex_amplitude for oscillator in normalized], dtype=COMPLEX_DTYPE
    )
    factors = [np.array([-1.0 + 0.0j, pole], dtype=COMPLEX_DTYPE) for pole in poles]
    denominator = _multiply_factors(factors)
    numerator = c0 * denominator

    prefix = [np.array([1.0 + 0.0j], dtype=COMPLEX_DTYPE)]
    for factor in factors:
        prefix.append(np.polymul(prefix[-1], factor).astype(COMPLEX_DTYPE))
    suffix = [None] * (len(factors) + 1)
    suffix[-1] = np.array([1.0 + 0.0j], dtype=COMPLEX_DTYPE)
    for index in range(len(factors) - 1, -1, -1):
        suffix[index] = np.polymul(factors[index], suffix[index + 1]).astype(COMPLEX_DTYPE)

    for index, fitted_amplitude in enumerate(fitted_amplitudes):
        quotient = np.polymul(prefix[index], suffix[index + 1]).astype(COMPLEX_DTYPE)
        numerator = _add_aligned(numerator, fitted_amplitude * quotient)

    zeros = _sorted_roots(numerator)
    warnings = []
    for i, j, distance in _pair_distances(poles):
        if distance <= near_distance_tolerance:
            warnings.append(f"Poles {i + 1} and {j + 1} are repeated or nearly repeated (distance={distance:.6g}).")
    for i, j, distance in _pair_distances(zeros):
        if distance <= near_distance_tolerance:
            warnings.append(f"Zeros {i + 1} and {j + 1} are repeated or nearly repeated (distance={distance:.6g}).")
    for zero_index, zero in enumerate(zeros):
        distances = np.abs(poles - zero)
        if distances.size and float(np.min(distances)) <= near_distance_tolerance:
            pole_index = int(np.argmin(distances))
            warnings.append(
                f"Zero {zero_index + 1} nearly cancels pole {pole_index + 1} "
                f"(distance={float(distances[pole_index]):.6g})."
            )

    for label, coefficients in (("Numerator", numerator), ("Denominator", denominator)):
        dynamic_range = _coefficient_dynamic_range(coefficients)
        if dynamic_range > 1e12:
            warnings.append(f"{label} coefficient dynamic range is large ({dynamic_range:.6g}).")

    trimmed_numerator = _exact_trim_leading_zeros(numerator)
    if trimmed_numerator.size < numerator.size:
        warnings.append("Numerator degree is below denominator degree; the high-frequency constant is zero.")

    return RationalLorentzianModel(
        c0=c0,
        oscillators=normalized,
        fitted_amplitudes=fitted_amplitudes,
        poles=poles,
        numerator=numerator,
        denominator=denominator,
        zeros=zeros,
        warnings=tuple(warnings),
    )


def evaluate_direct(z, c0, fitted_amplitudes, poles):
    z_array = np.asarray(z, dtype=COMPLEX_DTYPE)
    chi = np.full(z_array.shape, complex(c0), dtype=COMPLEX_DTYPE)
    for fitted_amplitude, pole in zip(fitted_amplitudes, poles):
        chi += fitted_amplitude / (pole - z_array)
    return chi


def evaluate_rational(z, numerator, denominator):
    z_array = np.asarray(z, dtype=COMPLEX_DTYPE)
    return np.polyval(numerator, z_array) / np.polyval(denominator, z_array)


def normalized_rms_difference(actual, expected, epsilon=1e-15):
    actual = np.asarray(actual)
    expected = np.asarray(expected)
    difference_rms = float(np.sqrt(np.mean(np.abs(actual - expected) ** 2)))
    reference_rms = float(np.sqrt(np.mean(np.abs(expected) ** 2)))
    return difference_rms / max(reference_rms, epsilon)


def reconstruction_metrics(model, frequencies):
    direct = evaluate_direct(frequencies, model.c0, model.fitted_amplitudes, model.poles)
    rational = evaluate_rational(frequencies, model.numerator, model.denominator)
    return {
        "max_abs_complex_error": float(np.max(np.abs(rational - direct))),
        "normalized_rms_complex_error": normalized_rms_difference(rational, direct),
    }


def recover_partial_fractions(numerator, denominator, poles, pole_tolerance=1e-12):
    """Recover C0 and fitted D_q values for simple poles using D=-P(p)/Q'(p)."""
    numerator = np.asarray(numerator, dtype=COMPLEX_DTYPE)
    denominator = np.asarray(denominator, dtype=COMPLEX_DTYPE)
    poles = np.asarray(poles, dtype=COMPLEX_DTYPE)
    if any(distance <= pole_tolerance for _, _, distance in _pair_distances(poles)):
        raise ValueError("Simple-pole recovery is undefined for repeated or nearly repeated poles")

    numerator_trimmed = _exact_trim_leading_zeros(numerator)
    denominator_trimmed = _exact_trim_leading_zeros(denominator)
    numerator_degree = numerator_trimmed.size - 1
    denominator_degree = denominator_trimmed.size - 1
    if numerator_degree > denominator_degree:
        raise ValueError("Improper rational response cannot be represented by a constant plus simple Lorentzians")
    c0 = (
        complex(numerator_trimmed[0] / denominator_trimmed[0])
        if numerator_degree == denominator_degree
        else 0.0 + 0.0j
    )

    derivative = np.polyder(denominator_trimmed)
    derivative_values = np.polyval(derivative, poles)
    scale = max(float(np.max(np.abs(derivative_values))), 1.0)
    if np.any(np.abs(derivative_values) <= pole_tolerance * scale):
        raise ValueError("Q'(p) is too small for stable simple-pole recovery")
    fitted_amplitudes = -np.polyval(numerator_trimmed, poles) / derivative_values
    if not np.isfinite(fitted_amplitudes.real).all() or not np.isfinite(fitted_amplitudes.imag).all():
        raise ValueError("Recovered fitted complex amplitudes are not finite")
    return c0, fitted_amplitudes.astype(COMPLEX_DTYPE)


def phase_deg(values):
    return np.rad2deg(np.angle(values))


def wrapped_phase_change_deg(alternative_phase, original_phase):
    return (np.asarray(alternative_phase) - np.asarray(original_phase) + 180.0) % 360.0 - 180.0


def unwrap_masked_phase(phase, valid_mask):
    """Unwrap each contiguous valid phase segment without bridging masked gaps."""
    phase = np.asarray(phase, dtype=float)
    valid_mask = np.asarray(valid_mask, dtype=bool)
    if phase.shape != valid_mask.shape:
        raise ValueError("phase and valid_mask must have the same shape")
    unwrapped = np.full(phase.shape, np.nan, dtype=float)
    valid_indices = np.flatnonzero(valid_mask)
    if valid_indices.size == 0:
        return unwrapped
    split_points = np.flatnonzero(np.diff(valid_indices) > 1) + 1
    for segment in np.split(valid_indices, split_points):
        unwrapped[segment] = np.unwrap(phase[segment])
    return unwrapped


def zero_records(model, real_zero_tolerance=1e-8):
    if not np.isfinite(real_zero_tolerance) or real_zero_tolerance < 0:
        raise ValueError("real_zero_tolerance must be non-negative and finite")
    records = []
    for index, zero in enumerate(model.zeros):
        direct_value = evaluate_direct(zero, model.c0, model.fitted_amplitudes, model.poles)
        records.append({
            "index": index,
            "id": f"z{index + 1}",
            "value": complex(zero),
            "abs_chi_direct": float(abs(complex(np.asarray(direct_value).item()))),
            "effectively_real": bool(abs(zero.imag) <= real_zero_tolerance),
        })
    return records


def flippable_zero_indices(model, real_zero_tolerance=1e-8):
    return tuple(
        record["index"] for record in zero_records(model, real_zero_tolerance)
        if not record["effectively_real"]
    )


def enumerate_flip_configurations(model, real_zero_tolerance=1e-8, max_flippable=10):
    indices = flippable_zero_indices(model, real_zero_tolerance)
    if len(indices) > max_flippable:
        raise ValueError(
            f"Refusing to enumerate {2 ** len(indices) - 1} zero-flip combinations; "
            f"the configured limit is {max_flippable} flippable zeros"
        )
    return [
        combination
        for size in range(1, len(indices) + 1)
        for combination in combinations(indices, size)
    ]


def _configuration_id(indices):
    return "flip-" + "-".join(f"z{index + 1}" for index in indices)


def _rebuild_numerator_with_flips(numerator, zeros, flip_indices):
    trimmed = _exact_trim_leading_zeros(numerator)
    if trimmed.size <= 1:
        raise ValueError("The numerator has no finite zeros to flip")
    new_roots = np.asarray(zeros, dtype=COMPLEX_DTYPE).copy()
    for index in flip_indices:
        new_roots[index] = np.conjugate(new_roots[index])
    rebuilt = trimmed[0] * np.poly(new_roots)
    return np.asarray(rebuilt, dtype=COMPLEX_DTYPE), new_roots


def build_zero_flip_alternative(
    model,
    flip_indices,
    frequencies,
    real_zero_tolerance=1e-8,
    ratio_threshold=1e-12,
    pole_tolerance=1e-12,
    validation_tolerance=1e-9,
):
    """Build and validate an exact conjugate-zero-reflected alternative."""
    indices = tuple(sorted(set(int(index) for index in flip_indices)))
    if not indices:
        raise ValueError("At least one zero must be selected")
    if indices[0] < 0 or indices[-1] >= model.zeros.size:
        raise IndexError("Selected zero index is out of range")
    for index in indices:
        if abs(model.zeros[index].imag) <= real_zero_tolerance:
            raise ValueError(f"Zero {index + 1} is effectively real and does not create a distinct alternative")

    numerator, alternative_zeros = _rebuild_numerator_with_flips(
        model.numerator, model.zeros, indices
    )
    c0, fitted_amplitudes = recover_partial_fractions(
        numerator, model.denominator, model.poles, pole_tolerance=pole_tolerance
    )

    frequencies = np.asarray(frequencies, dtype=float)
    if frequencies.ndim != 1 or frequencies.size < 2 or not np.isfinite(frequencies).all():
        raise ValueError("frequencies must be a finite one-dimensional grid with at least two points")
    # Evaluate the displayed spectra through the stable all-pass form. Rebuilding
    # a high-degree polynomial from many numerical roots is ill-conditioned and
    # can create artificial spikes even though a zero flip must preserve |chi|
    # on the real-frequency axis.
    original = evaluate_direct(
        frequencies, model.c0, model.fitted_amplitudes, model.poles
    )
    all_pass = np.ones(frequencies.shape, dtype=COMPLEX_DTYPE)
    for index in indices:
        zero = model.zeros[index]
        all_pass *= (frequencies - np.conjugate(zero)) / (frequencies - zero)
    alternative = original * all_pass
    recovered = evaluate_direct(frequencies, c0, fitted_amplitudes, model.poles)
    original_intensity = np.abs(original) ** 2
    alternative_intensity = np.abs(alternative) ** 2
    intensity_difference = alternative_intensity - original_intensity

    ratio_scale = max(float(np.max(np.abs(original))), 1.0)
    ratio_mask = np.abs(original) > ratio_threshold * ratio_scale
    ratio = np.full(original.shape, np.nan + 1j * np.nan, dtype=COMPLEX_DTYPE)
    ratio[ratio_mask] = alternative[ratio_mask] / original[ratio_mask]
    phase_difference = np.full(original.shape, np.nan, dtype=float)
    phase_difference[ratio_mask] = np.angle(ratio[ratio_mask])

    partial_fraction_max_error = float(np.max(np.abs(recovered - alternative)))
    partial_fraction_nrmse = normalized_rms_difference(recovered, alternative)
    max_intensity_error = float(np.max(np.abs(intensity_difference)))
    intensity_nrmse = normalized_rms_difference(alternative_intensity, original_intensity)
    max_ratio_magnitude_error = (
        float(np.max(np.abs(np.abs(ratio[ratio_mask]) - 1.0))) if np.any(ratio_mask) else math.nan
    )

    warnings = []
    if not np.all(ratio_mask):
        warnings.append(f"Masked {int(np.count_nonzero(~ratio_mask))} frequencies where |chi_original| is too small.")
    amplitude_scale = max(float(np.max(np.abs(model.fitted_amplitudes))), 1.0)
    if np.any(np.abs(fitted_amplitudes) > amplitude_scale * 1e8):
        warnings.append("At least one recovered fitted amplitude is very large relative to the original model.")
    if partial_fraction_nrmse > validation_tolerance:
        warnings.append("Recovered partial fractions do not reproduce the alternative within tolerance.")

    original_phase = phase_deg(model.fitted_amplitudes)
    alternative_phase = phase_deg(fitted_amplitudes)
    comparison = []
    for index, oscillator in enumerate(model.oscillators):
        comparison.append({
            "oscillator_index": index + 1,
            "center": oscillator.center,
            "lorentzian_hwhm": oscillator.lorentzian_hwhm,
            "original_fitted_complex_amplitude": complex(model.fitted_amplitudes[index]),
            "original_amplitude": float(abs(model.fitted_amplitudes[index])),
            "original_phase_deg": float(original_phase[index]),
            "alternative_fitted_complex_amplitude": complex(fitted_amplitudes[index]),
            "alternative_amplitude": float(abs(fitted_amplitudes[index])),
            "alternative_phase_deg": float(alternative_phase[index]),
            "amplitude_change": float(abs(fitted_amplitudes[index]) - abs(model.fitted_amplitudes[index])),
            "phase_change_deg": float(wrapped_phase_change_deg(alternative_phase[index], original_phase[index])),
        })

    return {
        "configuration_id": _configuration_id(indices),
        "flipped_zero_indices": indices,
        "original_zeros": model.zeros.copy(),
        "alternative_zeros": alternative_zeros,
        "numerator": numerator,
        "denominator": model.denominator.copy(),
        "poles": model.poles.copy(),
        "c0": c0,
        "fitted_amplitudes": fitted_amplitudes,
        "amplitudes": np.abs(fitted_amplitudes),
        "phases_deg": alternative_phase,
        "comparison": comparison,
        "frequencies": frequencies,
        "original_chi": original,
        "alternative_chi": alternative,
        "recovered_chi": recovered,
        "original_intensity": original_intensity,
        "alternative_intensity": alternative_intensity,
        "ratio": ratio,
        "ratio_mask": ratio_mask,
        "phase_difference_rad": phase_difference,
        "phase_difference_unwrapped_rad": unwrap_masked_phase(phase_difference, ratio_mask),
        "max_intensity_error": max_intensity_error,
        "normalized_rms_intensity_error": intensity_nrmse,
        "max_ratio_magnitude_error": max_ratio_magnitude_error,
        "partial_fraction_max_abs_error": partial_fraction_max_error,
        "partial_fraction_normalized_rms_error": partial_fraction_nrmse,
        "numerically_valid": bool(partial_fraction_nrmse <= validation_tolerance),
        "warnings": tuple(warnings),
    }
