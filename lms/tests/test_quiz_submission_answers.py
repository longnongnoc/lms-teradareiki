# Copyright (c) 2026, FOSS United and contributors
# See license.txt
"""get_submission_answers: who may read a submission question by question, and when the
correct answers are part of the reply."""

import frappe
from frappe.tests import IntegrationTestCase

from lms.lms.quiz_results import get_submission_answers


def _make_user(email, role):
	return frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": "Answers",
			"last_name": role,
			"send_welcome_email": 0,
			"roles": [{"role": role}],
		}
	).insert(ignore_permissions=True)


class TestGetSubmissionAnswers(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		hash_ = frappe.generate_hash(length=6)
		cls.learner = _make_user(f"answers-learner-{hash_}@test.com", "LMS Student")
		cls.outsider = _make_user(f"answers-outsider-{hash_}@test.com", "LMS Student")
		cls.instructor = _make_user(f"answers-instructor-{hash_}@test.com", "Course Creator")

		question = frappe.new_doc("LMS Question")
		question.update(
			{
				"question": f"Submission answers question {hash_}?",
				"type": "Choices",
				"option_1": "Right",
				"is_correct_1": 1,
				"option_2": "Wrong",
				"is_correct_2": 0,
			}
		)
		question.save(ignore_permissions=True)
		cls.question = question

		quiz = frappe.new_doc("LMS Quiz")
		quiz.update({"title": f"Submission Answers Quiz {hash_}", "passing_percentage": 50})
		quiz.append("questions", {"question": question.name, "marks": 2})
		quiz.append("authors", {"author": cls.instructor.name})
		quiz.save(ignore_permissions=True)
		cls.quiz = quiz

		submission = frappe.new_doc("LMS Quiz Submission")
		submission.update(
			{
				"quiz": quiz.name,
				"member": cls.learner.name,
				"score": 0,
				"score_out_of": 2,
				"percentage": 0,
				"passing_percentage": 50,
				"result": [
					{
						"question_name": question.name,
						"question": question.question,
						"question_type": "Choices",
						"answer": "Wrong",
						"marks": 0,
						"marks_out_of": 2,
						"is_correct": 0,
					}
				],
			}
		)
		submission.save(ignore_permissions=True)
		cls.submission = submission

	def _call(self, user, show_answers=0):
		frappe.db.set_value("LMS Quiz", self.quiz.name, "show_answers", show_answers)
		original = frappe.session.user
		frappe.session.user = user
		try:
			return get_submission_answers(self.submission.name)
		finally:
			frappe.session.user = original

	def test_owner_reads_their_own_submission(self):
		data = self._call(self.learner.name)
		self.assertEqual(data["member"], self.learner.name)
		self.assertEqual(len(data["questions"]), 1)
		row = data["questions"][0]
		self.assertEqual(row["question_name"], self.question.name)
		self.assertEqual(row["question_type"], "Choices")
		self.assertIn("Wrong", row["answer"])
		self.assertEqual(row["marks"], 0)
		self.assertEqual(row["marks_out_of"], 2)

	def test_another_learner_is_refused(self):
		with self.assertRaises(frappe.PermissionError):
			self._call(self.outsider.name)

	def test_guest_is_refused(self):
		with self.assertRaises(frappe.PermissionError):
			self._call("Guest")

	def test_instructor_reads_the_submission_with_correct_answers(self):
		data = self._call(self.instructor.name)
		self.assertTrue(data["show_correct_answers"])
		self.assertEqual(data["questions"][0]["correct_answer"], "Right")

	def test_learner_gets_no_correct_answer_when_show_answers_is_off(self):
		data = self._call(self.learner.name, show_answers=0)
		self.assertFalse(data["show_correct_answers"])
		self.assertNotIn("correct_answer", data["questions"][0])

	def test_learner_gets_the_correct_answer_when_show_answers_is_on(self):
		data = self._call(self.learner.name, show_answers=1)
		self.assertTrue(data["show_correct_answers"])
		self.assertEqual(data["questions"][0]["correct_answer"], "Right")

	def test_unknown_submission_is_a_validation_error(self):
		original = frappe.session.user
		frappe.session.user = self.learner.name
		try:
			with self.assertRaises(frappe.ValidationError):
				get_submission_answers("no-such-submission-xyz")
		finally:
			frappe.session.user = original
