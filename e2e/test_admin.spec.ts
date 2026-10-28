import { test, expect } from "./fixtures";
import { authFile, baseURL } from "./config";
import { button, deleteLeftovers, waitForApiCall } from "./helpers";
import {
	adminApi,
	choiceQuestion,
	createLearnerUser,
	createQuiz,
	getDoc,
	insertDoc,
	labeledField,
	learnerContext,
	listDocs,
	makeLearner,
	setValues,
	SUBMIT_QUIZ_METHOD,
	testUser,
} from "./quizHelpers";
import type { Api, Learner } from "./quizHelpers";
import type { BrowserContext, Page } from "@playwright/test";

// Numbers used throughout:
//   Quiz I (instructions): two choice questions worth 2 and 3 marks, so the
//   intro and the outline say 2 questions and 5 marks.
//   Quiz N (no instructions): one question worth 1 mark, "1 question · 1 mark".
//   Both sit in lessons of one published course; a third lesson holds no quiz.
// The learner submits quiz I, which is what makes its delete refused later.

// Unique per run: leftovers from runs whose afterAll never ran share this DB,
// and LMS Question and LMS Quiz rows are cleaned up by matching this token.
const runToken = Date.now();
const instructionsTitle = `E2E Instructions Quiz ${runToken}`;
const plainTitle = `E2E No Instructions Quiz ${runToken}`;
const importTitle = `E2E Imported Quiz ${runToken}`;
const instructionsLesson = `E2E Lesson With Instructions Quiz ${runToken}`;
const plainLesson = `E2E Lesson With Plain Quiz ${runToken}`;
const readingLesson = `E2E Reading Lesson ${runToken}`;
const instructionsText = `Bring a calculator ${runToken}.`;
const boldText = "Phones stay off.";

const IMPORT_METHOD = "lms.lms.test_import.import_tests";
const DUPLICATE_METHOD = "lms.lms.doctype.lms_quiz.lms_quiz.duplicate_quiz";

let api: Api | undefined;
let learner: Learner | undefined;
let learnerCtx: BrowserContext | undefined;
let instructionsQuiz: string | undefined;
let plainQuiz: string | undefined;
let firstCopy: string | undefined;
let course: string | undefined;
let chapter: string | undefined;
const lessons: string[] = [];

type QuizDoc = {
	name: string;
	title: string;
	instructions?: string | null;
	passing_percentage: number;
	total_marks: number;
	questions: { question: string; marks: number }[];
};

// A lesson places its quiz through an editorjs quiz block; saving the lesson
// derives the LMS Lesson Assessment row the outline and the learner's access
// both read.
function quizBlock(quiz: string) {
	return JSON.stringify({
		time: 1765194986690,
		blocks: [{ id: "q1", type: "quiz", data: { quiz } }],
		version: "2.29.0",
	});
}

// The lesson only gets a Lesson Reference, and so a place in the outline,
// through create_lesson; the content is set afterwards so the save syncs it.
async function createLesson(api: Api, title: string, content?: string) {
	const response = await api.request.post(
		"/api/method/lms.lms.api.create_lesson",
		{ headers: api.headers, form: { chapter: chapter as string, title } },
	);
	if (!response.ok()) {
		throw new Error(`create_lesson failed: ${response.status()}`);
	}
	const name = ((await response.json()) as { message: string }).message;
	lessons.push(name);
	if (content) await setValues(api, "Course Lesson", name, { content });
	return name;
}

async function withLearnerPage(fn: (page: Page) => Promise<void>) {
	const page = await (learnerCtx as BrowserContext).newPage();
	try {
		await fn(page);
	} finally {
		await page.close();
	}
}

// The start screen's stats grid pairs each <dt> label with its <dd>.
function stat(page: Page, label: string) {
	return page
		.locator("dl > div")
		.filter({ has: page.getByText(label, { exact: true }) })
		.locator("dd");
}

const quizzesWithTitle = (title: string) =>
	listDocs<{ name: string }>(api as Api, "LMS Quiz", { title }, ["name"]);

const submissionsOf = (quiz: string) =>
	listDocs<{ name: string }>(api as Api, "LMS Quiz Submission", { quiz }, [
		"name",
	]);

