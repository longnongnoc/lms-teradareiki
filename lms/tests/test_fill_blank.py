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
apply_negative_marking = fill_blank.apply_negative_marking
parse_submitted_answer = fill_blank.parse_submitted_answer
clean_answer_text = fill_blank.clean_answer_text


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

	def test_ideographic_space_is_trimmed(self):
		assert normalize_answer("　圧縮機　") == "圧縮機"
		assert normalize_answer("　abc　") == "abc"

	def test_trim_and_collapse_whitespace(self):
		assert normalize_answer("  a \t b\n\n c  ") == "a b c"

	def test_case_insensitive(self):
		assert normalize_answer("R410A") == normalize_answer("r410a")

	def test_casefold_handles_sharp_s(self):
		assert normalize_answer("Straße") == normalize_answer("STRASSE")

	def test_zero_width_characters_are_removed(self):
		for char in ("\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"):
			assert normalize_answer(f"圧{char}縮機") == "圧縮機"
			assert normalize_answer(f"hea{char}t") == "heat"
		assert normalize_answer("\ufeff圧縮機\u200b") == "圧縮機"

	def test_zero_width_only_is_empty(self):
		assert normalize_answer("\u200b\u200c\u200d\ufeff\u2060") == ""

	def test_space_between_japanese_words_is_ignored(self):
		assert normalize_answer("冷凍 サイクル") == "冷凍サイクル"
		assert normalize_answer("冷凍  サイクル") == "冷凍サイクル"

	def test_ideographic_space_between_japanese_words_is_ignored(self):
		assert normalize_answer("冷凍　サイクル") == "冷凍サイクル"

	def test_space_next_to_each_japanese_script_is_ignored(self):
		assert normalize_answer("ひらがな 漢字") == "ひらがな漢字"
		assert normalize_answer("カタカナ ひらがな") == "カタカナひらがな"
		assert normalize_answer("コンプレッサー 冷凍") == "コンプレッサー冷凍"
		assert normalize_answer("ｺﾝﾌﾟﾚｯｻｰ 冷凍") == "コンプレッサー冷凍"

	def test_space_next_to_japanese_punctuation_is_ignored(self):
		assert normalize_answer("冷凍 、 サイクル") == "冷凍、サイクル"
		assert normalize_answer("「 冷凍 」") == "「冷凍」"

	def test_space_between_japanese_and_latin_is_ignored(self):
		assert normalize_answer("R410A 冷媒") == "r410a冷媒"
		assert normalize_answer("冷媒 R410A") == "冷媒r410a"
		assert normalize_answer("冷媒 R 410A") == "冷媒r 410a"

	def test_space_between_latin_words_is_kept(self):
		assert normalize_answer("heat pump") == "heat pump"
		assert normalize_answer("heat   pump") == "heat pump"
		assert normalize_answer("heat pump") != normalize_answer("heatpump")

	def test_space_between_fullwidth_latin_words_is_kept(self):
		assert normalize_answer("ＨＥＡＴ　ＰＵＭＰ") == "heat pump"

	def test_zero_width_then_space_next_to_japanese(self):
		assert normalize_answer("冷凍\u200b サイクル") == "冷凍サイクル"


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
		html = "<p>[[2]] then [[1]] then [[2]] and [[3]]</p>"
		assert extract_blank_ids(html) == ["2", "1", "3"]

	def test_multi_digit_ids(self):
		assert extract_blank_ids("[[10]] [[2]] [[007]]") == ["10", "2", "007"]

	def test_ignores_malformed_tokens(self):
		assert extract_blank_ids("[[]] [1] [[ ]] [[a b]] [[x]] [[ 1 ]] [[1] {{1}}") == []

	def test_full_width_digits_are_not_markers(self):
		assert extract_blank_ids("[[１]] [[１２]] [[1２]]") == []

	def test_blank_id_pattern_is_ascii_digits_only(self):
		assert fill_blank.BLANK_ID.fullmatch("12")
		assert not fill_blank.BLANK_ID.fullmatch("１２")
		assert not fill_blank.BLANK_ID.fullmatch("a1")
		assert not fill_blank.BLANK_ID.fullmatch("")

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

	def test_japanese_spacing_variants_match(self):
		assert _grade_one("冷凍サイクル", "冷凍 サイクル")
		assert _grade_one("冷凍サイクル", "冷凍　サイクル")
		assert _grade_one("冷凍 サイクル", "冷凍サイクル")
		assert not _grade_one("heatpump", "heat pump")

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

	def test_wrong_answer_scores_zero_by_default(self):
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


