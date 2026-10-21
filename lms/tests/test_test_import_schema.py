# Copyright (c) 2026, FOSS United and contributors
# See license.txt
"""Unit tests for the test import validator. No frappe, no bench: run with pytest alone."""

import copy
import importlib.util
import json
import unittest
from pathlib import Path

_LMS_DIR = Path(__file__).resolve().parents[1] / "lms"
_spec = importlib.util.spec_from_file_location(
	"lms_test_import_schema_under_test", _LMS_DIR / "test_import_schema.py"
)
schema = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(schema)

validate = schema.validate
normalize = schema.normalize


def _example():
	with open(_LMS_DIR / "test_import_example.json", encoding="utf-8") as f:
		return json.load(f)


def _doc(*questions, **test_fields):
	test = {
		"title": "テスト",
		"passing_percentage": 60,
		"sections": [{"title": "A", "questions": list(questions)}],
	}
	test.update(test_fields)
	return {"tests": [test]}


def _fill(body="<p>[[1]]</p>", blanks=None):
	return {
		"type": "fill_blank",
		"body": body,
		"blanks": blanks if blanks is not None else [{"id": "1", "answers": ["a"], "marks": 1}],
	}


def _choice(kind="single_choice", correct=(True, False), **extra):
	question = {
		"type": kind,
		"text": "<p>Q</p>",
		"options": [{"text": f"opt{i}", "correct": flag} for i, flag in enumerate(correct)],
	}
	question.update(extra)
	return question


def _has(errors, fragment):
	return any(fragment in error for error in errors)


class TestValidDocuments(unittest.TestCase):
	def test_example_file_is_valid(self):
		assert validate(_example()) == []

	def test_example_normalizes(self):
		out = normalize(_example())
		test = out["tests"][0]
		assert test["title"] == "冷凍サイクル基礎テスト"
		assert len(test["sections"]) == 2
		first = test["sections"][0]["questions"][0]
		assert [blank["id"] for blank in first["blanks"]] == ["1", "2", "3"]
		assert first["blanks"][0]["answers"] == ["圧縮機", "コンプレッサー"]
		assert test["practical_max_marks"] == 20.0

	def test_minimal_document_and_defaults(self):
		doc = _doc(_choice())
		assert validate(doc) == []
		test = normalize(doc)["tests"][0]
		assert test["duration_minutes"] is None
		assert test["shuffle_questions"] is None
		assert test["sections"][0]["questions"][0]["marks"] == 1

	def test_null_section_titles_may_repeat(self):
		doc = _doc(_choice())
		doc["tests"][0]["sections"].append({"title": None, "questions": [_choice()]})
		doc["tests"][0]["sections"].append({"title": None, "questions": [_choice()]})
		assert validate(doc) == []

	def test_integer_blank_id_is_accepted(self):
		doc = _doc(_fill(blanks=[{"id": 1, "answers": ["a"]}]))
		assert validate(doc) == []
		assert normalize(doc)["tests"][0]["sections"][0]["questions"][0]["blanks"][0]["id"] == "1"


class TestDocumentShape(unittest.TestCase):
	def test_not_an_object(self):
		assert _has(validate([]), "document")

	def test_tests_missing_or_empty(self):
		assert _has(validate({}), "tests:")
		assert _has(validate({"tests": []}), "tests:")

	def test_errors_are_collected_not_first_only(self):
		doc = _doc(_choice(correct=(False, False)), _fill(blanks=[]))
		doc["tests"][0]["passing_percentage"] = 150
		errors = validate(doc)
		assert len(errors) >= 3


class TestTestFields(unittest.TestCase):
	def test_title_required_and_length(self):
		assert _has(validate(_doc(_choice(), title="")), "tests[0].title: required")
		assert _has(validate(_doc(_choice(), title="x" * 201)), "tests[0].title: at most 200")
		assert validate(_doc(_choice(), title="あ" * 200)) == []

	def test_passing_percentage(self):
		for bad in (-1, 101, "70", None, True, 70.5):
			assert _has(validate(_doc(_choice(), passing_percentage=bad)), "tests[0].passing_percentage")
		assert validate(_doc(_choice(), passing_percentage=0)) == []
		assert validate(_doc(_choice(), passing_percentage=100)) == []

	def test_duration(self):
		for bad in (0, 241, "30", 1.5):
			assert _has(validate(_doc(_choice(), duration_minutes=bad)), "tests[0].duration_minutes")
		assert validate(_doc(_choice(), duration_minutes=240)) == []

	def test_max_attempts(self):
		assert _has(validate(_doc(_choice(), max_attempts=-1)), "tests[0].max_attempts")
		assert validate(_doc(_choice(), max_attempts=0)) == []

	def test_flags_must_be_bool(self):
		assert _has(validate(_doc(_choice(), shuffle_questions=1)), "tests[0].shuffle_questions")
		assert _has(validate(_doc(_choice(), show_answers="yes")), "tests[0].show_answers")

	def test_practical_max_marks(self):
		assert _has(validate(_doc(_choice(), practical_max_marks=1000)), "practical_max_marks")
		assert _has(validate(_doc(_choice(), practical_max_marks=-1)), "practical_max_marks")
		assert _has(validate(_doc(_choice(), practical_max_marks=1.234)), "2 decimal")
		assert validate(_doc(_choice(), practical_max_marks=999.99)) == []
		assert validate(_doc(_choice(), practical_max_marks=12.5)) == []

	def test_duplicate_test_titles(self):
		doc = {"tests": _doc(_choice())["tests"] * 2}
		assert _has(validate(doc), "tests[1].title: duplicate of tests[0]")


