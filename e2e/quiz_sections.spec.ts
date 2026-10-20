import { test, expect } from "./fixtures";
import { button, deleteLeftovers } from "./helpers";
import {
	adminApi,
	choiceQuestion,
	createQuiz,
	getDoc,
	insertDoc,
	setValues,
} from "./quizHelpers";
import type { Api } from "./quizHelpers";
import type { Page } from "@playwright/test";

// Unique per run: leftovers from runs whose afterAll never ran share this DB.
const runToken = Date.now();
const quizTitle = `E2E Sections ${runToken}`;

let api: Api | undefined;
let quizName: string | undefined;
// Created in order, so questionNames[0] is the quiz's first question.
const questionNames: string[] = [];

// Every question's text ends in "(runToken)", which is also how the player's
// current question is found: nothing else on the page carries it.
const questionText = (n: number) => `Sections question ${n} (${runToken})`;

type Row = { question: string; group: string | null };
const quizGroups = async () =>
	(
		await getDoc<{ questions: Row[] }>(
			api as Api,
			"LMS Quiz",
			quizName as string
		)
	).questions.map((row) => row.group);

// A section lives on the quiz row, not the question, so it is typed into the
// card's own "Section" input and committed on Enter (QuestionCard.vue). Close
// only drops what the card holds for the question itself.
async function setSection(page: Page, position: number, title: string) {
	await page
		.getByRole("button", { name: `Edit question ${position}`, exact: true })
		.click();
	const field = page.getByTestId("section-field");
	await field.locator("input").fill(title);
	await field.locator("input").press("Enter");
	await field
		.locator("xpath=ancestor::div[starts-with(@id, 'question-card-')][1]")
		.getByRole("button", { name: "Close", exact: true })
		.click();
	await expect(page.getByTestId("section-field")).toHaveCount(0);
}

