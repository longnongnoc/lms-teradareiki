import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const insertText = vi.hoisted(() => vi.fn())
const focusEditor = vi.hoisted(() => vi.fn())

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
		inheritAttrs: false,
		props: ['modelValue', 'type', 'label', 'ariaLabel', 'placeholder'],
		emits: ['update:modelValue', 'blur'],
		template: `<div>
			<textarea v-if="type === 'textarea'" v-bind="$attrs" :aria-label="label" :placeholder="placeholder" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" @blur="$emit('blur')" />
			<input v-else v-bind="$attrs" :aria-label="ariaLabel" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" @blur="$emit('blur')" />
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
			expose({ insertText, focus: focusEditor })
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
	props: Record<string, unknown> = {},
	options: Record<string, unknown> = {}
) => {
	const { default: QuestionEditor } = await import(
		'@/components/Quiz/QuestionEditor.vue'
	)
	const working = reactive(question)
	const wrapper = mount(QuestionEditor, {
		props: { question: working, uiType: 'fill_blank', idPrefix: 't', ...props },
		global: { config: { globalProperties: { __: (s: string) => s } as any } },
		...options,
	})
	await flushPromises()
	return { wrapper, working }
}

const base = (over: Record<string, unknown> = {}) => ({
	question: '<p>The [[1]] and the [[2]]</p>',
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
		working.question = '<p>[[2]] only</p>'
		await flushPromises()
		expect(rows()).toHaveLength(1)
		expect(working.blanks).toEqual([
			{ blank_id: '2', answers: '凝縮器\ncondenser', marks: 1 },
		])

		working.question = '<p>[[2]] [[3]]</p>'
		await flushPromises()
		expect(rows()).toHaveLength(2)
		expect(
			(rows()[0].get('textarea').element as HTMLTextAreaElement).value
		).toBe('凝縮器\ncondenser')
		wrapper.unmount()
	})

	it('gives a row its answers and marks back when its marker returns', async () => {
		const { wrapper, working } = await mountEditor(
			base({ question: '<p>[[1]] [[2]]</p>' })
		)
		const rows = () => wrapper.findAll('[data-testid="fill-blank-row"]')
		await rows()[1].get('textarea').setValue('凝縮器')
		await rows()[1].get('input').setValue('4')

		working.question = '<p>[[1]]</p>'
		await flushPromises()
		expect(working.blanks).toHaveLength(1)

		working.question = '<p>[[1]] [[2]]</p>'
		await flushPromises()
		expect(working.blanks).toEqual([
			{ blank_id: '1', answers: '', marks: 1 },
			{ blank_id: '2', answers: '凝縮器', marks: '4' },
		])
		expect(working.marks).toBe(5)
		wrapper.unmount()
	})

	it('forgets removed rows once the question is freshly loaded or saved', async () => {
		const { wrapper, working } = await mountEditor(
			base({ question: '<p>[[1]] [[2]]</p>' })
		)
		await wrapper
			.findAll('[data-testid="fill-blank-row"]')[1]
			.get('textarea')
			.setValue('凝縮器')
		working.question = '<p>[[1]]</p>'
		await flushPromises()
		;(wrapper.vm as any).resetTouched()

		working.question = '<p>[[1]] [[2]]</p>'
		await flushPromises()
		expect(working.blanks[1]).toEqual({ blank_id: '2', answers: '', marks: 1 })
		wrapper.unmount()
	})

	it('warns, in amber, about a full-width marker that is not one', async () => {
		const { wrapper, working } = await mountEditor(base())
		expect(wrapper.find('[data-testid="blank-near-miss"]').exists()).toBe(false)

		working.question = '<p>The ［［１］］ and [[1]]</p>'
		await flushPromises()
		const warning = wrapper.get('[data-testid="blank-near-miss"]')
		expect(warning.text()).toContain('is not a blank marker. Use Insert blank.')
		expect(warning.classes()).toContain('text-ink-amber-8')
		wrapper.unmount()
	})

	it('names a marker used more than once as an error', async () => {
		const { wrapper } = await mountEditor(
			base({ question: '<p>[[1]] and [[1]] and [[2]]</p>' })
		)
		const errors = wrapper.findAll('[data-testid="blank-duplicate"]')
		expect(errors.map((e) => e.text())).toEqual([
			'Marker [[1]] appears more than once',
		])
		wrapper.unmount()
	})

	it('sends focus to the question field when the body is what is wrong', async () => {
		focusEditor.mockClear()
		const { wrapper } = await mountEditor(
			base({ question: '<p>[[1]] and [[1]]</p>' })
		)
		;(wrapper.vm as any).focusFirstInvalid()
		expect(focusEditor).toHaveBeenCalledTimes(1)
		wrapper.unmount()
	})

	it('sends focus to the first invalid control otherwise', async () => {
		focusEditor.mockClear()
		const { wrapper } = await mountEditor(
			base(),
			{ revealErrors: true },
			{ attachTo: document.body }
		)
		const first = wrapper
			.findAll('[data-testid="fill-blank-row"]')[0]
			.get('textarea')
		;(wrapper.vm as any).focusFirstInvalid()
		expect(focusEditor).not.toHaveBeenCalled()
		expect(document.activeElement).toBe(first.element)
		wrapper.unmount()
	})

	it('ties each answers field to its hint and, once invalid, to its error', async () => {
		const { wrapper } = await mountEditor(
			base({ question: '<p>[[1]]</p>' }),
			{ revealErrors: true },
			{ attachTo: document.body }
		)
		const field = wrapper.get('textarea')
		const ids = field.attributes('aria-describedby')!.split(' ')
		expect(ids).toHaveLength(2)
		const [hint, error] = ids.map((id) => document.getElementById(id))
		expect(hint?.textContent).toContain('okurigana')
		expect(error?.textContent).toContain('Add at least one accepted answer')

		await field.setValue('圧縮機')
		expect(field.attributes('aria-describedby')).toBe(ids[0])
		expect(field.attributes('placeholder')).toContain('Example: compressor')
		wrapper.unmount()
	})

	it('points the marks field at its error and hides the spin buttons like the question marks do', async () => {
		const { wrapper } = await mountEditor(
			base({ question: '<p>[[1]]</p>', blanks: [{ blank_id: '1', answers: 'a', marks: 0 }] }),
			{ revealErrors: true },
			{ attachTo: document.body }
		)
		const marks = wrapper.get('[data-testid="fill-blank-row"] input')
		const error = document.getElementById(marks.attributes('aria-describedby')!)
		expect(error?.textContent).toContain('Marks must be a whole number')
		expect(marks.element.closest('.marks-input')).not.toBeNull()
		wrapper.unmount()
	})

	it('explains the markers only once there is a blank to explain', async () => {
		const empty = await mountEditor(base({ question: '<p>plain</p>' }))
		expect(empty.wrapper.text()).not.toContain('becomes an answer box')
		empty.wrapper.unmount()

		const { wrapper } = await mountEditor(base())
		expect(wrapper.text()).toContain('becomes an answer box')
		wrapper.unmount()
	})

	it('inserts the next unused token at the cursor', async () => {
		insertText.mockClear()
		const { wrapper } = await mountEditor(
			base({ question: '<p>[[1]] [[3]]</p>' })
		)
		const button = wrapper
			.findAll('button')
			.find((b) => b.text() === 'Insert blank')
		expect(button).toBeDefined()
		await button!.trigger('click')
		expect(insertText).toHaveBeenCalledWith('[[2]]')
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
