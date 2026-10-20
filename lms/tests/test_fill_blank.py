# Copyright (c) 2026, FOSS United and contributors
# See license.txt
"""Unit tests for the Fill Blank grading rules. No frappe, no bench: run with pytest alone."""

import importlib.util
import json
from pathlib import Path

_MODULE_PATH = Path(__file__).resolve().parents[1] / "lms" / "fill_blank.py"
_spec = importlib.util.spec_from_file_location("lms_fill_blank_under_test", _MODULE_PATH)
fill_blank = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fill_blank)

normalize_answer = fill_blank.normalize_answer
parse_accepted_answers = fill_blank.parse_accepted_answers
extract_blank_ids = fill_blank.extract_blank_ids
grade_fill_blank = fill_blank.grade_fill_blank
parse_submitted_answer = fill_blank.parse_submitted_answer


def _blank(blank_id, answers, marks=1):
	return {"blank_id": blank_id, "answers": answers, "marks": marks}


def _grade_one(accepted, answer):
	return grade_fill_blank([_blank("1", accepted)], {"1": answer})["results"][0]["is_correct"]


class TestNormalizeAnswer:
	def test_none_is_empty(self):
		assert normalize_answer(None) == ""

	def test_nfkc_fullwidth_digits_and_letters(self):
		assert normalize_answer("ＡＢＣ１２３") == "abc123"
		assert normalize_answer("ＡＢＣ１２３") == normalize_answer("abc123")

	def test_ideographic_space_collapses(self):
		assert normalize_answer("圧縮　機") == "圧縮 機"
		assert normalize_answer("　圧縮機　") == "圧縮機"

	def test_trim_and_collapse_whitespace(self):
		assert normalize_answer("  a \t b\n\n c  ") == "a b c"

	def test_case_insensitive(self):
		assert normalize_answer("R410A") == normalize_answer("r410a")

	def test_casefold_handles_sharp_s(self):
		assert normalize_answer("Straße") == normalize_answer("STRASSE")


class TestParseAcceptedAnswers:
	def test_one_per_line_normalized(self):
		assert parse_accepted_answers("Compressor\n  COMPRESSOR  \n圧縮機\r\nＡＢＣ") == [
			"compressor",
			"圧縮機",
			"abc",
		]

	def test_drops_empty_and_dedupes_preserving_order(self):
		assert parse_accepted_answers("b\n\n  \na\nB\nA") == ["b", "a"]

	def test_empty_input(self):
		assert parse_accepted_answers("") == []
		assert parse_accepted_answers(None) == []


class TestExtractBlankIds:
	def test_order_and_dedupe(self):
		html = "<p>{{2}} then {{ 1 }} then {{2}} and {{3}}</p>"
		assert extract_blank_ids(html) == ["2", "1", "3"]

	def test_ignores_malformed_tokens(self):
		assert extract_blank_ids("{{}} {1} {{ }} {{a b}} {{x}}") == ["x"]

	def test_empty(self):
		assert extract_blank_ids("") == []
		assert extract_blank_ids(None) == []


