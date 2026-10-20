import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const held = vi.hoisted(() => ({
	question: null as any,
	doc: null as any,
	saved: [] as any[],
}))

vi.mock('frappe-ui', () => ({
	Button: { template: '<button type="button"><slot /></button>' },
	Badge: { template: '<span><slot name="prefix" /><slot /></span>' },
	Dropdown: { template: '<div><slot /></div>' },
	toast: { error: vi.fn(), success: vi.fn() },
	createResource: (options: { url: string }) => ({
		submit: async (params: any) => {
			if (options.url === 'frappe.client.get') return held.doc
			if (options.url === 'frappe.client.set_value') held.saved.push(params)
			return {}
		},
	}),
}))

vi.mock('@/components/Quiz/QuestionEditor.vue', () => ({
	default: {
		props: ['question'],
		setup(props: { question: unknown }) {
			held.question = props.question
			return () => null
		},
		methods: { focus() {}, resetTouched() {} },
	},
}))

String.prototype.format = function (this: string, ...args: unknown[]): string {
	return args.reduce<string>(
		(out, arg, i) => out.replaceAll(`{${i}}`, String(arg)),
		this
	)
}

const storedDoc = () => ({
	name: 'QN-1',
	question: '<p>Which?</p>',
	type: 'Choices',
	multiple: 0,
	marks: 1,
	option_1: 'one',
	option_1_image: null,
	option_2: '',
	option_2_image: '/private/files/b.png',
	is_correct_2: 1,
})

const mountOpenCard = async () => {
	const { default: QuestionCard } =
		await import('@/components/Quiz/QuestionCard.vue')
	const wrapper = mount(QuestionCard, {
		props: {
			row: { name: 'r1', question: 'QN-1', marks: 1, type: 'Choices' },
			index: 0,
			quizName: 'QUIZ-1',
			editing: true,
		},
		global: { mocks: { __: (s: string) => s } },
	})
	await flushPromises()
	const dirty = () => wrapper.emitted('dirty-change')?.at(-1)?.[0] ?? false
	return { wrapper, dirty }
}

describe('QuestionCard with option images', () => {
	beforeEach(() => {
		held.doc = storedDoc()
		held.saved = []
		held.question = null
	})

	it('loads the stored image and treats a null image as empty', async () => {
		const { wrapper } = await mountOpenCard()
		expect(held.question.option_2_image).toBe('/private/files/b.png')
		expect(held.question.option_1_image).toBe('')
		wrapper.unmount()
	})

	it('is clean as loaded, dirty once an image is added, clean again when undone', async () => {
		const { wrapper, dirty } = await mountOpenCard()
		expect(dirty()).toBe(false)

		held.question.option_1_image = '/private/files/a.png'
		await flushPromises()
		expect(dirty()).toBe(true)

		held.question.option_1_image = ''
		await flushPromises()
		expect(dirty()).toBe(false)
		wrapper.unmount()
	})

	it('is dirty after removing the stored image', async () => {
		const { wrapper, dirty } = await mountOpenCard()
		held.question.option_2_image = ''
		await flushPromises()
		expect(dirty()).toBe(true)
		wrapper.unmount()
	})

	it('sends every image field on save, an empty string for a cleared one', async () => {
		const { wrapper } = await mountOpenCard()
		held.question.option_2_image = ''
		held.question.option_2 = 'two'
		held.question.option_1_image = '/private/files/a.png'
		await wrapper
			.findAll('button')
			.find((b) => b.attributes('label') === 'Save question')!
			.trigger('click')
		await flushPromises()

		const sent = held.saved[0].fieldname
		expect(sent.option_1_image).toBe('/private/files/a.png')
		expect(sent.option_2_image).toBe('')
		expect(sent.option_3_image).toBe('')
		wrapper.unmount()
	})
})
