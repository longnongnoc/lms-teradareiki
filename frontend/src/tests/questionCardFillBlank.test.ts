import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('frappe-ui', () => ({
	Button: { template: '<button type="button"><slot /></button>' },
	Badge: { template: '<span><slot name="prefix" /><slot /></span>' },
	Dropdown: { template: '<div><slot /></div>' },
	toast: { error: vi.fn(), success: vi.fn() },
	createResource: vi.fn(),
}))

vi.mock('@/components/Quiz/QuestionEditor.vue', () => ({
	default: { template: '<div />', methods: { focus() {}, resetTouched() {} } },
}))

String.prototype.format = function (this: string, ...args: unknown[]): string {
	return args.reduce<string>(
		(out, arg, i) => out.replaceAll(`{${i}}`, String(arg)),
		this
	)
}

const mountCard = async (
	row: Record<string, unknown>,
	extra: Record<string, unknown> = {}
) => {
	const { default: QuestionCard } = await import(
		'@/components/Quiz/QuestionCard.vue'
	)
	const wrapper = mount(QuestionCard, {
		props: { row, index: 0, quizName: 'QUIZ-1', ...extra },
		global: { mocks: { __: (s: string) => s } },
	})
	await flushPromises()
	return wrapper
}

describe('QuestionCard collapsed, fill in the blanks', () => {
	const row = {
		name: 'r1',
		question: 'Q1',
		marks: 3,
		type: 'Fill Blank',
		question_detail: '<p>The {{1}} compresses and the {{ 2 }} condenses</p>',
	}

	it('shows the type, the blank count and tokens as numbered chips', async () => {
		const wrapper = await mountCard(row)
		expect(wrapper.text()).toContain('Fill in the Blanks')
		expect(wrapper.get('[data-testid="blank-count"]').text()).toBe('2 blanks')
		expect(
			wrapper.findAll('[data-testid="blank-chip"]').map((c) => c.text())
		).toEqual(['[1]', '[2]'])
		expect(wrapper.text()).not.toContain('{{')
		expect(wrapper.text()).toContain('compresses')
		wrapper.unmount()
	})

	it('counts a single blank in the singular', async () => {
		const wrapper = await mountCard({ ...row, question_detail: '<p>{{1}}</p>' })
		expect(wrapper.get('[data-testid="blank-count"]').text()).toBe('1 blank')
		wrapper.unmount()
	})

	it('adds neither chips nor a count to another type', async () => {
		const wrapper = await mountCard({
			...row,
			type: 'User Input',
			question_detail: '<p>plain {{1}}</p>',
		})
		expect(wrapper.find('[data-testid="blank-chip"]').exists()).toBe(false)
		expect(wrapper.find('[data-testid="blank-count"]').exists()).toBe(false)
		expect(wrapper.text()).toContain('plain {{1}}')
		wrapper.unmount()
	})
})

describe('QuestionCard expanded, section field', () => {
	// The row has no question, so opening it loads nothing.
	const row = { name: 'r1', marks: 1, type: 'Choices', group: 'Theory' }
	const field = (wrapper: any) =>
		wrapper.get('[data-testid="section-field"] input')

	it('offers the existing sections as suggestions and shows the current one', async () => {
		const wrapper = await mountCard(row, {
			editing: true,
			sectionOptions: ['Theory', 'Practice'],
		})
		expect(field(wrapper).element.value).toBe('Theory')
		expect(field(wrapper).attributes('maxlength')).toBe('140')
		const list = wrapper.get('datalist')
		expect(field(wrapper).attributes('list')).toBe(list.attributes('id'))
		expect(
			list.findAll('option').map((o: any) => o.attributes('value'))
		).toEqual(['Theory', 'Practice'])
		wrapper.unmount()
	})

	it('emits the trimmed title on change, and an empty one to clear it', async () => {
		const wrapper = await mountCard(row, { editing: true })
		await field(wrapper).setValue('  Practice  ')
		expect(wrapper.emitted('section-change')?.at(-1)).toEqual(['Practice'])
		await field(wrapper).setValue('')
		expect(wrapper.emitted('section-change')?.at(-1)).toEqual([''])
		wrapper.unmount()
	})

	it('emits nothing when the title did not change', async () => {
		const wrapper = await mountCard(row, { editing: true })
		await field(wrapper).trigger('change')
		expect(wrapper.emitted('section-change')).toBeUndefined()
		wrapper.unmount()
	})

	it('has no field on a draft or a collapsed card', async () => {
		const draft = await mountCard(row, { draft: true })
		expect(draft.find('[data-testid="section-field"]').exists()).toBe(false)
		draft.unmount()
		const closed = await mountCard(row)
		expect(closed.find('[data-testid="section-field"]').exists()).toBe(false)
		closed.unmount()
	})
})
