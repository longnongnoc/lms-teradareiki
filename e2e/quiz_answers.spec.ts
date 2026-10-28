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
	setValues,
	SUBMIT_QUIZ_METHOD,
	testUser,
} from "./quizHelpers";
import type { Api, Learner } from "./quizHelpers";
import type { BrowserContext, Page } from "@playwright/test";

// The quizzes, all pass mark 60%:
//   shown     two 1-mark questions, Show Answers on, ten attempts and the
//             attempt history on. Both right is 2 of 2 (Passed); the retake
//             gets the second wrong, 1 of 2 = 50% (Failed).
//   hidden    one question, Show Answers off: answers listed, no key.
//   noReview  one question, Show Answer Review off: nothing listed at all.
//   practical one 5-mark question plus a practical score out of 10, never
//             entered, so the overall result stays pending on every attempt.

// Unique per run: leftovers from runs whose afterAll never ran share this DB.
const runToken = Date.now();
const shownTitle = `E2E Answers Shown ${runToken}`;
const hiddenTitle = `E2E Answers Hidden ${runToken}`;
const noReviewTitle = `E2E Answers No Review ${runToken}`;
const practicalTitle = `E2E Answers Practical ${runToken}`;

const SUBMISSION_ANSWERS_METHOD =
	"/api/method/lms.lms.quiz_results.get_submission_answers";

type AnswerRow = {
	question_name: string;
	answer: string | null;
	marks: number;
	marks_out_of: number;
	correct_answer?: unknown;
};

let api: Api | undefined;
let learner: Learner | undefined;
let other: Learner | undefined;
let learnerCtx: BrowserContext | undefined;
let otherCtx: BrowserContext | undefined;
// The learner again, in a context that has not loaded the app yet, so the
// first translations it fetches are those of the language the last test sets.
let japaneseCtx: BrowserContext | undefined;
const quizzes: Record<string, string> = {};
let course: string | undefined;
let chapter: string | undefined;
const lessons: string[] = [];
// The learner's first submission of the shown quiz, read by the later tests.
let firstShownSubmission: string | undefined;

// Each question gets its own option texts, so an answer on the result screen
// says which question and which attempt it came from.
function question(label: string, marks = 1) {
	return {
		...choiceQuestion(`Question ${label} (${runToken})`, marks),
		option_1: `Wrong ${label}`,
		option_2: `Right ${label}`,
	};
}

async function withPage(
	context: BrowserContext | undefined,
	fn: (page: Page) => Promise<void>
) {
	const page = await (context as BrowserContext).newPage();
	try {
		await fn(page);
	} finally {
		await page.close();
	}
}

// One pick per question, in order. With Show Answers on each pick is Checked
// before moving on; with it off, Submit asks for confirmation first. Returns
// the name of the submission the attempt made.
async function sitQuiz(
	page: Page,
	picks: string[],
	{ showAnswers = true } = {}
) {
	for (const [index, pick] of picks.entries()) {
		await page.locator("label", { hasText: pick }).locator("input").click();
		if (showAnswers) await button(page, "Check").click();
		if (index < picks.length - 1) {
			await button(page, "Next").click();
			continue;
		}
		const submit = waitForApiCall(page, SUBMIT_QUIZ_METHOD);
		await button(page, "Submit").click();
		if (!showAnswers) {
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Submit", exact: true })
				.click();
		}
		const response = await submit;
		expect(response.ok()).toBe(true);
		return ((await response.json()) as { message: { submission: string } })
			.message.submission;
	}
	throw new Error("No picks given");
}

async function startQuiz(page: Page, quiz: string) {
	await page.goto(`/lms/quiz/${quiz}`);
	const start = button(page, "Start Quiz");
	await expect(start).toBeEnabled();
	await start.click();
}

// What the learner's own session gets from the server, not what the page shows.
async function answersAsUser(context: BrowserContext, submission: string) {
	return context.request.get(SUBMISSION_ANSWERS_METHOD, {
		params: { submission },
	});
}

