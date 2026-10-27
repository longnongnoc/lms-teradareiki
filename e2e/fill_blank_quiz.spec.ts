import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";
import { button, deleteLeftovers, waitForApiCall } from "./helpers";
import {
	adminApi,
	blankInput,
	createQuiz,
	fillBlankQuestion,
	fillBlanks,
	getDoc,
	insertDoc,
	labeledField,
	listDocs,
	openQuiz,
	resultMarks,
	SUBMIT_QUIZ_METHOD,
} from "./quizHelpers";
import type { Api } from "./quizHelpers";

// Unique per run: the shared dev DB keeps leftovers from runs whose afterAll
// never got to run, and the question-bank cleanup below matches on this token.
const runToken = Date.now();
const authoredTitle = `E2E Fill Blank Authored ${runToken}`;
const symbolTitle = `E2E Fill Blank Symbols ${runToken}`;
const imageTitle = `E2E Fill Blank Image ${runToken}`;

// The symbols are written as escapes so the file stays ASCII-safe and the
// look-alike pairs cannot be "fixed" into one code point by an editor.
const DEGREE_C = "\u00B0C"; // U+00B0 DEGREE SIGN, then C
const CELSIUS_SIGN = "\u2103"; // DEGREE CELSIUS, NFKC gives U+00B0 and C
const GREEK_OMEGA = "\u03A9"; // GREEK CAPITAL LETTER OMEGA
const OHM_SIGN = "\u2126"; // OHM SIGN, NFKC gives U+03A9

// Blank 1 of the authored question accepts both spellings (one per line);
// blank 2 accepts "abc123", which the learner types in full-width form.
const COMPRESSOR = "圧縮機";
const COMPRESSOR_KANA = "コンプレッサー";
const FULL_WIDTH_ABC123 = "ＡＢＣ１２３";
const KATAKANA = "テスト";
const HALF_WIDTH_KATAKANA = "ﾃｽﾄ";

// A public asset shipped with the app (hooks.py app_icon_url), so the image
// needs no upload and never goes through the /files/ image rules.
const LOGO_PATH = "/assets/lms/images/lms-logo.png";

let api: Api | undefined;
let authoredQuiz: string | undefined;
let symbolQuiz: string | undefined;
let imageQuiz: string | undefined;

