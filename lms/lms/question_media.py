"""Rules for images embedded in a quiz question.

Kept free of frappe imports so the rules can be unit tested on their own: callers
pass in the urls and the file sizes they looked up.
"""

import posixpath
import re
from html.parser import HTMLParser
from urllib.parse import unquote, urlparse

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGES_PER_QUESTION = 5
ALLOWED_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
FILE_URL_PREFIXES = ("/files/", "/private/files/")
RESERVED_OPTION_KEY = re.compile(r"\[image:\d+\]")


class _ImageSourceParser(HTMLParser):
	def __init__(self):
		super().__init__()
		self.sources = []

	def handle_starttag(self, tag, attrs):
		if tag != "img":
			return
		for name, value in attrs:
			if name == "src":
				self.sources.append((value or "").strip())
				return
		# An <img> with no src still counts toward the per-question limit.
		self.sources.append("")


def extract_image_sources(html):
	"""The src of every <img> in html, in document order, duplicates kept."""
	if not html or not isinstance(html, str) or "<img" not in html.lower():
		return []
	parser = _ImageSourceParser()
	parser.feed(html)
	parser.close()
	return parser.sources


def is_data_uri(src):
	return (src or "").lstrip().lower().startswith("data:")


def count_data_uri_images(sources):
	return sum(1 for src in sources if is_data_uri(src))


def exceeds_image_limit(sources, limit=MAX_IMAGES_PER_QUESTION):
	return len(sources) > limit


def local_file_url(src, hosts=()):
	"""The /files/ or /private/files/ path src points at on this site, else None.

	An absolute url only counts when its host is one of `hosts`. Query string and
	fragment are dropped and percent-escapes decoded, so the result matches File.file_url.
	"""
	src = (src or "").strip()
	if not src or is_data_uri(src):
		return None

	if src.startswith(("http://", "https://")):
		parsed = urlparse(src)
		if parsed.netloc not in hosts:
			return None
		path = parsed.path
	elif src.startswith("/") and not src.startswith("//"):
		path = urlparse(src).path
	else:
		return None

	path = unquote(path)
	if ".." in path or not path.startswith(FILE_URL_PREFIXES):
		return None
	return path


def local_file_urls(sources, hosts=()):
	"""Unique local file paths among sources, first occurrence order."""
	seen = {}
	for src in sources:
		url = local_file_url(src, hosts)
		if url:
			seen.setdefault(url, None)
	return list(seen)


def has_allowed_extension(url):
	return posixpath.splitext(url)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def disallowed_extension_urls(urls):
	return [url for url in urls if not has_allowed_extension(url)]


def oversized_urls(urls, sizes, max_bytes=MAX_IMAGE_BYTES):
	"""(url, size) for each url whose size is known and above max_bytes.

	A url missing from sizes, or with no recorded size, is skipped: nothing is known
	about it.
	"""
	oversized = []
	for url in urls:
		size = sizes.get(url)
		if size and size > max_bytes:
			oversized.append((url, size))
	return oversized


def option_present(text, image):
	"""An answer option exists when it has text or an image."""
	return bool((text or "").strip() or (image or "").strip())


def option_signature(text, image):
	"""What makes two options the same: text and image together, so two image-only
	options with different images are distinct."""
	return (text or "", (image or "").strip())


def has_duplicate_options(options):
	"""Whether two of the (text, image) pairs in `options` are the same option.

	Absent options (neither text nor image) are skipped.
	"""
	signatures = [option_signature(text, image) for text, image in options if option_present(text, image)]
	return len(set(signatures)) != len(signatures)


def correct_flags_without_option(options, flags):
	"""1-based positions flagged correct whose (text, image) option is absent."""
	return [
		position
		for position, ((text, image), flag) in enumerate(zip(options, flags, strict=True), start=1)
		if flag and not option_present(text, image)
	]


def is_reserved_option_text(text):
	"""Whether option text collides with the answer key of an image-only option."""
	return bool(RESERVED_OPTION_KEY.fullmatch((text or "").strip()))


def option_key(text, slot):
	"""The string a learner submits to choose an option: its text, or "[image:N]" (N the
	1-based slot) when it has none. Callers pass only options that are present."""
	if (text or "").strip():
		return text
	return f"[image:{slot}]"


def option_keys(options):
	"""Answer key per (text, image) slot, in slot order; None for an absent option."""
	return [
		option_key(text, slot) if option_present(text, image) else None
		for slot, (text, image) in enumerate(options, start=1)
	]


def is_choice_answer_correct(keys, flags, multiple, answer):
	"""Whether the submitted keys are right: every flagged option chosen and no other
	(multiple), or the last chosen option is flagged (single). An absent option has no
	key, so it can never be chosen."""
	if multiple:
		for key, flag in zip(keys, flags, strict=True):
			if key in answer and not flag:
				return False
			if flag and key not in answer:
				return False
		return True

	correct = False
	for key, flag in zip(keys, flags, strict=True):
		if key is not None and key in answer:
			correct = flag
	return correct


def choice_answer_flags(keys, flags, answers):
	"""Per slot: 1 chosen and correct, 2 correct but missed, 0 otherwise."""
	result = []
	for key, flag in zip(keys, flags, strict=True):
		if key is not None and key in answers:
			result.append(flag)
		elif flag:
			result.append(2)
		else:
			result.append(0)
	return result
