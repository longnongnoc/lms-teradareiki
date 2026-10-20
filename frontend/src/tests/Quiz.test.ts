import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Quiz from '@/components/Quiz.vue'

const resourceState = vi.hoisted(() => ({
	cache: new Map<string, any>(),
	request: vi.fn(),
	// Every resource submit, by url. `request` only records reads.
	submits: [] as string[],
	response: null as any,
	// Per-option verdict check_answer returns: 1 correct, 2 partial, 0 wrong.
	checkAnswer: [] as unknown[],
}))

vi.mock('frappe-ui', async () => {
	const { reactive } = await import('vue')

	const createResource = (options: any) => {
		const key = options.cache ? JSON.stringify(options.cache) : null
		const cached = key ? resourceState.cache.get(key) : null

		if (cached) {
			if (cached.auto) void cached.reload()
			return cached
		}

		let resource: any
		const reload = vi.fn(async () => {
			resource.loading = true
			const params = options.makeParams?.()
			resourceState.request(options.url, params)

			if (options.url === 'lms.lms.utils.get_quiz_with_questions') {
				// Match a real network response: let the remounted component finish setup before the cached resource's original callbacks run.
				await Promise.resolve()

				const raw = structuredClone(resourceState.response)
				const transformed = options.transform?.(raw)
				resource.data = transformed == null ? raw : transformed
				options.onSuccess?.(raw)
			}

			if (options.url === 'lms.lms.doctype.lms_quiz.lms_quiz.check_answer') {
				options.onSuccess?.(resourceState.checkAnswer)
			}

			resource.loading = false
			return resource.data
		})

		resource = reactive({
			auto: options.auto,
			data: null,
			loading: false,
			reload,
			fetch: reload,
			submit: vi.fn(() => {
				resourceState.submits.push(options.url)
			}),
			reset: vi.fn(() => {
				resource.data = null
			}),
		})

		if (key) resourceState.cache.set(key, resource)
		if (options.auto) void reload()
		return resource
	}

	const empty = { template: '<div><slot /></div>' }

	return {
		createResource,
		call: vi.fn(),
		toast: { warning: vi.fn(), error: vi.fn() },
		Button: {
			props: { disabled: { type: Boolean, default: false } },
			emits: ['click'],
			template: `<button type="button" :disabled="disabled" @click="$emit('click')"><slot /></button>`,
		},
		Badge: empty,
		// The option controls render their content through a `label` slot, so a
		// bare `<slot />` stub would drop every answer from the markup.
		Checkbox: {
			props: ['modelValue'],
			template: '<div><slot name="label" /><slot /></div>',
		},
		// `Radio` reaches its group through provide/inject and is meaningless
		// outside one, so the stubs keep that contract rather than flattening it.
		RadioGroup: {
			props: ['modelValue', 'name'],
			emits: ['update:modelValue'],
			provide(this: any) {
				return {
					pickRadio: (value: unknown) => this.$emit('update:modelValue', value),
				}
			},
			template: '<div><slot /></div>',
		},
		Radio: {
			props: ['value'],
			inject: ['pickRadio'],
			template:
				'<button type="button" class="radio-option" @click="pickRadio(value)"><slot name="label" /></button>',
		},
		Dialog: {
			props: ['open'],
			template: '<div v-if="open"><slot /></div>',
		},
		FormControl: empty,
		LoadingIndicator: empty,
		Progress: empty,
		Skeleton: empty,
	}
})

vi.mock('frappe-ui/experimental', () => ({
	ListView: { template: '<div><slot /></div>' },
}))

vi.mock('@/components/ProgressBar.vue', () => ({
	default: { template: '<div />' },
}))

vi.mock('@/utils/sanitizeRichHTML', () => ({
	sanitizeRichHTML: (value: string) => value,
}))

vi.mock('@/utils/format', () => ({
	timeAgo: (value: string) => value,
}))

vi.stubGlobal('__', (value: string) => value)

// `String.format` is supplied by Frappe in the browser runtime.
String.prototype.format = function (...args: unknown[]) {
	return this.replace(/\{(\d+)\}/g, (_match: string, index: number) =>
		String(args[index])
	)
}

