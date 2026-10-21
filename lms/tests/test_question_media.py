import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "lms" / "question_media.py"
spec = importlib.util.spec_from_file_location("question_media", MODULE_PATH)
qm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qm)

HOSTS = {"lms.example.com"}


def test_constants():
	assert qm.MAX_IMAGE_BYTES == 5 * 1024 * 1024
	assert qm.MAX_IMAGES_PER_QUESTION == 10
	assert set(qm.ALLOWED_IMAGE_EXTENSIONS) == {".jpg", ".jpeg", ".png", ".webp"}


def test_extract_image_sources():
	html = (
		'<p>Look <img src="/files/a.png" alt="x"> and <IMG class="c" src=\'/private/files/b.jpg\'/>'
		'<img src="data:image/png;base64,AAAA"></p>'
	)
	assert qm.extract_image_sources(html) == [
		"/files/a.png",
		"/private/files/b.jpg",
		"data:image/png;base64,AAAA",
	]


def test_extract_image_sources_empty_and_plain():
	assert qm.extract_image_sources(None) == []
	assert qm.extract_image_sources("") == []
	assert qm.extract_image_sources("no images here") == []
	assert qm.extract_image_sources("<p>text</p><a href='/files/a.png'>link</a>") == []


def test_extract_keeps_duplicates_and_srcless_img():
	html = '<img src="/files/a.png"><img src="/files/a.png"><img alt="no src">'
	assert qm.extract_image_sources(html) == ["/files/a.png", "/files/a.png", ""]


def test_extract_unescapes_entities():
	assert qm.extract_image_sources('<img src="/files/a.png?x=1&amp;y=2">') == ["/files/a.png?x=1&y=2"]


def test_data_uri_detection():
	assert qm.is_data_uri("data:image/png;base64,AAAA")
	assert qm.is_data_uri("  DATA:image/jpeg;base64,AAAA")
	assert not qm.is_data_uri("/files/a.png")
	assert not qm.is_data_uri("")
	assert not qm.is_data_uri(None)
	assert (
		qm.count_data_uri_images(["/files/a.png", "data:image/png;base64,A", "data:image/gif;base64,B"]) == 2
	)


def test_image_limit():
	five = ["/files/a.png"] * 5
	assert not qm.exceeds_image_limit(five)
	assert qm.exceeds_image_limit([*five, "/files/b.png"])
	assert qm.exceeds_image_limit(["x", "y", "z"], limit=2)


def test_local_file_url_relative():
	assert qm.local_file_url("/files/a.png") == "/files/a.png"
	assert qm.local_file_url("/private/files/a.png") == "/private/files/a.png"
	assert qm.local_file_url("/files/a%20b.png?v=1#top") == "/files/a b.png"


def test_local_file_url_rejects_other_sources():
	assert qm.local_file_url("") is None
	assert qm.local_file_url(None) is None
	assert qm.local_file_url("data:image/png;base64,AAAA") is None
	assert qm.local_file_url("/assets/lms/a.png") is None
	assert qm.local_file_url("files/a.png") is None
	assert qm.local_file_url("//evil.example/files/a.png") is None
	assert qm.local_file_url("/files/../private/files/a.png") is None
	assert qm.local_file_url("/files/%2e%2e/a.png") is None


def test_local_file_url_absolute_requires_known_host():
	assert qm.local_file_url("https://lms.example.com/files/a.png", HOSTS) == "/files/a.png"
	assert qm.local_file_url("https://other.example.com/files/a.png", HOSTS) is None
	assert qm.local_file_url("https://lms.example.com/files/a.png") is None
	assert qm.local_file_url("https://lms.example.com/assets/a.png", HOSTS) is None


def test_local_file_urls_unique_in_order():
	sources = [
		"/files/b.png",
		"https://cdn.example.com/files/x.png",
		"/files/a.png",
		"/files/b.png",
		"data:image/png;base64,A",
	]
	assert qm.local_file_urls(sources, HOSTS) == ["/files/b.png", "/files/a.png"]


def test_allowed_extensions():
	for name in ("a.jpg", "a.JPEG", "a.png", "a.WebP", "/files/my.photo.png"):
		assert qm.has_allowed_extension(name), name
	for name in ("a.gif", "a.svg", "a.bmp", "a.avif", "a.pdf", "a", "a.png.exe", "/files/png"):
		assert not qm.has_allowed_extension(name), name


def test_disallowed_extension_urls():
	urls = ["/files/a.png", "/files/b.gif", "/files/c.svg", "/files/d.webp"]
	assert qm.disallowed_extension_urls(urls) == ["/files/b.gif", "/files/c.svg"]
	assert qm.disallowed_extension_urls([]) == []


def test_oversized_urls_boundary_and_unknown():
	limit = qm.MAX_IMAGE_BYTES
	sizes = {
		"/files/exact.png": limit,
		"/files/over.png": limit + 1,
		"/files/small.png": 10,
		"/files/zero.png": 0,
		"/files/none.png": None,
	}
	urls = [*sizes, "/files/unknown.png"]
	assert qm.oversized_urls(urls, sizes) == [("/files/over.png", limit + 1)]


