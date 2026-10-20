import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const insertText = vi.hoisted(() => vi.fn())

vi.mock('frappe-ui', () => ({
	Button: {
		emits: ['click'],
		template:
			'<button type="button" @click="$emit(\'click\')"><slot /></button>',
	},
	Badge: { template: '<span><slot /></span>' },
	Dropdown: { template: '<div><slot /></div>' },
	FormLabel: { template: '<label />' },
	FileUploader: {
		template:
			'<div><slot :openFileSelector="() => {}" :uploading="false" /></div>',
	},
	Checkbox: { template: '<input type="checkbox" />' },
	toast: { error: vi.fn() },
	FormControl: {
		props: ['modelValue', 'type', 'label', 'ariaLabel'],
		emits: ['update:modelValue', 'blur'],
		template: `<div>
			<textarea v-if="type === 'textarea'" :aria-label="label" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" @blur="$emit('blur')" />
			<input v-else :aria-label="ariaLabel" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" @blur="$emit('blur')" />
			<slot name="suffix" />
		</div>`,
	},
}))

vi.mock('@/components/RichTextEditor.vue', () => ({
	default: {
		name: 'RichTextEditorStub',
		props: ['content'],
		emits: ['change', 'blur'],
		setup(_props: unknown, { expose }: { expose: (api: object) => void }) {
			expose({ insertText, focus: () => {} })
			return () => null
		},
	},
}))

vi.stubGlobal('__', (s: string) => s)
String.prototype.format = function (this: string, ...args: unknown[]): string {
	return args.reduce<string>(
		(out, arg, i) => out.replaceAll(`{${i}}`, String(arg)),
		this
	)
}

const mountEditor = async (
	question: Record<string, unknown>,
	props: Record<string, unknown> = {}
) => {
	const { default: QuestionEditor } = await import(
		'@/components/Quiz/QuestionEditor.vue'
	)
	const working = reactive(question)
	const wrapper = mount(QuestionEditor, {
		props: { question: working, uiType: 'fill_blank', idPrefix: 't', ...props },
		global: { config: { globalProperties: { __: (s: string) => s } as any } },
	})
	await flushPromises()
	return { wrapper, working }
}

const base = (over: Record<string, unknown> = {}) => ({
	question: '<p>The {{1}} and the {{2}}</p>',
	marks: 1,
	blanks: [],
	...over,
})

describe('QuestionEditor for fill in the blanks', () => {
	it('lists a row for every token in the body and keeps them in step as it changes', async () => {
		const { wrapper, working } = await mountEditor(base())
		const rows = () => wrapper.findAll('[data-testid="fill-blank-row"]')
		expect(rows()).toHaveLength(2)
		expect(working.blanks).toEqual([
			{ blank_id: '1', answers: '', marks: 1 },
			{ blank_id: '2', answers: '', marks: 1 },
		])

		await rows()[1].get('textarea').setValue('凝縮器\ncondenser')
		working.question = '<p>{{2}} only</p>'
		await flushPromises()
		expect(rows()).toHaveLength(1)
		expect(working.blanks).toEqual([
			{ blank_id: '2', answers: '凝縮器\ncondenser', marks: 1 },
		])

		working.question = '<p>{{2}} {{3}}</p>'
		await flushPromises()
		expect(rows()).toHaveLength(2)
		expect(
			(rows()[0].get('textarea').element as HTMLTextAreaElement).value
		).toBe('凝縮器\ncondenser')
		wrapper.unmount()
	})

	it('inserts the next unused token at the cursor', async () => {
		insertText.mockClear()
		const { wrapper } = await mountEditor(
			base({ question: '<p>{{1}} {{3}}</p>' })
		)
		const button = wrapper
			.findAll('button')
			.find((b) => b.text() === 'Insert blank')
		expect(button).toBeDefined()
		await button!.trigger('click')
		expect(insertText).toHaveBeenCalledWith('{{2}}')
		wrapper.unmount()
	})

	it('offers Insert blank for this type only', async () => {
		const { wrapper } = await mountEditor(base(), { uiType: 'single' })
		expect(wrapper.text()).not.toContain('Insert blank')
		expect(wrapper.find('[data-testid="fill-blank-panel"]').exists()).toBe(
			false
		)
		wrapper.unmount()
	})

	it('totals the blank marks, read-only, and writes them to the question', async () => {
		const { wrapper, working } = await mountEditor(
			base({
				blanks: [
					{ blank_id: '1', answers: 'a', marks: 2 },
					{ blank_id: '2', answers: 'b', marks: 3 },
				],
			})
		)
		expect(wrapper.get('[data-testid="fill-blank-marks"]').text()).toBe(
			'5 marks'
		)
		expect(wrapper.get('[data-testid="fill-blank-total"]').text()).toContain(
			'5 marks'
		)
		expect(working.marks).toBe(5)

		const marks = wrapper
			.findAll('[data-testid="fill-blank-row"]')[0]
			.get('input')
		await marks.setValue('4')
		expect(working.marks).toBe(7)
		expect(wrapper.get('[data-testid="fill-blank-marks"]').text()).toBe(
			'7 marks'
		)
		wrapper.unmount()
	})

	it('shows per-blank errors once errors are revealed', async () => {
		const { wrapper } = await mountEditor(base(), { revealErrors: true })
		const text = wrapper.text()
		expect(text).toContain('Add at least one accepted answer')
		wrapper.unmount()
	})

	it('keeps quiet until a field is left when errors are not revealed', async () => {
		const { wrapper } = await mountEditor(base())
		expect(wrapper.text()).not.toContain('Add at least one accepted answer')
		await wrapper
			.findAll('[data-testid="fill-blank-row"]')[0]
			.get('textarea')
			.trigger('blur')
		expect(wrapper.text()).toContain('Add at least one accepted answer')
		wrapper.unmount()
	})

	it('says so when the body has no blank yet', async () => {
		const { wrapper } = await mountEditor(base({ question: '<p>plain</p>' }), {
			revealErrors: true,
		})
		expect(wrapper.get('[data-testid="fill-blank-empty"]').text()).toContain(
			'Add at least one blank'
		)
		wrapper.unmount()
	})
})