const quizResponse = () => ({
	quiz: {
		name: 'QUIZ-1',
		title: 'Quiz cache regression',
		duration: 0,
		passing_percentage: 70,
		shuffle_questions: 0,
		show_answers: 0,
		show_submission_history: 0,
		questions: [
			{ question: 'Q1', marks: 1 },
			{ question: 'DELETED', marks: 1 },
		],
	},
	questions_by_name: {
		Q1: {
			name: 'Q1',
			question: 'Visible question body',
			type: 'Choices',
			multiple: 0,
			option_1: 'Correct answer',
			is_correct_1: 1,
		},
	},
})

let mountedQuizzes = 0

// A distinct idPrefix per mount, as mountBlock gives each lesson block.
const mountQuiz = (props: Record<string, unknown> = {}) =>
	mount(Quiz, {
		props: { quizName: 'QUIZ-1', ...props },
		global: {
			config: { idPrefix: `quiz-${++mountedQuizzes}` },
			provide: { $user: { data: { name: 'learner@example.com' } } },
			mocks: { __: (value: string) => value },
		},
	})

beforeEach(() => {
	resourceState.cache.clear()
	resourceState.request.mockReset()
	resourceState.submits.length = 0
	resourceState.response = quizResponse()
	resourceState.checkAnswer = []
	localStorage.clear()
})

// Guards an empty quiz, or one whose questions no longer resolve, offering Start
// beside "no questions" and opening on nothing. Came with Start moving below the
// rules, out of the branch that excluded it. Added on quiz-share-link.
describe('Quiz with no questions', () => {
	it('offers no Start button and cannot be started', async () => {
		const response = quizResponse()
		response.quiz.questions = [{ question: 'DELETED', marks: 1 }]
		resourceState.response = response
		const wrapper = mountQuiz()
		await flushPromises()

		expect(wrapper.text()).toContain(
			'This quiz has no questions available yet.'
		)
		expect(
			wrapper.findAll('button').some((b) => b.text() === 'Start Quiz')
		).toBe(false)
		;(wrapper.vm as any).startQuiz()
		expect((wrapper.vm as any).activeQuestion).toBe(0)
	})
})

describe('Quiz remount', () => {
	it('restores valid questions without extra requests after remounting the same quiz', async () => {
		const first = mountQuiz()
		await flushPromises()

		expect(first.text()).toContain('Questions1')
		expect(first.text()).toContain('Start')
		expect(first.text()).not.toContain(
			'This quiz has no questions available yet.'
		)
		expect(resourceState.request).toHaveBeenCalledTimes(1)
		first.unmount()

		const second = mountQuiz()
		await flushPromises()

		expect(resourceState.request).toHaveBeenCalledTimes(2)
		expect(resourceState.request.mock.calls).toEqual([
			['lms.lms.utils.get_quiz_with_questions', { quiz: 'QUIZ-1' }],
			['lms.lms.utils.get_quiz_with_questions', { quiz: 'QUIZ-1' }],
		])
		expect(second.text()).toContain('Questions1')
		expect(second.text()).toContain('Start')
		expect(second.text()).not.toContain(
			'This quiz has no questions available yet.'
		)

		const start = second
			.findAll('button')
			.find((button) => button.text() === 'Start Quiz')
		expect(start).toBeDefined()
		await start!.trigger('click')
		await flushPromises()

		expect(second.text()).toContain('Visible question body')
		expect(resourceState.request).toHaveBeenCalledTimes(2)
		second.unmount()
	})
})

const choicesQuizResponse = (count: number) => ({
	quiz: {
		name: 'QUIZ-1',
		title: 'Quiz pager states',
		duration: 0,
		passing_percentage: 70,
		shuffle_questions: 0,
		show_answers: 0,
		show_submission_history: 0,
		questions: Array.from({ length: count }, (_unused, index) => ({
			question: `Q${index + 1}`,
			marks: 1,
		})),
	},
	questions_by_name: Object.fromEntries(
		Array.from({ length: count }, (_unused, index) => [
			`Q${index + 1}`,
			{
				name: `Q${index + 1}`,
				question: `Question body ${index + 1}`,
				type: 'Choices',
				multiple: 0,
				option_1: `First option ${index + 1}`,
				is_correct_1: 1,
				option_2: `Second option ${index + 1}`,
			},
		])
	),
})

