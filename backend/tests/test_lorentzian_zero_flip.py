import pathlib
import sys
import unittest

import numpy as np

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from lorentzian_zero_flip import (
    LorentzianOscillator,
    build_zero_flip_alternative,
    construct_rational_model,
    enumerate_flip_configurations,
    evaluate_direct,
    evaluate_rational,
    flippable_zero_indices,
    recover_partial_fractions,
    reconstruction_metrics,
    unwrap_masked_phase,
    wrapped_phase_change_deg,
    zero_records,
)


class LorentzianZeroFlipTests(unittest.TestCase):
    def setUp(self):
        self.frequencies = np.linspace(2750.0, 3650.0, 5001)

    def test_constructs_rational_response_from_known_parameters(self):
        model = construct_rational_model(0.12 - 0.03j, [
            LorentzianOscillator(2.5, 37.0, 3000.0, 15.0),
            LorentzianOscillator(1.3, -42.0, 3320.0, 28.0),
        ])
        metrics = reconstruction_metrics(model, self.frequencies)
        self.assertLess(metrics["max_abs_complex_error"], 1e-12)
        self.assertLess(metrics["normalized_rms_complex_error"], 1e-12)

    def test_recovers_original_fitted_complex_amplitudes_with_required_sign(self):
        model = construct_rational_model(0.12 - 0.03j, [
            LorentzianOscillator(2.5, 37.0, 3000.0, 15.0),
            LorentzianOscillator(1.3, -42.0, 3320.0, 28.0),
        ])
        c0, recovered = recover_partial_fractions(model.numerator, model.denominator, model.poles)
        np.testing.assert_allclose(c0, model.c0, rtol=1e-12, atol=1e-12)
        np.testing.assert_allclose(recovered, model.fitted_amplitudes, rtol=1e-10, atol=1e-10)

        conventional_residues = np.polyval(model.numerator, model.poles) / np.polyval(
            np.polyder(model.denominator), model.poles
        )
        np.testing.assert_allclose(conventional_residues, -model.fitted_amplitudes, rtol=1e-10, atol=1e-10)

    def test_one_zero_conjugate_reflection_preserves_intensity(self):
        model = construct_rational_model(0.1 + 0.02j, [
            LorentzianOscillator(10.0, 25.0, 3100.0, 12.0),
        ])
        index = flippable_zero_indices(model)[0]
        alternative = build_zero_flip_alternative(model, [index], self.frequencies)
        self.assertAlmostEqual(
            alternative["alternative_zeros"][index], np.conjugate(model.zeros[index])
        )
        self.assertLess(alternative["max_intensity_error"], 1e-12)
        self.assertLess(alternative["normalized_rms_intensity_error"], 1e-12)
        self.assertLess(alternative["max_ratio_magnitude_error"], 1e-12)

    def test_multiple_zero_flip_combinations_are_unique_and_stable(self):
        model = construct_rational_model(0.08 - 0.01j, [
            LorentzianOscillator(6.0, 10.0, 2920.0, 18.0),
            LorentzianOscillator(5.0, 95.0, 3180.0, 24.0),
            LorentzianOscillator(4.0, -55.0, 3450.0, 31.0),
        ])
        flippable = flippable_zero_indices(model)
        configurations = enumerate_flip_configurations(model, max_flippable=10)
        self.assertEqual(len(configurations), 2 ** len(flippable) - 1)
        ids = {
            build_zero_flip_alternative(model, config, self.frequencies)["configuration_id"]
            for config in configurations
        }
        self.assertEqual(len(ids), len(configurations))

    def test_all_original_poles_are_preserved(self):
        model = construct_rational_model(0.08 + 0.03j, [
            LorentzianOscillator(3.0, 15.0, 2900.0, 11.0),
            LorentzianOscillator(7.0, -70.0, 3350.0, 23.0),
        ])
        alternative = build_zero_flip_alternative(
            model, [flippable_zero_indices(model)[0]], self.frequencies
        )
        np.testing.assert_array_equal(alternative["denominator"], model.denominator)
        np.testing.assert_array_equal(alternative["poles"], model.poles)

    def test_recovers_alternative_amplitudes_and_phases(self):
        model = construct_rational_model(0.1 - 0.04j, [
            LorentzianOscillator(2.0, 175.0, 3000.0, 14.0),
            LorentzianOscillator(4.0, -25.0, 3300.0, 20.0),
        ])
        alternative = build_zero_flip_alternative(
            model, [flippable_zero_indices(model)[0]], self.frequencies
        )
        np.testing.assert_allclose(
            alternative["amplitudes"], np.abs(alternative["fitted_amplitudes"]), atol=1e-12
        )
        np.testing.assert_allclose(
            alternative["phases_deg"], np.rad2deg(np.angle(alternative["fitted_amplitudes"])), atol=1e-12
        )
        for row in alternative["comparison"]:
            self.assertGreaterEqual(row["phase_change_deg"], -180.0)
            self.assertLess(row["phase_change_deg"], 180.0)

    def test_high_order_all_pass_evaluation_preserves_intensity(self):
        oscillators = [
            {
                "amplitude": 1.0 + index,
                "phase_deg": 23.0 * index,
                "center": 2700.0 + 90.0 * index,
                "lorentzian_hwhm": 10.0 + index,
            }
            for index in range(12)
        ]
        model = construct_rational_model(0.08 - 0.01j, oscillators)
        flippable = flippable_zero_indices(model)
        self.assertGreaterEqual(len(flippable), 8)
        alternative = build_zero_flip_alternative(
            model, flippable[:8], np.linspace(2500.0, 4000.0, 2001)
        )
        self.assertLess(alternative["normalized_rms_intensity_error"], 1e-14)
        self.assertLess(alternative["max_ratio_magnitude_error"], 1e-12)

    def test_recovered_partial_fractions_reconstruct_alternative(self):
        model = construct_rational_model(0.15 + 0.01j, [
            LorentzianOscillator(2.0, 30.0, 2870.0, 12.0),
            LorentzianOscillator(3.0, 80.0, 3200.0, 25.0),
            LorentzianOscillator(1.5, -50.0, 3500.0, 32.0),
        ])
        alternative = build_zero_flip_alternative(
            model, flippable_zero_indices(model)[:2], self.frequencies
        )
        self.assertTrue(alternative["numerically_valid"])
        self.assertLess(alternative["partial_fraction_max_abs_error"], 1e-10)
        self.assertLess(alternative["partial_fraction_normalized_rms_error"], 1e-10)

    def test_nearly_real_zero_is_not_flippable(self):
        pole = 3000.0 - 10.0j
        zero = 3050.0 + 1e-10j
        c0 = 0.2 + 0.0j
        fitted_amplitude = c0 * (zero - pole)
        oscillator = LorentzianOscillator(
            abs(fitted_amplitude), np.rad2deg(np.angle(fitted_amplitude)), 3000.0, 10.0
        )
        model = construct_rational_model(c0, [oscillator])
        records = zero_records(model, real_zero_tolerance=1e-8)
        self.assertTrue(records[0]["effectively_real"])
        self.assertEqual(flippable_zero_indices(model, real_zero_tolerance=1e-8), ())

    def test_nearly_degenerate_poles_warn_and_recovery_refuses_them(self):
        model = construct_rational_model(0.1, [
            LorentzianOscillator(1.0, 0.0, 3000.0, 10.0),
            LorentzianOscillator(2.0, 20.0, 3000.0 + 1e-10, 10.0),
        ], near_distance_tolerance=1e-7)
        self.assertTrue(any("nearly repeated" in warning for warning in model.warnings))
        with self.assertRaisesRegex(ValueError, "repeated or nearly repeated poles"):
            recover_partial_fractions(
                model.numerator, model.denominator, model.poles, pole_tolerance=1e-7
            )

    def test_nearly_repeated_zeros_warn(self):
        poles = np.array([2900.0 - 12.0j, 3300.0 - 20.0j])
        target_zero = 3100.0 + 40.0j
        c0 = 0.1 + 0.02j
        denominator = np.polymul([-1.0, poles[0]], [-1.0, poles[1]])
        numerator = c0 * np.poly([target_zero, target_zero + 1e-9])
        derivative = np.polyder(denominator)
        fitted = -np.polyval(numerator, poles) / np.polyval(derivative, poles)
        oscillators = [
            LorentzianOscillator(abs(fitted[index]), np.rad2deg(np.angle(fitted[index])), poles[index].real, -poles[index].imag)
            for index in range(2)
        ]
        # Polynomial root finding splits this almost-double root by about 1e-4
        # at this frequency scale, which is itself the conditioning issue the
        # warning is intended to expose.
        model = construct_rational_model(c0, oscillators, near_distance_tolerance=1e-3)
        self.assertTrue(any("Zeros" in warning and "nearly repeated" in warning for warning in model.warnings))

    def test_zero_nonresonant_constant_is_recovered(self):
        model = construct_rational_model(0.0, [
            LorentzianOscillator(2.0, 20.0, 3000.0, 10.0),
            LorentzianOscillator(3.0, -30.0, 3300.0, 18.0),
        ])
        c0, fitted = recover_partial_fractions(model.numerator, model.denominator, model.poles)
        self.assertEqual(c0, 0.0j)
        np.testing.assert_allclose(fitted, model.fitted_amplitudes, rtol=1e-10, atol=1e-10)

    def test_phase_change_wraps_consistently(self):
        self.assertAlmostEqual(float(wrapped_phase_change_deg(179.0, -181.0)), 0.0)
        self.assertAlmostEqual(float(wrapped_phase_change_deg(-179.0, 179.0)), 2.0)

    def test_phase_unwrap_does_not_bridge_masked_gaps(self):
        phase = np.array([3.0, -3.0, np.nan, -3.0, 3.0])
        mask = np.array([True, True, False, True, True])
        unwrapped = unwrap_masked_phase(phase, mask)
        self.assertTrue(np.isnan(unwrapped[2]))
        np.testing.assert_allclose(unwrapped[:2], [3.0, 2 * np.pi - 3.0])
        np.testing.assert_allclose(unwrapped[3:], [-3.0, 3.0 - 2 * np.pi])

    def test_enumeration_limit_prevents_combinatorial_explosion(self):
        oscillators = [
            LorentzianOscillator(1.0 + index, 20.0 * index, 2800.0 + 80.0 * index, 10.0 + index)
            for index in range(5)
        ]
        model = construct_rational_model(0.1 + 0.03j, oscillators)
        if len(flippable_zero_indices(model)) > 2:
            with self.assertRaisesRegex(ValueError, "Refusing to enumerate"):
                enumerate_flip_configurations(model, max_flippable=2)

    def test_direct_and_rational_evaluation_accept_complex_grid(self):
        model = construct_rational_model(0.1 + 0.02j, [
            LorentzianOscillator(2.0, 45.0, 3100.0, 20.0),
        ])
        grid = np.array([2900.0 + 20.0j, 3200.0 - 5.0j])
        np.testing.assert_allclose(
            evaluate_rational(grid, model.numerator, model.denominator),
            evaluate_direct(grid, model.c0, model.fitted_amplitudes, model.poles),
            rtol=1e-12,
            atol=1e-12,
        )


if __name__ == "__main__":
    unittest.main()
