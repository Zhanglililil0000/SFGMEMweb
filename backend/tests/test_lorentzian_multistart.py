import pathlib
import sys
import unittest

import numpy as np

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from lorentzian_multistart import evaluate_lorentzian, run_multistart_refit
from main import app


def request_data(**overrides):
    reference = {
        "nr_real": 0.08,
        "nr_imag": -0.02,
        "peaks": [
            {"amplitude": 4.0, "phase_deg": 25.0, "center": 2950.0, "hwhm": 18.0},
            {"amplitude": 3.0, "phase_deg": -40.0, "center": 3250.0, "hwhm": 26.0},
        ],
    }
    data = {
        "x_min": 2700.0, "x_max": 3500.0, "npoints": 301,
        "reference": reference,
        "free": {"nr_real": True, "nr_imag": True, "amplitude": True, "phase_deg": True, "center": True, "hwhm": True},
        "bounds": {
            "nr_real": [-0.2, 0.3], "nr_imag": [-0.2, 0.2],
            "peaks": [
                {"amplitude": [0.1, 8.0], "phase_deg": [-180.0, 180.0], "center": [2900.0, 3000.0], "hwhm": [5.0, 40.0]},
                {"amplitude": [0.1, 8.0], "phase_deg": [-180.0, 180.0], "center": [3200.0, 3300.0], "hwhm": [5.0, 50.0]},
            ],
        },
        "n_starts": 4, "random_seed": 7, "max_nfev": 1000,
        "cluster_tolerance": 1e-4, "acceptance_mode": "nrmse", "nrmse_threshold": 1e-7,
    }
    data.update(overrides)
    return data


class LorentzianMultiStartTests(unittest.TestCase):
    def test_route_is_registered(self):
        self.assertIn("/api/lorentzian-multistart/search", {route.path for route in app.routes})

    def test_reference_convention(self):
        chi = evaluate_lorentzian(np.array([3000.0]), 0.0, 0.0, [
            {"amplitude": 2.0, "phase_deg": 0.0, "center": 3000.0, "hwhm": 10.0}
        ])
        self.assertAlmostEqual(chi[0].real, 0.0)
        self.assertAlmostEqual(chi[0].imag, 0.2)

    def test_negative_amplitude_is_allowed_and_reports_effective_phase(self):
        data = request_data(n_starts=1)
        data["reference"]["peaks"][0]["amplitude"] = -4.0
        data["reference"]["peaks"][0]["phase_deg"] = 0.0
        data["bounds"]["peaks"][0]["amplitude"] = [-8.0, 8.0]
        result = run_multistart_refit(data)
        peak = result["reference"]["parameters"]["peaks"][0]
        self.assertEqual(peak["amplitude"], -4.0)
        self.assertEqual(peak["effective_phase_deg"], -180.0)

    def test_multistart_recovers_synthetic_intensity_and_respects_bounds(self):
        result = run_multistart_refit(request_data())
        self.assertEqual(result["failed_count"], 0)
        self.assertGreaterEqual(result["accepted_count"], 1)
        best = min(result["accepted_solutions"], key=lambda item: item["nrmse"])
        self.assertLess(best["nrmse"], 1e-10)
        self.assertEqual(len(best["intensity"]), 301)
        for peak, bounds in zip(best["parameters"]["peaks"], request_data()["bounds"]["peaks"]):
            self.assertGreater(peak["hwhm"], 0)
            self.assertTrue(bounds["center"][0] <= peak["center"] <= bounds["center"][1])

    def test_fixed_centers_and_widths_remain_fixed(self):
        data = request_data(n_starts=2)
        data["free"]["center"] = False
        data["free"]["hwhm"] = False
        result = run_multistart_refit(data)
        for solution in result["solutions"]:
            for fitted, reference in zip(solution["parameters"]["peaks"], data["reference"]["peaks"]):
                self.assertEqual(fitted["center"], reference["center"])
                self.assertEqual(fitted["hwhm"], reference["hwhm"])

    def test_rejects_nonpositive_width_bound(self):
        data = request_data()
        data["bounds"]["peaks"][0]["hwhm"] = [0.0, 40.0]
        with self.assertRaisesRegex(ValueError, "greater than zero"):
            run_multistart_refit(data)


if __name__ == "__main__":
    unittest.main()
