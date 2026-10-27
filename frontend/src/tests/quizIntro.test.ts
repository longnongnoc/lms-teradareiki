/** The intro screen of Quiz.vue: what a learner reads before Start. */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Quiz from '@/components/Quiz.vue'

const state = vi.hoisted(() => ({ response: null as any }))

vi.mock('frappe-ui', async () => {
	const { reactive } = await import('vue')

	const createResource = (options: any) => {
		const resource: any = reactive({
			data: null,
			loading: false,
			submit: vi.fn(),
			reset: vi.fn(),
			reload: vi.fn(async () => {
				if (options.url === 'lms.lms.utils.get_quiz_with_questions') {
					// As over the network: the component's `quiz` exists before this lands.
					await Promise.resolve()
					const raw = structuredClone(state.response)
					resource.data = options.transform?.(raw) ?? raw
					options.onSuccess?.(raw)
				}
				return resource.data
			}),
		})
		resource.fetch = resource.reload
		if (options.auto) void resource.reload()
		return resource
	}

	const empty = { template: '<div><slot /></div>' }

	return {
		createResource,
		call: vi.fn(),
		toast: { warning: vi.fn(), error: vi.fn() },
		Button: {
			emits: ['click'],
			template: `<button type="button" @click="$emit('click')"><slot /></button>`,
		},
		Badge: empty,
		Checkbox: empty,
		RadioGroup: empty,
		Radio: empty,
		Dialog: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
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

vi.mock('@/utils/format', () => ({
	timeAgo: (value: string) => value,
}))

String.prototype.format = function (...args: unknown[]) {
	return this.replace(/\{(\d+)\}/g, (_match: string, index: number) =>
		String(args[index])
	)
}

const quizResponse = (quiz: Record<string, unknown> = {}) => ({
	quiz: {
		name: 'QUIZ-1',
		title: 'Intro quiz',
		duration: 0,
		passing_percentage: 70,
		total_marks: 5,
		questions: [
			{ question: 'Q1', marks: 2 },
			{ question: 'Q2', marks: 3 },
		],
		...quiz,
	},
	questions_by_name: {
		Q1: { name: 'Q1', question: 'One', type: 'Choices', option_1: 'A' },
		Q2: { name: 'Q2', question: 'Two', type: 'Choices', option_1: 'B' },
	},
})

const mountQuiz = async () => {
	const wrapper = mount(Quiz, {
		props: { quizName: 'QUIZ-1' },
		global: {
			provide: { $user: { data: { name: 'learner@example.com' } } },
			mocks: { __: (value: string) => value },
		},
	})
	await flushPromises()
	return wrapper
}

const instructions = (wrapper: any) =>
	wrapper.find('[data-testid="quiz-instructions"]')

beforeEach(() => {
	localStorage.clear()
})

describe('Quiz intro: instructions', () => {
	it('shows the instructions as rich text before Start', async () => {
		state.response = quizResponse({
			instructions: '<p>Use a <strong>pencil</strong>.</p>',
		})
		const wrapper = await mountQuiz()

		expect(instructions(wrapper).exists()).toBe(true)
		expect(instructions(wrapper).find('strong').text()).toBe('pencil')
		expect(wrapper.text()).toContain('Start Quiz')
	})

	it('drops anything unsafe from the instructions', async () => {
		state.response = quizResponse({
			instructions: '<p>Hi</p><img src="x" onerror="alert(1)">',
		})
		const wrapper = await mountQuiz()

		expect(instructions(wrapper).html()).not.toContain('onerror')
	})

	it.each([undefined, null, '', '<p></p>', '<p> </p>'])(
		'shows no instructions box for %s',
		async (value) => {
			state.response = quizResponse({ instructions: value })
			const wrapper = await mountQuiz()

			expect(instructions(wrapper).exists()).toBe(false)
			expect(wrapper.text()).not.toContain('Instructions')
		}
	)
})

describe('Quiz intro: total marks', () => {
	it('shows what the quiz is scored out of beside the question count', async () => {
		state.response = quizResponse()
		const wrapper = await mountQuiz()

		expect(wrapper.find('[data-testid="quiz-total-marks"]').text()).toBe('5')
		expect(wrapper.text()).toContain('Questions2')
	})

	it('draws no marks cell for a quiz without a total', async () => {
		state.response = quizResponse({ total_marks: 0 })
		const wrapper = await mountQuiz()

		expect(wrapper.find('[data-testid="quiz-total-marks"]').exists()).toBe(
			false
		)
	})
})
