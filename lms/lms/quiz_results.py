# Copyright (c) 2026, FOSS United and contributors
# For license information, please see license.txt
"""Test results of a quiz: the practical score entered by staff, and the summaries
built on it. The scoring rules themselves live in lms.lms.quiz_scoring."""

import frappe
from frappe import _
from frappe.utils import cint

from lms.lms.doctype.lms_question.lms_question import QUESTION_POSSIBILITY_FIELDS
from lms.lms.doctype.lms_quiz.lms_quiz import (
	get_fill_blanks,
	get_option_keys_and_flags,
	get_question_details,
)
from lms.lms.permissions import can_review_submission, is_site_administrator
from lms.lms.quiz_scoring import (
	MAX_PRACTICAL_MARKS,
	STATUS_FAIL,
	STATUS_PASS,
	STATUS_PENDING_PRACTICAL,
	compute_summary,
	has_at_most_two_decimals,
)
from lms.lms.utils import PRIVILEGED_ROLES, has_moderator_role

PRACTICAL_SCORE = "LMS Quiz Practical Score"
LISTABLE_STATUSES = (STATUS_PASS, STATUS_FAIL, STATUS_PENDING_PRACTICAL)
# The admin list is built in python from the newest submissions; older ones are left out.
MAX_WORKING_SET = 2000
MAX_PAGE_LENGTH = 100
MAX_SEARCH_LENGTH = 100


def validate_practical_max_marks(doc, method=None):
	"""doc_events `validate` for LMS Quiz."""
	value = doc.get("practical_max_marks") or 0
	if value < 0 or value > MAX_PRACTICAL_MARKS:
		frappe.throw(_("Practical Max Marks must be between 0 and {0}.").format(MAX_PRACTICAL_MARKS))
	if not has_at_most_two_decimals(value):
		frappe.throw(_("Practical Max Marks can have at most 2 decimal places."))


def _is_staff() -> bool:
	return bool(PRIVILEGED_ROLES & set(frappe.get_roles()))


def _is_unrestricted(user: str) -> bool:
	return is_site_administrator(user) or bool(has_moderator_role(user))


def _require_text(value, label: str) -> str:
	if not isinstance(value, str) or not value:
		frappe.throw(_("Invalid {0}.").format(label), frappe.ValidationError)
	return value


def _require_quiz(quiz) -> str:
	_require_text(quiz, _("quiz"))
	if not frappe.db.exists("LMS Quiz", quiz):
		frappe.throw(_("Invalid quiz."), frappe.ValidationError)
	return quiz


def _can_review(quiz: str, member: str) -> bool:
	user = frappe.session.user
	return _is_unrestricted(user) or can_review_submission("LMS Quiz", quiz, member, user=user)


def _assert_can_score(quiz: str, member: str):
	user = frappe.session.user
	if not _is_staff():
		frappe.throw(_("You are not permitted to enter practical scores."), frappe.PermissionError)
	if member == user and user != "Administrator":
		frappe.throw(_("You cannot enter your own practical score."), frappe.PermissionError)
	if not _can_review(quiz, member):
		frappe.throw(_("You are not permitted to score this member on this quiz."), frappe.PermissionError)


def _practical_row(quiz: str, member: str):
	return frappe.db.get_value(
		PRACTICAL_SCORE,
		{"quiz": quiz, "member": member},
		["name", "score", "note", "scored_by", "scored_on"],
		as_dict=True,
	)


