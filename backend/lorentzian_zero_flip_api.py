"""JSON-ready orchestration for the Lorentzian zero-flip numerical core."""

import math
from itertools import combinations

import numpy as np

from lorentzian_zero_flip import (
    build_zero_flip_alternative,
    construct_rational_model,
    evaluate_direct,
    reconstruction_metrics,
    zero_records,
)


MAX_FREQUENCY_POINTS = 20000
MAX_EXPLICIT_CONFIGURATIONS = 256


def _complex_value(value):
    value = complex(value)
    return {"real": float(value.real), "imag": float(value.imag)}


def _complex_array(values):
    return [_complex_value(value) for value in np.asarray(values).ravel()]


def _optional_float_array(values, valid_mask=None):
    values = np.asarray(values, dtype=float)
    if valid_mask is None:
        valid_mask = np.isfinite(values)
    else:
        valid_mask = np.asarray(valid_mask, dtype=bool) & np.isfinite(values)
    return [float(value) if valid else None for value, valid in zip(values, valid_mask)]


def _validate_request(request):
    x_min = float(request.get("x_min", 2500.0))
    x_max = float(request.get("x_max", 4000.0))
    if not np.isfinite([x_min, x_max]).all() or x_min >= x_max:
        raise ValueError("x_min and x_max must be finite, with x_min less than x_max")
    npoints = int(request.get("npoints", 2000))
    if npoints < 10 or npoints > MAX_FREQUENCY_POINTS:
        raise ValueError(f"npoints must be between 10 and {MAX_FREQUENCY_POINTS}")

    tolerance_names = (
        "real_zero_tolerance",
        "ratio_threshold",
        "near_distance_tolerance",
        "pole_tolerance",
        "validation_tolerance",
    )
    tolerances = {}
    defaults = {
        "real_zero_tolerance": 1e-8,
        "ratio_threshold": 1e-12,
        "near_distance_tolerance": 1e-7,
        "pole_tolerance": 1e-12,
        "validation_tolerance": 1e-9,
    }
    for name in tolerance_names:
        value = float(request.get(name, defaults[name]))
        if not math.isfinite(value) or value <= 0:
            raise ValueError(f"{name} must be positive and finite")
        tolerances[name] = value

    max_flippable = int(request.get("max_flippable_for_enumeration", 8))
    if max_flippable < 1 or max_flippable > 8:
        raise ValueError("max_flippable_for_enumeration must be between 1 and 8")
    window_margin = float(request.get("enumeration_window_margin", 200.0))
    minimum_phase_effect_deg = float(request.get("minimum_phase_effect_deg", 1.0))
    if not math.isfinite(window_margin) or window_margin < 0:
        raise ValueError("enumeration_window_margin must be non-negative and finite")
    if not math.isfinite(minimum_phase_effect_deg) or minimum_phase_effect_deg < 0:
        raise ValueError("minimum_phase_effect_deg must be non-negative and finite")
    selection = {
        "max_flippable": max_flippable,
        "window_margin": window_margin,
        "minimum_phase_effect_deg": minimum_phase_effect_deg,
    }
    return x_min, x_max, npoints, tolerances, selection


def _phase_effect_deg(zero, frequencies):
    """Measure non-constant phase variation caused by flipping one zero."""
    factor = (frequencies - np.conjugate(zero)) / (frequencies - zero)
    phase = np.unwrap(np.angle(factor))
    centered = phase - np.median(phase)
    return float(np.rad2deg(np.max(np.abs(centered))))


