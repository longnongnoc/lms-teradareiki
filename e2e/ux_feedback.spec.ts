import { request as playwrightRequest } from "@playwright/test";
import { test, expect } from "./fixtures";
import { baseURL } from "./config";
import { button, csrfToken, deleteLeftovers, waitForApiCall } from "./helpers";
import {
	adminApi,
	createLearnerUser,
	getDoc,
	insertDoc,
	labeledField,
	listDocs,
	learnerContext,
	makeLearner,
	setValues,
} from "./quizHelpers";
import type { Api, Learner } from "./quizHelpers";
import type { BrowserContext, Page } from "@playwright/test";

// Covers the learner-facing fixes of "fix(lms): rating, profile, highlight,
// table size and password feedback" and "fix(lesson): draw a saved highlight
// once instead of nesting it on reload".
//
// Ratings (the Rating control is 0-5, LMS Course Review stores a 0-1 fraction):
//   learner B rates 2 of 5 through the API before the tests start.
//   learner A adds 5 of 5 through the page: (2 + 5) / 2 = 3.5
//   learner A's review edited to 3 of 5:      (2 + 3) / 2 = 2.5
//   learner A's review deleted:               2 / 1       = 2

// Unique per run: leftovers from runs whose afterAll never ran share this DB.
const runToken = Date.now();
const courseTitle = `E2E UX Feedback Course ${runToken}`;

// Two lesson paragraphs, the second with an inline tag, so one selection can
// cross a block boundary and end inside <b>.
const lessonContent = JSON.stringify({
	time: runToken,
	blocks: [
		{ type: "paragraph", data: { text: "Alpha beta gamma." } },
		{ type: "paragraph", data: { text: "Delta <b>epsilon</b> zeta." } },
	],
	version: "2.29.0",
});

let api: Api | undefined;
let learnerA: Learner | undefined;
let learnerB: Learner | undefined;
let usernameA: string | undefined;
let ctxA: BrowserContext | undefined;
let course: string | undefined;
let reviewA: string | undefined;

async function withLearnerPage(fn: (page: Page) => Promise<void>) {
	const page = await (ctxA as BrowserContext).newPage();
	try {
		await fn(page);
	} finally {
		await page.close();
	}
}

// Learner B's review has to be owned by learner B (LMS Course Review keys
// "already reviewed" and the enrolment check off the owner), so it goes in
// through B's own session, not the admin's.
async function insertAsLearner(
	learner: Learner,
	doc: Record<string, unknown>
): Promise<{ name: string }> {
	const request = await playwrightRequest.newContext({ baseURL });
	try {
		const login = await request.post("/api/method/login", {
			form: { usr: learner.email, pwd: learner.password },
		});
		if (!login.ok()) throw new Error(`Login as ${learner.email} failed`);
		const response = await request.post("/api/method/frappe.client.insert", {
			headers: { "X-Frappe-CSRF-Token": await csrfToken(request) },
			form: { doc: JSON.stringify(doc) },
		});
		if (!response.ok()) {
			throw new Error(
				`insert ${String(doc.doctype)} as ${learner.email} failed: ${(
					await response.text()
				).slice(0, 600)}`
			);
		}
		return ((await response.json()) as { message: { name: string } }).message;
	} finally {
		await request.dispose();
	}
}

async function storedCourseRating() {
	const doc = await getDoc<{ rating: number }>(
		api as Api,
		"LMS Course",
		course as string
	);
	return Number(doc.rating);
}

// The big number beside "course rating & N user ratings" (CourseReviews.vue).
const reviewSummary = (page: Page) => page.getByText(/course rating/);
const averageShown = (page: Page) =>
	reviewSummary(page).locator("xpath=preceding-sibling::span[1]");

const highlights = (page: Page) => page.locator("#editor .highlighted-text");