@frappe.whitelist()
def set_practical_score(quiz: str, member: str, score: float, note: str | None = None):
	"""Create or update the practical score of `member` on `quiz`.

	Returns the practical fields plus the member's refreshed summary."""
	_require_quiz(quiz)
	_require_text(member, _("member"))
	try:
		score = float(score)
	except (TypeError, ValueError):
		frappe.throw(_("Practical score must be a number."), frappe.ValidationError)
	if not frappe.db.exists("User", member):
		frappe.throw(_("Invalid member."), frappe.ValidationError)

	_assert_can_score(quiz, member)

	existing = frappe.db.get_value(PRACTICAL_SCORE, {"quiz": quiz, "member": member})
	if existing:
		doc = frappe.get_doc(PRACTICAL_SCORE, existing)
	else:
		doc = frappe.new_doc(PRACTICAL_SCORE)
		doc.quiz = quiz
		doc.member = member
	doc.score = score
	doc.note = (note or "").strip() or None
	doc.save()

	return {
		"name": doc.name,
		"quiz": quiz,
		"member": member,
		"score": doc.score,
		"note": doc.note,
		"scored_by": doc.scored_by,
		"scored_on": doc.scored_on,
		"summary": _build_summary(quiz, member, with_attempts=True),
	}


@frappe.whitelist()
def delete_practical_score(quiz: str, member: str):
	"""Clear the practical score, so the result goes back to Pending Practical.

	Returns the member's refreshed summary."""
	_require_quiz(quiz)
	_require_text(member, _("member"))
	_assert_can_score(quiz, member)

	existing = frappe.db.get_value(PRACTICAL_SCORE, {"quiz": quiz, "member": member})
	if existing:
		frappe.delete_doc(PRACTICAL_SCORE, existing)
	return {"summary": _build_summary(quiz, member, with_attempts=True)}


def _quiz_settings(quiz: str):
	return frappe.db.get_value(
		"LMS Quiz",
		quiz,
		["name", "title", "passing_percentage", "practical_max_marks", "show_submission_history"],
		as_dict=True,
	)


def _build_summary(
	quiz: str, member: str, *, with_attempts: bool = False, show_attempts: bool = True
) -> dict:
	settings = _quiz_settings(quiz)
	attempts = frappe.get_all(
		"LMS Quiz Submission",
		filters={"quiz": quiz, "member": member},
		fields=["name", "score", "score_out_of", "percentage", "creation"],
		order_by="creation asc, name asc",
	)
	practical = _practical_row(quiz, member)
	summary = compute_summary(
		attempts,
		practical.score if practical else None,
		settings.practical_max_marks,
		settings.passing_percentage,
	)
	summary.update(
		{
			"quiz": quiz,
			"member": member,
			"passing_percentage": settings.passing_percentage,
			"practical_note": practical.note if practical else None,
			"practical_scored_by": practical.scored_by if practical else None,
			"practical_scored_on": practical.scored_on if practical else None,
		}
	)
	if with_attempts:
		summary["attempts"] = _attempt_rows(attempts, summary["counting_attempt"]) if show_attempts else []
	return summary


def _attempt_rows(attempts: list, counting: str | None) -> list:
	"""`attempts` is oldest first; the rows come back newest first."""
	rows = [
		{
			"name": attempt.name,
			"attempt_no": index,
			"score": attempt.score,
			"score_out_of": attempt.score_out_of,
			"percentage": attempt.percentage or 0,
			"creation": attempt.creation,
			"is_counting": attempt.name == counting,
		}
		for index, attempt in enumerate(attempts, start=1)
	]
	rows.reverse()
	return rows


@frappe.whitelist()
def get_quiz_result_summary(quiz: str, member: str | None = None):
	"""The result of `member` (default: the caller) on `quiz`: the compute_summary
	fields, the quiz passing_percentage, the practical note and `attempts`."""
	user = frappe.session.user
	if not user or user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	_require_quiz(quiz)
	member = member or user
	_require_text(member, _("member"))

	staff = False
	if member != user:
		if not _is_staff() or not _can_review(quiz, member):
			frappe.throw(_("You are not permitted to view this result."), frappe.PermissionError)
		staff = True
	else:
		staff = _is_staff()

	show_history = staff or bool(_quiz_settings(quiz).show_submission_history)
	return _build_summary(quiz, member, with_attempts=True, show_attempts=show_history)


