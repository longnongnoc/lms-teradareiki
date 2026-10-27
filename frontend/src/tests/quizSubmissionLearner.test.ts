/**
 * QuizSubmission.vue opened by the learner who sat the quiz: the link to it is
 * sent to them, so the page has to stay, read-only, instead of sending them to
 * Courses. Reading anyone else's submission is refused by the server.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const held = vi.hoisted(() => ({
	doc: null as any,
	docOptions: null as any,
	answers: null as any,
	push: vi.fn(),
}))

vi.mock('frappe-ui', () => {
	const empty = { template: '<div><slot /></div>' }
	return {
		createDocumentResource: (options: any) => {
			held.docOptions = options
			return {
				get doc() {
					return held.doc
				},
				isDirty: false,
			}
		},
		createResource: (options: { url: string }) => {
			if (options.url.endsWith('get_submission_answers')) return held.answers
			return reactive({ data: null, loading: false, error: null, fetch() {} })
		},
		call: vi.fn(async () => null),
		usePageMeta: vi.fn(),
		toast: { error: vi.fn(), success: vi.fn() },
		FormControl: { template: '<input data-testid="marks-input" />' },
		Badge: empty,
		Avatar: empty,
		Popover: empty,
		LoadingIndicator: empty,
	}
})

vi.mock('vue-router', () => ({ useRouter: () => ({ push: held.push }) }))
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
	default: { template: '<button data-testid="save" />' },
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

const LEARNER = 'learner@example.com'

const mountPage = async (sessionUser: Record<string, unknown>) => {
	const { default: QuizSubmission } = await import(
		'@/pages/QuizSubmission.vue'
	)
	const wrapper = mount(QuizSubmission, {
		props: { submission: 'SUB-1' },
		global: {
			mocks: { __: (s: string) => s },
			provide: { $user: { data: sessionUser } },
			stubs: { 'router-link': true },
		},
	})
	await flushPromises()
	return wrapper
}

const choiceRow = {
	name: 'row-1',
	question_name: 'Q1',
	question_type: 'Choices',
	question: 'Pick one',
	answer: 'Wrong',
	marks: 0,
	marks_out_of: 2,
}

describe('QuizSubmission opened by the learner', () => {
	beforeEach(() => {
		held.push.mockClear()
		held.doc = {
			quiz_title: 'Quiz',
			member: LEARNER,
			member_name: 'Learner',
			result: [choiceRow],
		}
		held.answers = reactive({
			data: { questions: [{ ...choiceRow }] },
			loading: false,
			error: null,
			fetch() {},
		})
	})

	it('does not redirect a learner viewing their own submission', async () => {
		const wrapper = await mountPage({ name: LEARNER })
		expect(held.push).not.toHaveBeenCalled()
		expect(wrapper.text()).toContain('Pick one')
		wrapper.unmount()
	})

	it('shows no grading controls to the learner', async () => {
		const wrapper = await mountPage({ name: LEARNER })
		expect(wrapper.find('[data-testid="save"]').exists()).toBe(false)
		expect(wrapper.find('[data-testid="marks-input"]').exists()).toBe(false)
		wrapper.unmount()
	})

	it('shows no correct answer when the server sends none', async () => {
		const wrapper = await mountPage({ name: LEARNER })
		expect(wrapper.find('[data-testid="correct-answer"]').exists()).toBe(false)
		wrapper.unmount()
	})

	it('shows the correct answer the server sends', async () => {
		held.answers.data = {
			questions: [{ ...choiceRow, correct_answer: 'Right' }],
		}
		const wrapper = await mountPage({ name: LEARNER })
		expect(wrapper.get('[data-testid="correct-answer"]').text()).toContain(
			'Right'
		)
		wrapper.unmount()
	})

	it('hides the answers when the server sends no questions', async () => {
		held.answers.data = { questions: [] }
		const wrapper = await mountPage({ name: LEARNER })
		expect(wrapper.find('[data-testid="review-hidden"]').exists()).toBe(true)
		expect(wrapper.text()).not.toContain('Pick one')
		wrapper.unmount()
	})

	it('sends a learner away when the server refuses the submission', async () => {
		const wrapper = await mountPage({ name: 'someone-else@example.com' })
		held.docOptions.onError(new Error('PermissionError'))
		expect(held.push).toHaveBeenCalledWith({ name: 'Courses' })
		wrapper.unmount()
	})

	it('keeps the Save button for an instructor', async () => {
		const wrapper = await mountPage({
			name: 'teacher@example.com',
			is_instructor: 1,
		})
		expect(held.push).not.toHaveBeenCalled()
		expect(wrapper.find('[data-testid="save"]').exists()).toBe(true)
		wrapper.unmount()
	})
})