// The file input is the dialog's only way in; Playwright hands it the file
// from memory, so no fixture file is written to disk.
async function chooseImportFile(page: Page, name: string, body: string) {
	const checked = waitForApiCall(page, IMPORT_METHOD);
	await page.getByTestId("quiz-import-file").setInputFiles({
		name,
		mimeType: "application/json",
		buffer: Buffer.from(body),
	});
	await checked;
}

async function openImport(page: Page) {
	await page.goto("/lms/quizzes");
	await button(page, "Import").click();
	await expect(
		page.getByRole("dialog").filter({ hasText: "Import tests from JSON" }),
	).toBeVisible();
}

// One test with two sections' worth of shape: a choice and a fill-in-the-blank
// question, both carrying the run token so the question-bank cleanup finds them.
const validImport = {
	tests: [
		{
			title: importTitle,
			passing_percentage: 70,
			sections: [
				{
					title: "Section 1",
					questions: [
						{
							type: "single_choice",
							text: `<p>Pick the right one (${runToken})</p>`,
							options: [
								{ text: "Wrong", correct: false },
								{ text: "Right", correct: true },
							],
							marks: 2,
						},
						{
							type: "fill_blank",
							body: `<p>Two plus two is [[1]] (${runToken})</p>`,
							blanks: [{ id: "1", answers: ["4"], marks: 1 }],
						},
					],
				},
			],
		},
	],
};

