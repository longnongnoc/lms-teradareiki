# Copyright (c) 2026, FOSS United and contributors
# For license information, please see license.txt

"""Grading rules for the Fill Blank question type.

Pure python on purpose: no frappe import, so the rules can be unit tested without a bench.
"""

import json
import re
import unicodedata
from html.parser import HTMLParser

BLANK_ID = re.compile(r"[0-9]+")
BLANK_TOKEN = re.compile(r"\[\[([0-9]+)\]\]")
_WHITESPACE = re.compile(r"\s+")
_ZERO_WIDTH = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff]")

# Hiragana, Katakana (incl. the prolonged sound mark and half-width forms), CJK symbols and
# punctuation, CJK ideographs and the full-width forms block.
_CJK_RANGES = (
	r"\u3000-\u303f\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef"
	r"\U00020000-\U0002ffff"
)
_SPACE_NEXT_TO_CJK = re.compile(rf"\s+(?=[{_CJK_RANGES}])|(?<=[{_CJK_RANGES}])\s+")


class _TagStripper(HTMLParser):
	"""Keeps the text of an answer and drops its markup. Entities are passed through as typed,
	so cleaning an already clean answer changes nothing."""

	def __init__(self):
		super().__init__(convert_charrefs=False)
		self.parts: list[str] = []
		self._skipping = 0

	def handle_starttag(self, tag, attrs):
		if tag in ("script", "style"):
			self._skipping += 1

	def handle_endtag(self, tag):
		if tag in ("script", "style") and self._skipping:
			self._skipping -= 1

	def handle_data(self, data):
		if not self._skipping:
			self.parts.append(data)

	def handle_entityref(self, name):
		self.handle_data(f"&{name};")

	def handle_charref(self, name):
		self.handle_data(f"&#{name};")


def clean_answer_text(value) -> str:
	"""A learner's text for one blank, stored as plain text: markup removed, ends trimmed.
	A stray "<" that opens no tag, as in "x < 5", is kept."""
	text = "" if value is None else str(value)
	if "<" in text:
		stripper = _TagStripper()
		stripper.feed(text)
		stripper.close()
		text = "".join(stripper.parts)
	return text.strip()


def normalize_answer(text) -> str:
	"""Case, width, invisible characters and spacing do not matter. Spaces next to Japanese
	text are dropped ("冷凍 サイクル" equals "冷凍サイクル"); spaces between Latin words stay."""
	if text is None:
		return ""
	text = unicodedata.normalize("NFKC", str(text))
	text = _ZERO_WIDTH.sub("", text)
	text = _WHITESPACE.sub(" ", text).strip()
	return _SPACE_NEXT_TO_CJK.sub("", text).casefold()


def parse_accepted_answers(answers_text) -> list[str]:
	accepted = []
	for line in str(answers_text or "").splitlines():
		normalized = normalize_answer(line)
		if normalized and normalized not in accepted:
			accepted.append(normalized)
	return accepted


def extract_blank_ids(question_html) -> list[str]:
	ids = []
	for blank_id in BLANK_TOKEN.findall(question_html or ""):
		if blank_id not in ids:
			ids.append(blank_id)
	return ids


def _number(value):
	value = float(value)
	return int(value) if value.is_integer() else value


def grade_fill_blank(blanks: list[dict], submitted: dict) -> dict:
	submitted = submitted or {}
	results = []
	earned = 0
	max_total = 0
	all_correct = bool(blanks)

	for blank in blanks:
		blank_id = str(blank.get("blank_id") or "").strip()
		answers_text = blank.get("answers") or ""
		marks_out_of = _number(1 if blank.get("marks") is None else blank.get("marks"))
		answer = submitted.get(blank_id)
		answer = "" if answer is None else str(answer)

		normalized = normalize_answer(answer)
		is_correct = bool(normalized) and normalized in parse_accepted_answers(answers_text)
		marks = marks_out_of if is_correct else 0

		earned += marks
		max_total += marks_out_of
		all_correct = all_correct and is_correct
		results.append(
			{
				"blank_id": blank_id,
				"answer": answer,
				"is_correct": is_correct,
				"marks": marks,
				"marks_out_of": marks_out_of,
				"accepted": [line.strip() for line in str(answers_text).splitlines() if line.strip()],
			}
		)

	return {
		"results": results,
		"marks": earned,
		"marks_out_of": max_total,
		"is_correct": all_correct,
	}


def apply_negative_marking(graded: dict, enabled, marks_to_cut) -> dict:
	"""Under negative marking, an answer with no blank right costs marks_to_cut, like a wrong
	Choices or User Input answer. Any blank right, however few, is graded as it stands:
	partial credit is never turned into a deduction."""
	if enabled and not any(item["is_correct"] for item in graded["results"]):
		graded["marks"] = -_number(marks_to_cut or 0)
	return graded


def parse_submitted_answer(raw) -> dict:
	if isinstance(raw, str | bytes | bytearray):
		try:
			raw = json.loads(raw)
		except (TypeError, ValueError):
			return {}
	if not isinstance(raw, dict):
		return {}
	return {str(key): clean_answer_text(value) for key, value in raw.items()}