class TestNegativeMarking:
	def _graded(self, submitted):
		blanks = [_blank("1", "a", 2), _blank("2", "b", 3)]
		return grade_fill_blank(blanks, submitted)

	def test_off_all_wrong_costs_nothing(self):
		graded = apply_negative_marking(self._graded({"1": "x", "2": "y"}), 0, 2)
		assert graded["marks"] == 0

	def test_on_all_wrong_costs_marks_to_cut(self):
		graded = apply_negative_marking(self._graded({"1": "x", "2": "y"}), 1, 2)
		assert graded["marks"] == -2
		assert graded["marks_out_of"] == 5

	def test_on_nothing_answered_costs_marks_to_cut(self):
		assert apply_negative_marking(self._graded({}), 1, 1)["marks"] == -1

	def test_on_partial_credit_is_not_reduced(self):
		graded = apply_negative_marking(self._graded({"1": "a", "2": "y"}), 1, 2)
		assert graded["marks"] == 2

	def test_on_all_right_is_not_reduced(self):
		graded = apply_negative_marking(self._graded({"1": "a", "2": "b"}), 1, 2)
		assert graded["marks"] == 5

	def test_on_without_a_cut_costs_nothing(self):
		assert apply_negative_marking(self._graded({"1": "x"}), 1, 0)["marks"] == 0
		assert apply_negative_marking(self._graded({"1": "x"}), 1, None)["marks"] == 0

	def test_per_blank_results_are_left_alone(self):
		graded = apply_negative_marking(self._graded({"1": "x", "2": "y"}), 1, 2)
		assert [r["marks"] for r in graded["results"]] == [0, 0]
		assert graded["is_correct"] is False


class TestCleanAnswerText:
	def test_plain_text_is_only_trimmed(self):
		assert clean_answer_text("  heat pump ") == "heat pump"
		assert clean_answer_text("圧縮 機") == "圧縮 機"

	def test_none_is_empty(self):
		assert clean_answer_text(None) == ""

	def test_non_text_is_coerced(self):
		assert clean_answer_text(5) == "5"

	def test_tags_comments_and_scripts_are_dropped(self):
		assert clean_answer_text("<p>a <b>b</b></p>") == "a b"
		assert clean_answer_text("<!-- c -->t") == "t"
		assert clean_answer_text("<script>alert(1)</script>ok") == "ok"
		assert clean_answer_text("<style>p{}</style>ok") == "ok"

	def test_a_lone_less_than_is_kept(self):
		assert clean_answer_text("x < 5") == "x < 5"
		assert clean_answer_text("5 > 3") == "5 > 3"

	def test_entities_are_not_decoded(self):
		assert clean_answer_text("R&D &amp; &#65;") == "R&D &amp; &#65;"

	def test_cleaning_twice_changes_nothing(self):
		for value in ("<b>a</b>", "&lt;b&gt;", "x < 5", "  &amp;lt;  "):
			once = clean_answer_text(value)
			assert clean_answer_text(once) == once


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

	def test_values_are_trimmed(self):
		raw = {"1": "  圧縮機\n", "2": "　x　"}
		assert parse_submitted_answer(raw) == {"1": "圧縮機", "2": "x"}

	def test_markup_is_stripped_from_values(self):
		raw = {"1": "<b>圧縮機</b>", "2": "<img src=x onerror=alert(1)>ok", "3": "<script>alert(1)</script>y"}
		assert parse_submitted_answer(raw) == {"1": "圧縮機", "2": "ok", "3": "y"}

	def test_graded_answer_is_the_cleaned_one(self):
		graded = grade_fill_blank([_blank("1", "圧縮機")], parse_submitted_answer({"1": " <i>圧縮機</i> "}))
		assert graded["results"][0]["answer"] == "圧縮機"
		assert graded["is_correct"] is True

	def test_roundtrip_through_json_dumps(self):
		stored = json.dumps({"1": "圧縮機"}, ensure_ascii=False)
		assert parse_submitted_answer(stored) == {"1": "圧縮機"}