class TestSections(unittest.TestCase):
	def test_sections_required(self):
		doc = _doc(_choice())
		doc["tests"][0]["sections"] = []
		assert _has(validate(doc), "tests[0].sections: at least one section")

	def test_section_without_questions(self):
		doc = _doc(_choice())
		doc["tests"][0]["sections"].append({"title": "B", "questions": []})
		assert _has(validate(doc), "tests[0].sections[1].questions: at least one question")

	def test_too_many_sections(self):
		doc = _doc(_choice())
		doc["tests"][0]["sections"] = [{"title": f"S{i}", "questions": [_choice()]} for i in range(41)]
		assert _has(validate(doc), "at most 40 sections")
		doc["tests"][0]["sections"] = doc["tests"][0]["sections"][:40]
		assert validate(doc) == []

	def test_section_title_length(self):
		doc = _doc(_choice())
		doc["tests"][0]["sections"][0]["title"] = "x" * 141
		assert _has(validate(doc), "sections[0].title: at most 140")

	def test_duplicate_section_title_would_split_a_section(self):
		doc = _doc(_choice())
		doc["tests"][0]["sections"].append({"title": "B", "questions": [_choice()]})
		doc["tests"][0]["sections"].append({"title": "A", "questions": [_choice()]})
		assert _has(validate(doc), "sections[2].title: duplicate of sections[0]")


class TestQuestions(unittest.TestCase):
	def test_unknown_type(self):
		errors = validate(_doc({"type": "essay", "text": "x"}))
		assert _has(errors, "tests[0].sections[0].questions[0].type")

	def test_error_path_is_precise(self):
		doc = {"tests": [_doc(_choice())["tests"][0], _doc(_choice())["tests"][0]]}
		doc["tests"][1]["title"] = "other"
		doc["tests"][1]["sections"][0]["questions"] = [_choice()] * 4 + [
			_fill(blanks=[{"id": "1", "answers": ["a"]}, {"id": "2", "answers": []}], body="[[1]][[2]]")
		]
		errors = validate(doc)
		assert "tests[1].sections[0].questions[4].blanks[1].answers: at least one answer" in errors

	def test_marks_must_be_positive_int(self):
		assert _has(validate(_doc(_choice(marks=0))), "questions[0].marks")
		assert _has(validate(_doc(_choice(marks=1.5))), "questions[0].marks")
		assert validate(_doc(_choice(marks=3))) == []


class TestChoice(unittest.TestCase):
	def test_text_required(self):
		question = _choice()
		question["text"] = " "
		assert _has(validate(_doc(question)), "questions[0].text: required")

	def test_option_count(self):
		one = _choice(correct=(True,))
		assert _has(validate(_doc(one)), "between 2 and 10 options")
		eleven = _choice(correct=(True,) + (False,) * 10)
		assert _has(validate(_doc(eleven)), "between 2 and 10 options")
		ten = _choice(correct=(True,) + (False,) * 9)
		assert validate(_doc(ten)) == []

	def test_single_choice_needs_exactly_one_correct(self):
		assert _has(validate(_doc(_choice(correct=(False, False)))), "exactly 1 correct option, found 0")
		assert _has(validate(_doc(_choice(correct=(True, True)))), "exactly 1 correct option, found 2")

	def test_multiple_choice_needs_at_least_one_correct(self):
		assert _has(validate(_doc(_choice("multiple_choice", (False, False)))), "at least 1 correct")
		assert validate(_doc(_choice("multiple_choice", (True, True, False)))) == []
		assert validate(_doc(_choice("multiple_choice", (True, False)))) == []

	def test_option_needs_text_or_image(self):
		question = _choice()
		question["options"][1] = {"correct": False}
		assert _has(validate(_doc(question)), "options[1]: needs text or image")

	def test_image_only_option_and_url_prefix(self):
		question = _choice()
		question["options"][1] = {"image": "/files/a.png", "correct": False}
		assert validate(_doc(question)) == []
		question["options"][1] = {"image": "https://example.com/a.png", "correct": False}
		assert _has(validate(_doc(question)), "options[1].image: must start with /files/")

	def test_duplicate_options(self):
		question = _choice()
		question["options"][1]["text"] = question["options"][0]["text"]
		assert _has(validate(_doc(question)), "options[1]: duplicate of options[0]")

	def test_reserved_option_text(self):
		question = _choice()
		question["options"][1]["text"] = "[image:2]"
		assert _has(validate(_doc(question)), "[image:N]")

	def test_correct_must_be_bool(self):
		question = _choice()
		question["options"][0]["correct"] = "true"
		assert _has(validate(_doc(question)), "options[0].correct")


