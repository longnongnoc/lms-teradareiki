# Copyright (c) 2026, FOSS United and contributors
# For license information, please see license.txt

"""Bulk import of tests (LMS Quiz) and their questions from one JSON file.

The document format is described by lms/lms/test_import_schema.py and shown in
lms/lms/test_import_example.json. Top level: {"tests": [{title, passing_percentage,
sections: [{title, questions: [...]}], ...}]}. Question types: fill_blank (body with
[[1]] [[2]] markers plus blanks), single_choice, multiple_choice, user_input.

Always run a dry run first, it validates everything and writes nothing:

	bench --site <site> execute lms.lms.test_import.import_file \
		--kwargs "{'path': '/abs/path/tests.json', 'dry_run': 1}"

Then import for real (a test whose title already exists is skipped):

	bench --site <site> execute lms.lms.test_import.import_file \
		--kwargs "{'path': '/abs/path/tests.json', 'dry_run': 0}"

Add 'update_existing': 1 to rebuild the questions and settings of tests that already
exist. Old questions stay in the question bank, nothing is deleted.

The same logic is available to a System Manager or Moderator as the whitelisted
lms.lms.test_import.import_tests. LMS Quiz has no description field, so a test's
"description" and a fill_blank "explanation" are reported in "warnings" and not stored.
"""

import os

import frappe
from frappe import _
from frappe.utils import cint

from lms.lms.doctype.lms_question.lms_question import (
	QUESTION_CORRECTNESS_FIELDS,
	QUESTION_EXPLANATION_FIELDS,
	QUESTION_OPTION_FIELDS,
	QUESTION_OPTION_IMAGE_FIELDS,
	QUESTION_POSSIBILITY_FIELDS,
)
from lms.lms.test_import_schema import normalize, validate

ALLOWED_ROLES = ("System Manager", "Moderator")
SAVEPOINT = "lms_test_import"


def _flag(value) -> bool:
	if isinstance(value, str):
		return value.strip().lower() in ("1", "true", "yes")
	return bool(value)


# nosemgrep: frappe-test-whitelist-missing-protection - "tests" are quizzes; only_for gates it
@frappe.whitelist()
def import_tests(
	data: str | dict, dry_run: bool | int | str = True, update_existing: bool | int | str = False
):
	frappe.only_for(ALLOWED_ROLES)
	dry_run = _flag(dry_run)
	update_existing = _flag(update_existing)

	result = {"ok": False, "errors": [], "created": [], "skipped": [], "updated": [], "warnings": []}

	if isinstance(data, str):
		try:
			data = frappe.parse_json(data)
		except Exception:
			result["errors"].append("document: not valid JSON")
			return result

	result["errors"] = validate(data)
	if result["errors"]:
		return result

	tests = normalize(data)["tests"]
	for index, test in enumerate(tests):
		result["warnings"].extend(_ignored_fields(test, index))

	for index, test in enumerate(tests):
		existing = frappe.db.get_value("LMS Quiz", {"title": test["title"]}, "name")
		if existing and not update_existing:
			result["skipped"].append(
				{"title": test["title"], "quiz": existing, "reason": "a test with this title already exists"}
			)
			continue

		count = sum(len(section["questions"]) for section in test["sections"])
		if dry_run:
			entry = {"title": test["title"], "quiz": existing, "questions": count}
			result["updated" if existing else "created"].append(entry)
			continue

		frappe.db.savepoint(SAVEPOINT)
		try:
			quiz = _write_test(test, existing)
		except Exception as e:
			frappe.db.rollback(save_point=SAVEPOINT)
			message = getattr(e, "message", None) or str(e)
			result["errors"].append(f"tests[{index}] ({test['title']}): {message}")
			continue

		frappe.db.commit()
		entry = {"title": test["title"], "quiz": quiz, "questions": count}
		result["updated" if existing else "created"].append(entry)

	result["ok"] = not result["errors"]
	return result


def import_file(path, dry_run=1, update_existing=0):
	"""Command line entry point: import_tests on a .json file read as utf-8."""
	path = os.path.realpath(str(path))
	if not path.lower().endswith(".json") or not os.path.isfile(path):
		frappe.throw(_("{0} is not an existing .json file.").format(frappe.bold(path)))

	with open(path, encoding="utf-8-sig") as f:
		data = f.read()
	return import_tests(data, dry_run=dry_run, update_existing=update_existing)


def _ignored_fields(test, index) -> list[str]:
	warnings = []
	if test["description"]:
		warnings.append(f"tests[{index}].description: ignored, LMS Quiz has no description field")
	for s_index, section in enumerate(test["sections"]):
		for q_index, question in enumerate(section["questions"]):
			if question["type"] == "fill_blank" and question["explanation"]:
				warnings.append(
					f"tests[{index}].sections[{s_index}].questions[{q_index}].explanation: "
					"ignored, Fill Blank questions have no explanation field"
				)
	return warnings


def _write_test(test, existing):
	rows = []
	for section in test["sections"]:
		for question in section["questions"]:
			name, marks = _create_question(question)
			rows.append({"question": name, "marks": marks, "group": section["title"]})

	if existing:
		quiz = frappe.get_doc("LMS Quiz", existing)
		quiz.set("questions", [])
	else:
		quiz = frappe.new_doc("LMS Quiz")
		quiz.title = test["title"]

	quiz.passing_percentage = test["passing_percentage"]
	if test["duration_minutes"] is not None:
		quiz.duration = str(test["duration_minutes"])
	if test["max_attempts"] is not None:
		quiz.max_attempts = test["max_attempts"]
	for flag in ("shuffle_questions", "show_answers"):
		if test[flag] is not None:
			quiz.set(flag, cint(test[flag]))
	if test["practical_max_marks"] is not None:
		quiz.practical_max_marks = test["practical_max_marks"]

	for row in rows:
		quiz.append("questions", row)

	# nosemgrep: lms-unjustified-ignore-permissions - only_for(System Manager, Moderator) gates import_tests
	quiz.save(ignore_permissions=True)
	return quiz.name


def _create_question(question):
	"""Insert one LMS Question, returning (name, marks). Authors are left to the
	AuthoredDocument seed, so the question answers to whoever imported it."""
	doc = frappe.new_doc("LMS Question")

	if question["type"] == "fill_blank":
		doc.type = "Fill Blank"
		doc.question = question["body"]
		for blank in question["blanks"]:
			doc.append(
				"blanks",
				{"blank_id": blank["id"], "answers": "\n".join(blank["answers"]), "marks": blank["marks"]},
			)
	elif question["type"] == "user_input":
		doc.type = "User Input"
		doc.question = question["text"]
		doc.marks = question["marks"]
		for field, answer in zip(QUESTION_POSSIBILITY_FIELDS, question["answers"], strict=False):
			doc.set(field, answer)
	else:
		doc.type = "Choices"
		doc.question = question["text"]
		doc.marks = question["marks"]
		for index, option in enumerate(question["options"]):
			doc.set(QUESTION_OPTION_FIELDS[index], option["text"])
			doc.set(QUESTION_OPTION_IMAGE_FIELDS[index], option["image"])
			doc.set(QUESTION_CORRECTNESS_FIELDS[index], 1 if option["correct"] else 0)
			doc.set(QUESTION_EXPLANATION_FIELDS[index], option["explanation"])

	# nosemgrep: lms-unjustified-ignore-permissions - only_for(System Manager, Moderator) gates import_tests
	doc.insert(ignore_permissions=True)
	return doc.name, cint(doc.marks)