// Ctrl+S is QuizForm.vue's own save shortcut. The badge reads "Saved" only
// once nothing is left unsaved, so this also holds if an autosave got there
// first.
async function saveQuiz(page: Page) {
	await page.keyboard.press("Control+s");
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

type Seen = { heading: string | null; text: string };

// Walks one attempt from the first question to the result, answering every
// question (the first option) so the attempt is a real submission and leaving
// the page never fires the unload beacon. Needs a quiz with show_answers off,
// where Next moves on without a Check.
async function takeAttempt(page: Page, total: number): Promise<Seen[]> {
	const seen: Seen[] = [];
	for (let position = 1; position <= total; position++) {
		await expect(
			page.getByText(`Question ${position} of ${total}`, { exact: true })
		).toBeVisible();

		const headings = page.getByTestId("quiz-section-heading");
		const heading = (await headings.count())
			? ((await headings.first().textContent()) ?? "").trim()
			: null;
		const current = page.getByText(`(${runToken})`);
		await expect(current).toBeVisible();
		seen.push({ heading, text: ((await current.textContent()) ?? "").trim() });

		await page.getByRole("radio").first().click();
		if (position < total) {
			await page.getByRole("button", { name: "Next", exact: true }).click();
		}
	}

	// Without live answers the Submit button asks to confirm first.
	await page.getByRole("button", { name: "Submit", exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Submit", exact: true })
		.click();
	await expect(page.getByTestId("quiz-verdict")).toBeVisible({
		timeout: 15000,
	});
	return seen;
}

test.describe("Quiz sections", () => {
	// Each test starts from the sections the one before saved, and the quiz
	// name lives only in the worker whose beforeAll made it. Serial retries the
	// chain from a fresh quiz instead of one test against a stale one.
	test.describe.configure({ mode: "serial" });

	// Playwright insists the first argument destructures its fixtures, even none.
	// eslint-disable-next-line no-empty-pattern
	test.beforeAll(async ({}, testInfo) => {
		testInfo.setTimeout(60000);
		api = await adminApi();
		for (const n of [1, 2, 3]) {
			const question = await insertDoc(api, choiceQuestion(questionText(n)));
			questionNames.push(question.name);
		}
		// show_answers off: the player then moves on with Next and no Check.
		quizName = (
			await createQuiz(api, {
				title: quizTitle,
				rows: questionNames.map((question) => ({ question, marks: 1 })),
				show_answers: 0,
			})
		).name;
	});

	// Submissions first: LMS Quiz refuses to go while one links to it, and the
	// question bank outlives its quiz.
	test.afterAll(async () => {
		await deleteLeftovers([
			{ doctype: "LMS Quiz Submission", filters: { quiz: quizName } },
			{ doctype: "LMS Quiz", name: quizName },
			...questionNames.map((name) => ({ doctype: "LMS Question", name })),
		]);
		await api?.request.dispose();
	});

	test("assigns Part A and Part B and shows a heading band per section", async ({
		page,
	}) => {
		test.setTimeout(90000);
		await page.goto(`/lms/quizzes/edit/${quizName}`);
		await expect(
			page.getByRole("button", { name: "Edit question 3", exact: true })
		).toBeVisible();
		await expect(page.getByTestId("section-heading")).toHaveCount(0);

		await setSection(page, 1, "Part A");
		await expect(page.getByTestId("section-heading")).toHaveText(["Part A"]);

		// The second question of a section adds no band of its own.
		await setSection(page, 2, "Part A");
		await expect(page.getByTestId("section-heading")).toHaveText(["Part A"]);

		await setSection(page, 3, "Part B");
		await expect(page.getByTestId("section-heading")).toHaveText([
			"Part A",
			"Part B",
		]);
		await expect(page.getByTestId("section-error")).toHaveCount(0);

		await saveQuiz(page);
		expect(await quizGroups()).toEqual(["Part A", "Part A", "Part B"]);

		// A reload shows the bands again, straight from what was stored.
		await page.reload();
		await expect(page.getByTestId("section-heading")).toHaveText([
			"Part A",
			"Part B",
		]);
	});

	test("refuses a section that is split, and saves once it is fixed", async ({
		page,
	}) => {
		test.setTimeout(120000);
		await page.goto(`/lms/quizzes/edit/${quizName}`);
		await expect(
			page.getByRole("button", { name: "Edit question 3", exact: true })
		).toBeVisible();

		const writes: string[] = [];
		page.on("request", (request) => {
			if (
				request.method() === "POST" &&
				/frappe\.client\.(set_value|save)/.test(request.url())
			) {
				writes.push(request.url());
			}
		});

		// A, A, B becomes A, B, A: Part A is now split around Part B.
		await setSection(page, 2, "Part B");
		await expect(page.getByTestId("section-error")).toHaveCount(0);
		await setSection(page, 3, "Part A");
		await expect(page.getByTestId("section-error")).toContainText(
			"Questions in section Part A must stay together"
		);
		await expect(page.getByText("Not saved", { exact: true })).toBeVisible();

		// Save is blocked: no request goes out, and the split sections never
		// reach the server. (An autosave may have stored the valid state one edit
		// earlier, so the stored sections are only required not to be split.)
		writes.length = 0;
		await page.keyboard.press("Control+s");
		expect(writes).toEqual([]);
		await expect(page.getByTestId("section-error")).toBeVisible();
		expect(await quizGroups()).not.toEqual(["Part A", "Part B", "Part A"]);

		// Part B back into Part A: A, A, A is one section, so the alert goes.
		await setSection(page, 2, "Part A");
		await expect(page.getByTestId("section-error")).toHaveCount(0);
		await expect(page.getByTestId("section-heading")).toHaveText(["Part A"]);

		// And Part B back onto the last question: A, A, B.
		await setSection(page, 3, "Part B");
		await expect(page.getByTestId("section-heading")).toHaveText([
			"Part A",
			"Part B",
		]);
		await saveQuiz(page);
		expect(await quizGroups()).toEqual(["Part A", "Part A", "Part B"]);
	});

	test("the player shows each section title above its questions, in order", async ({
		page,
	}) => {
		await page.goto(`/lms/quiz/${quizName}`);
		const start = button(page, "Start Quiz");
		await expect(start).toBeEnabled();
		await start.click();

		const seen = await takeAttempt(page, 3);

		// Authored order, no shuffle: q1 and q2 under Part A, q3 under Part B.
		expect(seen.map((s) => s.heading)).toEqual(["Part A", "Part A", "Part B"]);
		expect(seen[0].text).toContain(questionText(1));
		expect(seen[1].text).toContain(questionText(2));
		expect(seen[2].text).toContain(questionText(3));
	});

	test("shuffled attempts keep every question inside its section", async ({
		page,
	}) => {
		test.setTimeout(240000);
		await setValues(api as Api, "LMS Quiz", quizName as string, {
			shuffle_questions: 1,
		});

		await page.goto(`/lms/quiz/${quizName}`);
		const orders: string[] = [];
		for (let attempt = 1; attempt <= 5; attempt++) {
			// The first attempt starts from the start screen; "Try again" resets
			// the quiz and reshuffles it (Quiz.vue resetQuiz -> populateQuestions).
			if (attempt > 1) await button(page, "Try again").click();
			const start = button(page, "Start Quiz");
			await expect(start).toBeEnabled();
			await start.click();

			const seen = await takeAttempt(page, 3);

			// The order of the sections never changes: Part A, Part A, Part B.
			expect(seen.map((s) => s.heading)).toEqual([
				"Part A",
				"Part A",
				"Part B",
			]);
			// Part A holds q1 and q2 in either order, Part B only q3.
			expect(seen[2].text).toContain(questionText(3));
			const partA = seen.slice(0, 2).map((s) => s.text);
			expect(partA.some((text) => text.includes(questionText(1)))).toBe(true);
			expect(partA.some((text) => text.includes(questionText(2)))).toBe(true);
			orders.push(partA.map((text) => text.slice(0, 22)).join(" | "));
		}
		// Only the order inside a section may differ between attempts; recorded
		// for the report, not asserted, since any one shuffle can repeat.
		test.info().annotations.push({
			type: "part A orders",
			description: orders.join("; "),
		});
	});
});