async function learnerAnswers(submission: string) {
	const response = await answersAsUser(
		learnerCtx as BrowserContext,
		submission
	);
	expect(response.ok()).toBe(true);
	return (
		(await response.json()) as {
			message: { show_correct_answers: boolean; questions: AnswerRow[] };
		}
	).message;
}

const reviewItems = (page: Page) => page.getByTestId("answer-review-item");
const reviewItem = (page: Page, label: string) =>
	reviewItems(page).filter({ hasText: `Question ${label} (${runToken})` });

test.describe("Quiz answers on the learner's result", () => {
	// Each test builds on the attempts the one before made, and the names live
	// only in the worker whose beforeAll made them. Serial retries the chain
	// from fresh data instead of one test against stale data.
	test.describe.configure({ mode: "serial" });

	// Everything is created through the API as admin. The learners reach the
	// quizzes the way a real one does, through lessons of a course they are
	// enrolled in (can_access_quiz). The other learner only needs a session: it
	// is never meant to read anything of the first one's.
	test.beforeAll(async ({ browser }, testInfo) => {
		testInfo.setTimeout(120000);
		api = await adminApi();

		learner = makeLearner(`${runToken}a`);
		other = makeLearner(`${runToken}b`);
		await createLearnerUser(api, learner);
		await createLearnerUser(api, other);

		const name = async (doc: Record<string, unknown>) =>
			(await insertDoc(api as Api, doc)).name;
		const [s1, s2, h1, r1, p1] = [
			await name(question("S1")),
			await name(question("S2")),
			await name(question("H1")),
			await name(question("R1")),
			await name(question("P1", 5)),
		];

		quizzes.shown = (
			await createQuiz(api, {
				title: shownTitle,
				rows: [{ question: s1 }, { question: s2 }],
				max_attempts: 10,
				show_submission_history: 1,
			})
		).name;
		quizzes.hidden = (
			await createQuiz(api, {
				title: hiddenTitle,
				rows: [{ question: h1 }],
				show_answers: 0,
			})
		).name;
		quizzes.noReview = (
			await createQuiz(api, {
				title: noReviewTitle,
				rows: [{ question: r1 }],
				show_answer_review: 0,
			})
		).name;
		quizzes.practical = (
			await createQuiz(api, {
				title: practicalTitle,
				rows: [{ question: p1, marks: 5 }],
				practical_max_marks: 10,
			})
		).name;

		course = (
			await insertDoc(api, {
				doctype: "LMS Course",
				title: `E2E Answers Course ${runToken}`,
				short_introduction: "Holds the quizzes of the quiz answers spec.",
				description: "<p>Created by the quiz answers e2e spec.</p>",
				instructors: [{ instructor: testUser }],
			})
		).name;
		chapter = (
			await insertDoc(api, {
				doctype: "Course Chapter",
				title: `E2E Answers Chapter ${runToken}`,
				course,
			})
		).name;
		// Lessons first, enrolment last: a lesson saved under an enrolled course
		// queues a progress recalculation.
		for (const [index, quiz] of Object.values(quizzes).entries()) {
			const lesson = await insertDoc(api, {
				doctype: "Course Lesson",
				title: `E2E Answers Lesson ${index + 1} ${runToken}`,
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
		otherCtx = await learnerContext(browser, other);
		japaneseCtx = await learnerContext(browser, learner);
	});

	// Links first: submissions and progress hold the quizzes, lessons and
	// learners, the enrolment and lessons hold the course, and the questions
	// outlive the quizzes that used them.
	test.afterAll(async () => {
		await learnerCtx?.close();
		await otherCtx?.close();
		await japaneseCtx?.close();
		await deleteLeftovers([
			...Object.values(quizzes).map((quiz) => ({
				doctype: "LMS Quiz Submission",
				filters: { quiz },
			})),
			{ doctype: "LMS Course Progress", filters: { course } },
			{ doctype: "LMS Enrollment", filters: { course } },
			...lessons.map((name) => ({ doctype: "Course Lesson", name })),
			{ doctype: "Course Chapter", name: chapter },
			{ doctype: "LMS Course", name: course },
			...Object.values(quizzes).map((name) => ({
				doctype: "LMS Quiz",
				name,
			})),
			{
				doctype: "LMS Question",
				filters: { question: ["like", `%(${runToken})%`] },
			},
			{ doctype: "User", name: learner?.email },
			{ doctype: "User", name: other?.email },
		]);
		await api?.request.dispose();
	});

	test("the result lists each question with the answer, marks and key", async () => {
		test.setTimeout(90000);
		await withPage(learnerCtx, async (page) => {
			await startQuiz(page, quizzes.shown);
			firstShownSubmission = await sitQuiz(page, ["Right S1", "Right S2"]);

			await expect(page.getByTestId("quiz-verdict")).toHaveText("Passed");
			await expect(page.getByTestId("answer-review")).toBeVisible();
			await expect(reviewItems(page)).toHaveCount(2);
			for (const label of ["S1", "S2"]) {
				const item = reviewItem(page, label);
				await expect(item).toContainText("1 of 1 marks");
				await expect(item).toContainText(`Your answer: Right ${label}`);
				await expect(item.getByTestId("answer-review-correct")).toHaveText(
					`Correct answer: Right ${label}`
				);
			}
		});

		// The key comes from the server, which sends it because the quiz shows
		// answers.
		const answers = await learnerAnswers(firstShownSubmission as string);
		expect(answers.show_correct_answers).toBe(true);
		expect(answers.questions.map((row) => row.correct_answer)).toEqual([
			"Right S1",
			"Right S2",
		]);
	});

	test("with Show Answers off the answers are listed without the key", async () => {
		let submission = "";
		await withPage(learnerCtx, async (page) => {
			await startQuiz(page, quizzes.hidden);
			submission = await sitQuiz(page, ["Wrong H1"], { showAnswers: false });

			await expect(reviewItems(page)).toHaveCount(1);
			const item = reviewItem(page, "H1");
			await expect(item).toContainText("0 of 1 marks");
			await expect(item).toContainText("Your answer: Wrong H1");
			await expect(page.getByTestId("answer-review-correct")).toHaveCount(0);
			await expect(page.getByText("Right H1")).toHaveCount(0);
		});

		// Hidden on the server too, not only left out of the page.
		const answers = await learnerAnswers(submission);
		expect(answers.show_correct_answers).toBe(false);
		expect(answers.questions).toHaveLength(1);
		expect(answers.questions[0].answer).toBe("Wrong H1");
		expect(answers.questions[0]).not.toHaveProperty("correct_answer");
	});

	test("with Show Answer Review off the learner gets no answers at all", async () => {
		let submission = "";
		await withPage(learnerCtx, async (page) => {
			await startQuiz(page, quizzes.noReview);
			submission = await sitQuiz(page, ["Right R1"]);

			await expect(page.getByTestId("quiz-verdict")).toHaveText("Passed");
			await expect(page.getByTestId("answer-review")).toHaveCount(0);

			// The submission page keeps them back as well.
			await page.goto(`/lms/quiz-submission/${submission}`);
			await expect(page.getByTestId("review-hidden")).toBeVisible();
			await expect(page.getByText("Right R1")).toHaveCount(0);
		});

		const answers = await learnerAnswers(submission);
		expect(answers.questions).toEqual([]);
	});

	test("the learner reads their own submission page, read-only", async () => {
		await withPage(learnerCtx, async (page) => {
			const url = `/lms/quiz-submission/${firstShownSubmission}`;
			await page.goto(url);
			await expect(
				page.getByRole("heading", { level: 1, name: shownTitle })
			).toBeVisible();
			await expect(page.getByText("Right S1").first()).toBeVisible();
			await expect(page.getByTestId("correct-answer")).toHaveCount(2);
			// Nothing to grade or save from here.
			await expect(button(page, "Save")).toHaveCount(0);
			await expect(page.getByRole("spinbutton")).toHaveCount(0);
			await expect(page).toHaveURL(new RegExp(`${url}$`));
		});
	});

	test("another learner is sent away and refused by the server", async () => {
		await withPage(otherCtx, async (page) => {
			await page.goto(`/lms/quiz-submission/${firstShownSubmission}`);
			await expect(page).toHaveURL(/\/lms\/courses$/);
			await expect(page.getByText("Right S1")).toHaveCount(0);
		});

		const response = await answersAsUser(
			otherCtx as BrowserContext,
			firstShownSubmission as string
		);
		expect(response.status()).toBe(403);
		expect(await response.text()).toContain("PermissionError");
	});

	test("a failing retake lists only its own answers and reads Failed", async () => {
		test.setTimeout(90000);
		let retake = "";
		await withPage(learnerCtx, async (page) => {
			await startQuiz(page, quizzes.shown);
			const first = await sitQuiz(page, ["Right S1", "Right S2"]);
			expect(first).not.toBe(firstShownSubmission);
			await expect(page.getByTestId("quiz-verdict")).toHaveText("Passed");

			await button(page, "Try again").click();
			await button(page, "Start Quiz").click();
			retake = await sitQuiz(page, ["Right S1", "Wrong S2"]);

			// The best attempt passed, but this one did not, and that is what the
			// badge reports for a quiz without a practical score.
			await expect(page.getByTestId("quiz-verdict")).toHaveText("Failed");
			await expect(reviewItems(page)).toHaveCount(2);
			await expect(reviewItem(page, "S1")).toContainText(
				"Your answer: Right S1"
			);
			const second = reviewItem(page, "S2");
			await expect(second).toContainText("0 of 1 marks");
			await expect(second).toContainText("Your answer: Wrong S2");
			await expect(second).not.toContainText("Your answer: Right S2");
		});

		const answers = await learnerAnswers(retake);
		expect(answers.questions.map((row) => row.answer)).toEqual([
			"Right S1",
			"Wrong S2",
		]);
	});

	test("with a practical score pending no verdict shows, on a retake either", async () => {
		test.setTimeout(90000);
		await withPage(learnerCtx, async (page) => {
			await startQuiz(page, quizzes.practical);
			await sitQuiz(page, ["Right P1"]);
			await expect(page.getByTestId("summary-status")).toHaveText(
				"Waiting for practical score"
			);
			await expect(page.getByTestId("quiz-verdict")).toHaveCount(0);

			await button(page, "Try again").click();
			await button(page, "Start Quiz").click();
			await sitQuiz(page, ["Wrong P1"]);
			await expect(reviewItem(page, "P1")).toContainText(
				"Your answer: Wrong P1"
			);
			await expect(page.getByTestId("summary-status")).toHaveText(
				"Waiting for practical score"
			);
			await expect(page.getByTestId("quiz-verdict")).toHaveCount(0);
		});
	});

	test("in Japanese the attempt history has Japanese column labels", async () => {
		await setValues(api as Api, "User", (learner as Learner).email, {
			language: "ja",
		});
		await withPage(japaneseCtx, async (page) => {
			await page.goto(`/lms/quiz/${quizzes.shown}`);
			// The history list's header is plain text, not a table: No., Date,
			// Score, Score out of, Percentage, in that order (lms/locale/ja.po).
			// The result summary above has its own table with some of the same
			// words, so the five are matched as one header.
			await expect(
				page.getByText(/^番号\s*日付\s*スコア\s*満点\s*割合$/)
			).toBeVisible();
			await expect(page.getByText("Score out of")).toHaveCount(0);
		});
	});
});
