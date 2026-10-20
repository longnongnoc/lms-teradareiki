# Copyright (c) 2026, FOSS United and contributors
# For license information, please see license.txt
"""Pure scoring rules for a quiz test plus its practical component.

No frappe import here on purpose: the rules are unit tested with pytest alone.
"""

from decimal import Decimal

STATUS_NOT_ATTEMPTED = "Not Attempted"
STATUS_PENDING_PRACTICAL = "Pending Practical"
STATUS_PASS = "Pass"
STATUS_FAIL = "Fail"

MAX_PRACTICAL_MARKS = 999.99


def has_at_most_two_decimals(value) -> bool:
	try:
		scaled = float(value) * 100
		return abs(scaled - round(scaled)) < 1e-6
	except (TypeError, ValueError, OverflowError):
		return False


def pick_counting_attempt(attempts: list[dict]) -> dict | None:
	"""The attempt that counts: highest score, and the latest one among equal scores."""
	if not attempts:
		return None
	return max(attempts, key=lambda a: (a.get("score") or 0, a.get("creation"), a.get("name") or ""))


def _decimal(value) -> Decimal:
	return Decimal(str(value or 0))


def _clean(value: float):
	return round(float(value), 2)


def compute_summary(
	attempts: list[dict],
	practical_score,
	practical_max,
	passing_percentage,
) -> dict:
	practical_max = float(practical_max or 0)
	has_practical = practical_max > 0
	# A score kept from before the component was switched off no longer counts.
	practical_score = None if (practical_score is None or not has_practical) else float(practical_score)

	summary = {
		"attempts_count": len(attempts),
		"counting_attempt": None,
		"test_score": None,
		"test_out_of": None,
		"practical_score": practical_score,
		"practical_max": practical_max,
		"total_score": None,
		"total_out_of": None,
		"percentage": None,
		"status": STATUS_NOT_ATTEMPTED,
	}

	counting = pick_counting_attempt(attempts)
	if not counting:
		return summary

	test_score = counting.get("score") or 0
	test_out_of = counting.get("score_out_of") or 0
	total_out_of = _decimal(test_out_of) + (_decimal(practical_max) if has_practical else 0)

	summary["counting_attempt"] = counting.get("name")
	summary["test_score"] = test_score
	summary["test_out_of"] = test_out_of
	summary["total_out_of"] = _clean(total_out_of) if has_practical else test_out_of

	if has_practical and practical_score is None:
		summary["status"] = STATUS_PENDING_PRACTICAL
		return summary

	total_score = _decimal(test_score) + (_decimal(practical_score) if has_practical else 0)
	summary["total_score"] = _clean(total_score) if has_practical else test_score

	if total_out_of <= 0:
		percentage = Decimal(0)
		passed = _decimal(passing_percentage) <= 0
	else:
		percentage = total_score * 100 / total_out_of
		passed = total_score * 100 >= _decimal(passing_percentage) * total_out_of

	# Floored at zero like LMS Quiz Submission, since negative marking can go below it.
	summary["percentage"] = max(0.0, round(float(percentage), 2))
	summary["status"] = STATUS_PASS if passed else STATUS_FAIL
	return summary
