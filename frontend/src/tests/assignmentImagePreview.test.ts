// Guards the submitted image on a file assignment: graders (who cannot modify the
// learner's submission) see the file link and an image preview, while the learner
// keeps the remove button. PDF/Document submissions get the link only.
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'

const state = vi.hoisted(() => ({
	assignment: null as Record<string, unknown> | null,
	submission: null as Record<string, unknown> | null,
	docResource: null as { doc: Record<string, unknown> | null } | null,
}))

vi.mock('frappe-ui', () => {
	const passthrough = (tag: string) =>
		defineComponent({ setup: (_p, { slots }) => () => h(tag, slots.default?.()) })
	return {
		Alert: passthrough('div'),
		Badge: passthrough('span'),
		Button: defineComponent({
			setup: (_p, { slots, attrs }) => () => h('button', attrs, [slots.icon?.(), slots.default?.()]),
		}),
		FileUploader: defineComponent({
			setup: (_p, { slots }) => () =>
				h('div', slots.default?.({ uploading: false, progress: 0, openFileSelector: () => {} })),
		}),
		FormControl: defineComponent({ render: () => h('input') }),
		Skeleton: defineComponent({ render: () => h('div') }),
		Tooltip: passthrough('div'),
		KeyboardShortcut: passthrough('span'),
		call: vi.fn(),
		toast: { error: vi.fn(), success: vi.fn() },
		createResource: () => reactive({ data: state.assignment, loading: false, reload: vi.fn() }),
		createDocumentResource: () =>
			(state.docResource = reactive({ doc: null, reload: vi.fn(), setValue: { submit: vi.fn() } })),
	}
})
vi.mock('@/router', () => ({
	default: { push: vi.fn(), currentRoute: { value: { name: 'AssignmentSubmission', query: {} } } },
}))
vi.mock('@/components/RichTextEditor.vue', () => ({ default: defineComponent({ render: () => h('div') }) }))
vi.mock('@/utils', () => ({ validateFile: vi.fn() }))

import Assignment from '@/components/Assignment.vue'

const translate = (message: string) =>
	/{\d+}/.test(message)
		? { format: (...a: unknown[]) => message.replace(/{(\d+)}/g, (_m, i) => String(a[Number(i)])) }
		: message

const mountAs = async (user: Record<string, unknown>) => {
	const wrapper = mount(Assignment, {
		props: { assignmentID: 'ASG-1', submissionName: 'SUB-1', showTitle: false },
		global: { provide: { $user: { data: user } }, mocks: { __: translate } },
	})
	await flushPromises()
	state.docResource!.doc = state.submission // the submission arrives after mount, as from the server
	await flushPromises()
	return wrapper
}

beforeEach(() => {
	state.assignment = { title: 'Photo of crimped terminal', type: 'Image', question: '<p>Upload a photo.</p>' }
	state.submission = {
		name: 'SUB-1',
		owner: 'learner@example.com',
		status: 'Not Graded',
		assignment_attachment: '/private/files/crimp photo.png',
	}
})

describe('a submitted image on a file assignment', () => {
	it('shows the grader the file link and an image preview', async () => {
		const wrapper = await mountAs({ name: 'admin@example.com', is_moderator: true })

		expect(wrapper.get('[data-testid="assignment-attachment"]').text()).toContain('crimp photo.png')
		expect(wrapper.get('[data-testid="assignment-image-preview"]').attributes('src')).toBe(
			'/private/files/crimp photo.png'
		)
		expect(wrapper.find('[aria-label="Remove submission"]').exists()).toBe(false)
	})

	it('shows no preview for a PDF submission', async () => {
		state.assignment = { ...state.assignment, type: 'PDF' }
		const wrapper = await mountAs({ name: 'admin@example.com', is_moderator: true })

		expect(wrapper.find('[data-testid="assignment-attachment"]').exists()).toBe(true)
		expect(wrapper.find('[data-testid="assignment-image-preview"]').exists()).toBe(false)
	})

	it('keeps the remove button for the learner', async () => {
		const wrapper = await mountAs({ name: 'learner@example.com' })

		expect(wrapper.find('[data-testid="assignment-image-preview"]').exists()).toBe(true)
		expect(wrapper.find('[aria-label="Remove submission"]').exists()).toBe(true)
	})
})
