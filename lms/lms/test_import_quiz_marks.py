import frappe

from lms.lms.course_import_export import build_assessment_doc
from lms.lms.test_helpers import BaseTestUtils


class TestImportQuizMarks(BaseTestUtils):
	def _create_question(self, text, marks):
		frappe.get_doc(
			{"doctype": "LMS Question", "question": text, "type": "Open Ended", "marks": marks}
		).insert(ignore_permissions=True)

	def test_imported_rows_keep_their_marks_and_group(self):
		suffix = frappe.generate_hash(length=8)
		texts = [f"<p>import marks {n} {suffix}</p>" for n in ("one", "two", "three")]
		for text in texts:
			self._create_question(text, 3)

		quiz = {
			"doctype": "LMS Quiz",
			"name": f"import-marks-{suffix}",
			"title": f"Import Marks {suffix}",
			"passing_percentage": 50,
			"questions": [
				{"question_detail": texts[0], "marks": 5, "group": "Part A"},
				{"question_detail": texts[1], "group": "Part A"},
				{"question_detail": texts[2], "marks": 0},
			],
		}

		build_assessment_doc(quiz)

		doc = frappe.get_doc("LMS Quiz", f"import-marks-{suffix}")
		# Row one states 5, row two states nothing so the question's own 3 applies,
		# and row three states 0, which is a value and must not fall back to 3.
		self.assertEqual([row.marks for row in doc.questions], [5, 3, 0])
		self.assertEqual([row.group for row in doc.questions], ["Part A", "Part A", None])
		self.assertEqual(doc.total_marks, 8)
