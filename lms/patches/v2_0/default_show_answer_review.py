import frappe


def execute():
	"""Turn Show Answer Review on for quizzes saved before the setting existed.

	The field defaults to on, and a quiz that never had it must keep showing its
	learners the per-blank review. Only a quiz with no value is written, so a second
	run, or a quiz someone has since switched off, is left alone. `modified` is left
	alone too: nothing about the quiz was edited.
	"""
	if not frappe.db.table_exists("LMS Quiz") or not frappe.db.has_column("LMS Quiz", "show_answer_review"):
		return

	quiz = frappe.qb.DocType("LMS Quiz")
	frappe.qb.update(quiz).set(quiz.show_answer_review, 1).where(quiz.show_answer_review.isnull()).run()
