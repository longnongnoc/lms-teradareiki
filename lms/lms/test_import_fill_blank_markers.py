import io
import json
import zipfile

import frappe

from lms.lms.course_import_export import build_assessment_doc, create_question_doc
from lms.lms.test_helpers import BaseTestUtils


class TestImportLegacyFillBlankMarkers(BaseTestUtils):
	def _import_question(self, question_data):
		buffer = io.BytesIO()
		with zipfile.ZipFile(buffer, "w") as archive:
			archive.writestr("assessments/questions/question.json", json.dumps(question_data))
		with zipfile.ZipFile(buffer) as archive:
			create_question_doc(archive, "assessments/questions/question.json")

	def _blanks(self, question_name):
		doc = frappe.get_doc("LMS Question", question_name)
		return {row.blank_id: row.answers for row in doc.blanks}

	def test_digit_markers_are_converted_and_the_question_is_linked_with_its_marks(self):
		suffix = frappe.generate_hash(length=8)
		legacy = f"<p>legacy {suffix}: {{{{1}}}} and {{{{ 2 }}}}</p>"
		current = f"<p>current {suffix}: [[1]]</p>"
		self._import_question(
			{
				"doctype": "LMS Question",
				"type": "Fill Blank",
				"question": legacy,
				"blanks": [
					{"blank_id": "1", "answers": "alpha", "marks": 2},
					{"blank_id": "2", "answers": "beta", "marks": 3},
				],
			}
		)
		self._import_question(
			{
				"doctype": "LMS Question",
				"type": "Fill Blank",
				"question": current,
				"blanks": [{"blank_id": "1", "answers": "gamma", "marks": 1}],
			}
		)

		converted = f"<p>legacy {suffix}: [[1]] and [[2]]</p>"
		name = frappe.db.get_value("LMS Question", {"question": converted}, "name")
		self.assertTrue(name)
		self.assertFalse(frappe.db.exists("LMS Question", {"question": legacy}))
		self.assertEqual(self._blanks(name), {"1": "alpha", "2": "beta"})
		self.assertEqual(frappe.db.get_value("LMS Question", name, "marks"), 5)

		quiz_name = f"import-legacy-{suffix}"
		build_assessment_doc(
			{
				"doctype": "LMS Quiz",
				"name": quiz_name,
				"title": f"Import Legacy {suffix}",
				"passing_percentage": 50,
				"questions": [
					{"question_detail": legacy, "marks": 4},
					{"question_detail": current},
				],
			}
		)

		quiz = frappe.get_doc("LMS Quiz", quiz_name)
		self.assertEqual(len(quiz.questions), 2)
		self.assertEqual(quiz.questions[0].question, name)
		self.assertEqual(quiz.questions[0].marks, 4)
		self.assertEqual(quiz.questions[1].question_detail, current)
		self.assertEqual(quiz.questions[1].marks, 1)

	def test_a_legacy_quiz_with_no_marks_uses_the_converted_questions_marks(self):
		suffix = frappe.generate_hash(length=8)
		legacy = f"<p>fallback {suffix} {{{{1}}}}</p>"
		self._import_question(
			{
				"doctype": "LMS Question",
				"type": "Fill Blank",
				"question": legacy,
				"blanks": [{"blank_id": "1", "answers": "alpha", "marks": 3}],
			}
		)

		quiz_name = f"import-legacy-fallback-{suffix}"
		build_assessment_doc(
			{
				"doctype": "LMS Quiz",
				"name": quiz_name,
				"title": f"Import Legacy Fallback {suffix}",
				"passing_percentage": 50,
				"questions": [{"question_detail": legacy}],
			}
		)

		quiz = frappe.get_doc("LMS Quiz", quiz_name)
		self.assertEqual([row.marks for row in quiz.questions], [3])

	def test_non_digit_ids_are_renumbered_with_their_rows_and_the_quiz_link(self):
		suffix = frappe.generate_hash(length=8)
		legacy = f"<p>renumber {suffix}: {{{{b}}}} then {{{{a}}}} then {{{{b}}}}</p>"
		self._import_question(
			{
				"doctype": "LMS Question",
				"type": "Fill Blank",
				"question": legacy,
				"blanks": [
					{"blank_id": "a", "answers": "answer for a", "marks": 1},
					{"blank_id": "b", "answers": "answer for b", "marks": 2},
				],
			}
		)

		converted = f"<p>renumber {suffix}: [[1]] then [[2]] then [[1]]</p>"
		name = frappe.db.get_value("LMS Question", {"question": converted}, "name")
		self.assertTrue(name)
		self.assertEqual(self._blanks(name), {"2": "answer for a", "1": "answer for b"})

		quiz_name = f"import-legacy-renumber-{suffix}"
		build_assessment_doc(
			{
				"doctype": "LMS Quiz",
				"name": quiz_name,
				"title": f"Import Legacy Renumber {suffix}",
				"passing_percentage": 50,
				"questions": [{"question_detail": legacy, "marks": 3}],
			}
		)

		quiz = frappe.get_doc("LMS Quiz", quiz_name)
		self.assertEqual([row.question for row in quiz.questions], [name])
		self.assertEqual([row.marks for row in quiz.questions], [3])
