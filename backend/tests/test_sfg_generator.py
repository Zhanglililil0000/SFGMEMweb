import pathlib
import sys
import unittest

import numpy as np

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sfg_generator import compute_sfg_spectrum


class SfgGeneratorIntensityTests(unittest.TestCase):
    def test_single_peak_intensity_matches_analytic_abs_chi_squared(self):
        wavenumbers = np.array([3000.0])

        intensity, real_part, imag_part, chi, _ = compute_sfg_spectrum(
            wavenumbers,
            [0.0, 0.0, 1.0, 3000.0, 10.0],
            phases=[0.0],
        )

        self.assertAlmostEqual(real_part[0], 0.0)
        self.assertAlmostEqual(imag_part[0], 0.1)
        self.assertAlmostEqual(chi[0], 0.1j)
        self.assertAlmostEqual(intensity[0], 0.01)

    def test_nonresonant_contribution_is_in_total_chi_before_squaring(self):
        wavenumbers = np.array([3000.0])

        intensity, real_part, imag_part, chi, _ = compute_sfg_spectrum(
            wavenumbers,
            [1.0, 0.0, 1.0, 3000.0, 10.0],
            phases=[0.0],
        )

        self.assertAlmostEqual(real_part[0], 1.0)
        self.assertAlmostEqual(imag_part[0], 0.1)
        self.assertAlmostEqual(chi[0], 1.0 + 0.1j)
        self.assertAlmostEqual(intensity[0], 1.01)

    def test_phase_degree_and_radian_equivalents_match_when_passed_as_radians(self):
        wavenumbers = np.array([2995.0, 3000.0, 3005.0])
        params = [0.2, -0.3, 1.0, 3000.0, 10.0]

        deg_90_as_rad = np.deg2rad(90.0)
        literal_rad = 1.57079632679

        deg_result = compute_sfg_spectrum(wavenumbers, params, phases=[deg_90_as_rad])
        rad_result = compute_sfg_spectrum(wavenumbers, params, phases=[literal_rad])

        for deg_values, rad_values in zip(deg_result[:4], rad_result[:4]):
            np.testing.assert_allclose(deg_values, rad_values, rtol=1e-12, atol=1e-12)

    def test_voigt_gaussian_hwhm_matches_equivalent_fwhm(self):
        wavenumbers = np.linspace(2980.0, 3020.0, 9)
        params = [0.0, 0.0, 1.0, 3000.0, 10.0]

        hwhm_result = compute_sfg_spectrum(
            wavenumbers,
            params,
            phases=[0.0],
            peak_options=[{"profile_type": "voigt", "gaussian_hwhm": 6.0}],
        )
        fwhm_result = compute_sfg_spectrum(
            wavenumbers,
            params,
            phases=[0.0],
            peak_options=[{"profile_type": "voigt", "gaussian_fwhm": 12.0}],
        )

        for hwhm_values, fwhm_values in zip(hwhm_result[:4], fwhm_result[:4]):
            np.testing.assert_allclose(hwhm_values, fwhm_values, rtol=1e-12, atol=1e-12)

        self.assertIn("G HWHM=6", hwhm_result[4][1]["label"])


if __name__ == "__main__":
    unittest.main()