class TestGradeFillBlank:
	def test_multiple_accepted_answers_one_per_line(self):
		accepted = "凝縮器\nコンデンサ\ncondenser"
		assert _grade_one(accepted, "Condenser")
		assert _grade_one(accepted, "コンデンサ")
		assert _grade_one(accepted, "凝縮器")
		assert not _grade_one(accepted, "evaporator")

	def test_empty_answer_is_always_wrong(self):
		assert not _grade_one("a", "")
		assert not _grade_one("a", "   ")
		assert not _grade_one("a", "　")
		assert not _grade_one("\n \n", "")

	def test_missing_answer_is_wrong(self):
		graded = grade_fill_blank([_blank("1", "a")], {})
		assert graded["results"][0]["answer"] == ""
		assert graded["is_correct"] is False
		assert graded["marks"] == 0

	def test_japanese_text(self):
		assert _grade_one("圧縮機", "圧縮機")
		assert _grade_one("圧縮機", "  圧縮機　")
		assert not _grade_one("圧縮機", "凝縮機")
		assert _grade_one("凝縮", "凝縮")

	def test_halfwidth_katakana_matches_fullwidth(self):
		assert _grade_one("コンプレッサー", "ｺﾝﾌﾟﾚｯｻｰ")

	def test_symbols(self):
		# NFKC maps U+2126 OHM SIGN to U+03A9 and U+2103 to "°C", so each pair meets in the middle.
		assert normalize_answer("Ω") == normalize_answer("Ω")
		assert normalize_answer("℃") == normalize_answer("°C")
		assert _grade_one("Ω", "Ω")
		assert _grade_one("50°C", "50℃")
		assert _grade_one("φ10", "φ10")
		assert _grade_one("φ10", "Φ10")

	def test_partial_credit_with_three_blanks(self):
		blanks = [_blank("1", "圧縮機", 2), _blank("2", "凝縮器\ncondenser", 3), _blank("3", "50°C", 5)]
		graded = grade_fill_blank(blanks, {"1": "圧縮機", "2": "wrong", "3": "50℃"})

		assert graded["marks"] == 7
		assert graded["marks_out_of"] == 10
		assert graded["is_correct"] is False
		assert [r["is_correct"] for r in graded["results"]] == [True, False, True]
		assert [r["marks"] for r in graded["results"]] == [2, 0, 5]
		assert [r["marks_out_of"] for r in graded["results"]] == [2, 3, 5]

	def test_all_correct(self):
		graded = grade_fill_blank([_blank("1", "a"), _blank("2", "b")], {"1": "A", "2": " b "})
		assert graded["is_correct"] is True
		assert graded["marks"] == graded["marks_out_of"] == 2

	def test_marks_default_to_one(self):
		graded = grade_fill_blank([{"blank_id": "1", "answers": "a"}], {"1": "a"})
		assert graded["marks"] == 1
		assert graded["marks_out_of"] == 1

	def test_no_negative_marking(self):
		graded = grade_fill_blank([_blank("1", "a", 4)], {"1": "z"})
		assert graded["marks"] == 0

	def test_accepted_keeps_original_text(self):
		graded = grade_fill_blank([_blank("1", "Compressor\n\n  圧縮機 ")], {"1": "compressor"})
		assert graded["results"][0]["accepted"] == ["Compressor", "圧縮機"]
		assert graded["results"][0]["answer"] == "compressor"

	def test_no_blanks_is_not_correct(self):
		graded = grade_fill_blank([], {"1": "a"})
		assert graded["is_correct"] is False
		assert graded["marks_out_of"] == 0

	def test_extra_submitted_keys_are_ignored(self):
		graded = grade_fill_blank([_blank("1", "a")], {"1": "a", "99": "a"})
		assert len(graded["results"]) == 1


class TestParseSubmittedAnswer:
	def test_json_string(self):
		assert parse_submitted_answer('{"1": "圧縮機", "2": "b"}') == {"1": "圧縮機", "2": "b"}

	def test_dict_passthrough_with_coercion(self):
		assert parse_submitted_answer({1: 5, "2": None, "3": "x"}) == {"1": "5", "2": "", "3": "x"}

	def test_invalid_json(self):
		assert parse_submitted_answer("{not json") == {}
		assert parse_submitted_answer("") == {}

	def test_non_object_json(self):
		assert parse_submitted_answer("[1, 2]") == {}
		assert parse_submitted_answer('"text"') == {}
		assert parse_submitted_answer("12") == {}

	def test_none_and_other_types(self):
		assert parse_submitted_answer(None) == {}
		assert parse_submitted_answer(["a"]) == {}

	def test_roundtrip_through_json_dumps(self):
		stored = json.dumps({"1": "圧縮機"}, ensure_ascii=False)
		assert parse_submitted_answer(stored) == {"1": "圧縮機"}
