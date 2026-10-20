import { test, expect } from "./fixtures";
import { button, deleteLeftovers, waitForApiCall } from "./helpers";
import {
	adminApi,
	choiceQuestion,
	createLearnerUser,
	createQuiz,
	insertDoc,
	learnerContext,
	makeLearner,
	SUBMIT_QUIZ_METHOD,
	testUser,
} from "./quizHelpers";
import type { Api, Learner } from "./quizHelpers";
import type { BrowserContext, Locator, Page } from "@playwright/test";

// Numbers used throughout (quiz P, the one with a practical component):
//   one question worth 5 marks, practical_max_marks 10, pass mark 60%.
//   The learner answers it correctly: test 5 of 5.
//   Total is out of 5 + 10 = 15, and Pass needs
//     (test + practical) / (test_out_of + practical_max) * 100 >= 60
//     (5 + practical) / 15 * 100 >= 60, which is practical >= 4.
//   practical 3   -> 8 / 15    = 53.33%  -> Fail
//   practical 7.5 -> 12.5 / 15 = 83.33%  -> Pass
// Quiz N has no practical component: 1 question worth 1 mark, answered
// correctly, so the status is Pass at once (1 of 1, 100%).

// Unique per run: leftovers from runs whose afterAll never ran share this DB.
const runToken = Date.now();
const practicalTitle = `E2E Practical Quiz ${runToken}`;
const plainTitle = `E2E Plain Quiz ${runToken}`;

const SET_PRACTICAL_METHOD = "lms.lms.quiz_results.set_practical_score";

// Column order of the results table (QuizResults.vue).
const COL = {
	learner: 0,
	quiz: 1,
	attempts: 2,
	test: 3,
	practical: 4,
	total: 5,
	status: 6,
};

let api: Api | undefined;
let learner: Learner | undefined;
let learnerCtx: BrowserContext | undefined;
let practicalQuiz: string | undefined;
let plainQuiz: string | undefined;
let practicalQuestion: string | undefined;
let plainQuestion: string | undefined;
let course: string | undefined;
let chapter: string | undefined;
const lessons: string[] = [];

// The learner's own browser context: its own cookies, so the admin session the
// default `page` carries is never involved on the learner's side. A fresh page
// per use, closed afterwards.
async function withLearnerPage(fn: (page: Page) => Promise<void>) {
	const page = await (learnerCtx as BrowserContext).newPage();
	try {
		await fn(page);
	} finally {
		await page.close();
	}
}

// show_answers is on by default, so a choice question is Checked before Submit
// (same flow as quiz.spec.ts). The option row is a <label> around the radio.
async function learnerPassesTest(page: Page, quizName: string) {
	await page.goto(`/lms/quiz/${quizName}`);
	const start = button(page, "Start Quiz");
	await expect(start).toBeEnabled();
	await start.click();
	await page
		.locator("label", { hasText: "Right answer" })
		.locator("input")
		.click();
	await button(page, "Check").click();
	const submit = waitForApiCall(page, SUBMIT_QUIZ_METHOD);
	await button(page, "Submit").click();
	await submit;
	await expect(page.getByTestId("quiz-verdict")).toContainText("Passed");
}

const resultsRows = (page: Page) =>
	page.getByTestId("results-table").locator("tbody tr");

const resultRow = (page: Page, title: string) =>
	page.getByTestId("results-table").getByRole("row").filter({ hasText: title });

const cell = (row: Locator, column: number) =>
	row.getByRole("cell").nth(column);

// The learner's name narrows the table to this spec's two rows, whatever else
// the shared DB holds.
async function openResults(page: Page) {
	await page.goto("/lms/quizzes/results");
	await page
		.getByRole("textbox", { name: "Search learner" })
		.fill((learner as Learner).lastName);
	await expect(resultsRows(page)).toHaveCount(2);
}

async function openResult(page: Page, title: string) {
	await resultRow(page, title)
		.getByRole("button", { name: /Open result for/ })
		.click();
	await expect(page.getByTestId("detail-cards")).toBeVisible();
}

async function closeResult(page: Page) {
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("result-detail")).toBeHidden();
}

