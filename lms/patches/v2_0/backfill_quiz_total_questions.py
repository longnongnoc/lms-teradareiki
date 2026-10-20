import frappe
from frappe.query_builder.functions import Count


def execute():
	"""Fill LMS Quiz.total_questions for quizzes saved before the field existed.

	The field is the number of rows in the quiz's questions table, the same value
	LMSQuiz.validate now keeps. Only rows that disagree are written, so a second run
	changes nothing, and `modified` is left alone: nothing about the quiz was edited.
	"""
	if not frappe.db.table_exists("LMS Quiz") or not frappe.db.has_column("LMS Quiz", "total_questions"):
		return

	quiz_question = frappe.qb.DocType("LMS Quiz Question")
	counts = dict(
		(
			frappe.qb.from_(quiz_question)
			.select(quiz_question.parent, Count(quiz_question.name))
			.where(quiz_question.parenttype == "LMS Quiz")
			.where(quiz_question.parentfield == "questions")
			.groupby(quiz_question.parent)
		).run()
	)

	for name, current in frappe.db.get_all("LMS Quiz", fields=["name", "total_questions"], as_list=True):
		expected = counts.get(name, 0)
		if (current or 0) != expected:
			frappe.db.set_value("LMS Quiz", name, "total_questions", expected, update_modified=False)
