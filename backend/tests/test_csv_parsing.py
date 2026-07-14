import pathlib
import sys
import unittest

import numpy as np

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from main import extract_selected_spectrum
from spectral_utils import parse_csv_file


class CsvParsingTests(unittest.TestCase):
    def test_unrelated_text_and_blank_columns_do_not_drop_valid_rows(self):
        content = (
            b"Wavenumber,Intensity,Comment,Blank\n"
            b"2800,1.0,baseline,\n"
            b"2900,1.5,peak,\n"
            b"3000,2.0,end,\n"
        )

        wavenumbers, data_matrix, columns_info = parse_csv_file(content)
        filtered_w, original_intensity, intensity = extract_selected_spectrum(
            wavenumbers,
            data_matrix,
            1,
        )

        self.assertEqual([column["name"] for column in columns_info], ["Wavenumber", "Intensity", "Comment", "Blank"])
        np.testing.assert_allclose(filtered_w, [2800.0, 2900.0, 3000.0])
        np.testing.assert_allclose(original_intensity, [1.0, 1.5, 2.0])
        np.testing.assert_allclose(intensity, [1.0, 1.5, 2.0])

    def test_headerless_csv_keeps_first_data_row(self):
        content = (
            b"2800,1.0\n"
            b"2900,1.5\n"
            b"3000,2.0\n"
        )

        wavenumbers, data_matrix, columns_info = parse_csv_file(content)
        filtered_w, original_intensity, intensity = extract_selected_spectrum(
            wavenumbers,
            data_matrix,
            1,
        )

        self.assertEqual([column["name"] for column in columns_info], ["Column 1", "Column 2"])
        np.testing.assert_allclose(filtered_w, [2800.0, 2900.0, 3000.0])
        np.testing.assert_allclose(original_intensity, [1.0, 1.5, 2.0])
        np.testing.assert_allclose(intensity, [1.0, 1.5, 2.0])

    def test_sfg_voigt_export_with_unquoted_commas_in_header_keeps_rows(self):
        content = (
            b"Wavenumber(cm-1),Intensity,Real,Imag,Peak 1 (voigt, L HWHM=10, G FWHM=12)_Intensity,Peak 1 (voigt, L HWHM=10, G FWHM=12)_Real\n"
            b"2.800000e+03,1.000000e+00,1.000000e+00,0.000000e+00,2.000000e-01,1.000000e-01\n"
            b"2.900000e+03,1.500000e+00,1.200000e+00,1.000000e-01,3.000000e-01,2.000000e-01\n"
            b"3.000000e+03,2.000000e+00,1.400000e+00,2.000000e-01,4.000000e-01,3.000000e-01\n"
        )

        wavenumbers, data_matrix, _columns_info = parse_csv_file(content)
        filtered_w, original_intensity, intensity = extract_selected_spectrum(
            wavenumbers,
            data_matrix,
            1,
        )

        np.testing.assert_allclose(filtered_w, [2800.0, 2900.0, 3000.0])
        np.testing.assert_allclose(original_intensity, [1.0, 1.5, 2.0])
        np.testing.assert_allclose(intensity, [1.0, 1.5, 2.0])

    def test_sfg_voigt_export_with_quoted_commas_in_header_keeps_rows(self):
        content = (
            b"Wavenumber(cm-1),Intensity,Real,Imag,\"Peak 1 (voigt, L HWHM=10, G FWHM=12)_Intensity\",\"Peak 1 (voigt, L HWHM=10, G FWHM=12)_Real\"\n"
            b"2.800000e+03,1.000000e+00,1.000000e+00,0.000000e+00,2.000000e-01,1.000000e-01\n"
            b"2.900000e+03,1.500000e+00,1.200000e+00,1.000000e-01,3.000000e-01,2.000000e-01\n"
            b"3.000000e+03,2.000000e+00,1.400000e+00,2.000000e-01,4.000000e-01,3.000000e-01\n"
        )

        wavenumbers, data_matrix, columns_info = parse_csv_file(content)
        filtered_w, original_intensity, intensity = extract_selected_spectrum(
            wavenumbers,
            data_matrix,
            1,
        )

        self.assertIn("Peak 1 (voigt, L HWHM=10, G FWHM=12)_Intensity", [column["name"] for column in columns_info])
        np.testing.assert_allclose(filtered_w, [2800.0, 2900.0, 3000.0])
        np.testing.assert_allclose(original_intensity, [1.0, 1.5, 2.0])
        np.testing.assert_allclose(intensity, [1.0, 1.5, 2.0])

    def test_comment_metadata_before_header_is_ignored(self):
        content = (
            b"# exported spectrum\n"
            b"# any metadata\n"
            b"Wavenumber(cm-1),Intensity\n"
            b"2800,1.0\n"
            b"2900,1.5\n"
            b"3000,2.0\n"
        )

        wavenumbers, data_matrix, columns_info = parse_csv_file(content)
        filtered_w, original_intensity, intensity = extract_selected_spectrum(
            wavenumbers,
            data_matrix,
            1,
        )

        self.assertEqual([column["name"] for column in columns_info], ["Wavenumber(cm-1)", "Intensity"])
        np.testing.assert_allclose(filtered_w, [2800.0, 2900.0, 3000.0])
        np.testing.assert_allclose(original_intensity, [1.0, 1.5, 2.0])
        np.testing.assert_allclose(intensity, [1.0, 1.5, 2.0])


if __name__ == "__main__":
    unittest.main()
