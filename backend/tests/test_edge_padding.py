import pathlib
import sys
import unittest

import numpy as np

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from spectral_utils import resample_spectrum_for_mem


class EdgePaddingTests(unittest.TestCase):
    def test_constant_endpoint_padding_builds_expected_range_and_regions(self):
        wavenumbers = np.linspace(2800.0, 3000.0, 5)
        intensity = np.linspace(1.0, 2.0, 5)
        original_wavenumbers = wavenumbers.copy()
        original_intensity = intensity.copy()

        mem_wavenumbers, mem_intensity, info = resample_spectrum_for_mem(
            wavenumbers,
            intensity,
            23,
            edge_padding_enabled=True,
            left_padding_width=1000.0,
            right_padding_width=1000.0,
        )

        self.assertEqual(mem_wavenumbers[0], 1800.0)
        self.assertEqual(mem_wavenumbers[-1], 4000.0)
        np.testing.assert_allclose(mem_intensity[mem_wavenumbers < 2800.0], 1.0)
        np.testing.assert_allclose(mem_intensity[mem_wavenumbers > 3000.0], 2.0)
        np.testing.assert_allclose(
            mem_intensity[(mem_wavenumbers >= 2800.0) & (mem_wavenumbers <= 3000.0)],
            [1.0, 1.5, 2.0],
        )
        np.testing.assert_allclose(wavenumbers, original_wavenumbers)
        np.testing.assert_allclose(intensity, original_intensity)
        self.assertEqual(info["edge_padding_enabled"], True)
        self.assertEqual(info["original_frequency_range"], [2800.0, 3000.0])
        self.assertEqual(info["padded_frequency_range"], [1800.0, 4000.0])
        self.assertEqual(info["evaluation_frequency_range"], [2800.0, 3000.0])
        self.assertEqual(info["n_eval"], 3)
        self.assertEqual(info["mem_regions"][0], "left_padding")
        self.assertEqual(info["mem_regions"][-1], "right_padding")

    def test_padding_disabled_keeps_original_range(self):
        wavenumbers = np.linspace(2800.0, 3000.0, 5)
        intensity = np.linspace(1.0, 2.0, 5)

        mem_wavenumbers, mem_intensity, info = resample_spectrum_for_mem(
            wavenumbers,
            intensity,
            5,
            edge_padding_enabled=False,
            left_padding_width=1000.0,
            right_padding_width=1000.0,
        )

        np.testing.assert_allclose(mem_wavenumbers, wavenumbers)
        np.testing.assert_allclose(mem_intensity, intensity)
        self.assertEqual(info["edge_padding_enabled"], False)
        self.assertEqual(info["mem_frequency_range"], [2800.0, 3000.0])
        self.assertEqual(info["n_eval"], 5)
        self.assertTrue(all(region == "original" for region in info["mem_regions"]))

    def test_padded_grid_must_leave_enough_points_in_original_evaluation_range(self):
        wavenumbers = np.linspace(2800.0, 3000.0, 5)
        intensity = np.linspace(1.0, 2.0, 5)

        with self.assertRaisesRegex(ValueError, "Original evaluation range must contain at least 3 MEM grid points"):
            resample_spectrum_for_mem(
                wavenumbers,
                intensity,
                5,
                edge_padding_enabled=True,
                left_padding_width=1000.0,
                right_padding_width=1000.0,
            )


if __name__ == "__main__":
    unittest.main()