def test_oversized_urls_custom_limit():
	assert qm.oversized_urls(["/files/a.png"], {"/files/a.png": 11}, max_bytes=10) == [("/files/a.png", 11)]


def test_option_present():
	assert qm.option_present("A", None)
	assert qm.option_present(None, "/files/a.png")
	assert qm.option_present("A", "/files/a.png")
	assert not qm.option_present(None, None)
	assert not qm.option_present("", "")
	assert not qm.option_present("   ", " ")


def test_duplicate_options_compare_text_and_image():
	assert qm.has_duplicate_options([("A", None), ("A", "")])
	assert qm.has_duplicate_options([(None, "/files/a.png"), (None, "/files/a.png")])
	assert not qm.has_duplicate_options([(None, "/files/a.png"), (None, "/files/b.png")])
	assert not qm.has_duplicate_options([("A", "/files/a.png"), ("A", "/files/b.png")])
	assert not qm.has_duplicate_options([("A", None), (None, None), (None, None)])
	assert not qm.has_duplicate_options([])


def test_correct_flags_without_option():
	options = [("A", None), (None, "/files/a.png"), (None, None), ("", "")]
	assert qm.correct_flags_without_option(options, [1, 1, 0, 0]) == []
	assert qm.correct_flags_without_option(options, [1, 0, 1, 1]) == [3, 4]
	assert qm.correct_flags_without_option(options, [0, 0, 0, 0]) == []


def test_option_image_urls_use_body_image_rules():
	images = ["/files/a.png", "/private/files/b.gif", "", None, "data:image/png;base64,AAAA"]
	sources = [image for image in images if image]
	assert qm.count_data_uri_images(sources) == 1
	urls = qm.local_file_urls(sources, HOSTS)
	assert urls == ["/files/a.png", "/private/files/b.gif"]
	assert qm.disallowed_extension_urls(urls) == ["/private/files/b.gif"]
	assert qm.oversized_urls(urls, {"/files/a.png": qm.MAX_IMAGE_BYTES + 1}) == [
		("/files/a.png", qm.MAX_IMAGE_BYTES + 1)
	]


def test_reserved_option_text():
	assert qm.is_reserved_option_text("[image:1]")
	assert qm.is_reserved_option_text("  [image:10] ")
	assert not qm.is_reserved_option_text("[image:]")
	assert not qm.is_reserved_option_text("[image:a]")
	assert not qm.is_reserved_option_text("see [image:1]")
	assert not qm.is_reserved_option_text("Paris")
	assert not qm.is_reserved_option_text(None)


def test_option_key_is_text_or_image_slot():
	assert qm.option_key("Paris", 3) == "Paris"
	assert qm.option_key(None, 3) == "[image:3]"
	assert qm.option_key("", 10) == "[image:10]"
	assert qm.option_key("   ", 2) == "[image:2]"


def test_option_keys_distinguish_image_only_options():
	options = [
		("A", None),
		(None, "/files/a.png"),
		(None, None),
		(None, "/files/b.png"),
		("D", "/files/d.png"),
	]
	keys = qm.option_keys(options)
	assert keys == ["A", "[image:2]", None, "[image:4]", "D"]
	present = [key for key in keys if key]
	assert len(set(present)) == len(present)


KEYS = ["A", "[image:2]", None, "[image:4]"]


def test_single_choice_grading_by_key():
	flags = [0, 0, 0, 1]
	assert qm.is_choice_answer_correct(KEYS, flags, 0, ["[image:4]"])
	assert not qm.is_choice_answer_correct(KEYS, flags, 0, ["[image:2]"])
	assert not qm.is_choice_answer_correct(KEYS, flags, 0, ["A"])
	assert not qm.is_choice_answer_correct(KEYS, flags, 0, [""])
	assert not qm.is_choice_answer_correct(KEYS, flags, 0, [])
	assert qm.is_choice_answer_correct(KEYS, [1, 0, 0, 0], 0, ["A"])


def test_multiple_choice_grading_by_key():
	flags = [1, 0, 0, 1]
	assert qm.is_choice_answer_correct(KEYS, flags, 1, ["A", "[image:4]"])
	assert qm.is_choice_answer_correct(KEYS, flags, 1, ["[image:4]", "A"])
	assert not qm.is_choice_answer_correct(KEYS, flags, 1, ["A"])
	assert not qm.is_choice_answer_correct(KEYS, flags, 1, ["A", "[image:4]", "[image:2]"])
	assert not qm.is_choice_answer_correct(KEYS, flags, 1, [])


def test_choice_answer_flags_per_slot():
	flags = [1, 0, 0, 1]
	assert qm.choice_answer_flags(KEYS, flags, ["[image:4]", "[image:2]"]) == [2, 0, 0, 1]
	assert qm.choice_answer_flags(KEYS, flags, ["A", "[image:4]"]) == [1, 0, 0, 1]
	assert qm.choice_answer_flags(KEYS, flags, [""]) == [2, 0, 0, 2]
