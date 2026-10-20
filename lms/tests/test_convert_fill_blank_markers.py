# Copyright (c) 2026, FOSS United and contributors
# See license.txt
"""Unit tests for the planning half of the marker conversion patch. No frappe, no bench."""

import importlib.util
import json
from pathlib import Path

_MODULE_PATH = Path(__file__).resolve().parents[1] / "patches" / "v2_0" / "convert_fill_blank_markers.py"
_spec = importlib.util.spec_from_file_location("lms_convert_fill_blank_markers_under_test", _MODULE_PATH)
patch = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(patch)

convert_markers = patch.convert_markers
remap_answer = patch.remap_answer
convert_snapshot = patch.convert_snapshot


class TestConvertMarkers:
	def test_digit_ids_keep_their_ids(self):
		plan = convert_markers("<p>{{2}} and {{ 1 }} and {{2}}</p>", ["2", "1"])
		assert plan["text"] == "<p>[[2]] and [[1]] and [[2]]</p>"
		assert plan["renumbered"] is False
		assert plan["ids"] == {"2": "2", "1": "1"}
		assert plan["row_ids"] == ["2", "1"]

	def test_non_contiguous_digit_ids_are_not_compacted(self):
		plan = convert_markers("{{1}} {{5}}", ["1", "5"])
		assert plan["text"] == "[[1]] [[5]]"
		assert plan["row_ids"] == ["1", "5"]

	def test_any_non_digit_id_renumbers_in_order_of_first_appearance(self):
		plan = convert_markers("<p>{{b}} {{a}} {{b}} {{3}}</p>", ["a", "b", "3"])
		assert plan["renumbered"] is True
		assert plan["text"] == "<p>[[1]] [[2]] [[1]] [[3]]</p>"
		assert plan["ids"] == {"b": "1", "a": "2", "3": "3"}
		assert plan["row_ids"] == ["2", "1", "3"]

	def test_renumbering_can_swap_ids_without_clashing(self):
		plan = convert_markers("{{2}} {{x}} {{1}}", ["1", "2", "x"])
		assert plan["text"] == "[[1]] [[2]] [[3]]"
		assert plan["row_ids"] == ["3", "1", "2"]

	def test_japanese_and_full_width_ids_renumber(self):
		plan = convert_markers("{{圧縮}} {{１}}", ["圧縮", "１"])
		assert plan["text"] == "[[1]] [[2]]"
		assert plan["row_ids"] == ["1", "2"]

	def test_orphan_row_takes_a_free_number(self):
		plan = convert_markers("{{a}} {{b}}", ["a", "b", "zzz"])
		assert plan["row_ids"] == ["1", "2", "3"]

	def test_orphan_non_digit_row_never_clashes_with_a_digit_marker(self):
		plan = convert_markers("{{3}} {{1}}", ["3", "1", "zzz"])
		assert plan["renumbered"] is False
		assert plan["row_ids"] == ["3", "1", "2"]

	def test_row_ids_are_matched_after_trimming(self):
		plan = convert_markers("{{a}}", [" a "])
		assert plan["row_ids"] == ["1"]

	def test_converted_text_is_left_alone(self):
		plan = convert_markers("<p>[[1]] [[2]]</p>", ["1", "2"])
		assert plan["text"] == "<p>[[1]] [[2]]</p>"
		assert plan["ids"] == {}

	def test_second_run_over_the_output_changes_nothing(self):
		first = convert_markers("{{b}} {{a}}", ["a", "b"])
		again = convert_markers(first["text"], first["row_ids"])
		assert again["text"] == first["text"]
		assert again["row_ids"] == first["row_ids"]

	def test_none_text(self):
		assert convert_markers(None, [])["text"] == ""


class TestRemapAnswer:
	def test_keys_follow_the_new_ids(self):
		stored = json.dumps({"a": "圧縮機", "b": "x"}, ensure_ascii=False)
		assert json.loads(remap_answer(stored, {"b": "1", "a": "2"})) == {"2": "圧縮機", "1": "x"}

	def test_swapped_ids_do_not_overwrite_each_other(self):
		stored = json.dumps({"1": "one", "2": "two"})
		assert json.loads(remap_answer(stored, {"1": "2", "2": "1"})) == {"2": "one", "1": "two"}

	def test_unknown_keys_are_dropped(self):
		assert json.loads(remap_answer('{"a": "x", "gone": "y"}', {"a": "1"})) == {"1": "x"}

	def test_unreadable_answers_are_left_alone(self):
		assert remap_answer("not json", {"a": "1"}) is None
		assert remap_answer("[1, 2]", {"a": "1"}) is None
		assert remap_answer(None, {"a": "1"}) is None


class TestConvertSnapshot:
	def test_known_ids_use_the_mapping(self):
		assert convert_snapshot("<p>{{b}} {{a}}</p>", {"b": "1", "a": "2"}) == "<p>[[1]] [[2]]</p>"

	def test_unknown_digit_ids_are_converted_as_they_are(self):
		assert convert_snapshot("{{7}}", {"a": "1"}) == "[[7]]"

	def test_unknown_other_ids_stay_in_the_old_syntax(self):
		assert convert_snapshot("{{zzz}}", {"a": "1"}) == "{{zzz}}"
