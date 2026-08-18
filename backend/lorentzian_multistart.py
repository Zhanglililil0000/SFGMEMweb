"""Constrained multi-start intensity refitting for finite Lorentzian models."""

from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares


PARAMETER_NAMES = ("nr_real", "nr_imag", "amplitude", "phase_deg", "center", "hwhm")


@dataclass(frozen=True)
class Variable:
    kind: str
    peak: int | None
    reference: float
    lower: float
    upper: float
    scale: float


def evaluate_lorentzian(frequency, nr_real, nr_imag, peaks):
    frequency = np.asarray(frequency, dtype=float)
    chi = np.full(frequency.shape, complex(nr_real, nr_imag), dtype=np.complex128)
    for peak in peaks:
        residue = peak["amplitude"] * np.exp(1j * np.deg2rad(peak["phase_deg"]))
        chi += residue / (peak["center"] - frequency - 1j * peak["hwhm"])
    return chi


def _default_scale(kind, reference, lower, upper):
    floor = {
        "nr_real": 0.01, "nr_imag": 0.01, "amplitude": 0.1,
        "phase_deg": 10.0, "center": 10.0, "hwhm": 2.0,
    }[kind]
    return max((upper - lower) / 2.0, abs(reference) * 0.1, floor)


def _make_variables(reference, free, bounds):
    variables = []
    scalar_values = {"nr_real": reference["nr_real"], "nr_imag": reference["nr_imag"]}
    for kind, value in scalar_values.items():
        if free.get(kind, False):
            lower, upper = map(float, bounds[kind])
            variables.append(Variable(kind, None, float(value), lower, upper, _default_scale(kind, value, lower, upper)))
    for index, peak in enumerate(reference["peaks"]):
        peak_bounds = bounds["peaks"][index]
        for kind in ("amplitude", "phase_deg", "center", "hwhm"):
            if free.get(kind, False):
                value = float(peak[kind])
                lower, upper = map(float, peak_bounds[kind])
                variables.append(Variable(kind, index, value, lower, upper, _default_scale(kind, value, lower, upper)))
    for variable in variables:
        if not np.isfinite([variable.reference, variable.lower, variable.upper, variable.scale]).all():
            raise ValueError("Reference values and bounds must be finite")
        if variable.lower >= variable.upper or not variable.lower <= variable.reference <= variable.upper:
            raise ValueError(f"Invalid bounds for {variable.kind}: reference must lie within lower < upper")
        if variable.kind == "hwhm" and variable.lower <= 0:
            raise ValueError("Every free Lorentzian HWHM lower bound must be greater than zero")
    return variables


def _decode(scaled, reference, variables):
    nr_real, nr_imag = float(reference["nr_real"]), float(reference["nr_imag"])
    peaks = [{key: float(peak[key]) for key in ("amplitude", "phase_deg", "center", "hwhm")} for peak in reference["peaks"]]
    for value, variable in zip(scaled, variables):
        physical = variable.reference + float(value) * variable.scale
        if variable.kind == "nr_real": nr_real = physical
        elif variable.kind == "nr_imag": nr_imag = physical
        else: peaks[variable.peak][variable.kind] = physical
    return {"nr_real": nr_real, "nr_imag": nr_imag, "peaks": peaks}


def _canonical_scaled_vector(parameters, variables):
    values = []
    free_phase_peaks = {item.peak for item in variables if item.kind == "phase_deg"}
    for variable in variables:
        if variable.peak is None:
            physical = parameters[variable.kind]
        else:
            physical = parameters["peaks"][variable.peak][variable.kind]
        reference_value = variable.reference
        if variable.peak is not None and variable.peak in free_phase_peaks:
            amplitude = parameters["peaks"][variable.peak]["amplitude"]
            reference_amplitude = next(item.reference for item in variables if item.peak == variable.peak and item.kind == "amplitude") if any(item.peak == variable.peak and item.kind == "amplitude" for item in variables) else None
            if variable.kind == "amplitude" and reference_amplitude is not None:
                physical, reference_value = abs(physical), abs(reference_value)
            elif variable.kind == "phase_deg":
                physical += -180.0 if amplitude < 0 else 0.0
                if reference_amplitude is not None and reference_amplitude < 0:
                    reference_value += -180.0
        delta = physical - reference_value
        if variable.kind == "phase_deg":
            delta = (delta + 180.0) % 360.0 - 180.0
        values.append(delta / variable.scale)
    return np.asarray(values, dtype=float)


