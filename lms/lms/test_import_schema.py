# Copyright (c) 2026, FOSS United and contributors
# For license information, please see license.txt

"""Validator and normalizer for the test import JSON document (see test_import.py).

Pure python on purpose: no frappe import, so it can be unit tested without a bench.
Messages are plain English strings that start with the JSON path of the offending value.
"""

import re

MAX_TITLE = 200
MAX_SECTION_TITLE = 140
MAX_SECTIONS = 40
MAX_OPTIONS = 10
MIN_OPTIONS = 2
MAX_INPUT_ANSWERS = 10
MAX_PRACTICAL_MARKS = 999.99
MAX_DURATION_MINUTES = 240

QUESTION_TYPES = ("fill_blank", "single_choice", "multiple_choice", "user_input")

BLANK_ID = re.compile(r"[0-9]+")
BLANK_TOKEN = re.compile(r"\[\[([0-9]+)\]\]")
RESERVED_OPTION_TEXT = re.compile(r"\[image:\d+\]")
FILE_URL_PREFIXES = ("/files/", "/private/files/")


def _is_int(value) -> bool:
	if isinstance(value, bool):
		return False
	if isinstance(value, int):
		return True
	return isinstance(value, float) and value.is_integer()


def _is_number(value) -> bool:
	return isinstance(value, int | float) and not isinstance(value, bool)


def _has_at_most_two_decimals(value) -> bool:
	scaled = float(value) * 100
	return abs(scaled - round(scaled)) < 1e-6


def _blank_text(value) -> bool:
	return isinstance(value, str) and bool(value.strip())


def validate(doc) -> list[str]:
	"""Every problem found in `doc`, never stopping at the first. Empty means valid."""
	errors = []
	if not isinstance(doc, dict):
		return ['document: must be a JSON object with a "tests" list']

	tests = doc.get("tests")
	if not isinstance(tests, list) or not tests:
		return ["tests: must be a non-empty list"]

	seen_titles = {}
	for index, test in enumerate(tests):
		path = f"tests[{index}]"
		_validate_test(test, path, errors)
		title = test.get("title") if isinstance(test, dict) else None
		if isinstance(title, str) and title.strip():
			key = title.strip().casefold()
			if key in seen_titles:
				errors.append(
					f"{path}.title: duplicate of tests[{seen_titles[key]}].title ({title.strip()!r})"
				)
			else:
				seen_titles[key] = index
	return errors


def _validate_test(test, path, errors):
	if not isinstance(test, dict):
		errors.append(f"{path}: must be an object")
		return

	title = test.get("title")
	if not isinstance(title, str) or not title.strip():
		errors.append(f"{path}.title: required text")
	elif len(title.strip()) > MAX_TITLE:
		errors.append(f"{path}.title: at most {MAX_TITLE} characters")

	description = test.get("description")
	if description is not None and not isinstance(description, str):
		errors.append(f"{path}.description: must be text")

	passing = test.get("passing_percentage")
	if not _is_int(passing):
		errors.append(f"{path}.passing_percentage: required whole number from 0 to 100")
	elif not 0 <= passing <= 100:
		errors.append(f"{path}.passing_percentage: must be between 0 and 100")

	duration = test.get("duration_minutes")
	if duration is not None:
		if not _is_int(duration) or not 1 <= duration <= MAX_DURATION_MINUTES:
			errors.append(f"{path}.duration_minutes: whole number from 1 to {MAX_DURATION_MINUTES}")

	attempts = test.get("max_attempts")
	if attempts is not None and (not _is_int(attempts) or attempts < 0):
		errors.append(f"{path}.max_attempts: whole number, 0 or more")

	for flag in ("shuffle_questions", "show_answers"):
		if test.get(flag) is not None and not isinstance(test.get(flag), bool):
			errors.append(f"{path}.{flag}: must be true or false")

	practical = test.get("practical_max_marks")
	if practical is not None:
		if not _is_number(practical) or not 0 <= practical <= MAX_PRACTICAL_MARKS:
			errors.append(f"{path}.practical_max_marks: number from 0 to {MAX_PRACTICAL_MARKS}")
		elif not _has_at_most_two_decimals(practical):
			errors.append(f"{path}.practical_max_marks: at most 2 decimal places")

	sections = test.get("sections")
	if not isinstance(sections, list) or not sections:
		errors.append(f"{path}.sections: at least one section")
		return
	if len(sections) > MAX_SECTIONS:
		errors.append(f"{path}.sections: at most {MAX_SECTIONS} sections")

	seen_sections = {}
	for index, section in enumerate(sections):
		section_path = f"{path}.sections[{index}]"
		_validate_section(section, section_path, errors)
		section_title = section.get("title") if isinstance(section, dict) else None
		if isinstance(section_title, str) and section_title.strip():
			key = section_title.strip()
			# One title is one run of rows, so a title cannot come back after another section.
			if key in seen_sections:
				errors.append(
					f"{section_path}.title: duplicate of sections[{seen_sections[key]}].title ({key!r})"
				)
			else:
				seen_sections[key] = index


