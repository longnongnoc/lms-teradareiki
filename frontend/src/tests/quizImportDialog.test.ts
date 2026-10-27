/** QuizImportDialog.vue: dry run first, write only on confirm. */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { call, toast } = vi.hoisted(() => ({
	call: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('frappe-ui', () => ({
	call,
	toast,
	Dialog: {
		props: ['open', 'title'],
		template: `<div v-if="open"><slot /><slot name="actions" :close="() => {}" /></div>`,
	},
	Button: {
		props: ['disabled', 'loading', 'variant'],
		emits: ['click'],
		template: `<button type="button" :disabled="disabled" @click="$emit('click')"><slot /></button>`,
	},
}))

import QuizImportDialog from '@/components/Quiz/QuizImportDialog.vue'

String.prototype.format = function (...args: unknown[]) {
	return this.replace(/\{(\d+)\}/g, (_match: string, index: number) =>
		String(args[index])
	)
}

const RESULT = {
	ok: true,
	errors: [],
	warnings: [],
	created: [{ title: 'Test A', quiz: null, questions: 4 }],
	updated: [],
	skipped: [{ title: 'Test B', quiz: 'test-b', reason: 'exists' }],
}

const mountDialog = () =>
	mount(QuizImportDialog, {
		props: { modelValue: true },
		global: { mocks: { __: (value: string) => value } },
	})

const pick = async (wrapper: any, content: string) => {
	const input = wrapper.find('[data-testid="quiz-import-file"]')
	const file = new File([content], 'tests.json', { type: 'application/json' })
	Object.defineProperty(input.element, 'files', { value: [file] })
	await input.trigger('change')
	await flushPromises()
}

const confirm = (wrapper: any) =>
	wrapper.find('[data-testid="quiz-import-confirm"]')

beforeEach(() => {
	call.mockReset()
	toast.success.mockReset()
	toast.error.mockReset()
})

describe('QuizImportDialog', () => {
	it('dry-runs the picked file and lists what would happen', async () => {
		call.mockResolvedValueOnce(RESULT)
		const wrapper = mountDialog()
		await pick(wrapper, '{"tests": []}')

		expect(call).toHaveBeenCalledWith('lms.lms.test_import.import_tests', {
			data: '{"tests": []}',
			dry_run: 1,
		})
		expect(wrapper.find('[data-testid="quiz-import-created"]').text()).toContain(
			'Test A'
		)
		expect(wrapper.find('[data-testid="quiz-import-skipped"]').text()).toContain(
			'Test B'
		)
		expect(confirm(wrapper).attributes('disabled')).toBeUndefined()
	})

	it('shows the errors of a bad file and cannot be confirmed', async () => {
		call.mockResolvedValueOnce({
			...RESULT,
			ok: false,
			errors: ['document: not valid JSON'],
			created: [],
			skipped: [],
		})
		const wrapper = mountDialog()
		await pick(wrapper, 'not json')

		expect(wrapper.find('[data-testid="quiz-import-errors"]').text()).toContain(
			'document: not valid JSON'
		)
		expect(confirm(wrapper).attributes('disabled')).toBeDefined()
		await confirm(wrapper).trigger('click')
		expect(call).toHaveBeenCalledTimes(1)
	})

	it('writes only once confirmed, then tells the list to reload', async () => {
		call.mockResolvedValueOnce(RESULT).mockResolvedValueOnce(RESULT)
		const wrapper = mountDialog()
		await pick(wrapper, '{"tests": []}')
		await confirm(wrapper).trigger('click')
		await flushPromises()

		expect(call).toHaveBeenLastCalledWith('lms.lms.test_import.import_tests', {
			data: '{"tests": []}',
			dry_run: 0,
		})
		expect(toast.success).toHaveBeenCalledWith('1 tests imported')
		expect(wrapper.emitted('imported')).toHaveLength(1)
		expect(confirm(wrapper).exists()).toBe(false)
	})
})
