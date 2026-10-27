# Copyright (c) 2026, Frappe and Contributors
# For license information, please see license.txt

from pathlib import Path

import frappe

from lms.lms.test_helpers import BaseTestUtils
from lms.lms.test_import import import_tests

_EXAMPLE = Path(__file__).resolve().parents[1] / "lms" / "test_import_example.json"


class TestImportTestsApi(BaseTestUtils):
	"""The Quizzes page sends the flags as form values, and the app requires every
	whitelisted argument to be type annotated, so an unannotated flag fails the call."""

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")

	def test_dry_run_accepts_form_values(self):
		data = _EXAMPLE.read_text(encoding="utf-8")
		before = frappe.db.count("LMS Quiz")
		result = import_tests(data, dry_run="1", update_existing="0")
		assert result["errors"] == []
		assert result["created"]
		assert frappe.db.count("LMS Quiz") == before

	def test_bad_json_writes_nothing(self):
		before = frappe.db.count("LMS Quiz")
		result = import_tests("{not json", dry_run=True)
		assert not result["ok"]
		assert result["errors"]
		assert frappe.db.count("LMS Quiz") == before
