import { randomBytes } from "node:crypto";
import { request as playwrightRequest } from "@playwright/test";
import type {
	APIRequestContext,
	Browser,
	BrowserContext,
	Page,
} from "@playwright/test";
import { authFile, baseURL } from "./config";
import { expect } from "./fixtures";
import { button, csrfToken } from "./helpers";

// Same default as global.setup.ts: the account the shared admin storage state
// belongs to.
export const testUser =
	process.env.PLAYWRIGHT_TEST_USER || "frappe@example.com";

export const SUBMIT_QUIZ_METHOD =
	"/api/method/lms.lms.doctype.lms_quiz.lms_quiz.submit_quiz";

// ---------------------------------------------------------------------------
// API access. Setup that is not the thing under test goes through the same
// whitelisted methods the SPA calls (frappe.client.insert, ...), under the
// admin session global.setup.ts saved.
// ---------------------------------------------------------------------------

export type Api = {
	request: APIRequestContext;
	headers: Record<string, string>;
};

export async function adminApi(): Promise<Api> {
	const request = await playwrightRequest.newContext({
		baseURL,
		storageState: authFile,
	});
	return {
		request,
		headers: { "X-Frappe-CSRF-Token": await csrfToken(request) },
	};
}

async function callMethod<T>(
	api: Api,
	method: string,
	form: Record<string, string>,
	what: string
): Promise<T> {
	const response = await api.request.post(`/api/method/${method}`, {
		headers: api.headers,
		form,
	});
	if (!response.ok()) {
		throw new Error(
			`${what} failed: ${response.status()} ${(await response.text()).slice(
				0,
				600
			)}`
		);
	}
	return ((await response.json()) as { message: T }).message;
}

export function insertDoc<T extends { name: string } = { name: string }>(
	api: Api,
	doc: Record<string, unknown>
): Promise<T> {
	return callMethod<T>(
		api,
		"frappe.client.insert",
		{ doc: JSON.stringify(doc) },
		`insert ${String(doc.doctype)}`
	);
}

export function setValues(
	api: Api,
	doctype: string,
	name: string,
	values: Record<string, unknown>
) {
	return callMethod<unknown>(
		api,
		"frappe.client.set_value",
		{ doctype, name, fieldname: JSON.stringify(values) },
		`set_value ${doctype} ${name}`
	);
}

export async function getDoc<T>(
	api: Api,
	doctype: string,
	name: string
): Promise<T> {
	const response = await api.request.get("/api/method/frappe.client.get", {
		params: { doctype, name },
	});
	if (!response.ok()) {
		throw new Error(`get ${doctype} ${name} failed: ${response.status()}`);
	}
	return ((await response.json()) as { message: T }).message;
}

export async function listDocs<T>(
	api: Api,
	doctype: string,
	filters: Record<string, unknown>,
	fields: string[]
): Promise<T[]> {
	const response = await api.request.get("/api/method/frappe.client.get_list", {
		params: {
			doctype,
			filters: JSON.stringify(filters),
			fields: JSON.stringify(fields),
			limit_page_length: "0",
		},
	});
	if (!response.ok()) {
		throw new Error(`list ${doctype} failed: ${response.status()}`);
	}
	return ((await response.json()) as { message: T[] }).message;
}

// ---------------------------------------------------------------------------
// Payloads, in the shape QuestionCard/useQuestionDoc and QuizForm send.
// ---------------------------------------------------------------------------

export function choiceQuestion(text: string, marks = 1) {
	return {
		doctype: "LMS Question",
		question: `<p>${text}</p>`,
		type: "Choices",
		multiple: 0,
		marks,
		option_1: "Wrong answer",
		option_2: "Right answer",
		is_correct_1: 0,
		is_correct_2: 1,
	};
}

export type BlankSpec = { blank_id: string; answers: string; marks?: number };

// `html` carries the [[n]] markers; the marks of the question are the sum of
// the blanks, which LMS Question.validate_fill_blanks recomputes anyway.
export function fillBlankQuestion(html: string, blanks: BlankSpec[]) {
	const rows = blanks.map((blank) => ({
		blank_id: blank.blank_id,
		answers: blank.answers,
		marks: blank.marks ?? 1,
	}));
	return {
		doctype: "LMS Question",
		question: html,
		type: "Fill Blank",
		multiple: 0,
		marks: rows.reduce((sum, row) => sum + row.marks, 0),
		blanks: rows,
	};
}