def _rank_enumeration_zeros(records, frequencies, x_min, x_max, selection):
    lower = x_min - selection["window_margin"]
    upper = x_max + selection["window_margin"]
    diagnostics = []
    for record in records:
        zero = record["value"]
        in_window = bool(lower <= zero.real <= upper)
        effect = 0.0 if record["effectively_real"] else _phase_effect_deg(zero, frequencies)
        eligible = (
            not record["effectively_real"]
            and in_window
            and effect >= selection["minimum_phase_effect_deg"]
        )
        diagnostics.append({
            "index": record["index"],
            "in_enumeration_window": in_window,
            "phase_effect_deg": effect,
            "enumeration_eligible": eligible,
            "enumeration_selected": False,
        })
    eligible = sorted(
        (item for item in diagnostics if item["enumeration_eligible"]),
        key=lambda item: (-item["phase_effect_deg"], item["index"]),
    )
    selected_indices = tuple(
        item["index"] for item in eligible[:selection["max_flippable"]]
    )
    selected_set = set(selected_indices)
    for item in diagnostics:
        item["enumeration_selected"] = item["index"] in selected_set
    return diagnostics, selected_indices


def _deduplicate_configurations(configurations):
    unique = []
    seen = set()
    for configuration in configurations:
        normalized = tuple(sorted(set(int(index) for index in configuration)))
        if normalized not in seen:
            seen.add(normalized)
            unique.append(normalized)
    return unique


def _serialize_alternative(alternative):
    ratio_mask = alternative["ratio_mask"]
    comparison = []
    for row in alternative["comparison"]:
        comparison.append({
            **row,
            "original_fitted_complex_amplitude": _complex_value(
                row["original_fitted_complex_amplitude"]
            ),
            "alternative_fitted_complex_amplitude": _complex_value(
                row["alternative_fitted_complex_amplitude"]
            ),
        })

    flipped = []
    for index in alternative["flipped_zero_indices"]:
        flipped.append({
            "index": int(index),
            "id": f"z{index + 1}",
            "original": _complex_value(alternative["original_zeros"][index]),
            "reflected": _complex_value(alternative["alternative_zeros"][index]),
        })

    return {
        "configuration_id": alternative["configuration_id"],
        "flipped_zero_indices": list(alternative["flipped_zero_indices"]),
        "flipped_zeros": flipped,
        "numerator_coefficients": _complex_array(alternative["numerator"]),
        "denominator_coefficients": _complex_array(alternative["denominator"]),
        "zeros": _complex_array(alternative["alternative_zeros"]),
        "poles": _complex_array(alternative["poles"]),
        "c0": _complex_value(alternative["c0"]),
        "fitted_complex_amplitudes": _complex_array(alternative["fitted_amplitudes"]),
        "amplitudes": np.asarray(alternative["amplitudes"], dtype=float).tolist(),
        "phases_deg": np.asarray(alternative["phases_deg"], dtype=float).tolist(),
        "comparison": comparison,
        "real_part": np.real(alternative["alternative_chi"]).tolist(),
        "imag_part": np.imag(alternative["alternative_chi"]).tolist(),
        "intensity": np.asarray(alternative["alternative_intensity"], dtype=float).tolist(),
        "ratio_magnitude": _optional_float_array(np.abs(alternative["ratio"]), ratio_mask),
        "phase_difference_rad": _optional_float_array(
            alternative["phase_difference_rad"], ratio_mask
        ),
        "phase_difference_unwrapped_rad": _optional_float_array(
            alternative["phase_difference_unwrapped_rad"], ratio_mask
        ),
        "ratio_defined": np.asarray(ratio_mask, dtype=bool).tolist(),
        "metrics": {
            "max_intensity_error": alternative["max_intensity_error"],
            "normalized_rms_intensity_error": alternative["normalized_rms_intensity_error"],
            "max_ratio_magnitude_error": alternative["max_ratio_magnitude_error"],
            "partial_fraction_max_abs_error": alternative["partial_fraction_max_abs_error"],
            "partial_fraction_normalized_rms_error": alternative[
                "partial_fraction_normalized_rms_error"
            ],
        },
        "numerically_valid": alternative["numerically_valid"],
        "warnings": list(alternative["warnings"]),
    }