test.describe("Test (quiz) administration", () => {
	// Each test builds on what the one before left (instructions, a submission,
	// a first copy), and the names live only in the worker whose beforeAll made
	// them. Serial retries the chain from fresh data.
	test.describe.configure({ mode: "serial" });

	test.beforeAll(async ({ browser }, testInfo) => {
		testInfo.setTimeout(120000);
		api = await adminApi();

		learner = makeLearner(runToken);
		await createLearnerUser(api, learner);

		const questions: string[] = [];
		for (const [text, marks] of [
			[`Instructions quiz question A (${runToken})`, 2],
			[`Instructions quiz question B (${runToken})`, 3],
			[`Plain quiz question (${runToken})`, 1],
		] as const) {
			questions.push((await insertDoc(api, choiceQuestion(text, marks))).name);
		}
		instructionsQuiz = (
			await createQuiz(api, {
				title: instructionsTitle,
				rows: [
					{ question: questions[0], marks: 2 },
					{ question: questions[1], marks: 3 },
				],
			})
		).name;
		plainQuiz = (
			await createQuiz(api, {
				title: plainTitle,
				rows: [{ question: questions[2], marks: 1 }],
			})
		).name;

		course = (
			await insertDoc(api, {
				doctype: "LMS Course",
				title: `E2E Test Admin Course ${runToken}`,
				short_introduction: "Holds the quizzes of the test admin spec.",
				description: "<p>Created by the test admin e2e spec.</p>",
				published: 1,
				instructors: [{ instructor: testUser }],
			})
		).name;
		// upsert_chapter also links the chapter into the course outline.
		const response = await api.request.post(
			"/api/method/lms.lms.api.upsert_chapter",
			{
				headers: api.headers,
				form: {
					title: `E2E Test Admin Chapter ${runToken}`,
					course,
					is_scorm_package: "0",
				},
			},
		);
		if (!response.ok()) {
			throw new Error(`upsert_chapter failed: ${response.status()}`);
		}
		chapter = ((await response.json()) as { message: { name: string } }).message
			.name;

		// Lessons first, enrolment last: a lesson saved under an enrolled course
		// queues a progress recalculation.
		await createLesson(api, instructionsLesson, quizBlock(instructionsQuiz));
		await createLesson(api, plainLesson, quizBlock(plainQuiz));
		await createLesson(api, readingLesson);
		await insertDoc(api, {
			doctype: "LMS Enrollment",
			member: learner.email,
			course,
		});

		learnerCtx = await learnerContext(browser, learner);
	});

	// Links first: the learner's submissions and progress hold the quiz and the
	// course, the lessons place the quizzes, a placed quiz is stamped with its
	// course, and the questions outlive every quiz that used them. Lessons go
	// one by one through delete_lesson, a real delete that takes their
	// placement rows with them; delete_chapter's raw delete would leave those
	// behind and block the quizzes. Every quiz this spec made, copies and the
	// import included, carries the run token in its title. Cleanup runs before
	// the learner's context closes, so a close that throws cannot skip it.
	test.afterAll(async () => {
		await deleteLeftovers([
			{ doctype: "LMS Quiz Submission", filters: { member: learner?.email } },
			{ doctype: "LMS Course Progress", filters: { member: learner?.email } },
			{ doctype: "LMS Enrollment", filters: { course } },
			...lessons.map((lesson) => ({
				method: "lms.lms.api.delete_lesson",
				args: { lesson, chapter },
			})),
			{ method: "lms.lms.api.delete_chapter", args: { chapter } },
			{
				doctype: "LMS Quiz",
				filters: { title: ["like", `%${runToken}%`] },
			},
			{ doctype: "LMS Course", name: course },
			{
				doctype: "LMS Question",
				filters: { question: ["like", `%(${runToken})%`] },
			},
			{ doctype: "User", name: learner?.email },
		]);
		await learnerCtx?.close();
		await api?.request.dispose();
	});

	test("the admin writes formatted instructions in the quiz form", async ({
		page,
	}) => {
		await page.goto(`/lms/quizzes/edit/${instructionsQuiz}`);
		const editor = page
			.getByTestId("quiz-instructions-editor")
			.locator("div.ProseMirror");
		await editor.click();
		await page.keyboard.type(`${instructionsText} `);
		await page.keyboard.press("Control+b");
		await page.keyboard.type(boldText);

		// The form autosaves; the stored field is what the learner is served.
		await expect
			.poll(
				async () =>
					(
						await getDoc<QuizDoc>(
							api as Api,
							"LMS Quiz",
							instructionsQuiz as string,
						)
					).instructions ?? "",
				{ timeout: 15000 },
			)
			.toContain(`<strong>${boldText}</strong>`);
		await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	});

	test("the learner sees the instructions, question count and total marks before Start", async () => {
		test.setTimeout(90000);
		await withLearnerPage(async (page) => {
			await page.goto(`/lms/quiz/${instructionsQuiz}`);
			const instructions = page.getByTestId("quiz-instructions");
			await expect(instructions).toContainText(instructionsText);
			await expect(instructions.locator("strong")).toHaveText(boldText);
			await expect(stat(page, "Questions")).toHaveText("2");
			await expect(page.getByTestId("quiz-total-marks")).toHaveText("5");
			const start = button(page, "Start Quiz");
			await expect(start).toBeEnabled();

			// The attempt is what the delete test below relies on. show_answers is
			// on by default, so each question is Checked before Next or Submit.
			await start.click();
			for (const last of [false, true]) {
				await page
					.locator("label", { hasText: "Right answer" })
					.locator("input")
					.click();
				await button(page, "Check").click();
				if (!last) await button(page, "Next").click();
			}
			const submit = waitForApiCall(page, SUBMIT_QUIZ_METHOD);
			await button(page, "Submit").click();
			await submit;
			await expect(page.getByTestId("quiz-verdict")).toContainText("Passed");
		});
	});

	test("a quiz without instructions shows no instructions box", async () => {
		await withLearnerPage(async (page) => {
			await page.goto(`/lms/quiz/${plainQuiz}`);
			await expect(button(page, "Start Quiz")).toBeEnabled();
			await expect(stat(page, "Questions")).toHaveText("1");
			await expect(page.getByTestId("quiz-total-marks")).toHaveText("1");
			await expect(page.getByTestId("quiz-instructions")).toHaveCount(0);
		});
	});

	test("a JSON file with errors is reported and nothing is imported", async ({
		page,
	}) => {
		await openImport(page);
		const errors = page.getByTestId("quiz-import-errors");
		const confirm = page.getByTestId("quiz-import-confirm");

		await chooseImportFile(page, "broken.json", "{ not json");
		await expect(errors).toContainText(
			"The file has errors. Nothing was imported.",
		);
		await expect(errors).toContainText("document: not valid JSON");
		await expect(confirm).toBeDisabled();

		// Valid JSON, but the test has no pass mark and the question no blanks.
		const invalid = structuredClone(validImport);
		const broken = invalid.tests[0] as Record<string, unknown>;
		delete broken.passing_percentage;
		(
			invalid.tests[0].sections[0].questions[1] as Record<string, unknown>
		).blanks = [];
		await chooseImportFile(page, "invalid.json", JSON.stringify(invalid));
		await expect(errors).toContainText(
			"The file has errors. Nothing was imported.",
		);
		await expect(errors.locator("li")).not.toHaveCount(0);
		await expect(confirm).toBeDisabled();

		expect(await quizzesWithTitle(importTitle)).toHaveLength(0);
	});

	test("a valid JSON file is checked first and only Confirm imports it", async ({
		page,
	}) => {
		await openImport(page);
		await chooseImportFile(page, "tests.json", JSON.stringify(validImport));

		const created = page.getByTestId("quiz-import-created");
		await expect(created).toContainText("Will be created");
		await expect(created).toContainText(importTitle);
		await expect(created).toContainText("(2 questions)");
		await expect(page.getByTestId("quiz-import-errors")).toHaveCount(0);
		// The dry run wrote nothing.
		expect(await quizzesWithTitle(importTitle)).toHaveLength(0);

		const imported = waitForApiCall(page, IMPORT_METHOD);
		await page.getByTestId("quiz-import-confirm").click();
		expect((await imported).ok()).toBe(true);
		await expect(page.getByText("1 test imported")).toBeVisible();
		await expect(created).toContainText("Created");
		await expect(page.getByTestId("quiz-import-confirm")).toHaveCount(0);

		const [quiz] = await quizzesWithTitle(importTitle);
		expect(quiz).toBeTruthy();
		const doc = await getDoc<QuizDoc>(api as Api, "LMS Quiz", quiz.name);
		expect(doc.questions).toHaveLength(2);
		expect(doc.total_marks).toBe(3);
		expect(doc.passing_percentage).toBe(70);

		// The list behind the dialog was reloaded with it.
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toBeHidden();
		await expect(
			page.getByRole("link").filter({ hasText: importTitle }),
		).toBeVisible();
	});

	test("Duplicate in the quiz form makes a (Copy) with the same questions and no submissions", async ({
		page,
	}) => {
		await page.goto(`/lms/quizzes/edit/${instructionsQuiz}`);
		const duplicated = waitForApiCall(page, DUPLICATE_METHOD);
		await button(page, "Duplicate").click();
		expect((await duplicated).ok()).toBe(true);
		await expect(page.getByText("Quiz duplicated")).toBeVisible();
		await page.waitForURL(
			(url) =>
				url.pathname.startsWith("/lms/quizzes/edit/") &&
				!url.pathname.endsWith(`/${instructionsQuiz}`),
		);
		firstCopy = page.url().split("/").pop() as string;
		await expect(labeledField(page, "Title")).toHaveValue(
			`${instructionsTitle} (Copy)`,
		);

		const source = await getDoc<QuizDoc>(
			api as Api,
			"LMS Quiz",
			instructionsQuiz as string,
		);
		const copy = await getDoc<QuizDoc>(api as Api, "LMS Quiz", firstCopy);
		expect(copy.title).toBe(`${instructionsTitle} (Copy)`);
		expect(copy.questions.map((row) => [row.question, row.marks])).toEqual(
			source.questions.map((row) => [row.question, row.marks]),
		);
		expect(copy.instructions).toBe(source.instructions);
		expect(copy.total_marks).toBe(5);
		expect(await submissionsOf(instructionsQuiz as string)).toHaveLength(1);
		expect(await submissionsOf(firstCopy)).toHaveLength(0);
	});

	test("Duplicate in the Quizzes list makes a (Copy 2) of the same quiz", async ({
		page,
	}) => {
		await page.goto("/lms/quizzes");
		await page.getByRole("textbox", { name: "Search" }).fill(instructionsTitle);
		// The search matches the source and its first copy. Each row is a link
		// holding its selection checkbox and the read-only Show Answers one.
		await expect(
			page.getByRole("link").filter({ hasText: `${instructionsTitle} (Copy)` }),
		).toBeVisible();
		await page
			.getByRole("link")
			.filter({ hasText: instructionsTitle })
			.filter({ hasNotText: "(Copy)" })
			.getByRole("checkbox", { disabled: false })
			.click();

		const duplicated = waitForApiCall(page, DUPLICATE_METHOD);
		await button(page, "Duplicate").click();
		expect((await duplicated).ok()).toBe(true);
		await page.waitForURL(/\/lms\/quizzes\/edit\//);
		const secondCopy = page.url().split("/").pop() as string;

		const copy = await getDoc<QuizDoc>(api as Api, "LMS Quiz", secondCopy);
		expect(copy.title).toBe(`${instructionsTitle} (Copy 2)`);
		expect(copy.questions).toHaveLength(2);
		expect(await submissionsOf(secondCopy)).toHaveLength(0);
	});

	// The refusal arrives as a 417 from frappe.client.delete, which Chromium
	// logs as a console error, and the shared `page` fixture fails any test on
	// one. So this page is opened beside the fixture, on the same admin
	// session, and checks the console itself: that refusal and nothing else.
	test("a quiz with a submission cannot be deleted and says why", async ({
		browser,
	}) => {
		const context = await browser.newContext({
			storageState: authFile,
			baseURL,
		});
		const page = await context.newPage();
		await page.route("https://pulse.m.frappe.cloud/**", (route) =>
			route.fulfill({ contentType: "application/javascript", body: "" }),
		);
		const problems: string[] = [];
		page.on("pageerror", (error) => problems.push(error.message));
		page.on("console", (msg) => {
			if (msg.type() !== "error" && msg.type() !== "warning") return;
			const refusal =
				/status of 417/.test(msg.text()) &&
				msg.location().url.endsWith("/api/method/frappe.client.delete");
			if (!refusal && !/ResizeObserver loop/.test(msg.text())) {
				problems.push(msg.text());
			}
		});
		try {
			await page.goto(`/lms/quizzes/edit/${instructionsQuiz}`);
			await button(page, "Delete").click();
			const dialog = page
				.getByRole("dialog")
				.filter({ hasText: "Delete this quiz?" });
			await expect(dialog).toContainText(
				"A quiz that already has submissions or practical scores cannot be deleted.",
			);
			await dialog.getByRole("button", { name: "Delete" }).click();
			await expect(
				page.getByText(
					"This quiz cannot be deleted because it already has submissions or practical scores. Nothing was deleted.",
				),
			).toBeVisible();
			await expect(page).toHaveURL(
				new RegExp(`/lms/quizzes/edit/${instructionsQuiz}$`),
			);
			expect(await quizzesWithTitle(instructionsTitle)).toHaveLength(1);
			expect(problems).toEqual([]);
		} finally {
			await context.close();
		}
	});

	test("a quiz without submissions is deleted", async ({ page }) => {
		await page.goto(`/lms/quizzes/edit/${firstCopy}`);
		await button(page, "Delete").click();
		await page
			.getByRole("dialog")
			.filter({ hasText: "Delete this quiz?" })
			.getByRole("button", { name: "Delete" })
			.click();
		await expect(page.getByText("Quiz deleted successfully")).toBeVisible();
		await page.waitForURL(/\/lms\/quizzes$/);
		expect(await quizzesWithTitle(`${instructionsTitle} (Copy)`)).toHaveLength(
			0,
		);
	});

	test("the course outline shows a lesson test's questions and marks", async ({
		page,
	}) => {
		await page.goto(`/lms/courses/${course}`);
		const lesson = (title: string) =>
			page.getByRole("link").filter({ hasText: title });

		await expect(
			lesson(instructionsLesson).getByTestId("outline-quiz-stats"),
		).toHaveText("2 questions · 5 marks");
		await expect(
			lesson(plainLesson).getByTestId("outline-quiz-stats"),
		).toHaveText("1 question · 1 mark");
		await expect(lesson(readingLesson)).toBeVisible();
		await expect(
			lesson(readingLesson).getByTestId("outline-quiz-stats"),
		).toHaveCount(0);
	});
});
