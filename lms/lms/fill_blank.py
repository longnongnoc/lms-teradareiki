# Copyright (c) 2026, FOSS United and contributors
# For license information, please see license.txt

"""Grading rules for the Fill Blank question type.

Pure python on purpose: no frappe import, so the rules can be unit tested without a bench.
"""

import json
import re
import unicodedata

BLANK_TOKEN = re.compile(r"\{\{\s*([^{}\s]+)\s*\}\}")
_WHITESPACE = re.compile(r"\s+")
_ZERO_WIDTH = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff]")

# Hiragana, Katakana (incl. the prolonged sound mark and half-width forms), CJK symbols and
# punctuation, CJK ideographs and the full-width forms block.
_CJK_RANGES = (
	r"\u3000-\u303f\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef"
	r"\U00020000-\U0002ffff"
)
_SPACE_NEXT_TO_CJK = re.compile(rf"\s+(?=[{_CJK_RANGES}])|(?<=[{_CJK_RANGES}])\s+")


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


def parse_submitted_answer(raw) -> dict:
	if isinstance(raw, str | bytes | bytearray):
		try:
			raw = json.loads(raw)
		except (TypeError, ValueError):
			return {}
	if not isinstance(raw, dict):
		return {}
	return {str(key): "" if value is None else str(value) for key, value in raw.items()}
