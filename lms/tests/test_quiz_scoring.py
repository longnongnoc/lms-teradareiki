# Copyright (c) 2026, FOSS United and contributors
# See license.txt
"""Unit tests for the quiz test + practical scoring rules. No frappe, no bench: run with pytest alone."""

import importlib.util
from datetime import datetime
from pathlib import Path

_MODULE_PATH = Path(__file__).resolve().parents[1] / "lms" / "quiz_scoring.py"
_spec = importlib.util.spec_from_file_location("lms_quiz_scoring_under_test", _MODULE_PATH)
quiz_scoring = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(quiz_scoring)

pick_counting_attempt = quiz_scoring.pick_counting_attempt
compute_summary = quiz_scoring.compute_summary
has_at_most_two_decimals = quiz_scoring.has_at_most_two_decimals


def _attempt(name, score, day, out_of=100):
	return {"name": name, "score": score, "score_out_of": out_of, "creation": datetime(2026, 10, day, 9, 0)}


class TestPickCountingAttempt:
	def test_no_attempts(self):
		assert pick_counting_attempt([]) is None

	def test_highest_score_wins_over_later_attempt(self):
		attempts = [_attempt("a", 40, 1), _attempt("b", 80, 2), _attempt("c", 60, 3)]
		assert pick_counting_attempt(attempts)["name"] == "b"

	def test_tie_goes_to_latest(self):
		attempts = [_attempt("a", 80, 1), _attempt("b", 80, 3), _attempt("c", 80, 2)]
		assert pick_counting_attempt(attempts)["name"] == "b"


class TestComputeSummary:
	def test_no_attempts_is_not_attempted(self):
		summary = compute_summary([], None, 20, 60)
		assert summary["status"] == "Not Attempted"
		assert summary["attempts_count"] == 0
		assert summary["counting_attempt"] is None
		assert summary["total_score"] is None
		assert summary["percentage"] is None

	def test_practical_pending(self):
		summary = compute_summary([_attempt("a", 70, 1)], None, 20, 60)
		assert summary["status"] == "Pending Practical"
		assert summary["counting_attempt"] == "a"
		assert summary["test_score"] == 70
		assert summary["practical_score"] is None
		assert summary["total_score"] is None
		assert summary["total_out_of"] == 120
		assert summary["percentage"] is None

	def test_practical_entered_passes_on_total(self):
		summary = compute_summary([_attempt("a", 50, 1)], 20, 20, 60)
		assert summary["total_score"] == 70
		assert summary["total_out_of"] == 120
		assert summary["percentage"] == 58.33
		assert summary["status"] == "Fail"

		summary = compute_summary([_attempt("a", 55, 1)], 20, 20, 60)
		assert summary["percentage"] == 62.5
		assert summary["status"] == "Pass"

	def test_boundary_exactly_at_passing_percentage_passes(self):
		summary = compute_summary([_attempt("a", 60, 1)], 12, 20, 60)
		assert summary["total_score"] == 72
		assert summary["percentage"] == 60
		assert summary["status"] == "Pass"

	def test_just_below_boundary_fails(self):
		summary = compute_summary([_attempt("a", 60, 1)], 11.99, 20, 60)
		assert summary["status"] == "Fail"

	def test_below_boundary_is_not_rounded_up(self):
		summary = compute_summary([_attempt("a", 5999, 1, out_of=9999)], 0.99, 1, 60)
		assert summary["total_out_of"] == 10000
		assert summary["percentage"] == 60
		assert summary["status"] == "Fail"

	def test_no_practical_component_uses_test_only(self):
		summary = compute_summary([_attempt("a", 60, 1)], None, 0, 60)
		assert summary["status"] == "Pass"
		assert summary["total_score"] == 60
		assert summary["total_out_of"] == 100
		assert summary["percentage"] == 60

		assert compute_summary([_attempt("a", 59, 1)], None, 0, 60)["status"] == "Fail"

	def test_stale_practical_score_ignored_when_component_off(self):
		summary = compute_summary([_attempt("a", 40, 1)], 15, 0, 60)
		assert summary["practical_score"] is None
		assert summary["total_score"] == 40
		assert summary["status"] == "Fail"

	def test_decimal_practical_score(self):
		summary = compute_summary([_attempt("a", 40, 1, out_of=85)], 12.5, 15, 70)
		assert summary["practical_score"] == 12.5
		assert summary["total_score"] == 52.5
		assert summary["total_out_of"] == 100
		assert summary["percentage"] == 52.5
		assert summary["status"] == "Fail"

		summary = compute_summary([_attempt("a", 60, 1, out_of=85)], 12.5, 15, 70)
		assert summary["total_score"] == 72.5
		assert summary["status"] == "Pass"

	def test_counting_attempt_feeds_the_total(self):
		attempts = [_attempt("low", 30, 1), _attempt("high", 70, 2), _attempt("last", 50, 3)]
		summary = compute_summary(attempts, 10, 20, 60)
		assert summary["attempts_count"] == 3
		assert summary["counting_attempt"] == "high"
		assert summary["total_score"] == 80

	def test_zero_total_out_of(self):
		summary = compute_summary([_attempt("a", 0, 1, out_of=0)], None, 0, 100)
		assert summary["percentage"] == 0
		assert summary["status"] == "Fail"

		summary = compute_summary([_attempt("a", 0, 1, out_of=0)], None, 0, 0)
		assert summary["percentage"] == 0
		assert summary["status"] == "Pass"

	def test_negative_marking_percentage_floored_at_zero(self):
		summary = compute_summary([_attempt("a", -5, 1)], None, 0, 60)
		assert summary["percentage"] == 0
		assert summary["status"] == "Fail"


class TestHasAtMostTwoDecimals:
	def test_accepts(self):
		for value in (0, 12, 12.5, 12.25, 999.99, "7.5"):
			assert has_at_most_two_decimals(value)

	def test_rejects(self):
		for value in (12.345, 0.001, "abc", None, float("nan"), float("inf")):
			assert not has_at_most_two_decimals(value)
