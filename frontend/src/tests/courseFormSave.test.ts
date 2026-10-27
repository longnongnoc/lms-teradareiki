import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

vi.stubGlobal('__', (text: string) => text)

// The course Settings tab saves through its Save button (or Ctrl+S) and when the
// tab is left, never on a timer. It used to save 1 s after each edit, so a
// browser page translation of the description was stored.

const { docResource, validation, section } = vi.hoisted(() => ({
	docResource: { current: null as any },
	validation: { error: null as string | null },
	section: { form: null as any },
}))

vi.mock('frappe-ui', async () => {
	const { reactive } = await import('vue')
	return {
		createResource: () => ({ submit: vi.fn() }),
		createDocumentResource: () => {
			const r: any = reactive({
				doc: {
					name: 'course-1',
					title: 'Course',
					short_introduction: 'Intro',
					description: '<p>Description</p>',
					instructors: [{ instructor: 'teacher@example.com' }],
					related_courses: [],
				},
				reload: vi.fn(),
				setValue: reactive({ loading: false }),
				lastHandlers: null,
			})
			r.setValue.submit = vi.fn((_params: any, handlers: any) => {
				r.lastHandlers = handlers
			})
			docResource.current = r
			return r
		},
		toast: { success: vi.fn(), error: vi.fn() },
	}
})

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/utils', () => ({ getMetaInfo: vi.fn(), updateMetaInfo: vi.fn() }))
vi.mock('@/utils/courseForm', () => ({
	validateCourse: () => validation.error,
}))
vi.mock('@/utils/resource', () => ({
	reportAutosaveError: vi.fn(),
	resourceErrorMessage: vi.fn(),
}))
vi.mock('@/utils/exportCourse', () => ({ exportCourseAsZip: vi.fn() }))
vi.mock('@/composables/useKeyboardShortcuts', () => ({
	useKeyboardShortcuts: () => {},
	saveShortcut: (fn: () => void) => ({ key: 's', handler: fn }),
}))

// The sections edit the course through the provided form context; the stub
// hands that context to the test.
vi.mock('@/components/Courses/CourseDetailsSection.vue', async () => {
	const { defineComponent, h, inject } = await import('vue')
	return {
		default: defineComponent({
			name: 'CourseDetailsSection',
			setup() {
				section.form = inject('courseForm')
				return () => h('div')
			},
		}),
	}
})
vi.mock('@/components/Courses/CourseOverviewSection.vue', () => ({
	default: { render: () => null },
}))
vi.mock('@/pages/Courses/CoursePublishSettings.vue', () => ({
	default: { render: () => null },
}))
vi.mock('@/components/SkeletonLoader.vue', () => ({
	default: { render: () => null },
}))

import CourseForm from '@/pages/Courses/CourseForm.vue'


function mountForm() {
	return mount(CourseForm, {
		props: {
			course: { data: { name: 'course-1' }, reload: vi.fn() } as any,
		},
		global: {
			provide: {
				$user: { data: { is_moderator: true, is_instructor: true } },
			},
			config: { globalProperties: { $dialog: vi.fn() } as any },
		},
	})
}

const form = (_wrapper: VueWrapper) => section.form
const isDirty = (wrapper: VueWrapper) => (wrapper.vm as any).isDirty
const submit = () => docResource.current.setValue.submit

async function edit(wrapper: VueWrapper, description: string) {
	docResource.current.doc.description = description
	form(wrapper).markDirty()
	await flushPromises()
}

async function idle(ms: number) {
	vi.advanceTimersByTime(ms)
	await flushPromises()
}

describe('course Settings tab: Save button, no autosave', () => {
	let wrapper: VueWrapper

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		validation.error = null
	})

	afterEach(() => {
		try {
			wrapper?.unmount()
		} catch {
			// already unmounted by the test
		}
		vi.useRealTimers()
	})

	it('marks an edit unsaved and does not save it within seconds', async () => {
		wrapper = mountForm()
		await edit(wrapper, '<p>Edited</p>')

		await idle(10_000)
		expect(isDirty(wrapper)).toBe(true)
		expect(submit()).not.toHaveBeenCalled()
	})

	it('never saves by itself, however long it stays unsaved', async () => {
		wrapper = mountForm()
		await edit(wrapper, '<p>One</p>')
		await idle(60 * 60 * 1000)

		expect(submit()).not.toHaveBeenCalled()
		expect(isDirty(wrapper)).toBe(true)
	})

	it('saves at once on Save and clears the badge', async () => {
		wrapper = mountForm()
		await edit(wrapper, '<p>Edited</p>')
		;(wrapper.vm as any).submitCourse()
		expect(submit()).toHaveBeenCalledTimes(1)

		docResource.current.lastHandlers.onSuccess()
		await flushPromises()
		expect(isDirty(wrapper)).toBe(false)
		await idle(60 * 60 * 1000)
		expect(submit()).toHaveBeenCalledTimes(1)
	})

	it('keeps an edit typed during the save unsaved and on screen', async () => {
		wrapper = mountForm()
		await edit(wrapper, '<p>Sent</p>')
		;(wrapper.vm as any).submitCourse()

		await edit(wrapper, '<p>Typed during the save</p>')
		docResource.current.lastHandlers.onSuccess()
		await flushPromises()

		expect(isDirty(wrapper)).toBe(true)
		// A reload would replace the new text with the server's copy.
		expect(docResource.current.reload).not.toHaveBeenCalled()
	})

	it('ignores an older save that succeeds after a newer one was sent', async () => {
		wrapper = mountForm()
		await edit(wrapper, '<p>One</p>')
		;(wrapper.vm as any).submitCourse()
		const older = docResource.current.lastHandlers
		await edit(wrapper, '<p>Two</p>')
		;(wrapper.vm as any).submitCourse()

		older.onSuccess()
		await flushPromises()
		expect(isDirty(wrapper)).toBe(true)
	})

	it('saves pending edits when the tab is left', async () => {
		wrapper = mountForm()
		await edit(wrapper, '<p>Edited</p>')
		wrapper.unmount()

		expect(submit()).toHaveBeenCalledTimes(1)
	})

	it('saves nothing when the tab is left clean', async () => {
		wrapper = mountForm()
		wrapper.unmount()

		expect(submit()).not.toHaveBeenCalled()
	})

	it('asks before closing the browser tab only while unsaved', async () => {
		wrapper = mountForm()
		const clean = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(clean)
		expect(clean.defaultPrevented).toBe(false)

		await edit(wrapper, '<p>Edited</p>')
		const dirty = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(dirty)
		expect(dirty.defaultPrevented).toBe(true)
	})
})
