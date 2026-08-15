import math

import numpy as np

from complex_voigt_analyzer import (
    analyze_complex_voigt,
    complex_lorentzian_response,
    complex_voigt_response,
    gaussian_hwhm_to_sigma,
)


def test_gaussian_hwhm_converts_to_sigma():
    hwhm = 80.0
    expected = hwhm / math.sqrt(2.0 * math.log(2.0))
    assert gaussian_hwhm_to_sigma(hwhm) == expected


def test_zero_gaussian_hwhm_matches_lorentzian_convention():
    z = np.array([3000.0 + 0.0j, 3200.0 + 20.0j, 3400.0 - 30.0j])
    lorentzian = complex_lorentzian_response(z, center=3200.0, lorentzian_hwhm=25.0)
    voigt_limit = complex_voigt_response(z, center=3200.0, lorentzian_hwhm=25.0, gaussian_hwhm=0.0)
    np.testing.assert_allclose(voigt_limit, lorentzian)


def test_lorentzian_zero_search_finds_lower_half_plane_zero():
    result = analyze_complex_voigt({
        "x_min": 3000.0,
        "x_max": 3200.0,
        "npoints": 200,
        "y_min": -80.0,
        "y_max": 80.0,
        "grid_x": 121,
        "grid_y": 101,
        "nr_real": 0.1,
        "nr_imag": 0.0,
        "peaks": [{
            "profile_type": "lorentzian",
            "amplitude": 10.0,
            "center": 3000.0,
            "lorentzian_hwhm": 10.0,
            "gaussian_hwhm": 0.0,
            "phase_deg": 0.0,
        }],
        "root_tolerance": 1e-7,
        "max_roots": 5,
    })

    assert result["lower_zero_count"] >= 1
    assert any(
        abs(zero["x"] - 3100.0) < 1e-5 and abs(zero["y"] + 10.0) < 1e-5
        for zero in result["zeros"]
    )
