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


@app.post("/api/mem/run")
async def mem_run(
    file: UploadFile = File(...),
    nn: Optional[int] = Form(None),
    mem_points: Optional[str] = Form(None),
    nnout: Optional[str] = Form(None),
    column: Optional[int] = Form(None),
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

    try:
        original_intensity = data_matrix[:, column].copy()
        intensity = get_intensity_column(data_matrix, column)
    except IndexError:
        raise HTTPException(status_code=422, detail="Data column not found")

    N_original = len(intensity)
    _n_mem = parse_mem_points(mem_points if mem_points is not None else nnout, N_original)

    try:
        mem_wavenumbers, mem_intensity, grid_info = resample_spectrum_for_mem(
            wavenumbers,
            intensity,
            _n_mem,
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

    return {
        "wavenumbers": mem_wavenumbers.tolist(),
        "original_wavenumbers": wavenumbers.tolist(),
        "mem_wavenumbers": mem_wavenumbers.tolist(),
        "original_intensity": original_intensity.tolist(),
        "mem_input_intensity": mem_intensity.tolist(),
        "reconstructed_intensity": SS.tolist(),
        "real_part": np.real(chiT).tolist(),
        "imag_part": np.imag(chiT).tolist(),
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

    try:
        original_intensity = data_matrix[:, column].copy()
        intensity = get_intensity_column(data_matrix, column)
    except IndexError:
        raise HTTPException(status_code=422, detail="Data column not found")

    N_original = len(intensity)
    _n_mem = parse_mem_points(mem_points, N_original)

    try:
        mem_wavenumbers, mem_intensity, grid_info = resample_spectrum_for_mem(
            wavenumbers,
            intensity,
            _n_mem,
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

    return {
        "wavenumbers": mem_wavenumbers.tolist(),
        "original_wavenumbers": wavenumbers.tolist(),
        "mem_wavenumbers": mem_wavenumbers.tolist(),
        "original_intensity": original_intensity.tolist(),
        "import_intensity": mem_intensity.tolist(),
        "mem_input_intensity": mem_intensity.tolist(),
        "fitting_intensity": fit_intensity.tolist(),
        "mem_real": np.real(chiT).tolist(),
        "mem_imag": np.imag(chiT).tolist(),
        "fitting_real": fit_real.tolist(),
        "fitting_imag": fit_imag.tolist(),
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