def _validate_section(section, path, errors):
	if not isinstance(section, dict):
		errors.append(f"{path}: must be an object")
		return

	title = section.get("title")
	if title is not None:
		if not isinstance(title, str):
			errors.append(f"{path}.title: must be text or null")
		elif len(title.strip()) > MAX_SECTION_TITLE:
			errors.append(f"{path}.title: at most {MAX_SECTION_TITLE} characters")

	questions = section.get("questions")
	if not isinstance(questions, list) or not questions:
		errors.append(f"{path}.questions: at least one question")
		return

	for index, question in enumerate(questions):
		_validate_question(question, f"{path}.questions[{index}]", errors)


def _validate_marks(question, path, errors):
	marks = question.get("marks")
	if marks is not None and (not _is_int(marks) or marks < 1):
		errors.append(f"{path}.marks: whole number, 1 or more")


def _validate_question(question, path, errors):
	if not isinstance(question, dict):
		errors.append(f"{path}: must be an object")
		return

	kind = question.get("type")
	if kind not in QUESTION_TYPES:
		errors.append(f"{path}.type: must be one of {', '.join(QUESTION_TYPES)}")
		return

	if kind == "fill_blank":
		_validate_fill_blank(question, path, errors)
		return

	if not _blank_text(question.get("text")):
		errors.append(f"{path}.text: required text")
	_validate_marks(question, path, errors)

	if kind == "user_input":
		_validate_user_input(question, path, errors)
	else:
		_validate_choices(question, kind, path, errors)


def _validate_answer_list(answers, path, errors, maximum=None):
	if not isinstance(answers, list) or not answers:
		errors.append(f"{path}: at least one answer")
		return
	if maximum and len(answers) > maximum:
		errors.append(f"{path}: at most {maximum} answers")
	for index, answer in enumerate(answers):
		if not _blank_text(answer):
			errors.append(f"{path}[{index}]: answer must be non-empty text")
		elif "\n" in answer or "\r" in answer:
			errors.append(f"{path}[{index}]: answer cannot contain a line break")


def _validate_user_input(question, path, errors):
	_validate_answer_list(question.get("answers"), f"{path}.answers", errors, MAX_INPUT_ANSWERS)


def _validate_choices(question, kind, path, errors):
	options = question.get("options")
	if not isinstance(options, list) or not MIN_OPTIONS <= len(options) <= MAX_OPTIONS:
		errors.append(f"{path}.options: between {MIN_OPTIONS} and {MAX_OPTIONS} options")
		return

	correct = 0
	seen = {}
	for index, option in enumerate(options):
		option_path = f"{path}.options[{index}]"
		if not isinstance(option, dict):
			errors.append(f"{option_path}: must be an object")
			continue

		text = option.get("text")
		image = option.get("image")
		if text is not None and not isinstance(text, str):
			errors.append(f"{option_path}.text: must be text")
			text = None
		if image is not None and not isinstance(image, str):
			errors.append(f"{option_path}.image: must be a file url")
			image = None
		if not (text or "").strip() and not (image or "").strip():
			errors.append(f"{option_path}: needs text or image")
		if image and not image.startswith(FILE_URL_PREFIXES):
			errors.append(f"{option_path}.image: must start with /files/ or /private/files/")
		if text and RESERVED_OPTION_TEXT.fullmatch(text.strip()):
			errors.append(f"{option_path}.text: cannot be written as [image:N]")

		signature = ((text or "").strip(), (image or "").strip())
		if any(signature) and signature in seen:
			errors.append(f"{option_path}: duplicate of options[{seen[signature]}]")
		elif any(signature):
			seen[signature] = index

		flag = option.get("correct", False)
		if not isinstance(flag, bool):
			errors.append(f"{option_path}.correct: must be true or false")
		elif flag:
			correct += 1

		explanation = option.get("explanation")
		if explanation is not None and not isinstance(explanation, str):
			errors.append(f"{option_path}.explanation: must be text")

	if kind == "single_choice" and correct != 1:
		errors.append(f"{path}.options: single_choice needs exactly 1 correct option, found {correct}")
	elif kind == "multiple_choice" and correct < 1:
		errors.append(f"{path}.options: multiple_choice needs at least 1 correct option")


