# Copyright (c) 2026, Frappe and Contributors
# For license information, please see license.txt

import json

import frappe

from lms.lms.test_helpers import BaseTestUtils
from lms.lms.utils import get_course_outline


def _quiz_content(quiz):
	return json.dumps(
		{
			"time": 1765194986690,
			"blocks": [{"id": "q1", "type": "quiz", "data": {"quiz": quiz}}],
			"version": "2.29.0",
		}
	)


class TestOutlineQuizStats(BaseTestUtils):
	"""The course outline tells a learner how many questions and marks a lesson's test holds."""

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		suffix = frappe.generate_hash(length=6)
		author = self._create_user(
			f"outline-stats-{suffix}@example.com", "Outline", "Author", ["Course Creator"]
		)
		self.course = self._create_course(f"Outline Stats {suffix}", author.email)
		chapter = self._create_chapter(f"Outline Stats Chapter {suffix}", self.course.name)
		self._create_chapter_reference(self.course.name, chapter.name)

		quiz = self._create_quiz(self._create_quiz_questions(), title=f"Outline Stats Quiz {suffix}")
		self.quiz_lesson = self._create_lesson(
			f"Outline Stats Test {suffix}", chapter.name, self.course.name, _quiz_content(quiz.name)
		)
		self.plain_lesson = self._create_lesson(
			f"Outline Stats Reading {suffix}", chapter.name, self.course.name
		)
		self._create_lesson_reference(chapter.name, self.quiz_lesson.name)
		self._create_lesson_reference(chapter.name, self.plain_lesson.name)

	def _lessons(self):
		outline = get_course_outline(self.course.name)
		return {lesson.name: lesson for chapter in outline for lesson in chapter.lessons}

	def test_a_lesson_with_a_quiz_carries_its_questions_and_marks(self):
		lesson = self._lessons()[self.quiz_lesson.name]
		self.assertEqual(lesson.quiz_stats, {"questions": 3, "marks": 15})

	def test_a_lesson_without_a_quiz_has_no_stats(self):
		self.assertNotIn("quiz_stats", self._lessons()[self.plain_lesson.name])

	def test_a_quiz_placed_for_instructors_only_is_left_out(self):
		frappe.db.set_value(
			"LMS Lesson Assessment",
			{"parent": self.quiz_lesson.name, "assessment_type": "LMS Quiz"},
			"instructor_only",
			1,
		)
		self.assertNotIn("quiz_stats", self._lessons()[self.quiz_lesson.name])
