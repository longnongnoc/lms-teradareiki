# Copyright (c) 2026, FOSS United and Contributors
# See license.txt

import re
from urllib.parse import quote, unquote

import frappe

from lms.lms.doctype.lms_question.lms_question import QUESTION_MEDIA_FIELDS, STUDENT_QUESTION_FIELDS
from lms.patches.v2_0.make_public_images_public import log, publish

# Question text and option images now upload public. The private ones uploaded
# before are refused by serve_question_resource whenever the uploader does not
# author the question, so learners see a broken image. Only files a learner is
# shown (prompt and options) are published; explanation-only files stay private.
QUESTION_FILE_FIELDS = tuple(("LMS Question", field) for field in STUDENT_QUESTION_FIELDS)
PRIVATE_URL = re.compile(r"/private/files/[^\"'\s<>?#]+")


def execute():
	summary = {"published": 0, "left_alone": 0, "failed": 0}

	for url in private_question_urls():
		try:
			public_url = publish(url, summary, fields=QUESTION_FILE_FIELDS, since=None)
			if public_url:
				replace_url(url, public_url)
		except Exception:
			summary["failed"] += 1
			log(f"Could not publish question image {url}")
		frappe.db.commit()

	frappe.logger("lms").info(f"publish_question_images: {summary}")
	return summary


def private_question_urls() -> list[str]:
	rows = frappe.get_all(
		"LMS Question",
		or_filters=[[field, "like", "%/private/files/%"] for field in STUDENT_QUESTION_FIELDS],
		fields=list(STUDENT_QUESTION_FIELDS),
	)
	urls = {}
	for row in rows:
		for value in row.values():
			for url in PRIVATE_URL.findall(value or ""):
				urls.setdefault(unquote(url), None)
	return list(urls)


def replace_url(old: str, new: str):
	"""Point every stored copy at the new URL: the question's fields (explanations
	included, they may cite the same file) and the question text LMS Quiz Question
	fetched into question_detail. Editor HTML may hold the URL percent-encoded."""
	pairs = {old: new, quote(old): quote(new)}
	targets = [("LMS Question", field) for field in QUESTION_MEDIA_FIELDS]
	targets.append(("LMS Quiz Question", "question_detail"))

	for doctype, field in targets:
		for source, target in pairs.items():
			for row in frappe.get_all(doctype, {field: ["like", f"%{source}%"]}, ["name", field]):
				frappe.db.set_value(
					doctype, row.name, field, row[field].replace(source, target), update_modified=False
				)
