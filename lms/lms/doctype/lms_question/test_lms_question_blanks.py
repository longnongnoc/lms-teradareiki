import frappe
from frappe.exceptions import ValidationError
from frappe.tests import IntegrationTestCase

from lms.lms.doctype.lms_quiz.lms_quiz import _grade_blanks, check_blank_answers


def make_question(text="<p>A [[1]], B [[2]], C [[3]]</p>", answers="ベンダー|ベンダ\ncat\n東京", marks=10):
	doc = frappe.get_doc(
		{
			"doctype": "LMS Question",
			"question": text,
			"type": "Blanks",
			"marks": marks,
			"blank_answers": answers,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def grade(question, answers, marks=10):
	result = {"answer": answers}
	details = frappe._dict(question=question.name, marks=marks)
	quiz = frappe._dict(enable_negative_marking=0, marks_to_cut=0)
	_grade_blanks(result, details, quiz)
	return result


class TestBlanksQuestion(IntegrationTestCase):
	def test_matching_is_exact_after_normalising(self):
		q = make_question()
		self.assertEqual(check_blank_answers(q.name, ["ﾍﾞﾝﾀﾞｰ", "cat", "東京"]), [1, 1, 1])
		self.assertEqual(check_blank_answers(q.name, ["ベンダ", " cat ", "東京"]), [1, 1, 1])
		# Near misses a fuzzy match would let through.
		self.assertEqual(check_blank_answers(q.name, ["ベンタ", "cats", "Cat"]), [0, 0, 0])
		self.assertEqual(check_blank_answers(q.name, ["", None, 5]), [0, 0, 0])

	def test_marks_round_and_full_marks_need_every_blank(self):
		q = make_question(marks=10)
		self.assertEqual(grade(q, ["ベンダー", "cat", "東京"])["marks"], 10)
		self.assertEqual(grade(q, ["ベンダー", "cat", "x"])["marks"], 7)
		self.assertEqual(grade(q, ["ベンダー", "x", "x"])["marks"], 3)
		self.assertEqual(grade(q, ["x", "x", "x"])["marks"], 0)
		one_mark = make_question(marks=1)
		self.assertEqual(grade(one_mark, ["ベンダー", "cat", "x"], marks=1)["marks"], 0)

	def test_validation(self):
		bad = [
			("<p>[[1]] [[1]]</p>", "a\nb"),  # duplicate marker
			("<p>[[2]] [[1]]</p>", "a\nb"),  # out of order
			("<p>[[<b>1</b>]]</p>", "a"),  # split across tags
			('<p><img alt="[[1]]"> text</p>', "a"),  # only in an attribute
			("<p>[[1]] [[2]]</p>", "a"),  # too few lines
			("<p>[[1]] [[2]]</p>", "a\n\nb"),  # empty interior line
			("<p>[[1]]</p>", "|"),  # no real answer
		]
		for text, answers in bad:
			with self.assertRaises(ValidationError, msg=text):
				make_question(text, answers)
