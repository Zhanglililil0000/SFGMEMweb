from typing import List, Optional

import json

import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import os

from memnum import memnum
from spectral_utils import (
    MAX_MEM_CALCULATION_POINTS,
    parse_csv_file,
    get_intensity_column,
    apply_phase_rotation,
    resample_spectrum_for_mem,
)
from sfg_generator import compute_sfg_spectrum

app = FastAPI(title="MEM Analyzer API")
DEFAULT_EDGE_PADDING_WIDTH = 1000.0

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


class PhaseRequest(BaseModel):
    phase_angle: float
    real_part: List[float]
    imag_part: List[float]


class SfgGenerateRequest(BaseModel):
    xmin: float
    xmax: float
    npoints: int
    nr_real: float
    nr_imag: float
    peaks: List[dict] = []


def collect_sfg_peak_parameters(peaks: List[dict]):
    raw_params = []
    phases = []
    peak_options = []
    for peak in peaks:
        profile_type = str(peak.get("profile_type", "lorentzian")).lower()
        gaussian_fwhm = float(peak.get("gaussian_fwhm", 0.0))
        raw_params.extend([
            float(peak.get("amplitude", 1.0)),
            float(peak.get("center", 3000.0)),
            float(peak.get("width", 10.0)),
        ])
        phases.append(float(peak.get("phase", 0.0)))
        peak_options.append({
            "profile_type": profile_type,
            "gaussian_fwhm": gaussian_fwhm,
        })
    return raw_params, phases, peak_options


def parse_mem_points(value: Optional[str], default_value: int) -> int:
    if value is None:
        parsed = default_value
    else:
        text = value.strip()
        if text == "":
            raise HTTPException(status_code=422, detail="MEM calculation points cannot be empty")
        if not text.isdigit():
            raise HTTPException(status_code=422, detail="MEM calculation points must be a positive integer")
        parsed = int(text)
    if parsed < 3:
        raise HTTPException(status_code=422, detail="MEM calculation points must be at least 3")
    if parsed > MAX_MEM_CALCULATION_POINTS:
        raise HTTPException(
            status_code=422,
            detail=f"MEM calculation points must not exceed {MAX_MEM_CALCULATION_POINTS}",
        )
    return parsed


