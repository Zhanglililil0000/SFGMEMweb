import asyncio
import json
import pathlib
import sys
import unittest

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from lorentzian_zero_flip_api import analyze_lorentzian_zero_flip
from main import LorentzianZeroFlipAnalyzeRequest, app, lorentzian_zero_flip_analyze


def sample_request(**overrides):
    request = {
        "x_min": 2800.0,
        "x_max": 3500.0,
        "npoints": 401,
        "c0_real": 0.12,
        "c0_imag": -0.03,
        "oscillators": [
            {"amplitude": 2.5, "phase_deg": 37.0, "center": 3000.0, "lorentzian_hwhm": 15.0},
            {"amplitude": 1.3, "phase_deg": -42.0, "center": 3320.0, "lorentzian_hwhm": 28.0},
        ],
    }
    request.update(overrides)
    return request


class LorentzianZeroFlipApiTests(unittest.TestCase):
    def test_initial_analysis_is_json_serializable(self):
        result = analyze_lorentzian_zero_flip(sample_request())
        json.dumps(result, allow_nan=False)
        self.assertEqual(len(result["frequency"]), 401)
        self.assertEqual(result["alternatives"], [])
        self.assertEqual(
            result["convention"]["recovery"], "D_q = -P(p_q) / Q'(p_q)"
        )
        self.assertLess(result["original"]["reconstruction"]["max_abs_complex_error"], 1e-10)

    def test_selected_configuration_returns_frequency_and_parameter_data(self):
        initial = analyze_lorentzian_zero_flip(sample_request())
        flippable = [
            zero["index"] for zero in initial["original"]["zeros"] if zero["flippable"]
        ]
        self.assertTrue(flippable)
        result = analyze_lorentzian_zero_flip(sample_request(
            flip_configurations=[[flippable[0]]]
        ))
        alternative = result["alternatives"][0]
        self.assertEqual(alternative["configuration_id"], f"flip-z{flippable[0] + 1}")
        self.assertEqual(len(alternative["comparison"]), 2)
        self.assertEqual(len(alternative["real_part"]), 401)
        self.assertTrue(alternative["numerically_valid"])
        self.assertLess(alternative["metrics"]["normalized_rms_intensity_error"], 1e-9)
        json.dumps(result, allow_nan=False)

    def test_enumeration_returns_all_nonempty_combinations(self):
        initial = analyze_lorentzian_zero_flip(sample_request())
        count = initial["flippable_zero_count"]
        result = analyze_lorentzian_zero_flip(sample_request(
            enumerate_all=True,
            max_flippable_for_enumeration=8,
        ))
        self.assertEqual(len(result["alternatives"]), 2 ** count - 1)
        self.assertEqual(
            len({item["configuration_id"] for item in result["alternatives"]}),
            len(result["alternatives"]),
        )

    def test_invalid_zero_index_becomes_validation_error_at_endpoint(self):
        request = LorentzianZeroFlipAnalyzeRequest(**sample_request(
            flip_configurations=[[999]]
        ))
        with self.assertRaisesRegex(Exception, "Selected zero index is out of range") as context:
            asyncio.run(lorentzian_zero_flip_analyze(request))
        self.assertEqual(context.exception.status_code, 422)

    def test_route_is_registered(self):
        paths = {route.path for route in app.routes}
        self.assertIn("/api/lorentzian-zero-flip/analyze", paths)

    def test_ranked_enumeration_limits_large_models_without_refusing(self):
        request = sample_request(
            oscillators=[
                {"amplitude": 1.0 + index, "phase_deg": 23.0 * index, "center": 2800.0 + 100.0 * index, "lorentzian_hwhm": 10.0 + index}
                for index in range(10)
            ],
            enumerate_all=True,
            max_flippable_for_enumeration=8,
            enumeration_window_margin=1000.0,
            minimum_phase_effect_deg=0.0,
        )
        result = analyze_lorentzian_zero_flip(request)
        self.assertLessEqual(result["enumeration_flippable_zero_count"], 8)
        self.assertEqual(
            len(result["alternatives"]), result["enumeration_configuration_count"]
        )

    def test_window_filter_does_not_disable_manual_flips(self):
        initial = analyze_lorentzian_zero_flip(sample_request(
            x_min=3000.0,
            x_max=3010.0,
            enumeration_window_margin=0.0,
            minimum_phase_effect_deg=0.0,
        ))
        manual_only = next(
            zero for zero in initial["original"]["zeros"]
            if zero["flippable"] and not zero["enumeration_selected"]
        )
        result = analyze_lorentzian_zero_flip(sample_request(
            x_min=3000.0,
            x_max=3010.0,
            enumeration_window_margin=0.0,
            minimum_phase_effect_deg=0.0,
            flip_configurations=[[manual_only["index"]]],
        ))
        self.assertEqual(result["alternatives"][0]["flipped_zero_indices"], [manual_only["index"]])


if __name__ == "__main__":
    unittest.main()