class TestUserInput(unittest.TestCase):
	def _q(self, answers):
		return {"type": "user_input", "text": "<p>Q</p>", "answers": answers}

	def test_answers_required(self):
		assert _has(validate(_doc(self._q([]))), "questions[0].answers: at least one answer")
		assert _has(validate(_doc(self._q(None))), "questions[0].answers: at least one answer")

	def test_answer_limits(self):
		assert validate(_doc(self._q(["a"] * 10))) == []
		assert _has(validate(_doc(self._q(["a"] * 11))), "at most 10 answers")

	def test_blank_and_multiline_answer(self):
		assert _has(validate(_doc(self._q([" "]))), "answers[0]: answer must be non-empty")
		assert _has(validate(_doc(self._q(["a\nb"]))), "line break")

	def test_japanese_answers(self):
		doc = _doc(self._q(["オゾン層を破壊しない"]))
		assert validate(doc) == []
		assert normalize(doc)["tests"][0]["sections"][0]["questions"][0]["answers"] == [
			"オゾン層を破壊しない"
		]


class TestFillBlank(unittest.TestCase):
	def test_matching_tokens_pass(self):
		blanks = [{"id": "1", "answers": ["圧縮機"]}, {"id": "2", "answers": ["凝縮器"]}]
		assert validate(_doc(_fill("<p>[[1]]と[[2]]</p>", blanks))) == []

	def test_blank_without_token(self):
		blanks = [{"id": "1", "answers": ["a"]}, {"id": "2", "answers": ["b"]}]
		assert _has(validate(_doc(_fill("<p>[[1]]</p>", blanks))), "no [[n]] marker for blanks 2")

	def test_token_without_blank(self):
		assert _has(validate(_doc(_fill("<p>[[1]][[7]]</p>"))), "markers without a blank 7")

	def test_duplicate_blank_ids(self):
		blanks = [{"id": "1", "answers": ["a"]}, {"id": "1", "answers": ["b"]}]
		assert _has(validate(_doc(_fill("[[1]]", blanks))), "blanks[1].id: duplicate blank id")

	def test_blank_id_must_be_ascii_digits(self):
		for bad in ("a b", "a", "1a", "-1", "1.5", "１", "{1}", "[1]"):
			blanks = [{"id": bad, "answers": ["a"]}]
			assert _has(validate(_doc(_fill("x", blanks))), "blanks[0].id: digits only"), bad

	def test_old_brace_markers_are_not_markers(self):
		blanks = [{"id": "1", "answers": ["a"]}]
		assert _has(validate(_doc(_fill("<p>{{1}}</p>", blanks))), "no [[n]] marker for blanks 1")

	def test_full_width_digit_markers_are_not_markers(self):
		blanks = [{"id": "1", "answers": ["a"]}]
		assert _has(validate(_doc(_fill("<p>[[１]]</p>", blanks))), "no [[n]] marker for blanks 1")

	def test_non_contiguous_ids_pass(self):
		blanks = [{"id": "2", "answers": ["a"]}, {"id": "5", "answers": ["b"]}]
		assert validate(_doc(_fill("<p>[[5]] [[2]]</p>", blanks))) == []

	def test_blank_marks_whole_number_at_least_one(self):
		for bad in (0, 1.5, -1, "1"):
			blanks = [{"id": "1", "answers": ["a"], "marks": bad}]
			assert _has(validate(_doc(_fill(blanks=blanks))), "blanks[0].marks")

	def test_blank_requires_answer(self):
		blanks = [{"id": "1", "answers": []}]
		assert _has(validate(_doc(_fill(blanks=blanks))), "blanks[0].answers: at least one answer")

	def test_blanks_and_body_required(self):
		assert _has(validate(_doc(_fill(blanks=[]))), "questions[0].blanks: at least one blank")
		assert _has(validate(_doc(_fill(body=" "))), "questions[0].body: required")

	def test_html_table_and_img_are_allowed(self):
		body = '<table><tr><td>[[1]]</td></tr></table><img src="/files/x.png">'
		assert validate(_doc(_fill(body))) == []

	def test_normalize_trims_and_defaults_marks(self):
		blanks = [{"id": "1", "answers": [" 圧縮機 ", "コンプレッサー"]}]
		out = normalize(_doc(_fill(blanks=blanks)))["tests"][0]["sections"][0]["questions"][0]
		assert out["blanks"] == [{"id": "1", "answers": ["圧縮機", "コンプレッサー"], "marks": 1}]


class TestInputIsNotMutated(unittest.TestCase):
	def test_validate_does_not_mutate_input(self):
		doc = _example()
		before = copy.deepcopy(doc)
		validate(doc)
		normalize(doc)
		assert doc == before
