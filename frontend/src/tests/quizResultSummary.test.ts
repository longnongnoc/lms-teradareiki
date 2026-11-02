import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.hoisted(() => vi.fn())

vi.mock('frappe-ui', () => ({
	call: callMock,
	Badge: {
		props: ['theme'],
		template: '<span class="badge" :data-theme="theme"><slot /></span>',
	},
}))

vi.stubGlobal('__', (value: string) => value)

// `String.format` is supplied by Frappe in the browser runtime.
String.prototype.format = function (this: string, ...args: unknown[]) {
	return this.replace(/\{(\d+)\}/g, (_m: string, i: number) => String(args[i]))
}

import QuizResultSummary from '@/components/Quiz/QuizResultSummary.vue'

const summary = (overrides: Record<string, unknown> = {}) => ({
	quiz: 'QUIZ-1',
	member: 'a@b.c',
	passing_percentage: 70,
	attempts_count: 2,
	counting_attempt: 'SUB-2',
	test_score: 8,
	test_out_of: 10,
	practical_score: 4,
	practical_max: 5,
	practical_note: null,
	practical_scored_by: 'i@b.c',
	practical_scored_on: '2026-10-19 10:00:00',
	total_score: 12,
	total_out_of: 15,
	percentage: 80,
	status: 'Pass',
	attempts: [
		{
			name: 'SUB-2',
			attempt_no: 2,
			score: 8,
			score_out_of: 10,
			percentage: 80,
			creation: '2026-10-19 09:00:00',
			is_counting: true,
		},
		{
			name: 'SUB-1',
			attempt_no: 1,
			score: 5,
			score_out_of: 10,
			percentage: 50,
			creation: '2026-10-18 09:00:00',
			is_counting: false,
		},
	],
	...overrides,
})

const mountSummary = async (
	props: Record<string, unknown> = { quiz: 'QUIZ-1' }
) => {
	const wrapper = mount(QuizResultSummary, {
		props: props as { quiz: string },
		global: { mocks: { __: (value: string) => value } },
	})
	await flushPromises()
	return wrapper
}

const text = (wrapper: ReturnType<typeof mount>, id: string) =>
	wrapper.find(`[data-testid="${id}"]`).text().replace(/\s+/g, ' ')

beforeEach(() => {
	callMock.mockReset()
})

