import frappe
from frappe.tests import IntegrationTestCase

from lms.lms.course_import_export import add_questions_to_quiz


class TestImportQuizMarks(IntegrationTestCase):
	def test_imported_rows_keep_their_marks(self):
		texts = ["<p>import marks one</p>", "<p>import marks two</p>"]
		for text, marks in zip(texts, (2, 3), strict=True):
			frappe.get_doc(
				{
					"doctype": "LMS Question",
					"question": text,
					"type": "Open Ended",
					"marks": marks,
				}
			).insert(ignore_permissions=True)

		quiz = frappe.new_doc("LMS Quiz")
		# Row one states its marks; row two does not, so the question's own marks apply.
		add_questions_to_quiz(
			quiz,
			[
				{"question_detail": texts[0], "marks": 5},
				{"question_detail": texts[1]},
			],
		)
		self.assertEqual([row.marks for row in quiz.questions], [5, 3])