const startQuiz = async (wrapper: VueWrapper<any>) => {
	const start = wrapper
		.findAll('button')
		.find((button) => button.text() === 'Start Quiz')
	expect(start).toBeDefined()
	await start!.trigger('click')
	await flushPromises()
}
describe('Quiz in an author preview', () => {
	beforeEach(() => {
		resourceState.response = choicesQuizResponse(1)
	})

	// Guards the lesson-only "Preview only" badge leaking onto the quiz form.
	// Came with this branch's quiz assessment card restyle.
	// Added on feat/assessment-visual-redesign; the badge marks lesson embeds.
	it('shows no Preview only badge on the authoring preview', async () => {
		const wrapper = mountQuiz({ preview: true })
		await flushPromises()

		const header = wrapper.findComponent({ name: 'AssessmentCardHeader' })
		expect(header.exists()).toBe(true)
		expect(header.props('preview')).toBe(false)
		wrapper.unmount()
	})

	// The quiz form's Preview mounts this as it ships, and the button is not the
	// only way in: a timed quiz auto-submits and proctoring submits on a
	// violation. That submission is real.
	it('writes nothing when a submit is triggered anyway', async () => {
		vi.useFakeTimers()
		try {
			const wrapper = mountQuiz({ preview: true })
			await flushPromises()
			await startQuiz(wrapper)
			resourceState.submits.length = 0
			;(wrapper.vm as any).submitQuiz('timeout')
			await vi.advanceTimersByTimeAsync(1000)
			await flushPromises()

			expect(resourceState.submits).not.toContain(
				'lms.lms.doctype.lms_quiz.lms_quiz.submit_quiz'
			)
			wrapper.unmount()
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('Quiz choices', () => {
	// `Check` only renders when the quiz shows answers, and it is the only
	// caller of checkAnswer, so this is the one flow that reaches the verdict
	// markup at all.
	beforeEach(() => {
		const response = choicesQuizResponse(1)
		response.quiz.show_answers = 1
		resourceState.response = response
	})

	const pickFirstAndCheck = async (wrapper: VueWrapper<any>) => {
		await startQuiz(wrapper)
		await wrapper.findAll('input[type="radio"]')[0].trigger('change')
		const check = wrapper.findAll('button').find((b) => b.text() === 'Check')
		expect(check).toBeDefined()
		await check!.trigger('click')
		await flushPromises()
	}

	it('marks each option right or wrong once checked, keeping the labels', async () => {
		const wrapper = mountQuiz()
		await flushPromises()
		resourceState.checkAnswer = [1, 0]
		await pickFirstAndCheck(wrapper)

		expect(wrapper.text()).toContain('First option 1')
		expect(wrapper.text()).toContain('Second option 1')
		const firstOption = wrapper.findAll('label')[0]
		expect(firstOption.find('.lucide-check-circle').exists()).toBe(true)
		wrapper.unmount()
	})

	// Guards two quizzes asking the same question sharing one radio group.
	// Broke with this branch's quiz card restyle (radios named by question text).
	// Added on feat/assessment-visual-redesign when quizzes became lesson blocks.
	it('keeps two quizzes on one page in separate radio groups', async () => {
		const first = mountQuiz()
		const second = mountQuiz()
		await flushPromises()
		await startQuiz(first)
		await startQuiz(second)

		const nameOf = (wrapper: VueWrapper<any>) =>
			wrapper.find('input[type="radio"]').attributes('name')
		expect(nameOf(first)).not.toBe(nameOf(second))
		first.unmount()
		second.unmount()
	})
})

// Guards the quiz card's skeleton, header summary, option rows and verdict.
// Came with this branch's restyle of the quiz block as an assessment card.
// Added on feat/assessment-visual-redesign to pin the new card's states.
describe('Quiz card', () => {
	it('shows a skeleton card until the quiz lands', async () => {
		const wrapper = mountQuiz()
		expect(wrapper.find('[data-testid="quiz-skeleton"]').exists()).toBe(true)

		await flushPromises()
		expect(wrapper.find('[data-testid="quiz-skeleton"]').exists()).toBe(false)
		expect(wrapper.text()).toContain('Start Quiz')
	})

	// The stats repeat it before the start, so the header carries it only during
	// the attempt.
	it('summarises the quiz type, size and pass mark in the header once started', async () => {
		resourceState.response = choicesQuizResponse(2)
		const wrapper = mountQuiz()
		await flushPromises()
		const summary =
			'Multiple choice\u2002·\u20022 questions\u2002·\u2002pass at 70%'
		expect(wrapper.text()).not.toContain(summary)

		await startQuiz(wrapper)

		expect(wrapper.text()).toContain(summary)
	})

	it('renders one option row per option and a verdict after Check', async () => {
		const response = choicesQuizResponse(1)
		response.quiz.show_answers = 1
		resourceState.response = response
		resourceState.checkAnswer = [1, 0]
		const wrapper = mountQuiz()
		await flushPromises()
		await startQuiz(wrapper)

		expect(wrapper.text()).toContain('Question 1 of 1')
		const options = wrapper.findAll('input[type="radio"]')
		expect(options).toHaveLength(2)
		expect(wrapper.find('[data-testid="quiz-feedback"]').exists()).toBe(false)

		await options[0].trigger('change')
		const check = wrapper
			.findAll('button')
			.find((button) => button.text() === 'Check')
		await check!.trigger('click')
		await flushPromises()

		const feedback = wrapper.find('[data-testid="quiz-feedback"]')
		expect(feedback.exists()).toBe(true)
		expect(feedback.text()).toBe('Correct')
		const firstOption = wrapper.findAll('label')[0]
		expect(firstOption.find('.lucide-check-circle').exists()).toBe(true)
	})
})

describe('Quiz for screen readers', () => {
	// Guards: answers not named by the question, verdicts and steps told by icon
	// colour, feedback unannounced, unnamed progress, focus lost at the summary.
	// Introduced in #713, #1062, #2713 and #2823; test added with the a11y audit remediation.
	const result = {
		is_open_ended: 0,
		percentage: 100,
		score: 1,
		score_out_of: 1,
	}

	const start = async (count = 1, question = {}, quiz = {}) => {
		const response = choicesQuizResponse(count)
		Object.assign(response.quiz, quiz)
		Object.assign(response.questions_by_name.Q1, question)
		resourceState.response = response
		const wrapper = mount(Quiz, {
			props: { quizName: 'QUIZ-1' },
			attachTo: document.body,
			global: {
				provide: { $user: { data: { name: 'learner@example.com' } } },
				mocks: { __: (s: string) => globalThis.__(s) },
			},
		})
		await flushPromises()
		await startQuiz(wrapper)
		return wrapper
	}

	const pick = async (wrapper: VueWrapper<any>, button: string) => {
		await wrapper.findAll('input[type="radio"]')[0].trigger('change')
		await wrapper
			.findAll('button')
			.find((b) => b.text() === button)!
			.trigger('click')
		await flushPromises()
	}

	beforeEach(() => {
		document.body.innerHTML = ''
	})

	it.each([
		[{}, '[role="radiogroup"]'],
		[{ multiple: 1 }, '[role="group"]'],
		[{ type: 'User Input' }, '[aria-labelledby]'],
	])(
		'names the %o answer control by the question',
		async (question, selector) => {
			const wrapper = await start(1, question)
			const text = wrapper
				.findAll('div')
				.find((div) => div.element.innerHTML.trim() === 'Question body 1')!
			expect(text.attributes('id')).toBeTruthy()
			expect(wrapper.get(selector).attributes('aria-labelledby')).toBe(
				text.attributes('id')
			)
		}
	)

	it.each([
		{ verdicts: [1, 0], first: ['Your answer, correct'], second: [] },
		{
			verdicts: [0, 2],
			first: ['Your answer, incorrect'],
			second: ['Correct answer'],
		},
	])(
		'announces verdicts $verdicts in text',
		async ({ verdicts, first, second }) => {
			resourceState.checkAnswer = verdicts
			const wrapper = await start(1, {}, { show_answers: 1 })
			const status = wrapper.get('[role="status"]')
			expect(status.text()).toBe('')

			await pick(wrapper, 'Check')

			expect(wrapper.get('[role="status"]').element).toBe(status.element)
			expect(status.text()).not.toBe('')
			const srText = (i: number) =>
				wrapper
					.findAll('label')
					[i].findAll('.sr-only')
					.map((s) => s.text())
			expect([srText(0), srText(1)]).toEqual([first, second])
			const icons = wrapper.findAll(
				'label [class*="lucide-"][class*="-circle"]'
			)
			expect(icons.map((i) => i.attributes('aria-hidden'))).toContain('true')
			expect(icons.every((i) => i.attributes('aria-hidden') === 'true')).toBe(
				true
			)
		}
	)

	it('names each step with its answered state and exposes named progress', async () => {
		const wrapper = await start(2)
		const nav = () => wrapper.find('nav').findAll('button')
		expect(nav()[0].attributes('aria-label')).toBe('Question 1, not answered')
		expect(nav()[0].attributes('aria-current')).toBe('step')
		expect(wrapper.get('[role="progressbar"]').attributes()).toMatchObject({
			'aria-valuenow': '1',
			'aria-valuemax': '2',
			'aria-label': 'Quiz progress',
		})

		await pick(wrapper, 'Next')

		expect(nav()[0].attributes('aria-label')).toBe('Question 1, answered')
		expect(nav()[1].attributes('aria-current')).toBe('step')
		expect(nav()[0].find('svg').attributes('aria-hidden')).toBe('true')
	})

	it('moves focus to the summary heading after a submit, not on a result alone', async () => {
		const wrapper = await start(1, {}, { show_answers: 1 })
		const submission = (wrapper.vm as any).quizSubmission
		submission.data = result
		await flushPromises()
		expect(wrapper.text()).toContain('Quiz result')
		expect(document.activeElement?.tagName).not.toBe('H2')

		submission.submit.mockImplementation((_: unknown, callbacks: any) => {
			submission.data = { ...result }
			callbacks?.onSuccess?.()
		})
		;(wrapper.vm as any).submitQuiz()
		await flushPromises()
		expect(document.activeElement?.textContent?.trim()).toBe('Quiz result')
	})
})

describe('Quiz fill in the blanks', () => {
	const fillBlankResponse = (quiz: Record<string, unknown> = {}) => {
		const response = choicesQuizResponse(2)
		Object.assign(response.quiz, quiz)
		response.questions_by_name.Q1 = {
			name: 'Q1',
			type: 'Fill Blank',
			question:
				'<p>The {{1}} compresses.</p><table><tbody><tr><td>{{2}}</td></tr></tbody></table>',
			blanks: [
				{ blank_id: '1', marks: 1 },
				{ blank_id: '2', marks: 2 },
			],
		} as any
		return response
	}

	const nav = (wrapper: VueWrapper<any>) =>
		wrapper
			.find('nav')
			.findAll('button')
			.map((b) => b.attributes('aria-label'))

	const press = async (wrapper: VueWrapper<any>, label: string) => {
		await wrapper
			.findAll('button')
			.find((b) => b.text() === label)!
			.trigger('click')
		await flushPromises()
	}

	const savedAnswer = () =>
		JSON.parse(localStorage.getItem('Quiz pager states') ?? 'null')

	const begin = async (quiz: Record<string, unknown> = {}) => {
		resourceState.response = fillBlankResponse(quiz)
		const wrapper = mountQuiz()
		await flushPromises()
		await startQuiz(wrapper)
		return wrapper
	}

	it('renders an input per blank, named by its id, with no token text', async () => {
		const wrapper = await begin()
		const inputs = wrapper.findAll('input[type="text"]')
		expect(inputs.map((i) => i.attributes('aria-label'))).toEqual([
			'Blank 1',
			'Blank 2',
		])
		expect(wrapper.text()).not.toContain('{{')
		expect(wrapper.text()).toContain('Fill in each blank')
		expect(wrapper.find('td input').exists()).toBe(true)
		wrapper.unmount()
	})

	it('counts the question answered once any blank has text, and sends one JSON string', async () => {
		const wrapper = await begin()
		expect(nav(wrapper)[0]).toBe('Question 1, not answered')

		await wrapper.findAll('input[type="text"]')[0].setValue('圧縮機')
		await press(wrapper, 'Next')

		expect(nav(wrapper)[0]).toBe('Question 1, answered')
		expect(savedAnswer()).toEqual([
			{ question_name: 'Q1', answer: ['{"1":"圧縮機","2":""}'] },
		])
		wrapper.unmount()
	})

	it('keeps what was typed when the learner goes away and comes back', async () => {
		const wrapper = await begin()
		await wrapper.findAll('input[type="text"]')[1].setValue('ループ')
		await press(wrapper, 'Next')
		expect(wrapper.text()).toContain('Question 2 of 2')

		await press(wrapper, 'Previous')
		const inputs = wrapper.findAll('input[type="text"]')
		expect((inputs[0].element as HTMLInputElement).value).toBe('')
		expect((inputs[1].element as HTMLInputElement).value).toBe('ループ')
		wrapper.unmount()
	})

	it('does not count whitespace as an answer', async () => {
		const wrapper = await begin()
		await wrapper.findAll('input[type="text"]')[0].setValue('   ')
		await press(wrapper, 'Next')

		expect(nav(wrapper)[0]).toBe('Question 1, not answered')
		expect(savedAnswer()).toBeNull()
		wrapper.unmount()
	})

	it('forgets an earlier answer once every blank is cleared', async () => {
		const wrapper = await begin()
		const field = () => wrapper.findAll('input[type="text"]')[0]
		await field().setValue('圧縮機')
		await press(wrapper, 'Next')
		await press(wrapper, 'Previous')
		await field().setValue('')
		await press(wrapper, 'Next')

		expect(nav(wrapper)[0]).toBe('Question 1, not answered')
		expect(savedAnswer()).toEqual([])
		wrapper.unmount()
	})

	it('marks each blank after Check, with its marks and the question total', async () => {
		resourceState.checkAnswer = {
			results: [
				{
					blank_id: '1',
					answer: '圧縮機',
					is_correct: true,
					marks: 1,
					marks_out_of: 1,
					accepted: ['圧縮機'],
				},
				{
					blank_id: '2',
					answer: 'x',
					is_correct: false,
					marks: 0,
					marks_out_of: 2,
					accepted: ['凝縮器'],
				},
			],
			marks: 1,
			marks_out_of: 3,
			is_correct: false,
		} as any
		const wrapper = await begin({ show_answers: 1 })

		await press(wrapper, 'Check')
		expect(wrapper.find('[data-testid="blank-result"]').exists()).toBe(false)

		const inputs = wrapper.findAll('input[type="text"]')
		await inputs[0].setValue('圧縮機')
		await inputs[1].setValue('x')
		await press(wrapper, 'Check')

		const chips = wrapper.findAll('[data-testid="blank-result"]')
		expect(chips).toHaveLength(2)
		expect(chips[0].text()).toContain('1 of 1')
		expect(chips[1].text()).toContain('Accepted answers: 凝縮器')
		expect(wrapper.find('[data-testid="quiz-feedback"]').text()).toBe(
			'Incorrect, 1 of 3 marks'
		)
		expect(wrapper.findAll('input[type="text"]')).toHaveLength(0)
		wrapper.unmount()
	})

	it('lists the filled-in questions on the result once submitted, fetching the review', async () => {
		const wrapper = await begin()
		const resultResource = (wrapper.vm as any).quizSubmission
		resultResource.data = {
			submission: 'SUB-1',
			percentage: 50,
			score: 1,
			score_out_of: 3,
		}
		const review = (wrapper.vm as any).fillBlankReview
		review.data = {
			Q1: {
				results: [
					{
						blank_id: '1',
						answer: '圧縮機',
						is_correct: true,
						marks: 1,
						marks_out_of: 1,
					},
					{
						blank_id: '2',
						answer: '',
						is_correct: false,
						marks: 0,
						marks_out_of: 2,
					},
				],
				marks: 1,
				marks_out_of: 3,
				is_correct: false,
			},
		}
		await flushPromises()

		expect(resourceState.request).toHaveBeenCalledWith(
			'lms.lms.doctype.lms_quiz.lms_quiz.get_fill_blank_review',
			{ submission: 'SUB-1' }
		)
		const section = wrapper.get('[data-testid="fill-blank-review"]')
		expect(section.text()).toContain('1 of 3 marks')
		expect(section.findAll('[data-testid="blank-result"]')).toHaveLength(2)
		expect(section.text()).toContain('No answer')
		wrapper.unmount()
	})
})

describe('Quiz sections', () => {
	const sectionedResponse = (shuffle = 0) => {
		const response = choicesQuizResponse(4)
		response.quiz.shuffle_questions = shuffle
		const groups = ['Theory', 'Theory', null, 'Practice']
		response.quiz.questions.forEach((row: any, i: number) => {
			row.group = groups[i]
		})
		return response
	}
	const heading = (wrapper: VueWrapper<any>) =>
		wrapper.find('[data-testid="quiz-section-heading"]')

	it('prints the section title above a question that has one, and not above one that has none', async () => {
		resourceState.response = sectionedResponse()
		const wrapper = mountQuiz()
		await flushPromises()
		await startQuiz(wrapper)

		expect(heading(wrapper).text()).toBe('Theory')
		const nav = wrapper.find('nav').findAll('button')
		expect(nav[0].attributes('title')).toBe('Theory')
		expect(nav[2].attributes('title')).toBeUndefined()
		await wrapper
			.findAll('button')
			.find((b) => b.text() === 'Next')!
			.trigger('click')
		await wrapper
			.findAll('button')
			.find((b) => b.text() === 'Next')!
			.trigger('click')
		expect(heading(wrapper).exists()).toBe(false)
		wrapper.unmount()
	})

	it('shows no heading for a quiz without sections', async () => {
		resourceState.response = choicesQuizResponse(2)
		const wrapper = mountQuiz()
		await flushPromises()
		await startQuiz(wrapper)

		expect(heading(wrapper).exists()).toBe(false)
		wrapper.unmount()
	})

	it('shuffles inside a section and keeps the sections in authored order', async () => {
		const random = vi.spyOn(Math, 'random').mockReturnValue(0)
		resourceState.response = sectionedResponse(1)
		const wrapper = mountQuiz()
		await flushPromises()
		await startQuiz(wrapper)

		// Theory is Q1, Q2 and shuffles to Q2, Q1; Q3 and Q4 stay behind it.
		const body = () => wrapper.text()
		expect(body()).toContain('Question body 2')
		expect(heading(wrapper).text()).toBe('Theory')
		random.mockRestore()
		wrapper.unmount()
	})
})

// Guards an option that has only an image: it renders, can be chosen, and is
// sent and restored by its "[image:N]" key rather than by empty text.
describe('Quiz image options', () => {
	const imageResponse = (multiple: 0 | 1, show = 0) => {
		const response = choicesQuizResponse(2)
		response.quiz.show_answers = show
		response.questions_by_name.Q1 = {
			name: 'Q1',
			question: 'Pick by picture',
			type: 'Choices',
			multiple,
			option_1: '',
			option_1_image: '/files/a.png',
			is_correct_1: 1,
			option_2: '  Beta  ',
			option_3: '',
			option_3_image: '/files/c.png',
			option_4: '   ',
			is_correct_3: multiple ? 1 : 0,
		} as any
		return response
	}

	const savedAnswer = () =>
		JSON.parse(localStorage.getItem('Quiz pager states') ?? 'null')

	const press = async (wrapper: VueWrapper<any>, label: string) => {
		await wrapper
			.findAll('button')
			.find((b) => b.text() === label)!
			.trigger('click')
		await flushPromises()
	}

	const begin = async (multiple: 0 | 1, show = 0) => {
		resourceState.response = imageResponse(multiple, show)
		const wrapper = mountQuiz()
		await flushPromises()
		await startQuiz(wrapper)
		return wrapper
	}

	it('shows an image beside its text, skips a blank option and names images by slot', async () => {
		const wrapper = await begin(0)
		expect(wrapper.findAll('input[type="radio"]')).toHaveLength(3)
		const images = wrapper.findAll('[data-testid="option-image"] img')
		expect(images.map((img) => img.attributes('alt'))).toEqual([
			'Option 1',
			'Option 3',
		])
		expect(images[0].attributes('src')).toBe('/files/a.png')
		expect(images[0].classes()).toContain('max-h-40')
		expect(images[0].classes()).toContain('object-contain')
		wrapper.unmount()
	})

	it('sends the image key for a single choice and the trimmed text for a text one', async () => {
		const wrapper = await begin(0)
		const radios = wrapper.findAll('input[type="radio"]')
		await radios[0].trigger('change')
		await press(wrapper, 'Next')
		expect(savedAnswer()).toEqual([
			{ question_name: 'Q1', answer: ['[image:1]'] },
		])

		await press(wrapper, 'Previous')
		await wrapper.findAll('input[type="radio"]')[1].trigger('change')
		await press(wrapper, 'Next')
		expect(savedAnswer()[0].answer).toEqual(['Beta'])
		wrapper.unmount()
	})

	it('sends one key per chosen option for a multiple choice, in slot order', async () => {
		const wrapper = await begin(1)
		const boxes = wrapper.findAll('input[type="checkbox"]')
		await boxes[2].trigger('change')
		await boxes[0].trigger('change')
		await boxes[1].trigger('change')
		await press(wrapper, 'Next')
		expect(savedAnswer()[0].answer).toEqual(['[image:1]', 'Beta', '[image:3]'])
		wrapper.unmount()
	})

	it('counts an image-only choice as answered and restores it by key', async () => {
		const wrapper = await begin(1)
		const nav = () =>
			wrapper
				.find('nav')
				.findAll('button')
				.map((b) => b.attributes('aria-label'))
		expect(nav()[0]).toBe('Question 1, not answered')
		await wrapper.findAll('input[type="checkbox"]')[2].trigger('change')
		await press(wrapper, 'Next')
		expect(nav()[0]).toBe('Question 1, answered')

		await press(wrapper, 'Previous')
		const checked = wrapper
			.findAll('input[type="checkbox"]')
			.map((box) => (box.element as HTMLInputElement).checked)
		expect(checked).toEqual([false, false, true])
		wrapper.unmount()
	})

	it('restores an answer saved before keys existed, as the raw option text', async () => {
		const wrapper = await begin(0)
		await press(wrapper, 'Next')
		localStorage.setItem(
			'Quiz pager states',
			JSON.stringify([{ question_name: 'Q1', answer: ['  Beta  '] }])
		)
		await press(wrapper, 'Previous')
		const checked = wrapper
			.findAll('input[type="radio"]')
			.map((r) => (r.element as HTMLInputElement).checked)
		expect(checked).toEqual([false, true, false])
		wrapper.unmount()
	})

	it('marks image options from the per-slot verdict after Check', async () => {
		resourceState.checkAnswer = [2, 1, 0, 0, 0, 0, 0, 0, 0, 0]
		const wrapper = await begin(1, 1)
		await wrapper.findAll('input[type="checkbox"]')[1].trigger('change')
		await press(wrapper, 'Check')

		const rows = wrapper.findAll('label')
		expect(rows[0].find('.lucide-minus-circle').exists()).toBe(true)
		expect(rows[1].find('.lucide-check-circle').exists()).toBe(true)
		expect(rows[2].find('.lucide-x-circle').exists()).toBe(false)
		expect(savedAnswer()[0].answer).toEqual(['Beta'])
		wrapper.unmount()
	})

	it('opens the image in the zoom overlay without choosing the option', async () => {
		const wrapper = await begin(0)
		await wrapper.findAll('[data-testid="option-image"]')[0].trigger('click')
		const overlay = document.querySelector('[data-testid="image-zoom"]')
		expect(overlay).not.toBeNull()
		expect(overlay!.querySelector('img')!.getAttribute('src')).toBe(
			'/files/a.png'
		)
		expect(
			(wrapper.findAll('input[type="radio"]')[0].element as HTMLInputElement)
				.checked
		).toBe(false)
		wrapper.unmount()
	})
})