async function saveScore(page: Page, value: string) {
	await page.getByTestId("practical-input").fill(value);
	const saved = waitForApiCall(page, SET_PRACTICAL_METHOD);
	await page.getByTestId("practical-save").click();
	expect((await saved).ok()).toBe(true);
}

test.describe("Quiz results and practical score", () => {
	// Each test builds on the scores the one before left, and the names live
	// only in the worker whose beforeAll made them. Serial retries the chain
	// from fresh data instead of one test against stale data.
	test.describe.configure({ mode: "serial" });

	// Everything is created through the API as admin, in dependency order. The
	// learner is a throwaway User (LMS Student, random password, deleted in
	// afterAll). The learner reaches the quizzes the way a real one does: the
	// quizzes sit in lessons of a course the learner is enrolled in (a lesson's
	// quiz_id is a placement, see permissions._course_placements), which is what
	// can_access_quiz checks for anyone who is not an author or a moderator.
	test.beforeAll(async ({ browser }, testInfo) => {
		testInfo.setTimeout(120000);
		api = await adminApi();

		learner = makeLearner(runToken);
		await createLearnerUser(api, learner);

		practicalQuestion = (
			await insertDoc(
				api,
				choiceQuestion(`Practical quiz question (${runToken})`, 5)
			)
		).name;
		plainQuestion = (
			await insertDoc(
				api,
				choiceQuestion(`Plain quiz question (${runToken})`, 1)
			)
		).name;

		practicalQuiz = (
			await createQuiz(api, {
				title: practicalTitle,
				rows: [{ question: practicalQuestion, marks: 5 }],
				passing_percentage: 60,
				practical_max_marks: 10,
			})
		).name;
		plainQuiz = (
			await createQuiz(api, {
				title: plainTitle,
				rows: [{ question: plainQuestion, marks: 1 }],
				passing_percentage: 60,
			})
		).name;

		course = (
			await insertDoc(api, {
				doctype: "LMS Course",
				title: `E2E Results Course ${runToken}`,
				short_introduction: "Holds the quizzes of the quiz results spec.",
				description: "<p>Created by the quiz results e2e spec.</p>",
				instructors: [{ instructor: testUser }],
			})
		).name;
		chapter = (
			await insertDoc(api, {
				doctype: "Course Chapter",
				title: `E2E Results Chapter ${runToken}`,
				course,
			})
		).name;
		// Lessons first, enrolment last: a lesson saved under an enrolled course
		// queues a progress recalculation.
		for (const [index, quiz] of [practicalQuiz, plainQuiz].entries()) {
			const lesson = await insertDoc(api, {
				doctype: "Course Lesson",
				title: `E2E Results Lesson ${index + 1} ${runToken}`,
				chapter,
				course,
				quiz_id: quiz,
			});
			lessons.push(lesson.name);
		}
		await insertDoc(api, {
			doctype: "LMS Enrollment",
			member: learner.email,
			course,
		});

		learnerCtx = await learnerContext(browser, learner);
	});

	// Links first, in reverse of how they were made: practical scores and
	// submissions hold the quizzes and the learner, the enrolment and lessons
	// hold the course, and the questions outlive the quizzes that used them.
	test.afterAll(async () => {
		await learnerCtx?.close();
		await deleteLeftovers([
			{ doctype: "LMS Quiz Practical Score", filters: { quiz: practicalQuiz } },
			{ doctype: "LMS Quiz Practical Score", filters: { quiz: plainQuiz } },
			{ doctype: "LMS Quiz Submission", filters: { quiz: practicalQuiz } },
			{ doctype: "LMS Quiz Submission", filters: { quiz: plainQuiz } },
			{ doctype: "LMS Enrollment", filters: { course } },
			...lessons.map((name) => ({ doctype: "Course Lesson", name })),
			{ doctype: "Course Chapter", name: chapter },
			{ doctype: "LMS Course", name: course },
			{ doctype: "LMS Quiz", name: practicalQuiz },
			{ doctype: "LMS Quiz", name: plainQuiz },
			{ doctype: "LMS Question", name: practicalQuestion },
			{ doctype: "LMS Question", name: plainQuestion },
			{ doctype: "User", name: learner?.email },
		]);
		await api?.request.dispose();
	});

	test("the learner passes the test of both quizzes", async () => {
		test.setTimeout(90000);
		await withLearnerPage(async (page) => {
			await learnerPassesTest(page, practicalQuiz as string);
			// The result screen carries the overall result; with a practical
			// component still open it says so.
			await expect(page.getByTestId("summary-status")).toHaveText(
				"Waiting for practical score"
			);
			await learnerPassesTest(page, plainQuiz as string);
		});
	});

	test("the results page lists the learner with the right status per quiz", async ({
		page,
	}) => {
		await openResults(page);

		const practical = resultRow(page, practicalTitle);
		await expect(cell(practical, COL.attempts)).toHaveText("1");
		await expect(cell(practical, COL.test)).toHaveText("5 of 5");
		await expect(cell(practical, COL.practical)).toHaveText("Not entered");
		await expect(cell(practical, COL.total)).toHaveText("-");
		await expect(cell(practical, COL.status)).toHaveText("Pending Practical");

		// No practical component: "-", and a Pass or Fail straight away.
		const plain = resultRow(page, plainTitle);
		await expect(cell(plain, COL.test)).toHaveText("1 of 1");
		await expect(cell(plain, COL.practical)).toHaveText("-");
		await expect(cell(plain, COL.total)).toContainText("1 of 1");
		await expect(cell(plain, COL.total)).toContainText("(100%)");
		await expect(cell(plain, COL.status)).toHaveText("Pass");
	});

	test("search and the status filter narrow the table", async ({ page }) => {
		await openResults(page);

		const search = page.getByRole("textbox", { name: "Search learner" });
		await search.fill(`nobody-${runToken}`);
		await expect(
			page.getByText("Try a different search or clear the filters.")
		).toBeVisible();
		await search.fill((learner as Learner).lastName);
		await expect(resultsRows(page)).toHaveCount(2);

		const status = page.getByRole("combobox", { name: "Filter by Status" });
		const choose = async (name: string) => {
			await status.click();
			await page.getByRole("option", { name, exact: true }).click();
		};

		await choose("Pending Practical");
		await expect(resultsRows(page)).toHaveCount(1);
		await expect(resultsRows(page)).toContainText(practicalTitle);

		await choose("Pass");
		await expect(resultsRows(page)).toHaveCount(1);
		await expect(resultsRows(page)).toContainText(plainTitle);

		await choose("Fail");
		await expect(
			page.getByText("Try a different search or clear the filters.")
		).toBeVisible();

		await choose("All statuses");
		await expect(resultsRows(page)).toHaveCount(2);
	});

	test("the practical form validates the score and blocks Save", async ({
		page,
	}) => {
		await openResults(page);
		await openResult(page, practicalTitle);

		const input = page.getByTestId("practical-input");
		const save = page.getByTestId("practical-save");
		const outOfRange = page.getByText("Enter a score between 0 and 10").first();

		// Nothing entered yet.
		await expect(save).toBeDisabled();

		await input.fill("11");
		await expect(outOfRange).toBeVisible();
		await expect(save).toBeDisabled();

		await input.fill("-1");
		await expect(outOfRange).toBeVisible();
		await expect(save).toBeDisabled();

		await input.fill("7.555");
		await expect(
			page.getByText("Use at most 2 decimal places").first()
		).toBeVisible();
		await expect(save).toBeDisabled();

		// The maximum itself is allowed.
		await input.fill("10");
		await expect(save).toBeEnabled();

		await closeResult(page);
		// Nothing was saved: the row still waits for a practical score.
		await expect(cell(resultRow(page, practicalTitle), COL.status)).toHaveText(
			"Pending Practical"
		);
	});

	test("the learner sees that the practical score is still awaited", async () => {
		await withLearnerPage(async (page) => {
			await page.goto(`/lms/quiz/${practicalQuiz}`);
			await expect(page.getByTestId("quiz-result-summary")).toBeVisible();
			await expect(page.getByTestId("summary-status")).toHaveText(
				"Waiting for practical score"
			);
			await expect(page.getByTestId("summary-test")).toHaveText("5 of 5");
			await expect(page.getByTestId("summary-practical")).toHaveText(
				"Waiting for practical score"
			);
			// No total until the practical score is in.
			await expect(page.getByTestId("summary-total")).toHaveCount(0);
			await expect(page.getByTestId("summary-pass-mark")).toHaveText("60%");
		});
	});

	test("a saved practical score sets the total and the Pass or Fail status", async ({
		page,
	}) => {
		test.setTimeout(90000);
		await openResults(page);
		await openResult(page, practicalTitle);

		const detail = page.getByTestId("detail-cards");
		await expect(detail).toContainText("Pending Practical");

		// 3 of 10: (5 + 3) / 15 = 53.33%, under the 60% pass mark.
		await saveScore(page, "3");
		await expect(detail).toContainText("3 of 10");
		await expect(detail).toContainText("8 of 15");
		await expect(detail).toContainText("53.33%");
		await expect(detail).toContainText("Fail");

		// 7.5 of 10: (5 + 7.5) / 15 = 83.33%, over it.
		await saveScore(page, "7.5");
		await expect(detail).toContainText("7.5 of 10");
		await expect(detail).toContainText("12.5 of 15");
		await expect(detail).toContainText("83.33%");
		await expect(detail).toContainText("Pass");
		await expect(page.getByTestId("scored-by")).toBeVisible();

		// The table behind the dialog was reloaded with it.
		await closeResult(page);
		const row = resultRow(page, practicalTitle);
		await expect(cell(row, COL.practical)).toHaveText("7.5 of 10");
		await expect(cell(row, COL.total)).toContainText("12.5 of 15");
		await expect(cell(row, COL.total)).toContainText("(83.33%)");
		await expect(cell(row, COL.status)).toHaveText("Pass");
	});

	test("the learner then sees the practical score, the total and Pass", async () => {
		await withLearnerPage(async (page) => {
			await page.goto(`/lms/quiz/${practicalQuiz}`);
			await expect(page.getByTestId("summary-status")).toHaveText("Pass");
			await expect(page.getByTestId("summary-test")).toHaveText("5 of 5");
			await expect(page.getByTestId("summary-practical")).toHaveText(
				"7.5 of 10"
			);
			await expect(page.getByTestId("summary-total")).toContainText(
				"12.5 of 15"
			);
			await expect(page.getByTestId("summary-percentage")).toContainText(
				"83.33%"
			);
			await expect(page.getByTestId("summary-pass-mark")).toHaveText("60%");
		});
	});

	test("clearing the practical score returns the result to Pending Practical", async ({
		page,
	}) => {
		test.setTimeout(90000);
		await openResults(page);
		await openResult(page, practicalTitle);

		await page.getByTestId("practical-clear").click();
		await page
			.getByRole("dialog")
			.filter({ hasText: "Clear the practical score?" })
			.getByRole("button", { name: "Clear", exact: true })
			.click();

		await expect(page.getByTestId("detail-cards")).toContainText(
			"Pending Practical"
		);
		await expect(page.getByTestId("practical-input")).toHaveValue("");
		await expect(page.getByTestId("practical-clear")).toHaveCount(0);

		await closeResult(page);
		const row = resultRow(page, practicalTitle);
		await expect(cell(row, COL.practical)).toHaveText("Not entered");
		await expect(cell(row, COL.status)).toHaveText("Pending Practical");

		await withLearnerPage(async (learnerPage) => {
			await learnerPage.goto(`/lms/quiz/${practicalQuiz}`);
			await expect(learnerPage.getByTestId("summary-status")).toHaveText(
				"Waiting for practical score"
			);
		});
	});

	test("a quiz without a practical component has no practical form", async ({
		page,
	}) => {
		await openResults(page);
		await openResult(page, plainTitle);

		await expect(page.getByTestId("no-practical")).toHaveText(
			"This test has no practical score."
		);
		await expect(page.getByTestId("practical-save")).toHaveCount(0);
		await expect(page.getByTestId("detail-cards")).toContainText("Pass");
		await closeResult(page);

		await withLearnerPage(async (learnerPage) => {
			await learnerPage.goto(`/lms/quiz/${plainQuiz}`);
			await expect(learnerPage.getByTestId("summary-status")).toHaveText(
				"Pass"
			);
			await expect(learnerPage.getByTestId("summary-test")).toHaveText(
				"1 of 1"
			);
			await expect(learnerPage.getByTestId("summary-practical")).toHaveCount(0);
			await expect(learnerPage.getByTestId("summary-total")).toContainText(
				"1 of 1"
			);
		});
	});
});
