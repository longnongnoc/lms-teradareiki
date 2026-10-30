# Copyright (c) 2026, FOSS United and Contributors
# See license.txt

"""A learner edits and deletes their own course review, and the course rating follows."""

import frappe
from frappe.utils import flt

from lms.lms.test_helpers import BaseTestUtils


class TestCourseReviewEdit(BaseTestUtils):
	def setUp(self) -> None:
		super().setUp()
		suffix = frappe.generate_hash(length=8)
		self.learner = self._create_user(
			f"rev-edit-{suffix}@example.com", "Rev", "Edit", ["LMS Student"]
		).name
		instructor = self._create_user(
			f"rev-edit-inst-{suffix}@example.com", "Rev", "Inst", ["LMS Student"]
		).name
		self.course = self._create_course(title=f"Review Edit {suffix}", instructor=instructor).name
		self._create_enrollment(self.learner, self.course)
		self.review = self._add_rating(self.course, self.learner, 0.4, "first")
		frappe.set_user(self.learner)
		self.addCleanup(frappe.set_user, "Administrator")

	def test_edit_own_review(self) -> None:
		doc = frappe.get_doc("LMS Course Review", self.review.name)
		doc.rating = 1
		doc.save()  # used to throw "You have already reviewed this course"
		# reviews store a 0-1 fraction, the course its 0-5 average
		self.assertEqual(flt(frappe.db.get_value("LMS Course", self.course, "rating")), 5)

	def test_second_review_still_refused(self) -> None:
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({"doctype": "LMS Course Review", "course": self.course, "rating": 1}).insert()

	def test_delete_own_review(self) -> None:
		frappe.delete_doc("LMS Course Review", self.review.name)
		self.assertFalse(frappe.db.exists("LMS Course Review", self.review.name))
		self.assertEqual(flt(frappe.db.get_value("LMS Course", self.course, "rating")), 0)
