from lms.lms.fill_blank import LEGACY_TOKEN, convert_markers, convert_snapshot, remap_answer


def execute():
	"""Move Fill Blank questions from {{id}} markers to [[n]] markers.

	Blank markers are now ASCII digits in double square brackets. A question whose
	ids are all digits only has its markers rewritten. A question with any other id
	(`{{a}}`, `{{圧縮}}`, `{{1-2}}`) is renumbered 1..n in order of first appearance,
	and everything keyed by the old id follows it in the same run:

	- the LMS Question Blank rows (blank_id); a row that no marker names takes the
	  smallest number still free, so ids stay unique and digits-only;
	- LMS Quiz Question.question_detail, the copy each quiz keeps of the question text;
	- LMS Quiz Result.answer, the learner's JSON keyed by blank_id, so a submission
	  still reviews against the right blanks;
	- LMS Quiz Result.question, the text shown with a past result. Past results keep the
	  ids they were graded with, so an old result of a question that was edited after the
	  submission may carry ids the current question never had: those digit ids are
	  converted as they are and the rest are left in the old syntax.

	A learner's unsaved answers in the browser (localStorage) are not reachable from
	here; they are keyed by the old ids and are dropped by the quiz page when they
	no longer match a blank.

	Plain db updates with `modified` left alone: nothing is validated or re-saved, and
	validation would refuse a question whose ids and markers are mid-conversion. Only a
	question that still holds a {{...}} marker is touched, so a second run changes
	nothing. Everything runs in the patch's own transaction, so a failure rolls the
	whole conversion back rather than leaving ids and text out of step.
	"""
	import frappe

	if not frappe.db.table_exists("LMS Question") or not frappe.db.table_exists("LMS Question Blank"):
		return

	for question in frappe.get_all(
		"LMS Question", filters={"type": "Fill Blank"}, fields=["name", "question"], order_by="creation asc"
	):
		if not LEGACY_TOKEN.search(question.question or ""):
			continue
		_convert_question(question)


def _convert_question(question):
	import frappe

	rows = frappe.get_all(
		"LMS Question Blank",
		filters={"parent": question.name, "parenttype": "LMS Question", "parentfield": "blanks"},
		fields=["name", "blank_id"],
		order_by="idx asc",
	)
	plan = convert_markers(question.question, [row.blank_id for row in rows])

	for row, new_id in zip(rows, plan["row_ids"], strict=True):
		if row.blank_id != new_id:
			frappe.db.set_value("LMS Question Blank", row.name, "blank_id", new_id, update_modified=False)

	frappe.db.set_value("LMS Question", question.name, "question", plan["text"], update_modified=False)
	for name in frappe.get_all(
		"LMS Quiz Question",
		filters={"question": question.name, "parenttype": "LMS Quiz"},
		pluck="name",
	):
		frappe.db.set_value("LMS Quiz Question", name, "question_detail", plan["text"], update_modified=False)

	for result in frappe.get_all(
		"LMS Quiz Result",
		filters={"question_name": question.name, "question_type": "Fill Blank"},
		fields=["name", "question", "answer"],
	):
		if plan["renumbered"]:
			answer = remap_answer(result.answer, plan["ids"])
			if answer is not None and answer != result.answer:
				frappe.db.set_value("LMS Quiz Result", result.name, "answer", answer, update_modified=False)
		text = convert_snapshot(result.question, plan["ids"])
		if text != result.question:
			frappe.db.set_value("LMS Quiz Result", result.name, "question", text, update_modified=False)