export type QuizRowSpec = {
	question: string;
	marks?: number;
	group?: string | null;
};

export function createQuiz(
	api: Api,
	spec: {
		title: string;
		rows: QuizRowSpec[];
		passing_percentage?: number;
	} & Record<string, unknown>
) {
	const { title, rows, passing_percentage = 60, ...extra } = spec;
	return insertDoc(api, {
		doctype: "LMS Quiz",
		title,
		passing_percentage,
		total_marks: rows.reduce((sum, row) => sum + (row.marks ?? 1), 0),
		questions: rows.map((row) => ({
			question: row.question,
			marks: row.marks ?? 1,
			group: row.group ?? null,
		})),
		...extra,
	});
}

// ---------------------------------------------------------------------------
// A throwaway learner. Never a real account: the password is random per run
// and lives only in this process. The User row is deleted by the spec's
// afterAll.
// ---------------------------------------------------------------------------

export type Learner = {
	email: string;
	password: string;
	lastName: string;
	fullName: string;
};

export function makeLearner(token: number | string): Learner {
	const lastName = `Learner${token}`;
	return {
		email: `e2e.learner.${token}@example.com`,
		// Random bytes for entropy, plus one of each character class in case the
		// site enforces a password policy.
		password: `${randomBytes(18).toString("base64url")}aZ9!`,
		lastName,
		fullName: `E2E ${lastName}`,
	};
}

// LMS Student is also added by User.before_insert; naming it here keeps the
// intent visible. A Website User, like every learner the LMS creates.
export function createLearnerUser(api: Api, learner: Learner) {
	return insertDoc(api, {
		doctype: "User",
		email: learner.email,
		first_name: "E2E",
		last_name: learner.lastName,
		enabled: 1,
		user_type: "Website User",
		send_welcome_email: 0,
		new_password: learner.password,
		roles: [{ role: "LMS Student" }],
	});
}

// Logs the learner in over the API (the approach global.setup.ts uses for the
// admin) and hands the session to a fresh browser context, so the learner and
// the admin never share cookies.
export async function learnerContext(
	browser: Browser,
	learner: Learner
): Promise<BrowserContext> {
	const request = await playwrightRequest.newContext({ baseURL });
	try {
		const response = await request.post("/api/method/login", {
			form: { usr: learner.email, pwd: learner.password },
		});
		if (!response.ok()) {
			throw new Error(
				`Login as ${learner.email} failed: ${response.status()} ${(
					await response.text()
				).slice(0, 300)}`
			);
		}
		await csrfToken(request);
		const state = await request.storageState();
		state.origins.push({
			origin: new URL(baseURL).origin,
			localStorage: [
				{
					name: `isOnboardingStepsCompletedlearning${learner.email}`,
					value: "true",
				},
			],
		});
		return await browser.newContext({ storageState: state, baseURL });
	} finally {
		await request.dispose();
	}
}

// ---------------------------------------------------------------------------
// UI helpers shared by the quiz specs.
// ---------------------------------------------------------------------------

// frappe-ui's FormControl doesn't reliably wire `for`/`id` to its <label>, so
// quiz.spec.ts and course_creation.spec.ts scope by the label's own text
// instead of trusting getByLabel: same pattern here.
export function labeledField(page: Page, label: string | RegExp) {
	return page
		.locator("label")
		.filter({ hasText: label })
		.locator("xpath=..")
		.locator("input, textarea");
}

// Opens the learner-facing start screen and starts the attempt.
export async function openQuiz(page: Page, quizName: string) {
	await page.goto(`/lms/quiz/${quizName}`);
	const start = button(page, "Start Quiz");
	await expect(start).toBeEnabled();
	await start.click();
}

// One text input per blank, aria-labelled "Blank N" (QuizQuestionBody.vue).
export async function fillBlanks(page: Page, answers: Record<string, string>) {
	for (const [id, value] of Object.entries(answers)) {
		await page.getByLabel(`Blank ${id}`, { exact: true }).fill(value);
	}
}

// The "X of Y marks" line under the Passed or Failed badge. The same phrase
// also heads each section of the fill-in-the-blanks review, so it is reached
// through the badge rather than by text.
export function resultMarks(page: Page) {
	return page.getByTestId("quiz-verdict").locator("xpath=following-sibling::p");
}
