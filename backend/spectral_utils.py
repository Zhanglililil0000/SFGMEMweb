import numpy as np
import pandas as pd
from io import BytesIO

MAX_MEM_CALCULATION_POINTS = 20000
MIN_EVALUATION_POINTS = 3


def parse_csv_file(file_content: bytes) -> tuple:
    try:
        df = pd.read_csv(BytesIO(file_content), comment="#")
    except Exception:
        raise ValueError("Unable to parse file as CSV")

    has_header = True
    try:
        float(df.columns[0])
        has_header = False
    except (ValueError, TypeError):
        has_header = True

    if not has_header:
        try:
            df = pd.read_csv(BytesIO(file_content), header=None, comment="#")
        except Exception:
            raise ValueError("Unable to parse file as CSV")

    columns_info = []
    if has_header:
        for i, col in enumerate(df.columns):
            columns_info.append({"index": i, "name": str(col)})
    else:
        for i in range(df.shape[1]):
            columns_info.append({"index": i, "name": f"Column {i + 1}"})

    freq_col = df.columns[0]
    df[freq_col] = pd.to_numeric(df[freq_col], errors="coerce")
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=[freq_col])
    df = df.sort_values(freq_col, ascending=True)
    df = df.astype(float)

    wavenumbers = df.iloc[:, 0].values.astype(np.float64)
    return wavenumbers, df.values.astype(np.float64), columns_info


def get_intensity_column(data: np.ndarray, column_index: int = 1) -> np.ndarray:
    intensities = data[:, column_index].copy()
    intensities = np.where(intensities <= 0, 1e-9, intensities)
    return intensities


def is_uniform_grid(wavenumbers: np.ndarray) -> bool:
    if len(wavenumbers) < 3:
        return True
    steps = np.diff(wavenumbers)
    return bool(np.allclose(steps, steps[0], rtol=1e-5, atol=1e-8))


def _unique_interpolation_source(wavenumbers: np.ndarray, intensity: np.ndarray) -> tuple:
    unique_w, inverse = np.unique(wavenumbers, return_inverse=True)
    if len(unique_w) == len(wavenumbers):
        return wavenumbers, intensity

    sums = np.zeros(len(unique_w), dtype=np.float64)
    counts = np.zeros(len(unique_w), dtype=np.float64)
    np.add.at(sums, inverse, intensity)
    np.add.at(counts, inverse, 1)
    return unique_w, sums / counts


def _indices_in_range(wavenumbers: np.ndarray, start: float, end: float) -> np.ndarray:
    range_width = max(abs(end - start), 1.0)
    tolerance = range_width * 1e-9
    return np.where((wavenumbers >= start - tolerance) & (wavenumbers <= end + tolerance))[0]


