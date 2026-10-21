import json
import os
import zipfile

import frappe

from lms.lms.course_import_export import import_course_zip

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "v2_courses")
V2_COURSES = (
	"v2",
	"v2-2",
	"v2-3",
	"v2-4",
	"v2-5",
	"welcome-to-terada-reiki-v2",
)


def execute():
	"""Import the V2 course folders bundled in the app, skipping any course already on the site.

	Each folder is the same layout the course export writes (course.json, chapters,
	lessons, assessments, instructors.json, assets). It is packed into a temporary
	zip under the site's private files and handed to the course importer. A course
	whose name already exists is left alone, so a later migrate changes nothing.
	"""
	for folder in V2_COURSES:
		# nosemgrep: frappe-security-file-traversal - folder comes from the fixed V2_COURSES tuple above, never from input
		source = os.path.join(DATA_DIR, folder)
		course_json = os.path.join(source, "course.json")
		# nosemgrep: frappe-security-file-traversal - fixed path, see above
		with open(course_json, encoding="utf-8") as f:
			course_name = json.load(f)["name"]
		if frappe.db.exists("LMS Course", course_name):
			continue

		site_relative = os.path.join("private", "files", f"_v2_import_{course_name}.zip")
		zip_path = frappe.get_site_path(site_relative)
		try:
			with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
				for root, _, files in os.walk(source):
					for name in files:
						full = os.path.join(root, name)
						archive.write(full, os.path.relpath(full, source).replace(os.sep, "/"))
			# Quizzes keep the names the lessons point at only while in_import is set;
			# without it Frappe renames each quiz and the lesson links fail.
			frappe.flags.in_import = True
			try:
				import_course_zip(site_relative.replace(os.sep, "/"))
			finally:
				frappe.flags.in_import = False
		finally:
			if os.path.exists(zip_path):
				os.remove(zip_path)