def _wrap_output_phases(parameters):
    output = {"nr_real": parameters["nr_real"], "nr_imag": parameters["nr_imag"], "peaks": [dict(peak) for peak in parameters["peaks"]]}
    for peak in output["peaks"]:
        peak["phase_deg"] = (peak["phase_deg"] + 180.0) % 360.0 - 180.0
        effective = peak["phase_deg"] + (-180.0 if peak["amplitude"] < 0 else 0.0)
        peak["effective_phase_deg"] = (effective + 180.0) % 360.0 - 180.0
    return output


def _metrics(chi, reference_chi, reference_intensity):
    intensity = np.abs(chi) ** 2
    residual = intensity - reference_intensity
    rss = float(np.dot(residual, residual))
    rmse = float(np.sqrt(np.mean(residual ** 2)))
    intensity_scale = max(float(np.sqrt(np.mean(reference_intensity ** 2))), np.finfo(float).eps)
    complex_scale = max(float(np.linalg.norm(reference_chi)), np.finfo(float).eps)
    re_scale = max(float(np.linalg.norm(reference_chi.real)), np.finfo(float).eps)
    im_scale = max(float(np.linalg.norm(reference_chi.imag)), np.finfo(float).eps)
    return {
        "rss": rss,
        "rmse": rmse,
        "nrmse": rmse / intensity_scale,
        "max_abs_intensity_deviation": float(np.max(np.abs(residual))),
        "complex_deviation": float(np.linalg.norm(chi - reference_chi) / complex_scale),
        "real_deviation": float(np.linalg.norm(chi.real - reference_chi.real) / re_scale),
        "imag_deviation": float(np.linalg.norm(chi.imag - reference_chi.imag) / im_scale),
        "intensity": intensity.tolist(),
        "residual": residual.tolist(),
        "real_part": chi.real.tolist(),
        "imag_part": chi.imag.tolist(),
    }


def _cluster(solutions, tolerance):
    representatives = []
    for solution in sorted(solutions, key=lambda item: item["rss"]):
        if any(np.sqrt(np.mean((solution["scaled_vector"] - existing["scaled_vector"]) ** 2)) <= tolerance for existing in representatives):
            continue
        representatives.append(solution)
    return representatives