def resample_spectrum_for_mem(
    wavenumbers: np.ndarray,
    intensity: np.ndarray,
    mem_points: int,
    edge_padding_enabled: bool = False,
    left_padding_width: float = 0.0,
    right_padding_width: float = 0.0,
) -> tuple:
    original_points = len(wavenumbers)
    if original_points != len(intensity):
        raise ValueError("Original frequency and intensity arrays must have the same length")
    if original_points < 3:
        raise ValueError("At least 3 original points are required for MEM calculation")
    if mem_points < 3:
        raise ValueError("MEM calculation points must be at least 3")
    if mem_points > MAX_MEM_CALCULATION_POINTS:
        raise ValueError(f"MEM calculation points must not exceed {MAX_MEM_CALCULATION_POINTS}")
    if not np.all(np.isfinite(wavenumbers)) or not np.all(np.isfinite(intensity)):
        raise ValueError("Original frequency and intensity arrays must contain only finite values")
    if np.any(np.diff(wavenumbers) < 0):
        raise ValueError("Original frequency axis must be monotonically increasing")
    if left_padding_width < 0 or right_padding_width < 0:
        raise ValueError("Edge padding widths must be greater than or equal to 0")

    start = float(wavenumbers[0])
    end = float(wavenumbers[-1])
    if not np.isfinite(start) or not np.isfinite(end) or start == end:
        raise ValueError("Original frequency range is invalid")

    original_uniform = is_uniform_grid(wavenumbers)
    padding_active = bool(edge_padding_enabled and (left_padding_width > 0 or right_padding_width > 0))

    if padding_active:
        source_w, source_i = _unique_interpolation_source(wavenumbers, intensity)
        if len(source_w) < 2:
            raise ValueError("At least 2 unique frequency points are required for interpolation")

        padded_start = start - float(left_padding_width)
        padded_end = end + float(right_padding_width)
        if not np.isfinite(padded_start) or not np.isfinite(padded_end) or padded_start >= padded_end:
            raise ValueError("Padded MEM frequency range is invalid")

        mem_wavenumbers = np.linspace(padded_start, padded_end, mem_points)
        mem_intensity = np.empty_like(mem_wavenumbers)
        regions = np.full(mem_points, "original", dtype=object)

        left_mask = mem_wavenumbers < start
        right_mask = mem_wavenumbers > end
        original_mask = ~(left_mask | right_mask)

        mem_intensity[left_mask] = intensity[0]
        mem_intensity[right_mask] = intensity[-1]
        mem_intensity[original_mask] = np.interp(mem_wavenumbers[original_mask], source_w, source_i)

        regions[left_mask] = "left_padding"
        regions[right_mask] = "right_padding"
        method = (
            f"Edge padding enabled: resampled {original_points} original points to "
            f"{mem_points} MEM points over padded range"
        )
    elif mem_points == original_points and original_uniform:
        mem_wavenumbers = wavenumbers.copy()
        mem_intensity = intensity.copy()
        regions = np.full(mem_points, "original", dtype=object)
        method = "Direct use of original grid"
    else:
        source_w, source_i = _unique_interpolation_source(wavenumbers, intensity)
        if len(source_w) < 2:
            raise ValueError("At least 2 unique frequency points are required for interpolation")

        mem_wavenumbers = np.linspace(start, end, mem_points)
        mem_intensity = np.interp(mem_wavenumbers, source_w, source_i)
        regions = np.full(mem_points, "original", dtype=object)
        if mem_points > original_points:
            method = f"Interpolated from {original_points} to {mem_points} points"
        elif mem_points < original_points:
            method = f"Resampled from {original_points} to {mem_points} points"
        else:
            method = f"Resampled non-uniform original grid to {mem_points} uniform MEM points"

    mem_intensity = np.where(mem_intensity <= 0, 1e-9, mem_intensity)
    evaluation_indices = _indices_in_range(mem_wavenumbers, start, end)
    if len(evaluation_indices) < MIN_EVALUATION_POINTS:
        raise ValueError(
            "Original evaluation range must contain at least 3 MEM grid points; "
            "increase N_MEM or reduce edge padding widths"
        )

    padded_range = [float(mem_wavenumbers[0]), float(mem_wavenumbers[-1])]
    info = {
        "n_original": int(original_points),
        "n_mem": int(mem_points),
        "n_eval": int(len(evaluation_indices)),
        "original_frequency_range": [start, end],
        "mem_frequency_range": padded_range,
        "padded_frequency_range": padded_range,
        "evaluation_frequency_range": [start, end],
        "edge_padding_enabled": bool(padding_active),
        "left_padding_width": float(left_padding_width if padding_active else 0.0),
        "right_padding_width": float(right_padding_width if padding_active else 0.0),
        "evaluation_indices": evaluation_indices.astype(int).tolist(),
        "mem_regions": regions.tolist(),
        "left_padding_points": int(np.count_nonzero(regions == "left_padding")),
        "original_region_points": int(np.count_nonzero(regions == "original")),
        "right_padding_points": int(np.count_nonzero(regions == "right_padding")),
        "resampling_method": method,
        "original_grid_uniform": original_uniform,
        "resampling_note": (
            "Edge padding uses constant endpoint intensities and does not add new spectral information. "
            "Residual and NRMSE are evaluated only over the original spectrum range."
            if padding_active
            else "Increasing MEM calculation points by interpolation does not add new spectral information."
        ),
    }
    return mem_wavenumbers, mem_intensity, info


def apply_phase_rotation(real_part: np.ndarray, imag_part: np.ndarray, phase_angle: float) -> tuple:
    chi = real_part + 1j * imag_part
    chi_rotated = chi * np.exp(1j * phase_angle)
    return np.real(chi_rotated).tolist(), np.imag(chi_rotated).tolist()


def format_export_csv(wavenumbers: np.ndarray, real_part: np.ndarray, imag_part: np.ndarray) -> str:
    lines = ["Wavenumber,Re_Chi,Im_Chi"]
    for w, r, i in zip(wavenumbers, real_part, imag_part):
        lines.append(f"{w:.6f},{r:.8e},{i:.8e}")
    return "\n".join(lines)
