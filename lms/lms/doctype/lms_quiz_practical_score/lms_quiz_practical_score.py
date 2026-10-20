# Copyright (c) 2026, FOSS United and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime

from lms.lms.quiz_scoring import MAX_PRACTICAL_MARKS, has_at_most_two_decimals


class LMSQuizPracticalScore(Document):
	def validate(self):
		self.validate_not_self_scored()
		self.validate_unique()
		self.validate_score()
		self.set_audit_fields()

	def validate_not_self_scored(self):
		user = frappe.session.user
		if self.member == user and user != "Administrator":
			frappe.throw(_("You cannot enter your own practical score."), frappe.PermissionError)

	def validate_unique(self):
		existing = frappe.db.exists(
			self.doctype, {"quiz": self.quiz, "member": self.member, "name": ("!=", self.name)}
		)
		if existing:
			frappe.throw(
				_("A practical score already exists for {0} on this quiz.").format(frappe.bold(self.member)),
				frappe.DuplicateEntryError,
			)

	def validate_score(self):
		practical_max = flt(frappe.db.get_value("LMS Quiz", self.quiz, "practical_max_marks"))
		if practical_max <= 0:
			frappe.throw(_("This quiz has no practical score."))

		score = flt(self.score)
		if not has_at_most_two_decimals(score):
			frappe.throw(_("Practical score can have at most 2 decimal places."))
		if score < 0 or score > min(practical_max, MAX_PRACTICAL_MARKS):
			frappe.throw(_("Practical score must be between 0 and {0}.").format(practical_max))
		self.score = score

	def set_audit_fields(self):
		self.scored_by = frappe.session.user
		self.scored_on = now_datetime()