describe('QuizResultSummary', () => {
	it('asks for the learner own summary, without a member', async () => {
		callMock.mockResolvedValue(summary())
		await mountSummary()

		expect(callMock).toHaveBeenCalledWith(
			'lms.lms.quiz_results.get_quiz_result_summary',
			{ quiz: 'QUIZ-1' }
		)
	})

	it('shows a pass with every figure and the counting attempt', async () => {
		callMock.mockResolvedValue(summary())
		const wrapper = await mountSummary()

		expect(text(wrapper, 'summary-test')).toBe('8 of 10 marks')
		expect(text(wrapper, 'summary-practical')).toBe('4 of 5 marks')
		expect(text(wrapper, 'summary-total')).toBe('12 of 15 marks (80%)')
		expect(text(wrapper, 'summary-pass-mark')).toBe('70%')
		const status = wrapper.find('[data-testid="summary-status"]')
		expect(status.text()).toBe('Pass')
		expect(status.attributes('data-theme')).toBe('green')

		const rows = wrapper.findAll('[data-testid="summary-attempts"] tbody tr')
		expect(rows).toHaveLength(2)
		expect(rows[0].text()).toContain('Counting')
		expect(rows[1].text()).not.toContain('Counting')
	})

	it('shows a fail in red', async () => {
		callMock.mockResolvedValue(
			summary({
				status: 'Fail',
				percentage: 40,
				total_score: 6,
				total_out_of: 15,
			})
		)
		const wrapper = await mountSummary()

		const status = wrapper.find('[data-testid="summary-status"]')
		expect(status.text()).toBe('Fail')
		expect(status.attributes('data-theme')).toBe('red')
		expect(text(wrapper, 'summary-total')).toBe('6 of 15 marks (40%)')
	})

	it('says it is waiting while the practical score is pending', async () => {
		callMock.mockResolvedValue(
			summary({
				status: 'Pending Practical',
				practical_score: null,
				total_score: null,
				total_out_of: null,
				percentage: null,
			})
		)
		const wrapper = await mountSummary()

		expect(text(wrapper, 'summary-practical')).toBe(
			'Waiting for practical score'
		)
		const status = wrapper.find('[data-testid="summary-status"]')
		expect(status.text()).toBe('Waiting for practical score')
		expect(status.attributes('data-theme')).toBe('amber')
		expect(wrapper.find('[data-testid="summary-total"]').exists()).toBe(false)
		expect(text(wrapper, 'summary-test')).toBe('8 of 10 marks')
	})

	it('hides the practical row when the quiz has no practical component', async () => {
		callMock.mockResolvedValue(
			summary({
				practical_max: 0,
				practical_score: null,
				total_score: 8,
				total_out_of: 10,
			})
		)
		const wrapper = await mountSummary()

		expect(wrapper.find('[data-testid="summary-practical"]').exists()).toBe(
			false
		)
		expect(text(wrapper, 'summary-total')).toBe('8 of 10 marks (80%)')
		expect(wrapper.find('[data-testid="summary-status"]').text()).toBe('Pass')
	})

	it('leaves out the history when the server sends no attempts', async () => {
		callMock.mockResolvedValue(summary({ attempts: [] }))
		const wrapper = await mountSummary()

		expect(wrapper.find('[data-testid="quiz-result-summary"]').exists()).toBe(
			true
		)
		expect(wrapper.find('[data-testid="summary-attempts"]').exists()).toBe(
			false
		)
	})

	it('renders nothing for a quiz not attempted', async () => {
		callMock.mockResolvedValue(
			summary({
				status: 'Not Attempted',
				attempts: [],
				attempts_count: 0,
				test_score: null,
			})
		)
		const wrapper = await mountSummary()

		expect(wrapper.find('[data-testid="quiz-result-summary"]').exists()).toBe(
			false
		)
	})

	it('renders nothing and does not throw when the call fails', async () => {
		callMock.mockRejectedValue({ messages: ['No permission'] })
		const wrapper = await mountSummary()

		expect(wrapper.find('[data-testid="quiz-result-summary"]').exists()).toBe(
			false
		)
		expect(wrapper.html()).not.toContain('No permission')
	})

	it('renders nothing for a malformed response', async () => {
		callMock.mockResolvedValue(undefined)
		const wrapper = await mountSummary()

		expect(wrapper.find('[data-testid="quiz-result-summary"]').exists()).toBe(
			false
		)
	})

	it('refetches when the refresh key changes after a new submission', async () => {
		callMock.mockResolvedValueOnce(summary({ attempts_count: 1 }))
		const wrapper = await mountSummary({ quiz: 'QUIZ-1', refreshKey: 'SUB-1' })
		expect(callMock).toHaveBeenCalledTimes(1)

		callMock.mockResolvedValueOnce(
			summary({ test_score: 9, percentage: 90, total_score: 13 })
		)
		await wrapper.setProps({ refreshKey: 'SUB-2' })
		await flushPromises()

		expect(callMock).toHaveBeenCalledTimes(2)
		expect(text(wrapper, 'summary-test')).toBe('9 of 10 marks')
	})

	it('keeps the newest response when an older one lands last', async () => {
		let releaseFirst: (value: unknown) => void = () => {}
		callMock.mockImplementationOnce(
			() => new Promise((resolve) => (releaseFirst = resolve))
		)
		const wrapper = mount(QuizResultSummary, {
			props: { quiz: 'QUIZ-1', refreshKey: 'A' },
			global: { mocks: { __: (value: string) => value } },
		})

		callMock.mockResolvedValueOnce(summary({ test_score: 9 }))
		await wrapper.setProps({ refreshKey: 'B' })
		await flushPromises()
		releaseFirst(summary({ test_score: 1 }))
		await flushPromises()

		expect(text(wrapper, 'summary-test')).toBe('9 of 10 marks')
	})
})