def _correct_answer(question: str, question_type: str):
	"""The answer key of one question, shaped like its stored answer: option keys or accepted
	answers joined with ", ", or {blank_id: [accepted answers]} for Fill Blank. None for an
	Open Ended question, which has no key."""
	if question_type == "Choices":
		keys, flags = get_option_keys_and_flags(get_question_details(question))
		return ", ".join(key for key, flag in zip(keys, flags, strict=True) if key and flag)
	if question_type == "User Input":
		values = frappe.db.get_value("LMS Question", question, QUESTION_POSSIBILITY_FIELDS, as_dict=True)
		return ", ".join(values[field] for field in QUESTION_POSSIBILITY_FIELDS if values and values[field])
	if question_type == "Fill Blank":
		return {
			blank.blank_id: [line.strip() for line in str(blank.answers or "").splitlines() if line.strip()]
			for blank in get_fill_blanks(question)
		}
	return None


@frappe.whitelist()
def get_submission_answers(submission: str):
	"""Each question of one submission, in order: the question, the member's answer, the marks
	and, when the caller may see it, the correct answer.

	The member reads their own submission; staff who may review the member on the quiz read
	anyone's. The correct answer (`correct_answer` on each row) is only sent to staff, or to
	the member when the quiz has Show Answers on. A member who does not review the quiz gets
	no questions when it has Show Answer Review off."""
	user = frappe.session.user
	if not user or user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	_require_text(submission, _("submission"))
	row = frappe.db.get_value("LMS Quiz Submission", submission, ["quiz", "member"], as_dict=True)
	if not row:
		frappe.throw(_("Invalid submission."), frappe.ValidationError)

	staff = _is_staff()
	reviewer = staff and _can_review(row.quiz, row.member)
	if row.member != user and not reviewer:
		frappe.throw(_("You are not permitted to view this submission."), frappe.PermissionError)
	quiz = frappe.db.get_value("LMS Quiz", row.quiz, ["show_answers", "show_answer_review"], as_dict=True)
	reveal = staff or bool(cint(quiz.show_answers))
	result = {"submission": submission, "quiz": row.quiz, "member": row.member}
	# As in get_fill_blank_review: with Show Answer Review off the member gets no review.
	if not reviewer and quiz.show_answer_review is not None and not cint(quiz.show_answer_review):
		return {**result, "show_correct_answers": False, "questions": []}

	questions = frappe.get_all(
		"LMS Quiz Result",
		filters={"parent": submission, "parenttype": "LMS Quiz Submission", "parentfield": "result"},
		fields=["name", "question_name", "question", "question_type", "answer", "marks", "marks_out_of"],
		order_by="idx asc",
	)
	for question in questions:
		if reveal:
			question["correct_answer"] = _correct_answer(question.question_name, question.question_type)

	return {**result, "show_correct_answers": reveal, "questions": questions}


def _like(term: str) -> str:
	term = term.strip()[:MAX_SEARCH_LENGTH]
	return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _search_filters(search: str):
	"""or_filters naming the quizzes and users whose title, name or email match. None when
	nothing matches, so the caller can answer with no rows."""
	like = _like(search)
	quizzes = frappe.get_all(
		"LMS Quiz", filters={"title": ["like", like]}, pluck="name", limit_page_length=MAX_WORKING_SET
	)
	members = frappe.get_all(
		"User",
		or_filters={"full_name": ["like", like], "email": ["like", like]},
		pluck="name",
		limit_page_length=MAX_WORKING_SET,
	)
	or_filters = {}
	if quizzes:
		or_filters["quiz"] = ["in", quizzes]
	if members:
		or_filters["member"] = ["in", members]
	return or_filters or None


