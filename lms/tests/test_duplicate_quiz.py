# Copyright (c) 2026, Frappe and Contributors
# For license information, please see license.txt

import frappe

from lms.lms.doctype.lms_quiz.lms_quiz import duplicate_quiz
from lms.lms.test_helpers import BaseTestUtils


class TestDuplicateQuiz(BaseTestUtils):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		suffix = frappe.generate_hash(length=6)
		cls.student = cls._create_user(f"dq-student-{suffix}@example.com", "Stu", "Dent", ["LMS Student"])
		cls.questions = cls._create_quiz_questions()
		cls.quiz = cls._create_quiz(cls.questions, title=f"Duplicate Source {suffix}")
		frappe.db.set_value(
			"LMS Quiz",
			cls.quiz.name,
			{
				"instructions": "<p>Read carefully.</p>",
				"duration": "30",
				"max_attempts": 2,
				"show_answers": 0,
			},
		)
		# Inserted directly: the quiz is in no lesson, so submit_quiz would refuse the student.
		submission = frappe.get_doc(
			{
				"doctype": "LMS Quiz Submission",
				"quiz": cls.quiz.name,
				"member": cls.student.name,
				"score": 0,
				"score_out_of": 15,
				"percentage": 0,
				"passing_percentage": 70,
			}
		)
		# nosemgrep: lms-unjustified-ignore-permissions - fixture seeding, not the permission under test
		submission.insert(ignore_permissions=True)
		cls._require_no_moderators(cls.student.name)

	def test_copies_settings_and_questions_into_a_new_quiz(self):
		name = duplicate_quiz(self.quiz.name)
		source = frappe.get_doc("LMS Quiz", self.quiz.name)
		copy = frappe.get_doc("LMS Quiz", name)

		self.assertNotEqual(copy.name, source.name)
		self.assertNotEqual(copy.title, source.title)
		self.assertIn(source.title, copy.title)
		for field in (
			"instructions",
			"duration",
			"max_attempts",
			"show_answers",
			"passing_percentage",
			"total_marks",
			"total_questions",
		):
			self.assertEqual(copy.get(field), source.get(field), field)
		self.assertEqual(
			[(row.question, row.marks) for row in copy.questions],
			[(row.question, row.marks) for row in source.questions],
		)
		# The rows are the copy's own, not the source's moved over.
		self.assertFalse({row.name for row in copy.questions} & {row.name for row in source.questions})
		self.assertEqual(len(source.questions), 3)

	def test_does_not_copy_submissions(self):
		self.assertTrue(frappe.db.exists("LMS Quiz Submission", {"quiz": self.quiz.name}))
		name = duplicate_quiz(self.quiz.name)

		self.assertFalse(frappe.db.exists("LMS Quiz Submission", {"quiz": name}))

	def test_a_student_cannot_duplicate(self):
		frappe.set_user(self.student.name)
		with self.assertRaises(frappe.PermissionError):
			duplicate_quiz(self.quiz.name)

	def test_each_copy_gets_its_own_title(self):
		# A source of its own, as the other tests leave copies of self.quiz behind.
		source = self._create_quiz(self.questions, title=f"Twice Copied {frappe.generate_hash(length=6)}")
		first = frappe.db.get_value("LMS Quiz", duplicate_quiz(source.name), "title")
		second = frappe.db.get_value("LMS Quiz", duplicate_quiz(source.name), "title")

		self.assertEqual(first, f"{source.title} (Copy)")
		self.assertEqual(second, f"{source.title} (Copy 2)")

	def test_a_title_at_the_length_limit_still_copies(self):
		limit = frappe.get_meta("LMS Quiz").get_field("title").length or 140
		title = (f"Long Source {frappe.generate_hash(length=6)} " + "x" * limit)[:limit]
		source = self._create_quiz(self.questions, title=title)

		copy = frappe.db.get_value("LMS Quiz", duplicate_quiz(source.name), "title")

		self.assertLessEqual(len(copy), limit)
		self.assertTrue(copy.endswith(" (Copy)"))
		self.assertTrue(title.startswith(copy.removesuffix(" (Copy)")))
