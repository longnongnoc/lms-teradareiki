/**
 * QuizSubmission.vue, the grader's view of one attempt: how a Fill Blank answer
 * reads while its per-blank results load, fail to load or are withheld, and what
 * the mark dots say to a screen reader.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const held = vi.hoisted(() => ({
	doc: null as any,
	review: null as any,
}))

vi.mock('frappe-ui', () => {
	const empty = { template: '<div><slot /></div>' }
	return {
		createDocumentResource: () => ({
			get doc() {
				return held.doc
			},
			isDirty: false,
		}),
		createResource: (options: { url: string }) => {
			if (options.url.endsWith('get_fill_blank_review')) return held.review
			return reactive({ data: null, loading: false, error: null, fetch() {} })
		},
		call: vi.fn(async () => null),
		usePageMeta: vi.fn(),
		toast: { error: vi.fn(), success: vi.fn() },
		FormControl: empty,
		Badge: empty,
		Avatar: empty,
		Popover: empty,
		LoadingIndicator: { template: '<span data-testid="loading" />' },
	}
})

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/stores/session', () => ({
	sessionStore: () => ({ brand: { value: 'LMS' } }),
}))
vi.mock('@/composables/useKeyboardShortcuts', () => ({
	useKeyboardShortcuts: vi.fn(),
	saveShortcut: () => ({}),
}))
vi.mock('@/components/Layouts/pages/PageHeader.vue', () => ({
	default: { template: '<div><slot name="actions" /></div>' },
}))
vi.mock('@/components/Layouts/pages/PageBody.vue', () => ({
	default: { template: '<div><slot /></div>' },
}))
vi.mock('@/components/HeaderButton.vue', () => ({
	default: { template: '<button />' },
}))
vi.mock('@/components/ShortcutTooltip.vue', () => ({
	default: { template: '<div><slot /></div>' },
}))

window.matchMedia = ((query: string) => ({
	matches: false,
	media: query,
	onchange: null,
	addEventListener: () => {},
	removeEventListener: () => {},
	addListener: () => {},
	removeListener: () => {},
	dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

String.prototype.format = function (this: string, ...args: unknown[]): string {
	return this.replace(/{(\d+)}/g, (_match, index) => String(args[Number(index)]))
}

const row = (over: Record<string, unknown> = {}) => ({
	name: 'row-1',
	question_name: 'Q1',
	question_type: 'Fill Blank',
	question: '<p>The [[1]] and the [[2]]</p>',
	answer: '{"1":"圧縮機","2":""}',
	marks: 1,
	marks_out_of: 2,
	...over,
})

const mountPage = async () => {
	const { default: QuizSubmission } = await import(
		'@/pages/QuizSubmission.vue'
	)
	const wrapper = mount(QuizSubmission, {
		props: { submission: 'SUB-1' },
		attachTo: document.body,
		global: {
			mocks: { __: (s: string) => s },
			provide: { $user: { data: { is_instructor: 1 } } },
			stubs: { 'router-link': true },
		},
	})
	await flushPromises()
	return wrapper
}

const reviewResource = (over: Record<string, unknown> = {}) =>
	reactive({ data: null, loading: false, error: null, fetch() {}, ...over })

describe('QuizSubmission Fill Blank row', () => {
	beforeEach(() => {
		held.doc = { quiz_title: 'Quiz', member_name: 'Learner', result: [row()] }
		held.review = reviewResource()
	})

	it('shows what the learner typed, read-only, while the results load', async () => {
		const wrapper = await mountPage()
		const inputs = wrapper.findAll('input')
		expect(inputs).toHaveLength(2)
		expect(inputs.map((i) => (i.element as HTMLInputElement).value)).toEqual([
			'圧縮機',
			'',
		])
		expect(inputs.every((i) => i.attributes('disabled') !== undefined)).toBe(
			true
		)
		expect(wrapper.find('[data-testid="loading"]').exists()).toBe(true)
		wrapper.unmount()
	})

	it('keeps the typed answers beside the message when the results fail to load', async () => {
		held.review = reviewResource({ error: new Error('boom') })
		const wrapper = await mountPage()
		expect(wrapper.findAll('input')).toHaveLength(2)
		expect(wrapper.text()).toContain('Could not load the blank results.')
		expect(wrapper.find('[data-testid="loading"]').exists()).toBe(false)
		wrapper.unmount()
	})

	it('keeps the typed answers beside the message when the results are withheld', async () => {
		held.review = reviewResource({ data: {} })
		const wrapper = await mountPage()
		expect(wrapper.findAll('input')).toHaveLength(2)
		expect(wrapper.text()).toContain(
			'The blank results are not shown for this quiz.'
		)
		wrapper.unmount()
	})

	it('shows the marked blanks, not inputs, once the results are in', async () => {
		held.review = reviewResource({
			data: {
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
							marks_out_of: 1,
						},
					],
					marks: 1,
					marks_out_of: 2,
					is_correct: false,
				},
			},
		})
		const wrapper = await mountPage()
		expect(wrapper.findAll('input')).toHaveLength(0)
		expect(wrapper.findAll('[data-testid="blank-result"]')).toHaveLength(2)
		wrapper.unmount()
	})

	it('gives each mark dot a status a screen reader can read', async () => {
		held.doc = {
			quiz_title: 'Quiz',
			member_name: 'Learner',
			result: [
				row({ name: 'a', question_type: 'Choices', question: 'A', marks: 1, marks_out_of: 1 }),
				row({ name: 'b', question_type: 'Choices', question: 'B', marks: 1, marks_out_of: 2 }),
				row({ name: 'c', question_type: 'Choices', question: 'C', marks: 0, marks_out_of: 1 }),
			],
		}
		const wrapper = await mountPage()
		const dots = wrapper.findAll('span.rounded-full.size-1\\.5')
		expect(dots.map((d) => d.text())).toEqual([
			'Correct',
			'Partly correct',
			'Incorrect',
		])
		wrapper.unmount()
	})
})