@frappe.whitelist()
def get_quiz_results(
	quiz: str | None = None,
	search: str | None = None,
	status: str | None = None,
	start: int = 0,
	page_length: int = 20,
):
	"""Admin list: one row per (quiz, member) with the compute_summary fields, `quiz`
	{name, title} and `member` {name, full_name, email, user_image}.

	Scoped by the permission hook of LMS Quiz Submission (see quiz_submission_query_conditions):
	System Manager and Moderator see everything, other staff the submissions of quizzes they
	author or whose course or batch they teach. Anyone without a staff role is refused."""
	if not _is_staff():
		frappe.throw(_("You are not permitted to view quiz results."), frappe.PermissionError)
	if status and status not in LISTABLE_STATUSES:
		frappe.throw(_("Invalid status."), frappe.ValidationError)

	start = max(cint(start), 0)
	page_length = min(max(cint(page_length) or 20, 1), MAX_PAGE_LENGTH)

	filters = {}
	if quiz:
		_require_text(quiz, _("quiz"))
		filters["quiz"] = quiz
	or_filters = None
	if search and isinstance(search, str) and search.strip():
		or_filters = _search_filters(search)
		if not or_filters:
			return {"rows": [], "total": 0, "truncated": False}

	submissions = frappe.get_list(
		"LMS Quiz Submission",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "quiz", "member", "score", "score_out_of", "percentage", "creation"],
		order_by="creation desc, name desc",
		limit_page_length=MAX_WORKING_SET,
	)
	truncated = len(submissions) >= MAX_WORKING_SET

	pairs: dict[tuple, list] = {}
	for submission in submissions:
		pairs.setdefault((submission.quiz, submission.member), []).append(submission)

	rows = _summarise_pairs(pairs)
	if status:
		rows = [row for row in rows if row["status"] == status]

	return {
		"rows": _with_people(rows[start : start + page_length]),
		"total": len(rows),
		"truncated": truncated,
	}


def _summarise_pairs(pairs: dict) -> list:
	if not pairs:
		return []

	quiz_names = list({quiz for quiz, _member in pairs})
	member_names = list({member for _quiz, member in pairs})
	settings = {
		row.name: row
		for row in frappe.get_all(
			"LMS Quiz",
			filters={"name": ["in", quiz_names]},
			fields=["name", "title", "passing_percentage", "practical_max_marks"],
		)
	}
	practical = {
		(row.quiz, row.member): row
		for row in frappe.get_all(
			PRACTICAL_SCORE,
			filters={"quiz": ["in", quiz_names], "member": ["in", member_names]},
			fields=["quiz", "member", "score", "note", "scored_by", "scored_on"],
		)
	}

	rows = []
	for (quiz, member), attempts in pairs.items():
		quiz_settings = settings.get(quiz)
		if not quiz_settings:
			continue
		score = practical.get((quiz, member))
		row = compute_summary(
			attempts,
			score.score if score else None,
			quiz_settings.practical_max_marks,
			quiz_settings.passing_percentage,
		)
		row.update(
			{
				"passing_percentage": quiz_settings.passing_percentage,
				"practical_note": score.note if score else None,
				"practical_scored_by": score.scored_by if score else None,
				"practical_scored_on": score.scored_on if score else None,
				"quiz": {"name": quiz, "title": quiz_settings.title},
				"member": {"name": member},
			}
		)
		rows.append(row)
	return rows


def _with_people(rows: list) -> list:
	"""Fill in the member details, for the one page being returned."""
	names = [row["member"]["name"] for row in rows]
	if not names:
		return rows
	users = {
		user.name: user
		for user in frappe.get_all(
			"User", filters={"name": ["in", names]}, fields=["name", "full_name", "email", "user_image"]
		)
	}
	for row in rows:
		user = users.get(row["member"]["name"])
		row["member"] = {
			"name": row["member"]["name"],
			"full_name": user.full_name if user else row["member"]["name"],
			"email": user.email if user else row["member"]["name"],
			"user_image": user.user_image if user else None,
		}
	return rows
