# Copyright (c) 2026, FOSS United and contributors
# For license information, please see license.txt

"""Grading rules for the Fill Blank question type.

Pure python on purpose: no frappe import, so the rules can be unit tested without a bench.
"""

import json
import logging
import re
import unicodedata
from functools import lru_cache
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

# What makes a stretch of text Japanese as far as morpheme normalization goes.
_JAPANESE_LETTERS = re.compile(
	r"[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002ffff]"
)
_KATAKANA = re.compile("[ァ-ヶ]")
# A prolonged sound mark that ends a word: コンピューター == コンピュータ. One inside a word stays.
_FINAL_LONG_VOWEL = re.compile("(?<=[ぁ-ゖ])ー+(?![ぁ-ゖー])")
# Japanese punctuation, ASCII punctuation (after NFKC), dash variants and curly quotes. A "." or ","
# between two digits is a decimal or thousands mark and stays: 1.5 is not 15.
_PUNCTUATION = re.compile(
	"[。、・「」『』【】〈〉《》〔〕（）〜]"
	r"|[-!?()\[\]/:;'\"~\u2010-\u2015\u2212\ufe63\u2018\u2019\u201c\u201d]"
	r"|(?<![0-9])[.,]|[.,](?![0-9])"
)

_sudachi = None
_sudachi_loaded = False


def _log_sudachi_unavailable(error) -> None:
	message = f"SudachiPy is not available, Fill Blank answers skip okurigana normalization: {error!r}"
	try:
		import frappe

		frappe.logger("lms").warning(message)
	except Exception:
		logging.getLogger(__name__).warning(message)


def _get_sudachi():
	"""The SudachiPy tokenizer, loaded on first use and kept. None when it cannot be loaded,
	which is logged once and never stops grading."""
	global _sudachi, _sudachi_loaded
	if not _sudachi_loaded:
		_sudachi_loaded = True
		try:
			from sudachipy import dictionary, tokenizer

			mode = tokenizer.Tokenizer.SplitMode.C
			sudachi_dictionary = dictionary.Dictionary()
			if hasattr(sudachi_dictionary, "tokenizer"):
				_sudachi = (sudachi_dictionary.tokenizer(mode), mode)
			else:
				_sudachi = (sudachi_dictionary.create(), mode)
		except Exception as error:
			_sudachi = None
			_log_sudachi_unavailable(error)
	return _sudachi


@lru_cache(maxsize=4096)
def _sudachi_normalized_form(text: str) -> str:
	loaded = _get_sudachi()
	if loaded is None:
		return text
	tokenizer, mode = loaded
	try:
		return "".join(morpheme.normalized_form() for morpheme in tokenizer.tokenize(text, mode))
	except Exception:
		return text


def _normalize_morphemes(text: str) -> str:
	"""Okurigana and kanji variants meet on the dictionary's normalized form (取付, 取付け and
	取り付け are one word). Never the reading: 機関, 期間 and 器官 must stay apart. Only stretches
	with Japanese in them are touched, so Latin words and codes such as R410A pass as typed, and
	the whitespace between stretches is kept for the spacing rules."""
	if not _JAPANESE_LETTERS.search(text):
		return text
	return "".join(
		_sudachi_normalized_form(part) if _JAPANESE_LETTERS.search(part) else part
		for part in re.split(r"(\s+)", text)
	)


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


def _normalize(text, morphemes: bool) -> str:
	if text is None:
		return ""
	text = unicodedata.normalize("NFKC", str(text))
	text = _ZERO_WIDTH.sub("", text).casefold()
	if morphemes:
		text = _normalize_morphemes(text)
	text = _KATAKANA.sub(lambda match: chr(ord(match.group()) - 0x60), text)
	# Before the punctuation goes, so a mark such as ・ still ends the word it follows.
	text = _FINAL_LONG_VOWEL.sub("", text)
	text = _PUNCTUATION.sub("", text)
	text = _WHITESPACE.sub(" ", text).strip()
	return _SPACE_NEXT_TO_CJK.sub("", text)


def normalize_answer(text) -> str:
	"""The plain key two answers are compared on. Width, case, invisible characters, spacing,
	punctuation and kana script do not matter: 冷凍 サイクル, 冷凍サイクル and 冷凍。 agree, ねじ
	with ネジ, コンピュータ with コンピューター, R-410A with R410A. Spaces between Latin words
	stay, so "heat pump" is not "heatpump"."""
	return _normalize(text, morphemes=False)


def normalize_answer_morphemes(text) -> str:
	"""The second key: the plain key with the dictionary's normalized form of each Japanese word
	put in first, so 取付, 取付け and 取り付け agree. It can only add matches, never remove them,
	because an answer is also correct on its plain key (the dictionary reads some hiragana
	spellings as other words: がす as 貸す). Without SudachiPy it equals the plain key."""
	return _normalize(text, morphemes=True)


def _accepted_keys(answers_text) -> list[tuple[str, str]]:
	"""(plain key, morpheme key) of each accepted line that compares as something."""
	keys = []
	for line in str(answers_text or "").splitlines():
		plain = normalize_answer(line)
		if plain:
			keys.append((plain, normalize_answer_morphemes(line)))
	return keys


def parse_accepted_answers(answers_text) -> list[str]:
	accepted = []
	for plain, _morphemes in _accepted_keys(answers_text):
		if plain not in accepted:
			accepted.append(plain)
	return accepted


def matches_accepted_answer(answer, answers_text) -> bool:
	"""True if the answer equals an accepted line on the plain key or on the morpheme key."""
	plain = normalize_answer(answer)
	if not plain:
		return False
	keys = _accepted_keys(answers_text)
	if any(plain == accepted_plain for accepted_plain, _ in keys):
		return True
	morphemes = normalize_answer_morphemes(answer)
	return bool(morphemes) and any(morphemes == accepted for _, accepted in keys)


def empty_accepted_answers(answers_text) -> list[str]:
	"""Accepted-answer lines that are text but compare as nothing, such as "。" or "-": every
	submitted answer that reduces to nothing is counted as unanswered, so the line could never match."""
	lines = (line.strip() for line in str(answers_text or "").splitlines())
	return [line for line in lines if line and not normalize_answer(line)]


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

		is_correct = matches_accepted_answer(answer, answers_text)
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