// Highlights are drawn, and redrawn when the notes list reloads, on a 500 ms
// timer (Lesson.vue's notes onSuccess). A redraw that correctly does nothing
// leaves nothing to wait on, so the check gives that timer room to fire first.
async function expectHighlightDrawnOnce(page: Page) {
	await expect(highlights(page)).toHaveCount(3);
	await page.waitForTimeout(1500);
	await expect(highlights(page)).toHaveCount(3);
	await expect(
		page.locator("#editor .highlighted-text .highlighted-text")
	).toHaveCount(0);
	// The slice inside the inline tag is highlighted too.
	await expect(page.locator("#editor b .highlighted-text")).toHaveCount(1);
	const text = await highlights(page).allTextContents();
	expect(text.join("").replace(/\s+/g, "")).toBe("betagamma.Deltaeps");
	const names = await highlights(page).evaluateAll((els) =>
		els.map((el) => (el as HTMLElement).dataset.name)
	);
	expect(new Set(names).size).toBe(1);
}

test.describe("UX feedback fixes", () => {
	// Each test builds on what the one before left (the reviews, the renamed
	// learner), and the names live only in the worker whose beforeAll made them.
	test.describe.configure({ mode: "serial" });

	// Two throwaway learners (LMS Student, random password, deleted in
	// afterAll), both enrolled in one course with a single lesson. Learner A
	// carries LinkedIn/GitHub/Twitter values so the profile page has something
	// it must no longer show.
	test.beforeAll(async ({ browser }, testInfo) => {
		testInfo.setTimeout(120000);
		api = await adminApi();

		learnerA = makeLearner(`ux${runToken}a`);
		learnerB = makeLearner(`ux${runToken}b`);
		await createLearnerUser(api, learnerA);
		await createLearnerUser(api, learnerB);
		await setValues(api, "User", learnerA.email, {
			linkedin: `e2e-linkedin-${runToken}`,
			github: `e2e-github-${runToken}`,
			twitter: `e2e_twitter_${runToken}`,
		});
		usernameA = (
			await getDoc<{ username: string }>(api, "User", learnerA.email)
		).username;

		course = (
			await insertDoc(api, {
				doctype: "LMS Course",
				title: courseTitle,
				short_introduction: "Holds the lesson of the UX feedback spec.",
				description: "<p>Created by the UX feedback e2e spec.</p>",
				instructors: [{ instructor: "frappe@example.com" }],
			})
		).name;
		// The outline APIs, not bare inserts: they also write the Chapter and
		// Lesson Reference rows the lesson route resolves 1-1 through.
		const chapter = (
			await api.request.post("/api/method/lms.lms.api.upsert_chapter", {
				headers: api.headers,
				form: {
					title: `E2E UX Chapter ${runToken}`,
					course,
					is_scorm_package: "0",
				},
			})
		).ok();
		expect(chapter).toBe(true);
		const chapterName = (
			await getDoc<{ chapters: { chapter: string }[] }>(
				api,
				"LMS Course",
				course
			)
		).chapters[0].chapter;
		const lessonResponse = await api.request.post(
			"/api/method/lms.lms.api.create_lesson",
			{
				headers: api.headers,
				form: { chapter: chapterName, title: `E2E UX Lesson ${runToken}` },
			}
		);
		expect(lessonResponse.ok()).toBe(true);
		const lesson = ((await lessonResponse.json()) as { message: string })
			.message;
		await setValues(api, "Course Lesson", lesson, { content: lessonContent });

		// Lessons first, enrolment last: a lesson saved under an enrolled course
		// queues a progress recalculation.
		for (const learner of [learnerA, learnerB]) {
			await insertDoc(api, {
				doctype: "LMS Enrollment",
				member: learner.email,
				course,
			});
		}
		await insertAsLearner(learnerB, {
			doctype: "LMS Course Review",
			course,
			review: "Seeded by the UX feedback spec.",
			rating: 0.4,
		});

		ctxA = await learnerContext(browser, learnerA);
	});

	// Notes link the lesson, so they go first; delete_course then takes the
	// reviews, enrolments, lesson, chapter and course in one call.
	test.afterAll(async () => {
		await ctxA?.close();
		await deleteLeftovers([
			{ doctype: "LMS Lesson Note", filters: { member: learnerA?.email } },
			{ method: "lms.lms.api.delete_course", args: { course } },
			{ doctype: "User", name: learnerA?.email },
			{ doctype: "User", name: learnerB?.email },
		]);
		await api?.request.dispose();
	});

	test("a new review counts in the course rating at once", async () => {
		await withLearnerPage(async (page) => {
			await page.goto(`/lms/courses/${course}`);
			await expect(reviewSummary(page)).toContainText("1 user rating");
			await expect(averageShown(page)).toHaveText("2");

			await button(page, "Write a Review").click();
			const dialog = page.getByRole("dialog");
			await dialog.getByRole("radio", { name: "5 of 5" }).click();
			await dialog.locator("textarea").fill(`Great course (${runToken})`);
			const saved = waitForApiCall(page, "frappe.client.insert");
			await dialog.getByRole("button", { name: "Submit" }).click();
			expect((await saved).ok()).toBe(true);

			// Averaged from the reviews on the page, no reload.
			await expect(reviewSummary(page)).toContainText("2 user ratings");
			await expect(averageShown(page)).toHaveText("3.5");
			await expect(button(page, "Write a Review")).toHaveCount(0);
		});
		// And written to the course on insert, not left to the hourly job.
		expect(await storedCourseRating()).toBe(3.5);
		const [review] = await listDocs<{ name: string }>(
			api as Api,
			"LMS Course Review",
			{ course, owner: (learnerA as Learner).email },
			["name"]
		);
		reviewA = review.name;
	});

	test("editing the review updates the course rating", async () => {
		// Known app bug: LMS Course Review.validate runs on every save, and
		// validate_if_already_reviewed finds the review being edited itself, so
		// any edit throws "You have already reviewed this course" and on_change
		// never gets to recompute. Expected to fail until that check excludes
		// self.name; once it does, this starts passing and the marker must go.
		test.fail();
		// The page has no edit control, so the edit goes through the API.
		await setValues(api as Api, "LMS Course Review", reviewA as string, {
			rating: 0.6,
		});
		expect(await storedCourseRating()).toBe(2.5);

		await withLearnerPage(async (page) => {
			await page.goto(`/lms/courses/${course}`);
			await expect(reviewSummary(page)).toContainText("2 user ratings");
			await expect(averageShown(page)).toHaveText("2.5");
		});
	});

	test("deleting the review updates the course rating", async () => {
		const { request, headers } = api as Api;
		const deleted = await request.post("/api/method/frappe.client.delete", {
			headers,
			form: { doctype: "LMS Course Review", name: reviewA as string },
		});
		expect(deleted.ok()).toBe(true);
		expect(await storedCourseRating()).toBe(2);

		await withLearnerPage(async (page) => {
			await page.goto(`/lms/courses/${course}`);
			await expect(reviewSummary(page)).toContainText("1 user rating");
			await expect(averageShown(page)).toHaveText("2");
		});
	});

	test("the profile shows no social links and its form no social fields", async () => {
		await withLearnerPage(async (page) => {
			await page.goto(`/lms/user/${usernameA}`);
			await expect(
				page.getByRole("heading", { name: learnerA?.fullName })
			).toBeVisible();
			await expect(
				page.locator(
					'a[href*="linkedin"], a[href*="github"], a[href*="twitter"]'
				)
			).toHaveCount(0);

			await page.goto(`/lms/user/${usernameA}/edit`);
			await expect(page.getByTestId("profile-fields")).toBeVisible();
			await expect(labeledField(page, "First Name")).toBeVisible();
			for (const label of ["LinkedIn ID", "GitHub ID", "Twitter ID"]) {
				await expect(page.getByText(label, { exact: true })).toHaveCount(0);
			}
		});
	});

	test("the insert-table picker offers up to 10 x 10", async () => {
		await withLearnerPage(async (page) => {
			// The Bio editor on the learner's own profile form has the full toolbar.
			await page.goto(`/lms/user/${usernameA}/edit`);
			await expect(page.getByTestId("profile-fields")).toBeVisible();
			await button(page, "Table").click();

			const grid = page.getByRole("grid", { name: /Table size/ });
			await expect(grid.getByRole("button")).toHaveCount(100);
			const largest = grid.getByRole("button", { name: "10 × 10" });
			await largest.hover();
			await expect(grid).toHaveAttribute(
				"aria-label",
				"Table size, 10 rows by 10 columns"
			);
			// Closed without inserting, so the form is left unchanged.
			await page.keyboard.press("Escape");
			await expect(grid).toBeHidden();
		});
	});

	test("saving a new name updates the sidebar without a reload", async () => {
		await withLearnerPage(async (page) => {
			await page.goto(`/lms/user/${usernameA}/edit`);
			const sidebar = page.locator('[data-slot="sidebar-header"]');
			// The sidebar title-cases the full name.
			await expect(sidebar).toContainText(`E2e ${learnerA?.lastName}`);

			await labeledField(page, "First Name").fill("Renamed");
			const saved = waitForApiCall(page, "frappe.client.set_value");
			await page.getByTestId("profile-save").click();
			expect((await saved).ok()).toBe(true);

			await expect(sidebar).toContainText(`Renamed ${learnerA?.lastName}`);
		});
	});

	test("a highlight across paragraphs and an inline tag is drawn once", async () => {
		test.setTimeout(60000);
		await withLearnerPage(async (page) => {
			const notesLoaded = page.waitForResponse(
				(res) =>
					res.url().includes("frappe.client.get_list") &&
					(res.request().postData() ?? "").includes("LMS Lesson Note")
			);
			await page.goto(`/lms/courses/${course}/learn/1-1`);
			await expect(page.locator("#editor .ce-paragraph")).toHaveCount(2);
			await notesLoaded;

			// A mouse drag lands on whatever pixel each word happens to sit at; a
			// Range from "beta" in the first paragraph to the middle of the bold
			// "epsilon" in the second is the same selection, every time. The
			// lesson listens on mouseup for it, which is dispatched by hand since
			// no real mouse was involved.
			await page.evaluate(() => {
				const [first, second] = Array.from(
					document.querySelectorAll("#editor .ce-paragraph")
				);
				const start = first.firstChild as Text;
				const end = second.querySelector("b")?.firstChild as Text;
				const range = document.createRange();
				range.setStart(start, start.data.indexOf("beta"));
				range.setEnd(end, 3);
				const selection = window.getSelection() as Selection;
				selection.removeAllRanges();
				selection.addRange(range);
			});
			await page.locator("#editor").dispatchEvent("mouseup");

			const inserted = waitForApiCall(page, "frappe.client.insert");
			const reloaded = page.waitForResponse(
				(res) =>
					res.url().includes("frappe.client.get_list") &&
					(res.request().postData() ?? "").includes("LMS Lesson Note")
			);
			await button(page, "Yellow").click();
			expect((await inserted).ok()).toBe(true);
			await reloaded;
			// Drawn on save, then the notes reload draws every note again.
			await expectHighlightDrawnOnce(page);

			await page.reload();
			await expectHighlightDrawnOnce(page);
		});
	});

	test("the user menu has a Change Password entry to /update-password", async () => {
		await withLearnerPage(async (page) => {
			// Frappe's own page; served empty here so nothing on it can be submitted.
			await page.route("**/update-password", (route) =>
				route.fulfill({ contentType: "text/html", body: "<html></html>" })
			);
			await page.goto("/lms/courses");
			await page.locator('[data-slot="sidebar-header"] button').click();
			await page.getByRole("menuitem", { name: "Change Password" }).click();
			await page.waitForURL(`${baseURL}/update-password`);
		});
		// The real page exists for a logged-in learner.
		const response = await (ctxA as BrowserContext).request.get(
			"/update-password"
		);
		expect(response.status()).toBe(200);
	});
});
