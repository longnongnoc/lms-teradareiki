# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt

from lms.lms.utils import get_average_rating


class LMSCourseReview(Document):
	def validate(self):
		self.validate_enrollment()
		self.validate_if_already_reviewed()

	def validate_enrollment(self):
		enrollment = frappe.db.exists("LMS Enrollment", {"course": self.course, "member": self.owner})
		if not enrollment:
			frappe.throw(_("You must be enrolled in the course to submit a review"))

	def validate_if_already_reviewed(self):
		# Not counting this review itself, so its author can edit it.
		if frappe.db.exists(
			"LMS Course Review", {"course": self.course, "owner": self.owner, "name": ["!=", self.name]}
		):
			frappe.throw(_("You have already reviewed this course"))

	# The hourly update_course_statistics job also writes this; doing it here
	# means a new review shows on the course page without waiting for it.
	def on_change(self):
		update_course_rating(self.course)

	def after_delete(self):
		update_course_rating(self.course)


def update_course_rating(course):
	rating = flt(get_average_rating(course) or 0, frappe.get_system_settings("float_precision") or 3)
	frappe.db.set_value("LMS Course", course, "rating", rating, update_modified=False)