test.describe("Fill in the Blanks quiz", () => {
	// The attempts build on the quiz and question the authoring test made, and
	// the names live only in the worker whose tests set them. Serial retries the
	// whole chain from a fresh quiz instead of one test against a stale one.
	test.describe.configure({ mode: "serial" });

	// Playwright insists the first argument destructures its fixtures, even none.
	// eslint-disable-next-line no-empty-pattern
	test.beforeAll(async ({}, testInfo) => {
		testInfo.setTimeout(60000);
		api = await adminApi();

		// Symbols: accepted degree C, Greek omega and katakana, typed by the learner
		// as the single code point CELSIUS SIGN, the OHM SIGN and half-width katakana.
		// NFKC maps each onto the accepted spelling, so every blank earns its
		// mark.
		const symbols = await insertDoc(
			api,
			fillBlankQuestion(
				`<p>Maximum operating temperature [[1]], unit of resistance [[2]], test in katakana [[3]] (${runToken})</p>`,
				[
					{ blank_id: "1", answers: DEGREE_C },
					{ blank_id: "2", answers: GREEK_OMEGA },
					{ blank_id: "3", answers: KATAKANA },
				]
			)
		);
		symbolQuiz = (
			await createQuiz(api, {
				title: symbolTitle,
				rows: [{ question: symbols.name, marks: 3 }],
			})
		).name;

		// Image: a Fill Blank body with an <img>, which the player makes
		// clickable (QuizQuestionBody.vue).
		const image = await insertDoc(
			api,
			fillBlankQuestion(
				`<p>Name of the product shown below [[1]] (${runToken})</p><p><img src="${LOGO_PATH}" alt="E2E product logo"></p>`,
				[{ blank_id: "1", answers: "lms" }]
			)
		);
		imageQuiz = (
			await createQuiz(api, {
				title: imageTitle,
				rows: [{ question: image.name, marks: 1 }],
			})
		).name;
	});

	// Submissions first: LMS Quiz refuses to go while one links to it, and a
	// question outlives its quiz (the bank record is owned separately). All
	// three questions carry "(runToken)" in their text.
	test.afterAll(async () => {
		await deleteLeftovers([
			{ doctype: "LMS Quiz Submission", filters: { quiz: authoredQuiz } },
			{ doctype: "LMS Quiz Submission", filters: { quiz: symbolQuiz } },
			{ doctype: "LMS Quiz Submission", filters: { quiz: imageQuiz } },
			{ doctype: "LMS Quiz", name: authoredQuiz },
			{ doctype: "LMS Quiz", name: symbolQuiz },
			{ doctype: "LMS Quiz", name: imageQuiz },
			{
				doctype: "LMS Question",
				filters: { question: ["like", `%(${runToken})%`] },
			},
		]);
		await api?.request.dispose();
	});

	test("author builds a Fill in the Blanks question in a new quiz", async ({
		page,
	}) => {
		test.setTimeout(90000);
		await page.goto("/lms/quizzes/new");

		// Naming the quiz is what inserts it (QuizForm.vue's createIfNamed, on
		// the title's blur).
		const title = labeledField(page, "Title");
		await title.fill(authoredTitle);
		await title.blur();
		await page.waitForURL(/\/lms\/quizzes\/edit\//);
		authoredQuiz = page.url().split("/").pop() as string;
		await labeledField(page, "Passing Percentage").fill("60");

		await page
			.getByTestId("question-toolbar")
			.getByRole("button", { name: "New question" })
			.click();
		const draft = page.getByTestId("draft-card");

		// A quiz's first question starts as Single choice.
		await draft.getByRole("button", { name: "Single choice" }).click();
		await page.getByRole("menuitem", { name: "Fill in the Blanks" }).click();

		const rows = draft.getByTestId("fill-blank-row");
		await expect(draft.getByTestId("fill-blank-empty")).toBeVisible();
		await expect(rows).toHaveCount(0);

		// The cursor decides where each marker lands. "Insert blank" keeps the
		// editor focused (mousedown is prevented), so the keyboard carries on
		// from the end of the marker it just inserted.
		const insertBlank = draft.getByRole("button", { name: "Insert blank" });
		await draft.locator("div.ProseMirror").click();
		await page.keyboard.type(`Refrigerant is compressed by the (${runToken}) `);
		await insertBlank.click();
		await expect(rows).toHaveCount(1);
		await page.keyboard.type(" and the sample code is ");
		await insertBlank.click();
		await expect(rows).toHaveCount(2);
		await page.keyboard.type(".");

		await expect(rows.nth(0)).toContainText("[[1]]");
		await expect(rows.nth(1)).toContainText("[[2]]");

		// Saving needs an accepted answer for every blank. Save stays enabled so a
		// tap is never met with silence: an invalid one shows what is missing.
		const save = draft.getByRole("button", { name: "Save question" });
		const missingAnswer = (row: Locator) =>
			row.getByText("Add at least one accepted answer");
		await expect(save).toBeEnabled();

		// Nothing is flagged before the author has had a turn at the blanks.
		await expect(missingAnswer(rows.nth(0))).toHaveCount(0);
		await expect(missingAnswer(rows.nth(1))).toHaveCount(0);

		// The red hint of a row waits for the author to leave its empty field.
		const blank2 = rows.nth(1).locator("textarea");
		await blank2.focus();
		await blank2.blur();
		await expect(missingAnswer(rows.nth(1))).toBeVisible();
		await expect(missingAnswer(rows.nth(0))).toHaveCount(0);

		// Save with both answers missing does not save: the draft stays open, no
		// card joins the quiz, and every blank now says what it lacks.
		await save.click();
		await expect(missingAnswer(rows.nth(0))).toBeVisible();
		await expect(missingAnswer(rows.nth(1))).toBeVisible();
		await expect(draft).toBeVisible();
		await expect(page.getByTestId("blank-count")).toHaveCount(0);

		// Blank 1: two accepted answers, one per line.
		await rows
			.nth(0)
			.locator("textarea")
			.fill(`${COMPRESSOR}\n${COMPRESSOR_KANA}`);
		await expect(missingAnswer(rows.nth(0))).toHaveCount(0);
		await expect(missingAnswer(rows.nth(1))).toBeVisible();

		// Blank 2 is still empty, so a second try is refused as well.
		await save.click();
		await expect(draft).toBeVisible();
		await expect(missingAnswer(rows.nth(1))).toBeVisible();
		await expect(page.getByTestId("blank-count")).toHaveCount(0);

		await blank2.fill("abc123");
		await expect(missingAnswer(rows.nth(1))).toHaveCount(0);
		await expect(save).toBeEnabled();

		// One mark per blank by default, and the question is worth their sum.
		await expect(draft.getByTestId("fill-blank-marks")).toContainText(
			"2 marks"
		);
		await expect(draft.getByTestId("fill-blank-total")).toContainText(
			"Total: 2 marks"
		);

		await save.click();
		await draft.waitFor({ state: "detached" });

		// The saved card reads the markers as chips and counts the blanks.
		await expect(page.getByTestId("blank-count")).toHaveText("2 blanks");
		await expect(page.getByTestId("blank-chip")).toHaveText(["[1]", "[2]"]);

		// The row joins the quiz on the quiz's own save. Ctrl+S forces it and
		// the badge flips from "Not saved" once it has landed.
		await page.keyboard.press("Control+s");
		await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	});

	test("the question persists after a reload", async ({ page }) => {
		await page.goto(`/lms/quizzes/edit/${authoredQuiz}`);

		await expect(page.getByTestId("blank-count")).toHaveText("2 blanks");
		await expect(page.getByTestId("blank-chip")).toHaveText(["[1]", "[2]"]);

		// Opening the card loads the whole question, answer key included.
		await page.getByRole("button", { name: "Edit question 1" }).click();
		const rows = page.getByTestId("fill-blank-row");
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0).locator("textarea")).toHaveValue(
			`${COMPRESSOR}\n${COMPRESSOR_KANA}`
		);
		await expect(rows.nth(1).locator("textarea")).toHaveValue("abc123");

		// And the server holds the same thing.
		const quiz = await getDoc<{ questions: { question: string }[] }>(
			api as Api,
			"LMS Quiz",
			authoredQuiz as string
		);
		expect(quiz.questions).toHaveLength(1);
		const question = await getDoc<{
			type: string;
			marks: number;
			blanks: { blank_id: string; answers: string; marks: number }[];
		}>(api as Api, "LMS Question", quiz.questions[0].question);
		expect(question.type).toBe("Fill Blank");
		expect(question.marks).toBe(2);
		expect(
			question.blanks.map((b) => [b.blank_id, b.answers, b.marks])
		).toEqual([
			["1", `${COMPRESSOR}\n${COMPRESSOR_KANA}`, 1],
			["2", "abc123", 1],
		]);
	});

	test("an alternative Japanese answer and a full-width answer earn full marks", async ({
		page,
	}) => {
		await openQuiz(page, authoredQuiz as string);

		// Blank 1 accepts the second of its two lines. Blank 2 accepts "abc123",
		// and NFKC folds the full-width letters and digits onto it.
		await fillBlanks(page, {
			"1": COMPRESSOR_KANA,
			"2": FULL_WIDTH_ABC123,
		});

		// show_answers is on by default, so Check grades the question live.
		await button(page, "Check").click();
		await expect(page.getByTestId("quiz-feedback")).toContainText(
			"Correct, 2 of 2 marks"
		);

		const submit = waitForApiCall(page, SUBMIT_QUIZ_METHOD);
		await button(page, "Submit").click();
		await submit;

		await expect(page.getByTestId("quiz-verdict")).toContainText("Passed");
		await expect(resultMarks(page)).toContainText("2 of 2 marks");

		const review = page.getByTestId("fill-blank-review");
		await expect(
			review.getByRole("heading", { name: "Fill in the blanks review" })
		).toBeVisible();
		const results = review.getByTestId("blank-result");
		await expect(results).toHaveCount(2);
		await expect(results.nth(0)).toContainText("Your answer, correct");
		await expect(results.nth(1)).toContainText("Your answer, correct");
		await expect(results.nth(1)).toContainText(FULL_WIDTH_ABC123);
	});

	test("a wrong blank earns partial marks and the review marks it incorrect", async ({
		page,
	}) => {
		// Needs unlimited attempts: the quiz leaves max_attempts at its default
		// of 0, which is what lets this second attempt happen at all.
		await openQuiz(page, authoredQuiz as string);

		// Check with a blank still empty does not grade: it flags that blank and
		// says why, rather than locking the question with the blank marked wrong.
		await fillBlanks(page, { "1": COMPRESSOR });
		await button(page, "Check").click();
		await expect(page.getByTestId("empty-blank-warning")).toHaveText(
			"Fill in every blank before checking"
		);
		await expect(blankInput(page, "2")).toHaveAttribute("aria-invalid", "true");
		await expect(blankInput(page, "1")).not.toHaveAttribute(
			"aria-invalid",
			"true"
		);
		await expect(page.getByTestId("quiz-feedback")).toHaveCount(0);

		// A wrong value in the second blank earns the first blank's mark only. It
		// is neither right nor wrong overall, so the banner says "Partly correct".
		await fillBlanks(page, { "2": "abc124" });
		await button(page, "Check").click();
		await expect(page.getByTestId("quiz-feedback")).toContainText(
			"Partly correct, 1 of 2 marks"
		);

		const submit = waitForApiCall(page, SUBMIT_QUIZ_METHOD);
		await button(page, "Submit").click();
		await submit;

		// 1 of 2 marks is 50%, under the 60% pass mark.
		await expect(page.getByTestId("quiz-verdict")).toContainText("Failed");
		await expect(resultMarks(page)).toContainText("1 of 2 marks");

		const results = page
			.getByTestId("fill-blank-review")
			.getByTestId("blank-result");
		await expect(results).toHaveCount(2);
		await expect(results.nth(0)).toContainText("Your answer, correct");
		await expect(results.nth(1)).toContainText("Your answer, incorrect");
		// An admin sees the answer key beside a wrong blank.
		await expect(results.nth(1)).toContainText("Accepted answers");
		await expect(results.nth(1)).toContainText("abc123");

		// Both attempts were stored, with the per-blank marks summed.
		const scores = await listDocs<{ score: number; score_out_of: number }>(
			api as Api,
			"LMS Quiz Submission",
			{ quiz: authoredQuiz },
			["score", "score_out_of"]
		);
		expect(scores.map((s) => s.score).sort((a, b) => a - b)).toEqual([1, 2]);
		expect(scores.every((s) => s.score_out_of === 2)).toBe(true);
	});

	test("symbols and half-width katakana match through Unicode normalisation", async ({
		page,
	}) => {
		await openQuiz(page, symbolQuiz as string);

		// CELSIUS SIGN (U+2103) is accepted for degree C (U+00B0 and C), the OHM
		// SIGN (U+2126) for the Greek capital omega (U+03A9), and half-width
		// katakana for the full-width.
		await fillBlanks(page, {
			"1": CELSIUS_SIGN,
			"2": OHM_SIGN,
			"3": HALF_WIDTH_KATAKANA,
		});
		await button(page, "Check").click();
		await expect(page.getByTestId("quiz-feedback")).toContainText(
			"Correct, 3 of 3 marks"
		);

		const submit = waitForApiCall(page, SUBMIT_QUIZ_METHOD);
		await button(page, "Submit").click();
		await submit;

		await expect(page.getByTestId("quiz-verdict")).toContainText("Passed");
		await expect(resultMarks(page)).toContainText("3 of 3 marks");
		const results = page
			.getByTestId("fill-blank-review")
			.getByTestId("blank-result");
		await expect(results).toHaveCount(3);
		for (let i = 0; i < 3; i++) {
			await expect(results.nth(i)).toContainText("Your answer, correct");
		}
	});

	test("an image in the question body opens the zoom dialog", async ({
		page,
	}) => {
		await openQuiz(page, imageQuiz as string);

		// The sanitised <img> is made reachable: role=button, labelled with its alt.
		const logo = page.getByRole("button", {
			name: "Enlarge image: E2E product logo",
		});
		await expect(logo).toBeVisible();
		await logo.click();

		const zoom = page.getByTestId("image-zoom");
		await expect(zoom).toBeVisible();
		await expect(zoom.locator("img")).toHaveAttribute(
			"src",
			/\/assets\/lms\/images\/lms-logo\.png$/
		);

		// Escape closes the overlay and goes no further.
		await page.keyboard.press("Escape");
		await expect(zoom).toBeHidden();

		// The keyboard opens it too, and its close button shuts it.
		await logo.focus();
		await page.keyboard.press("Enter");
		await expect(zoom).toBeVisible();
		await zoom.getByRole("button", { name: "Close" }).click();
		await expect(zoom).toBeHidden();

		// Finish the attempt instead of leaving the page mid-quiz, which would
		// submit it from the pagehide beacon.
		await fillBlanks(page, { "1": "LMS" });
		await button(page, "Check").click();
		await expect(page.getByTestId("quiz-feedback")).toContainText(
			"Correct, 1 of 1 marks"
		);
		const submit = waitForApiCall(page, SUBMIT_QUIZ_METHOD);
		await button(page, "Submit").click();
		await submit;
		await expect(page.getByTestId("quiz-verdict")).toContainText("Passed");
	});
});
