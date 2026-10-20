import json
import re

LEGACY_TOKEN = re.compile(r"\{\{\s*([^{}\s]+)\s*\}\}")
DIGITS = re.compile(r"[0-9]+")


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


def convert_markers(text: str, row_ids: list[str]) -> dict:
	"""Plan the conversion of one question.

	Returns the new text, `ids` (old id -> new id for every marker), `row_ids` (the new
	blank_id of each row, in the order given) and whether any id changed.
	"""
	found: list[str] = []
	for old_id in LEGACY_TOKEN.findall(text or ""):
		if old_id not in found:
			found.append(old_id)

	renumbered = not all(DIGITS.fullmatch(old_id) for old_id in found)
	ids = (
		{old_id: str(position) for position, old_id in enumerate(found, 1)}
		if renumbered
		else {old_id: old_id for old_id in found}
	)

	new_text = LEGACY_TOKEN.sub(lambda match: f"[[{ids[match.group(1)]}]]", text or "")

	row_new_ids = []
	taken = set(ids.values())
	next_free = 1
	for raw_id in row_ids:
		old_id = (raw_id or "").strip()
		if old_id in ids:
			row_new_ids.append(ids[old_id])
		elif not renumbered and DIGITS.fullmatch(old_id):
			row_new_ids.append(old_id)
		else:
			while str(next_free) in taken:
				next_free += 1
			row_new_ids.append(str(next_free))
			taken.add(str(next_free))

	return {"text": new_text, "ids": ids, "row_ids": row_new_ids, "renumbered": renumbered}


def remap_answer(stored, ids: dict[str, str]) -> str | None:
	"""A stored answer with its keys moved to the new ids, or None if it is not a JSON object."""
	try:
		answers = json.loads(stored or "")
	except (TypeError, ValueError):
		return None
	if not isinstance(answers, dict):
		return None
	return json.dumps({ids[key]: value for key, value in answers.items() if key in ids}, ensure_ascii=False)


def convert_snapshot(text, ids: dict[str, str]) -> str:
	"""The question text kept with a past result, markers moved to the new syntax."""

	def replace(match):
		old_id = match.group(1)
		if old_id in ids:
			return f"[[{ids[old_id]}]]"
		return f"[[{old_id}]]" if DIGITS.fullmatch(old_id) else match.group(0)

	return LEGACY_TOKEN.sub(replace, text or "")
