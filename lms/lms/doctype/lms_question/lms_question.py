# Copyright (c) 2023, Frappe and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document

from lms.lms.doctype.lms_content_author.lms_content_author import AuthoredDocument
from lms.lms.utils import has_course_instructor_role, has_moderator_role

# Each LMS Question carries up to 10 option/correctness/explanation/possibility
# columns. Keep these lists as the single source of truth so any future change
# to cardinality touches one place.
QUESTION_OPTION_FIELDS = [f"option_{i}" for i in range(1, 11)]
QUESTION_CORRECTNESS_FIELDS = [f"is_correct_{i}" for i in range(1, 11)]
QUESTION_EXPLANATION_FIELDS = [f"explanation_{i}" for i in range(1, 11)]
QUESTION_POSSIBILITY_FIELDS = [f"possibility_{i}" for i in range(1, 11)]


class LMSQuestion(AuthoredDocument, Document):
	def validate(self):
		validate_correct_answers(self)
		update_question_title(self)


def validate_correct_answers(question):
	if question.type == "Choices":
		validate_duplicate_options(question)
		validate_minimum_options(question)
		validate_correct_options(question)
	elif question.type == "User Input":
		validate_possible_answer(question)
	elif question.type == "Blanks":
		validate_blanks(question)


def validate_duplicate_options(question):
	options = [question.get(f) for f in QUESTION_OPTION_FIELDS if question.get(f)]
	if len(set(options)) != len(options):
		frappe.throw(_("Duplicate options found for this question."))


def validate_correct_options(question):
	correct_options = get_correct_options(question)

	if len(correct_options) > 1:
		question.multiple = 1
	else:
		question.multiple = 0

	if not len(correct_options):
		frappe.throw(_("At least one option must be correct for this question."))


def validate_minimum_options(question):
	if question.type == "Choices" and (not question.option_1 or not question.option_2):
		frappe.throw(_("Minimum two options are required for multiple choice questions."))


def validate_possible_answer(question):
	if not any(question.get(f) for f in QUESTION_POSSIBILITY_FIELDS):
		frappe.throw(
			_("Add at least one possible answer for this question: {0}").format(
				frappe.bold(question.question)
			)
		)


def validate_blanks(question):
	# Tags become a placeholder so a marker inside an attribute (an alt text) is not a
	# blank, and one split across tags ([[<b>1</b>]]) is not either: neither gets an input.
	text = re.sub(r"<[^>]*>", "\x00", question.question or "")
	markers = re.findall(r"\[\[(\d+)\]\]", text)
	lines = (question.blank_answers or "").rstrip().splitlines()
	if not markers or markers != [str(i) for i in range(1, len(markers) + 1)]:
		frappe.throw(_("Mark the blanks in the question as [[1]], [[2]], ... in order."))
	if len(lines) != len(markers):
		frappe.throw(_("Give one line of accepted answers for each of the {0} blanks.").format(len(markers)))
	for number, line in enumerate(lines, 1):
		if not any(answer.strip() for answer in line.split("|")):
			frappe.throw(_("Blank [[{0}]] needs at least one accepted answer.").format(number))


def update_question_title(question):
	if not question.is_new():
		question_rows = frappe.get_all("LMS Quiz Question", {"question": question.name}, pluck="name")

		for row in question_rows:
			frappe.db.set_value("LMS Quiz Question", row, "question_detail", question.question)


def get_correct_options(question):
	return [f for f in QUESTION_CORRECTNESS_FIELDS if question.get(f) == 1]