def parse_bool_form(value: Optional[str]) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_padding_width(value: Optional[str], label: str, default_value: float = 0.0) -> float:
    if value is None or value.strip() == "":
        return default_value
    try:
        parsed = float(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{label} must be a finite number")
    if not np.isfinite(parsed):
        raise HTTPException(status_code=422, detail=f"{label} must be a finite number")
    if parsed < 0:
        raise HTTPException(status_code=422, detail=f"{label} must be greater than or equal to 0")
    return parsed


def extract_selected_spectrum(
    wavenumbers: np.ndarray,
    data_matrix: np.ndarray,
    column: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    try:
        selected_intensity = data_matrix[:, column].copy()
    except IndexError:
        raise HTTPException(status_code=422, detail="Data column not found")

    valid_mask = np.isfinite(wavenumbers) & np.isfinite(selected_intensity)
    if int(np.count_nonzero(valid_mask)) < 3:
        raise HTTPException(
            status_code=422,
            detail=(
                "Selected Wavenumber and intensity columns must contain at least 3 numeric rows. "
                "Please check the selected intensity column and ignore unrelated text or empty columns."
            ),
        )

    filtered_wavenumbers = wavenumbers[valid_mask]
    filtered_matrix = data_matrix[valid_mask]
    original_intensity = selected_intensity[valid_mask]
    intensity = get_intensity_column(filtered_matrix, column)
    return filtered_wavenumbers, original_intensity, intensity


@app.post("/api/mem/run")
async def mem_run(
    file: UploadFile = File(...),
    nn: Optional[int] = Form(None),
    mem_points: Optional[str] = Form(None),
    nnout: Optional[str] = Form(None),
    column: Optional[int] = Form(None),
    edge_padding_enabled: Optional[str] = Form(None),
    left_padding_width: Optional[str] = Form(None),
    right_padding_width: Optional[str] = Form(None),
):
    if not file.filename or not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=422, detail="Only CSV files are accepted")

    content = await file.read()

    try:
        wavenumbers, data_matrix, columns_info = parse_csv_file(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if column is None:
        column = 1

    if column < 0 or column >= data_matrix.shape[1]:
        raise HTTPException(status_code=422, detail=f"Invalid column index: {column}")

    wavenumbers, original_intensity, intensity = extract_selected_spectrum(
        wavenumbers,
        data_matrix,
        column,
    )

    N_original = len(intensity)
    _n_mem = parse_mem_points(mem_points if mem_points is not None else nnout, N_original)
    _edge_padding_enabled = parse_bool_form(edge_padding_enabled)
    default_padding_width = DEFAULT_EDGE_PADDING_WIDTH if _edge_padding_enabled else 0.0
    _left_padding_width = parse_padding_width(left_padding_width, "Left padding width", default_padding_width)
    _right_padding_width = parse_padding_width(right_padding_width, "Right padding width", default_padding_width)

    try:
        mem_wavenumbers, mem_intensity, grid_info = resample_spectrum_for_mem(
            wavenumbers,
            intensity,
            _n_mem,
            edge_padding_enabled=_edge_padding_enabled,
            left_padding_width=_left_padding_width,
            right_padding_width=_right_padding_width,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    _nn = nn if nn is not None else min(1024, _n_mem // 2)

    if _nn < 2 or _nn >= _n_mem:
        raise HTTPException(status_code=422, detail=f"NN must be between 2 and N_MEM - 1 ({_n_mem - 1})")

    try:
        SS, chiT, Ft1, ASt1 = memnum(mem_intensity, _nn, _n_mem)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MEM calculation failed: {str(e)}")

    abs_sq = np.abs(chiT) ** 2
    ratio = np.where(abs_sq > 1e-30, mem_intensity / abs_sq, np.nan)
    median_ratio = np.nanmedian(ratio)
    if np.isfinite(median_ratio) and median_ratio > 0:
        rat = np.sqrt(median_ratio)
        chiT = chiT * rat
        SS = np.abs(chiT) ** 2
    else:
        SS = np.abs(chiT) ** 2

    peak_idx = np.argmax(SS)
    eval_indices = np.array(grid_info["evaluation_indices"], dtype=int)

    return {
        "wavenumbers": mem_wavenumbers.tolist(),
        "original_wavenumbers": wavenumbers.tolist(),
        "mem_wavenumbers": mem_wavenumbers.tolist(),
        "evaluation_wavenumbers": mem_wavenumbers[eval_indices].tolist(),
        "original_intensity": original_intensity.tolist(),
        "mem_input_intensity": mem_intensity.tolist(),
        "mem_input_intensity_eval": mem_intensity[eval_indices].tolist(),
        "reconstructed_intensity": SS.tolist(),
        "reconstructed_intensity_eval": SS[eval_indices].tolist(),
        "real_part": np.real(chiT).tolist(),
        "imag_part": np.imag(chiT).tolist(),
        "real_part_eval": np.real(chiT)[eval_indices].tolist(),
        "imag_part_eval": np.imag(chiT)[eval_indices].tolist(),
        "peak_intensity": float(SS[peak_idx]),
        "n_points": int(_n_mem),
        "n_original": int(N_original),
        "n_mem": int(_n_mem),
        "nn": int(_nn),
        "columns_info": columns_info,
        **grid_info,
    }


@app.post("/api/mem/phase")
async def mem_phase(request: PhaseRequest):
    real_arr = np.array(request.real_part)
    imag_arr = np.array(request.imag_part)
    new_real, new_imag = apply_phase_rotation(real_arr, imag_arr, request.phase_angle)
    return {"real_part": new_real, "imag_part": new_imag}


@app.post("/api/mem/compare")
async def mem_compare(
    file: UploadFile = File(...),
    nn: Optional[int] = Form(None),
    mem_points: Optional[str] = Form(None),
    column: Optional[int] = Form(None),
    params_json: str = Form(...),
    edge_padding_enabled: Optional[str] = Form(None),
    left_padding_width: Optional[str] = Form(None),
    right_padding_width: Optional[str] = Form(None),
):
    if not file.filename or not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=422, detail="Only CSV files are accepted")

    try:
        fit_params = json.loads(params_json)
        nr_real = float(fit_params.get("nr_real", 0.0))
        nr_imag = float(fit_params.get("nr_imag", 0.0))
        peaks = fit_params.get("peaks", [])
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid params_json: {str(e)}")

    peak_params, fit_phases, peak_options = collect_sfg_peak_parameters(peaks)
    fitting_raw_params = [nr_real, nr_imag, *peak_params]

    content = await file.read()

    try:
        wavenumbers, data_matrix, columns_info = parse_csv_file(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if column is None:
        column = 1

    if column < 0 or column >= data_matrix.shape[1]:
        raise HTTPException(status_code=422, detail=f"Invalid column index: {column}")

    wavenumbers, original_intensity, intensity = extract_selected_spectrum(
        wavenumbers,
        data_matrix,
        column,
    )

    N_original = len(intensity)
    _n_mem = parse_mem_points(mem_points, N_original)
    _edge_padding_enabled = parse_bool_form(edge_padding_enabled)
    default_padding_width = DEFAULT_EDGE_PADDING_WIDTH if _edge_padding_enabled else 0.0
    _left_padding_width = parse_padding_width(left_padding_width, "Left padding width", default_padding_width)
    _right_padding_width = parse_padding_width(right_padding_width, "Right padding width", default_padding_width)

    try:
        mem_wavenumbers, mem_intensity, grid_info = resample_spectrum_for_mem(
            wavenumbers,
            intensity,
            _n_mem,
            edge_padding_enabled=_edge_padding_enabled,
            left_padding_width=_left_padding_width,
            right_padding_width=_right_padding_width,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    _nn = nn if nn is not None else min(1024, _n_mem // 2)

    if _nn < 2 or _nn >= _n_mem:
        raise HTTPException(status_code=422, detail=f"NN must be between 2 and N_MEM - 1 ({_n_mem - 1})")

    try:
        SS, chiT, Ft1, ASt1 = memnum(mem_intensity, _nn, _n_mem)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MEM calculation failed: {str(e)}")

    abs_sq = np.abs(chiT) ** 2
    ratio = np.where(abs_sq > 1e-30, mem_intensity / abs_sq, np.nan)
    median_ratio = np.nanmedian(ratio)
    if np.isfinite(median_ratio) and median_ratio > 0:
        rat = np.sqrt(median_ratio)
        chiT = chiT * rat

    try:
        fit_intensity, fit_real, fit_imag, _, _ = compute_sfg_spectrum(
            mem_wavenumbers,
            fitting_raw_params,
            phases=fit_phases,
            peak_options=peak_options,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ideal spectrum from peak parameters calculation failed: {str(e)}")

    eval_indices = np.array(grid_info["evaluation_indices"], dtype=int)

    return {
        "wavenumbers": mem_wavenumbers.tolist(),
        "original_wavenumbers": wavenumbers.tolist(),
        "mem_wavenumbers": mem_wavenumbers.tolist(),
        "evaluation_wavenumbers": mem_wavenumbers[eval_indices].tolist(),
        "original_intensity": original_intensity.tolist(),
        "import_intensity": mem_intensity.tolist(),
        "mem_input_intensity": mem_intensity.tolist(),
        "mem_input_intensity_eval": mem_intensity[eval_indices].tolist(),
        "fitting_intensity": fit_intensity.tolist(),
        "fitting_intensity_eval": fit_intensity[eval_indices].tolist(),
        "mem_real": np.real(chiT).tolist(),
        "mem_imag": np.imag(chiT).tolist(),
        "mem_real_eval": np.real(chiT)[eval_indices].tolist(),
        "mem_imag_eval": np.imag(chiT)[eval_indices].tolist(),
        "fitting_real": fit_real.tolist(),
        "fitting_imag": fit_imag.tolist(),
        "fitting_real_eval": fit_real[eval_indices].tolist(),
        "fitting_imag_eval": fit_imag[eval_indices].tolist(),
        "n_points": int(_n_mem),
        "n_original": int(N_original),
        "n_mem": int(_n_mem),
        "nn": int(_nn),
        "columns_info": columns_info,
        **grid_info,
    }


@app.post("/api/sfg/generate")
async def sfg_generate(request: SfgGenerateRequest):
    if request.xmin >= request.xmax:
        raise HTTPException(status_code=422, detail="xmin must be less than xmax")
    if request.npoints < 10 or request.npoints > 10000:
        raise HTTPException(status_code=422, detail="npoints must be between 10 and 10000")

    peak_params, sfg_phases, peak_options = collect_sfg_peak_parameters(request.peaks)
    params = [request.nr_real, request.nr_imag, *peak_params]

    wavenumbers = np.linspace(request.xmin, request.xmax, request.npoints)

    try:
        intensity, real_part, imag_part, _, sub_components = compute_sfg_spectrum(
            wavenumbers,
            params,
            phases=sfg_phases,
            peak_options=peak_options,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SFG calculation failed: {str(e)}")

    return {
        "wavenumbers": wavenumbers.tolist(),
        "intensity": intensity.tolist(),
        "real_part": real_part.tolist(),
        "imag_part": imag_part.tolist(),
        "sub_components": sub_components,
    }


frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