def analyze_lorentzian_zero_flip(request):
    """Construct a model and optionally return selected or enumerated alternatives."""
    x_min, x_max, npoints, tolerances, selection = _validate_request(request)
    model = construct_rational_model(
        complex(float(request.get("c0_real", 0.0)), float(request.get("c0_imag", 0.0))),
        request.get("oscillators", []),
        near_distance_tolerance=tolerances["near_distance_tolerance"],
    )
    frequencies = np.linspace(x_min, x_max, npoints)
    original_chi = evaluate_direct(
        frequencies, model.c0, model.fitted_amplitudes, model.poles
    )
    original_reconstruction = reconstruction_metrics(model, frequencies)

    records = zero_records(model, tolerances["real_zero_tolerance"])
    enumeration_diagnostics, enumeration_indices = _rank_enumeration_zeros(
        records, frequencies, x_min, x_max, selection
    )
    diagnostics_by_index = {item["index"]: item for item in enumeration_diagnostics}
    serialized_zeros = [{
        "index": record["index"],
        "id": record["id"],
        **_complex_value(record["value"]),
        "abs_chi_direct": record["abs_chi_direct"],
        "effectively_real": record["effectively_real"],
        "flippable": not record["effectively_real"],
        **diagnostics_by_index[record["index"]],
    } for record in records]

    configurations = list(request.get("flip_configurations", []))
    if bool(request.get("enumerate_all", False)):
        configurations.extend(
            combination
            for size in range(1, len(enumeration_indices) + 1)
            for combination in combinations(enumeration_indices, size)
        )
    configurations = _deduplicate_configurations(configurations)
    if len(configurations) > MAX_EXPLICIT_CONFIGURATIONS:
        raise ValueError(
            f"At most {MAX_EXPLICIT_CONFIGURATIONS} zero-flip configurations may be returned per request"
        )

    alternatives = []
    for configuration in configurations:
        alternative = build_zero_flip_alternative(
            model,
            configuration,
            frequencies,
            real_zero_tolerance=tolerances["real_zero_tolerance"],
            ratio_threshold=tolerances["ratio_threshold"],
            pole_tolerance=tolerances["pole_tolerance"],
            validation_tolerance=tolerances["validation_tolerance"],
        )
        alternatives.append(_serialize_alternative(alternative))

    warnings = list(model.warnings)
    flippable_count = sum(1 for zero in serialized_zeros if zero["flippable"])
    possible_configuration_count = 2 ** flippable_count - 1
    enumeration_configuration_count = 2 ** len(enumeration_indices) - 1
    if possible_configuration_count > 64:
        warnings.append(
            f"The model has {possible_configuration_count} possible non-empty zero-flip combinations; "
            f"ranked enumeration will use {len(enumeration_indices)} zeros "
            f"({enumeration_configuration_count} alternatives)."
        )

    return {
        "convention": {
            "response": "chi(z) = C0 + sum(D_q / (p_q - z))",
            "fitted_complex_amplitude": "D_q = A_q * exp(i * phi_q)",
            "pole": "p_q = omega_q - i * Gamma_q",
            "conventional_residue": "R_q = P(p_q) / Q'(p_q) = -D_q",
            "recovery": "D_q = -P(p_q) / Q'(p_q)",
        },
        "frequency": frequencies.tolist(),
        "original": {
            "c0": _complex_value(model.c0),
            "fitted_complex_amplitudes": _complex_array(model.fitted_amplitudes),
            "poles": _complex_array(model.poles),
            "zeros": serialized_zeros,
            "numerator_coefficients": _complex_array(model.numerator),
            "denominator_coefficients": _complex_array(model.denominator),
            "real_part": np.real(original_chi).tolist(),
            "imag_part": np.imag(original_chi).tolist(),
            "intensity": (np.abs(original_chi) ** 2).tolist(),
            "reconstruction": original_reconstruction,
        },
        "flippable_zero_count": flippable_count,
        "possible_configuration_count": possible_configuration_count,
        "enumeration_flippable_zero_count": len(enumeration_indices),
        "enumeration_configuration_count": enumeration_configuration_count,
        "enumeration_selection": selection,
        "alternatives": alternatives,
        "tolerances": tolerances,
        "warnings": warnings,
    }