def _validate_fill_blank(question, path, errors):
	body = question.get("body")
	if not _blank_text(body):
		errors.append(f"{path}.body: required text")
		body = ""

	explanation = question.get("explanation")
	if explanation is not None and not isinstance(explanation, str):
		errors.append(f"{path}.explanation: must be text")

	blanks = question.get("blanks")
	if not isinstance(blanks, list) or not blanks:
		errors.append(f"{path}.blanks: at least one blank")
		return

	ids = []
	for index, blank in enumerate(blanks):
		blank_path = f"{path}.blanks[{index}]"
		if not isinstance(blank, dict):
			errors.append(f"{blank_path}: must be an object")
			continue

		raw_id = blank.get("id")
		blank_id = (
			str(raw_id).strip() if isinstance(raw_id, str | int) and not isinstance(raw_id, bool) else ""
		)
		if not blank_id:
			errors.append(f"{blank_path}.id: required")
		elif BLANK_ID.fullmatch(blank_id) is None:
			errors.append(f"{blank_path}.id: digits only, such as 1 or 2")
		elif blank_id in ids:
			errors.append(f"{blank_path}.id: duplicate blank id {blank_id!r}")
		else:
			ids.append(blank_id)

		_validate_answer_list(blank.get("answers"), f"{blank_path}.answers", errors)

		marks = blank.get("marks", 1)
		if not _is_int(marks) or marks < 1:
			errors.append(f"{blank_path}.marks: whole number, 1 or more")

	tokens = []
	for token in BLANK_TOKEN.findall(body):
		if token not in tokens:
			tokens.append(token)
	missing = [blank_id for blank_id in ids if blank_id not in tokens]
	extra = [token for token in tokens if token not in ids]
	if missing:
		errors.append(f"{path}.body: no [[n]] marker for blanks {', '.join(missing)}")
	if extra:
		errors.append(f"{path}.body: markers without a blank {', '.join(extra)}")


def normalize(doc) -> dict:
	"""A clean structure for creation. Assumes validate(doc) returned no errors."""
	return {"tests": [_normalize_test(test) for test in doc["tests"]]}


def _optional(value, convert):
	return None if value is None else convert(value)


def _normalize_test(test) -> dict:
	return {
		"title": test["title"].strip(),
		"description": (test.get("description") or "").strip() or None,
		"passing_percentage": int(test["passing_percentage"]),
		"duration_minutes": _optional(test.get("duration_minutes"), int),
		"max_attempts": _optional(test.get("max_attempts"), int),
		"shuffle_questions": test.get("shuffle_questions"),
		"show_answers": test.get("show_answers"),
		"practical_max_marks": _optional(test.get("practical_max_marks"), lambda v: round(float(v), 2)),
		"sections": [
			{
				"title": (section.get("title") or "").strip() or None,
				"questions": [_normalize_question(q) for q in section["questions"]],
			}
			for section in test["sections"]
		],
	}


def _normalize_question(question) -> dict:
	kind = question["type"]
	if kind == "fill_blank":
		return {
			"type": kind,
			"body": question["body"],
			"blanks": [
				{
					"id": str(blank["id"]).strip(),
					"answers": [answer.strip() for answer in blank["answers"]],
					"marks": int(blank.get("marks", 1)),
				}
				for blank in question["blanks"]
			],
			"explanation": (question.get("explanation") or "").strip() or None,
		}

	marks = int(question.get("marks") or 1)
	if kind == "user_input":
		return {
			"type": kind,
			"text": question["text"],
			"answers": [answer.strip() for answer in question["answers"]],
			"marks": marks,
		}

	return {
		"type": kind,
		"text": question["text"],
		"options": [
			{
				"text": (option.get("text") or "").strip() or None,
				"image": (option.get("image") or "").strip() or None,
				"correct": bool(option.get("correct", False)),
				"explanation": (option.get("explanation") or "").strip() or None,
			}
			for option in question["options"]
		],
		"marks": marks,
	}
