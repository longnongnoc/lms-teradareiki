# Copyright (c) 2026, Frappe and Contributors
# For license information, please see license.txt

import frappe

from lms.lms.doctype.lms_quiz.lms_quiz import get_fill_blank_review
from lms.lms.test_helpers import BaseTestUtils


class TestFillBlankReviewAccess(BaseTestUtils):
	"""Who sees a Fill Blank answer key (`accepted`) in get_fill_blank_review."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		suffix = frappe.generate_hash(length=6)
		cls.student = cls._create_user(f"fbra-student-{suffix}@example.com", "Stu", "Dent", ["LMS Student"])
		cls.evaluator = cls._create_user(
			f"fbra-evaluator-{suffix}@example.com", "Eva", "Luator", ["Batch Evaluator"]
		)
		cls.instructor = cls._create_user(
			f"fbra-instructor-{suffix}@example.com", "Ins", "Tructor", ["Course Creator"]
		)
		cls._require_no_moderators(cls.student.name, cls.evaluator.name, cls.instructor.name)

		question = frappe.get_doc(
			{
				"doctype": "LMS Question",
				"type": "Fill Blank",
				"question": f"<p>Capital of France {suffix}: [[1]]</p>",
				"blanks": [{"blank_id": "1", "answers": "Paris", "marks": 5}],
			}
		)
		question.insert()
		cls.question = question.name
		quiz = frappe.get_doc(
			{
				"doctype": "LMS Quiz",
				"title": f"Fill Blank Review Access {suffix}",
				"passing_percentage": 50,
				"questions": [{"question": question.name, "marks": 5}],
			}
		)
		quiz.insert()
		cls.quiz = quiz.name
		cls._set_authors("LMS Quiz", cls.quiz, [cls.instructor.name])
		cls.student_submission = cls._submit(cls.student.name)
		cls.evaluator_submission = cls._submit(cls.evaluator.name)

	@classmethod
	def _submit(cls, member):
		# Inserted directly: the quiz is in no lesson, so submit_quiz would refuse the member.
		submission = frappe.get_doc(
			{
				"doctype": "LMS Quiz Submission",
				"quiz": cls.quiz,
				"member": member,
				"score": 5,
				"score_out_of": 5,
				"percentage": 100,
				"passing_percentage": 50,
				"result": [
					{
						"question": cls.question,
						"question_name": cls.question,
						"question_type": "Fill Blank",
						"answer": frappe.as_json({"1": "Paris"}),
						"marks": 5,
						"marks_out_of": 5,
					}
				],
			}
		)
		# nosemgrep: lms-unjustified-ignore-permissions - fixture seeding, not the permission under test
		submission.insert(ignore_permissions=True)
		return submission.name

	def _settings(self, show_answers, show_answer_review=1):
		frappe.db.set_value(
			"LMS Quiz",
			self.quiz,
			{"show_answers": show_answers, "show_answer_review": show_answer_review},
		)

	def _review_as(self, user, submission):
		frappe.set_user(user)
		try:
			return get_fill_blank_review(submission)
		finally:
			frappe.set_user("Administrator")

	def _blank(self, review):
		self.assertIn(self.question, review)
		return review[self.question]["results"][0]

	def test_learner_gets_no_key_with_show_answers_off(self):
		self._settings(show_answers=0)
		blank = self._blank(self._review_as(self.student.name, self.student_submission))
		self.assertNotIn("accepted", blank)

	def test_learner_gets_the_key_with_show_answers_on(self):
		self._settings(show_answers=1)
		blank = self._blank(self._review_as(self.student.name, self.student_submission))
		self.assertIn("accepted", blank)

	def test_staff_on_own_submission_of_a_quiz_they_do_not_review_gets_no_key(self):
		self._settings(show_answers=0)
		blank = self._blank(self._review_as(self.evaluator.name, self.evaluator_submission))
		self.assertNotIn("accepted", blank)

	def test_the_quizs_instructor_gets_the_key(self):
		self._settings(show_answers=0)
		blank = self._blank(self._review_as(self.instructor.name, self.student_submission))
		self.assertIn("accepted", blank)

	def test_learner_gets_nothing_with_review_off(self):
		self._settings(show_answers=1, show_answer_review=0)
		self.assertEqual(self._review_as(self.student.name, self.student_submission), {})
