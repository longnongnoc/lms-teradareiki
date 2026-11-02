import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const toastError = vi.hoisted(() => vi.fn())

vi.mock('frappe-ui', () => ({
	Button: {
		props: ['label', 'icon'],
		emits: ['click'],
		template:
			'<button type="button" :aria-label="label" @click="$emit(\'click\')"><slot name="prefix" /><slot /></button>',
	},
	Checkbox: { template: '<input type="checkbox" />' },
	FormControl: {
		props: ['modelValue', 'ariaLabel'],
		emits: ['update:modelValue', 'blur'],
		template:
			'<div><input :aria-label="ariaLabel" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @blur="$emit(\'blur\')" /></div>',
	},
	FileUploader: {
		name: 'FileUploader',
		props: ['fileTypes', 'private', 'validateFile'],
		emits: ['success', 'failure'],
		methods: {
			async pick(file: { type: string; size: number }) {
				const error = await (this as any).validateFile?.(file)
				if (error) this.$emit('failure', error)
				else this.$emit('success', { file_url: '/private/files/new.png' })
			},
		},
		template:
			'<div data-testid="uploader" :data-private="String(private)" :data-types="fileTypes.join()"><slot :openFileSelector="() => {}" :uploading="false" /></div>',
	},
	toast: { error: toastError },
}))

vi.stubGlobal('__', (s: string) => s)
String.prototype.format = function (this: string, ...args: unknown[]): string {
	return args.reduce<string>(
		(out, arg, i) => out.replaceAll(`{${i}}`, String(arg)),
		this
	)
}

const mountAnswers = async (over: Record<string, unknown> = {}) => {
	const { default: QuestionAnswers } =
		await import('@/components/Quiz/QuestionAnswers.vue')
	const { blankOptionFields } = await import('@/utils/quizQuestion')
	const question = reactive<Record<string, any>>({
		...blankOptionFields(),
		option_1: 'one',
		option_2: '',
		option_2_image: '/private/files/b.png',
		is_correct_1: 1,
		...over,
	})
	const wrapper = mount(QuestionAnswers, {
		props: { uiType: 'single', question },
		global: { config: { globalProperties: { __: (s: string) => s } as any } },
	})
	await flushPromises()
	return { wrapper, question }
}

describe('QuestionAnswers image controls', () => {
	it('shows a labelled thumbnail and remove button only on an option with an image', async () => {
		const { wrapper } = await mountAnswers()
		const previews = wrapper.findAll('[data-testid="option-image-preview"]')
		expect(previews).toHaveLength(1)
		expect(previews[0].attributes('alt')).toBe('Option 2 image')
		expect(previews[0].attributes('src')).toBe('/private/files/b.png')
		expect(
			wrapper.findAll('[role="group"]').map((g) => g.attributes('aria-label'))
		).toEqual(['Option 1 image', 'Option 2 image'])
		expect(wrapper.findAll('[data-testid="option-image-remove"]')).toHaveLength(
			1
		)
		const uploads = wrapper.findAll('[data-testid="option-image-upload"]')
		expect(uploads.map((u) => u.attributes('aria-label'))).toEqual([
			'Upload image for option 1',
			'Replace image for option 2',
		])
		wrapper.unmount()
	})

	it('uploads public and offers only jpeg, png and webp', async () => {
		const { wrapper } = await mountAnswers()
		const uploader = wrapper.get('[data-testid="uploader"]')
		expect(uploader.attributes('data-private')).toBe('false')
		expect(uploader.attributes('data-types')).toBe(
			'image/jpeg,image/png,image/webp'
		)
		wrapper.unmount()
	})

	it('stores the uploaded url on the option', async () => {
		const { wrapper, question } = await mountAnswers()
		const first = wrapper.findAllComponents({ name: 'FileUploader' })[0]
		await (first.vm as any).pick({ type: 'image/png', size: 100 })
		expect(question.option_1_image).toBe('/private/files/new.png')
		wrapper.unmount()
	})

	it('rejects a wrong type or an oversized file with a message and no upload', async () => {
		toastError.mockClear()
		const { wrapper, question } = await mountAnswers()
		const first = wrapper.findAllComponents({ name: 'FileUploader' })[0]
		await (first.vm as any).pick({ type: 'image/gif', size: 100 })
		await (first.vm as any).pick({ type: 'image/png', size: 6 * 1024 * 1024 })
		expect(question.option_1_image).toBe('')
		expect(toastError.mock.calls.map((c) => c[0])).toEqual([
			'Only JPG, PNG or WebP images are allowed.',
			'The image must be 5 MB or smaller.',
		])
		wrapper.unmount()
	})

	it('clears the image to an empty string on remove', async () => {
		const { wrapper, question } = await mountAnswers()
		await wrapper.get('[data-testid="option-image-remove"]').trigger('click')
		expect(question.option_2_image).toBe('')
		wrapper.unmount()
	})

	it('moves an option image up with its row when an earlier option is removed', async () => {
		const { wrapper, question } = await mountAnswers({
			option_3: 'three',
			option_3_image: '/private/files/c.png',
		})
		const removes = wrapper
			.findAll('button')
			.filter((b) => b.attributes('aria-label')?.startsWith('Remove option'))
		expect(removes.length).toBeGreaterThan(0)
		await removes[0].trigger('click')
		expect(question.option_1).toBe('')
		expect(question.option_1_image).toBe('/private/files/b.png')
		expect(question.option_2).toBe('three')
		expect(question.option_2_image).toBe('/private/files/c.png')
		expect(question.option_3_image).toBe('')
		wrapper.unmount()
	})

	it('says why a reserved, duplicated or empty-but-correct option is wrong', async () => {
		const { wrapper } = await mountAnswers({
			option_1: '[image:1]',
			option_2: 'x',
			option_2_image: '',
			option_3: '',
			is_correct_3: 1,
			option_4: 'x',
		})
		const messages = wrapper
			.findAll('[data-testid="option-problem"]')
			.map((p) => p.text())
		expect(messages).toEqual([
			'This text is reserved for image options. Use other text.',
			'Add text or an image, or clear the correct mark',
			'Option 4 is the same as an earlier option',
		])
		wrapper.unmount()
	})
})