def run_multistart_refit(request):
    reference = request["reference"]
    if not reference.get("peaks"):
        raise ValueError("At least one Lorentzian peak is required")
    for peak in reference["peaks"]:
        if float(peak["hwhm"]) <= 0:
            raise ValueError("Reference HWHM values must be positive")
    x_min, x_max = float(request["x_min"]), float(request["x_max"])
    npoints = int(request.get("npoints", 1000))
    if not x_min < x_max or npoints < 10 or npoints > 10000:
        raise ValueError("Require x_min < x_max and 10 <= npoints <= 10000")
    n_starts = int(request.get("n_starts", 20))
    if n_starts < 1 or n_starts > 500:
        raise ValueError("n_starts must be between 1 and 500")
    variables = _make_variables(reference, request["free"], request["bounds"])
    if not variables:
        raise ValueError("At least one parameter type must be free")

    frequency = np.linspace(x_min, x_max, npoints)
    reference_chi = evaluate_lorentzian(frequency, reference["nr_real"], reference["nr_imag"], reference["peaks"])
    reference_intensity = np.abs(reference_chi) ** 2
    lower = np.array([(item.lower - item.reference) / item.scale for item in variables])
    upper = np.array([(item.upper - item.reference) / item.scale for item in variables])
    perturbation = request.get("perturbation", {})
    sigma = np.array([float(perturbation.get(item.kind, 0.25)) for item in variables])
    if np.any(sigma < 0) or not np.isfinite(sigma).all():
        raise ValueError("Perturbation scales must be non-negative and finite")
    rng = np.random.default_rng(int(request.get("random_seed", 12345)))

    def residual(scaled):
        parameters = _decode(scaled, reference, variables)
        chi = evaluate_lorentzian(frequency, parameters["nr_real"], parameters["nr_imag"], parameters["peaks"])
        return np.abs(chi) ** 2 - reference_intensity

    converged, failed = [], []
    for start_index in range(n_starts):
        start = np.zeros(len(variables)) if start_index == 0 else np.clip(rng.normal(0.0, sigma), lower, upper)
        try:
            fit = least_squares(residual, start, bounds=(lower, upper), x_scale=1.0, max_nfev=int(request.get("max_nfev", 3000)))
        except Exception as error:
            failed.append({"start_index": start_index, "status": -99, "message": str(error)})
            continue
        if not fit.success or not np.isfinite(fit.x).all() or not np.isfinite(fit.fun).all():
            failed.append({"start_index": start_index, "status": int(fit.status), "message": str(fit.message)})
            continue
        parameters = _decode(fit.x, reference, variables)
        chi = evaluate_lorentzian(frequency, parameters["nr_real"], parameters["nr_imag"], parameters["peaks"])
        canonical_vector = _canonical_scaled_vector(parameters, variables)
        item = {"start_index": start_index, "status": int(fit.status), "message": str(fit.message), "nfev": int(fit.nfev), "parameters": _wrap_output_phases(parameters), "scaled_vector": canonical_vector, "parameter_distance": float(np.sqrt(np.mean(canonical_vector ** 2))), **_metrics(chi, reference_chi, reference_intensity)}
        converged.append(item)

    cluster_tolerance = float(request.get("cluster_tolerance", 1e-3))
    if not np.isfinite(cluster_tolerance) or cluster_tolerance < 0:
        raise ValueError("cluster_tolerance must be non-negative and finite")
    distinct = _cluster(converged, cluster_tolerance)
    if distinct:
        best_rss = min(item["rss"] for item in distinct)
    else:
        best_rss = None
    mode = request.get("acceptance_mode", "nrmse")
    if mode not in ("nrmse", "relative-rss"):
        raise ValueError("acceptance_mode must be 'nrmse' or 'relative-rss'")
    epsilon = float(request.get("relative_rss_epsilon", 0.05))
    nrmse_threshold = float(request.get("nrmse_threshold", 1e-6))
    for item in distinct:
        item["accepted"] = item["nrmse"] <= nrmse_threshold if mode == "nrmse" else item["rss"] <= best_rss * (1.0 + epsilon) + np.finfo(float).eps
        item["scaled_vector"] = item["scaled_vector"].tolist()
    accepted = [item for item in distinct if item["accepted"]]
    return {
        "frequency": frequency.tolist(),
        "reference": {"parameters": _wrap_output_phases(reference), "intensity": reference_intensity.tolist(), "real_part": reference_chi.real.tolist(), "imag_part": reference_chi.imag.tolist()},
        "variable_labels": [f"peak{item.peak + 1}.{item.kind}" if item.peak is not None else item.kind for item in variables],
        "variable_scales": [item.scale for item in variables],
        "converged_count": len(converged), "failed_count": len(failed), "distinct_count": len(distinct), "accepted_count": len(accepted),
        "best_rss": best_rss, "solutions": distinct, "accepted_solutions": accepted, "failed_runs": failed,
    }
