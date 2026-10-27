<template>
	<div ref="formRef" class="py-6 sm:py-10">
		<div class="mx-0 space-y-6 px-4 sm:mx-10 sm:px-20">
			<button
				v-if="isMobile"
				type="button"
				class="inline-flex h-9 items-center gap-1.5 rounded-full border border-outline-gray-2 px-3.5 text-p-sm-medium text-ink-gray-7 hover:bg-surface-gray-2"
				@click="showLessonDetails = true"
			>
				<span class="lucide-pencil size-3.5" />
				{{ __('Lesson details') }}
			</button>

			<div v-else class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-3">
					<Switch
						v-model="lesson.include_in_preview"
						:aria-labelledby="previewLabelId"
						@update:modelValue="markFieldDirty"
					/>
					<div class="flex items-center gap-1.5">
						<span
							:id="previewLabelId"
							class="text-p-base font-medium text-ink-gray-8"
						>
							{{ __('Include in preview') }}
						</span>
						<Tooltip
							:text="
								__(
									'When on, anyone can preview this lesson without enrolling. Otherwise it is visible only to enrolled students.'
								)
							"
						>
							<span
								class="lucide-help-circle size-4 shrink-0 text-ink-gray-5"
							/>
						</Tooltip>
					</div>
				</div>
			</div>

			<BottomSheet v-model="showLessonDetails" :title="__('Lesson details')">
				<div class="px-3 pb-2">
					<div class="flex items-start justify-between gap-4 py-3">
						<div class="min-w-0">
							<div
								:id="previewSheetLabelId"
								class="text-p-base font-medium text-ink-gray-8"
							>
								{{ __('Include in preview') }}
							</div>
							<p class="mt-0.5 text-p-sm text-ink-gray-6">
								{{
									__(
										'When on, anyone can preview this lesson without enrolling. Otherwise it is visible only to enrolled students.'
									)
								}}
							</p>
						</div>
						<Switch
							v-model="lesson.include_in_preview"
							:aria-labelledby="previewSheetLabelId"
							class="shrink-0"
							@update:modelValue="markFieldDirty"
						/>
					</div>
				</div>
			</BottomSheet>

			<textarea
				ref="titleRef"
				v-model="lesson.title"
				:placeholder="__('Lesson title')"
				:aria-label="__('Lesson title')"
				rows="1"
				class="lesson-title block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-2xl font-bold leading-tight text-ink-gray-9 placeholder:text-ink-gray-4 focus:outline-none"
				:class="
					titleKeyboardFocus
						? 'focus:ring-2 focus:ring-outline-gray-5'
						: 'focus:ring-0'
				"
				@input="onTitleInput"
				@focus="titleKeyboardFocus = lastInputWasKeyboard"
				@keydown.enter="onTitleEnter"
				@blur="onTitleBlur"
			/>

			<details
				class="instructor-notes rounded-6 border border-outline-gray-2"
				@toggle="onInstructorNotesToggle"
			>
				<summary
					class="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-start"
				>
					<NotebookPen class="size-4 stroke-1.5 text-ink-gray-7" />
					<span class="text-p-base font-medium text-ink-gray-8">
						{{ __('Instructor notes') }}
					</span>
					<Badge
						variant="subtle"
						theme="gray"
						size="sm"
						:label="__('private')"
					/>
					<ChevronRight
						class="instructor-notes-chevron ms-auto size-4 text-ink-gray-5"
					/>
				</summary>
				<BlockEditor
					ref="instructorEditor"
					class="instructor-notes-editor border-t border-outline-gray-2 py-3"
					:uploadContext="instructorUploadContext"
					@change="markDirty"
					@input="markTyped"
				/>
			</details>

			<BlockEditor
				ref="editor"
				:uploadContext="contentUploadContext"
				@change="markDirty"
				@input="markTyped"
			/>
		</div>
	</div>
</template>
<script setup>
// The title textarea is `block` because a textarea is inline-block by default,
// so it would sit on the parent's line box and carry its descender — 5px of
// space under the title belonging to no rule and no gap.
import {
	Badge,
	Button,
	Switch,
	call,
	createResource,
	toast,
	Tooltip,
} from 'frappe-ui'
import {
	reactive,
	computed,
	onMounted,
	inject,
	ref,
	nextTick,
	onBeforeUnmount,
	useId,
	watch,
} from 'vue'
import { ChevronRight, NotebookPen } from 'lucide-vue-next'
import { useEventListener } from '@vueuse/core'
import { enablePlyr, sanitizeEditorJs } from '@/utils'
import {
	hasEditorContent,
	parseStoredEditorJs,
	shouldSkipLessonSave,
	toSingleLineTitle,
} from '@/utils/lessonForm'
import { convertBodyToBlocks as convertToJSON } from '@/utils/lessonMacros'
import { resourceErrorMessage, submitResource } from '@/utils/resource'
import { hasVideoContent } from '@/utils/video'
import BlockEditor from '@/components/BlockEditor.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { useScreenSize } from '@/utils/composables'
import { useOnboarding } from '@framework/ui/components/Onboarding/index'
import { useTelemetry } from '@framework/ui/telemetry/index'
import {
	useKeyboardShortcuts,
	saveShortcut,
} from '@/composables/useKeyboardShortcuts'

const { isMobile } = useScreenSize()
const showLessonDetails = ref(false)
const previewLabelId = useId()
const previewSheetLabelId = useId()

const editor = ref(null)
const instructorEditor = ref(null)
const user = inject('$user')
const titleRef = ref(null)
// Text fields always match :focus-visible, even on click, so the ring follows
// the input that led to the focus: a key (Tab, or Enter on "Add Lesson") shows it.
const titleKeyboardFocus = ref(false)
let lastInputWasKeyboard = false
useEventListener(
	document,
	'keydown',
	(e) => {
		if (!e.metaKey && !e.ctrlKey && !e.altKey) lastInputWasKeyboard = true
	},
	true
)
useEventListener(
	document,
	'pointerdown',
	() => (lastInputWasKeyboard = false),
	true
)
const formRef = ref(null)

// A lesson title is one line. The field stays a textarea so a long title wraps
// and grows; only the explicit break is refused.
function onTitleEnter(event) {
	// Enter also confirms an IME candidate. Never swallow that one.
	if (event.isComposing) return
	event.preventDefault()
}

function onTitleInput() {
	// Enter is refused on keydown, but a paste or a drop can still carry breaks.
	lesson.title = toSingleLineTitle(lesson.title)
	autoGrowTitle()
	markDirty({ fromTitle: true })
}

function onTitleBlur() {
	titleKeyboardFocus.value = false
}

// EditorJS can't focus while the card is collapsed (display:none).
function onInstructorNotesToggle(event) {
	if (event.target.open) instructorEditor.value?.focus()
}

function autoGrowTitle() {
	const el = titleRef.value
	if (!el) return
	el.style.height = 'auto'
	el.style.height = `${el.scrollHeight}px`
}

// reactive so the upload block picks up `docname` once the lesson is saved.
const contentUploadContext = reactive({ docname: null, fieldname: 'content' })
const instructorUploadContext = reactive({
	docname: null,
	fieldname: 'instructor_content',
})
const { capture } = useTelemetry()
const { updateOnboardingStep } = useOnboarding('learning')

const emit = defineEmits(['saved', 'created'])

// True after initial render, so render()'s onChange doesn't mark the lesson dirty.
let initialLoadComplete = false

// An unreadable field renders as empty, which looks exactly like a lesson with
// no body, so foldEditorData holds it back and writes it home unchanged.
// Per field: unreadable notes must not stop the author fixing the body.
const unreadable = reactive({ content: false, instructor_content: false })

const unreadableLabels = () =>
	[
		unreadable.content && __('Content'),
		unreadable.instructor_content && __('Instructor Notes'),
	].filter(Boolean)

// What the last toast said, rather than a boolean. The fields resolve
// independently, so a warning naming only Content must not suppress the later
// one that also names the notes.
let warnedAbout = ''

function markUnreadable(field) {
	unreadable[field] = true
}

function warnUnreadable() {
	const fields = unreadableLabels().join(', ')
	if (!fields || warnedAbout === fields) return
	warnedAbout = fields
	toast.error(__('Lesson content could not be read'), {
		description: __(
			'The stored {0} of this lesson could not be read, so the editor is showing it as empty. It is left untouched and will not be overwritten; anything else you edit still saves. Reload the page; if it still fails, restore the lesson from its version history in Desk.'
		).format(fields),
	})
}

const props = defineProps({
	courseName: {
		type: String,
		required: true,
	},
	chapterNumber: {
		type: String,
		required: true,
	},
	lessonNumber: {
		type: String,
		required: true,
	},
	// A new lesson for this chapter (docname), created once its title is typed.
	draftChapter: {
		type: String,
		default: '',
	},
})

// Read once: the parent swaps the props to the created lesson's without
// remounting, and that must not turn this form back into a draft.
const draftChapter = props.draftChapter
const isDraft = ref(Boolean(draftChapter))

const isDirty = ref(false)
// Set once the Course Lesson exists. Its Lesson Reference is a second request,
// and a retry after that one fails must link this lesson, not create another.
const createdLesson = ref(null)
let isUnmounting = false
let lessonDeleted = false
function markDeleted() {
	lessonDeleted = true
}

// Edits only mark the lesson dirty; the header's Save button (or Ctrl+S) writes
// them. There is no timed autosave. The unmount flush still saves when the
// author moves to another lesson.
function markDirty({ fromTitle = false } = {}) {
	if (lessonDeleted) return
	if (isDraft.value) return markDraftDirty(fromTitle)
	if (!lessonDetails.data?.lesson) return
	if (fromTitle) return markFieldEdited()
	// render() fires onChange; gate editor edits until loaded.
	if (!initialLoadComplete) return
	checkEditors()
}

// A keystroke in an editor is an edit for certain, and the DOM reports it at
// once, while EditorJS's change event and the block comparison take about half
// a second. Without this, Save stays disabled for that long after typing.
function markTyped() {
	if (lessonDeleted || !initialLoadComplete) return
	if (!isDraft.value && !lessonDetails.data?.lesson) return
	isDirty.value = true
}

// The preview switch is a plain field: every toggle is an edit.
function markFieldDirty() {
	if (lessonDeleted || !initialLoadComplete) return
	if (!isDraft.value && !lessonDetails.data?.lesson) return
	markFieldEdited()
}

// Counts title and preview edits, so a save can tell whether one landed while
// it was in flight.
let fieldEdits = 0
function markFieldEdited() {
	fieldEdits += 1
	isDirty.value = true
}

// What the editors held when the lesson loaded or was last saved. EditorJS also
// reports changes that edit nothing (the markdown block toggles its placeholder
// on focus and blur, so clicking Save fires one), and an editor change marks
// the lesson dirty only when its blocks differ from this.
let savedEditors = ''
let snapshotReady = Promise.resolve()
const editorsKey = (bodyData, notesData) =>
	JSON.stringify([keptBlocks(bodyData), keptBlocks(notesData)])

function snapshotEditors() {
	snapshotReady = Promise.all([
		serialise(editor.value),
		serialise(instructorEditor.value),
	]).then(([bodyData, notesData]) => {
		savedEditors = editorsKey(bodyData, notesData)
	})
}

// Editor changes whose comparison has not resolved yet. Until it does, a lesson
// switch or a tab close must treat the lesson as possibly edited.
let pendingChecks = 0

// Capture block data now so a later flush persists latest, not stale.
function checkEditors() {
	pendingChecks += 1
	return captureEditors()
		.then((changed) => {
			if (changed) isDirty.value = true
		})
		.finally(() => {
			pendingChecks -= 1
		})
}

// A draft with a title is about to be created; closing the tab now drops it.
const hasUnsavedWork = () =>
	isDirty.value ||
	pendingChecks > 0 ||
	(isDraft.value && lesson.title.trim() !== '')

// Closing or reloading the tab runs no unmount flush, so ask first.
useEventListener(window, 'beforeunload', (event) => {
	if (!hasUnsavedWork() || lessonDeleted) return
	event.preventDefault()
	event.returnValue = ''
})

const isSaving = computed(
	() =>
		editLesson.loading ||
		newLessonResource.loading ||
		lessonReference.loading ||
		createLessonResource.loading
)

defineExpose({
	saveLesson,
	markDeleted,
	isDirty,
	isSaving,
	lessonHasVideo: () => lessonHasVideo.value,
	lessonName: () => lessonDetails.data?.lesson?.name,
	lessonTitle: () => lesson.title,
})

onMounted(() => {
	if (!user.data?.is_moderator && !user.data?.is_instructor) {
		window.location.href = '/login'
	}
	capture('lesson_form_opened')
	enablePlyr()
	if (isDraft.value) openDraft()
})

// A draft has nothing to load: arm the editors once they are ready and put the
// caret in the title. Focus again after the editors settle, unless the author
// has already moved on, in case closing the mobile outline sheet took it.
function openDraft() {
	titleRef.value?.focus()
	Promise.all([
		editor.value?.isReady(),
		instructorEditor.value?.isReady(),
	]).then(() => {
		initialLoadComplete = true
		snapshotEditors()
		if (!formRef.value?.contains(document.activeElement)) {
			titleRef.value?.focus()
		}
	})
}

// Before the lesson exists, body edits are only captured and a title only marks
// the form unsaved. Nothing creates the lesson until Save (or Ctrl+S).
function markDraftDirty(fromTitle) {
	if (fromTitle) return markFieldEdited()
	if (!initialLoadComplete) return
	checkEditors()
}

const createLessonResource = createResource({
	url: 'lms.lms.api.create_lesson',
	makeParams: (values) => values,
})

// Guards the one create: a second Save or Ctrl+S during the request must not
// insert a second lesson. Cleared only when the request fails.
let creatingDraft = false
let createdTitle = ''
// A Save click creates the lesson and then writes the body captured meanwhile.
let saveAfterCreate = false

function createDraftLesson({ flush = false, andSave = false } = {}) {
	if (!isDraft.value || creatingDraft || lessonDeleted) return
	if (isUnmounting && !flush) return
	const title = lesson.title.trim()
	if (!title) return
	creatingDraft = true
	createdTitle = title
	saveAfterCreate = andSave
	return submitResource(
		createLessonResource,
		{ chapter: draftChapter, title },
		{
			onSuccess: promoteDraft,
			onError(err) {
				creatingDraft = false
				toast.error(resourceErrorMessage(err))
			},
		}
	)
}

// The form stays mounted, so the title keeps its focus and caret. From here on
// it is an ordinary lesson, saved by the Save button.
function promoteDraft(name) {
	isDraft.value = false
	lessonDetails.data = {
		chapter: { name: draftChapter },
		lesson: { name, title: createdTitle },
	}
	contentUploadContext.docname = name
	instructorUploadContext.docname = name
	emit('created', { name, chapter: draftChapter })
	// Typed while the create was in flight.
	const typedMeanwhile = lesson.title.trim() !== createdTitle
	if (typedMeanwhile) markFieldEdited()
	const writeBody = saveAfterCreate
	saveAfterCreate = false
	if (writeBody) {
		// The create saved the title. The body goes in the same Save, but only
		// when it has something in it.
		if (!typedMeanwhile) isDirty.value = false
		captureEditors().then((changed) => {
			if (!changed) return
			isDirty.value = true
			saveLesson({ flush: isUnmounting })
		})
	} else if (isDirty.value && isUnmounting) saveLesson({ flush: true })
}

// ignoreTyping:false enables Ctrl+S in title; guard spares ProseMirror.
useKeyboardShortcuts({
	ignoreTyping: false,
	shortcuts: [
		{
			...saveShortcut(() => saveLesson()),
			guard: (e) => !e.target?.classList?.contains('ProseMirror'),
		},
	],
})

const lesson = reactive({
	title: '',
	include_in_preview: false,
	body: '',
	instructor_notes: '',
	content: '',
})

const lessonHasVideo = computed(() => hasVideoContent(lesson))

const lessonDetails = createResource({
	url: 'lms.lms.utils.get_lesson_creation_details',
	params: {
		course: props.courseName,
		chapter: props.chapterNumber,
		lesson: props.lessonNumber,
	},
	auto: !isDraft.value,
	onSuccess(data) {
		if (data.lesson) {
			unreadable.content = false
			unreadable.instructor_content = false
			warnedAbout = ''
			Object.keys(data.lesson).forEach((key) => {
				lesson[key] = data.lesson[key]
			})
			// Titles saved before Enter was refused still hold breaks.
			lesson.title = toSingleLineTitle(lesson.title)
			lesson.include_in_preview = data?.lesson?.include_in_preview
				? true
				: false
			contentUploadContext.docname = data.lesson.name
			instructorUploadContext.docname = data.lesson.name
			nextTick(autoGrowTitle)
			Promise.all([addLessonContent(data), addInstructorNotes(data)]).then(
				() => {
					nextTick(() => {
						// Loaded content isn't user input; track edits after render.
						isDirty.value = false
						initialLoadComplete = true
						snapshotEditors()
						// An empty lesson focuses the title so it can be named (and so
						// the block editor doesn't grab the caret out from under the
						// title). Lessons with a body focus the body for editing.
						if (!data.lesson.content && !data.lesson.body) {
							titleRef.value?.focus()
						} else {
							editor.value?.focus()
						}
					})
				}
			)
		}
	},
})

const addLessonContent = (data) => {
	// Editor can unmount mid-load; render() on a null ref throws.
	if (!editor.value) return Promise.resolve()
	// Return render promise so callers wait for blocks in DOM.
	return editor.value.isReady().then(() => {
		if (!editor.value) return
		if (data.lesson.content) {
			const stored = parseStoredEditorJs(data.lesson.content)
			// Throwing here abandons the rest of the load chain, leaving the form
			// permanently un-loaded, and the notes editor's edits with it.
			if (!stored) return markUnreadable('content')
			return editor.value.render(sanitizeEditorJs(stored))
		} else if (data.lesson.body) {
			let blocks = convertToJSON(data.lesson)
			return editor.value.render({
				blocks: blocks,
			})
		}
	})
}

const addInstructorNotes = (data) => {
	if (!instructorEditor.value) return Promise.resolve()
	return instructorEditor.value.isReady().then(() => {
		if (!instructorEditor.value) return
		if (data.lesson.instructor_content) {
			const stored = parseStoredEditorJs(data.lesson.instructor_content)
			if (!stored) return markUnreadable('instructor_content')
			return instructorEditor.value.render(sanitizeEditorJs(stored))
		} else if (data.lesson.instructor_notes) {
			let blocks = convertToJSON(data.lesson)
			return instructorEditor.value.render({
				blocks: blocks,
			})
		}
	})
}

onBeforeUnmount(() => {
	isUnmounting = true
	// Flush unsaved edits before teardown; skip if deleted.
	if (lessonDeleted) return
	if (isDraft.value) {
		// Read the editors before they are destroyed; the create writes them after.
		if (initialLoadComplete) captureEditors()
		createDraftLesson({ flush: true })
		return
	}
	if (!lessonDetails.data?.lesson) return
	if (isDirty.value) saveLesson({ flush: true })
	// An editor change still being compared: write only if the blocks differ.
	else if (pendingChecks > 0) saveLesson({ flush: true, onlyIfChanged: true })
})

const newLessonResource = createResource({
	url: 'frappe.client.insert',
	makeParams(values) {
		return {
			doc: {
				doctype: 'Course Lesson',
				course: props.courseName,
				chapter: lessonDetails.data?.chapter.name,
				...lesson,
			},
		}
	},
})

const editLesson = createResource({
	url: 'frappe.client.set_value',
	makeParams(values) {
		return {
			doctype: 'Course Lesson',
			name: values.lesson,
			fieldname: lesson,
		}
	},
})

const lessonReference = createResource({
	url: 'frappe.client.insert',
	makeParams(values) {
		return {
			doc: {
				doctype: 'Lesson Reference',
				parent: lessonDetails.data?.chapter.name,
				parenttype: 'Course Chapter',
				parentfield: 'lessons',
				lesson: values.lesson,
				idx: props.lessonNumber,
			},
		}
	},
})

// Stored body has real content? Lets title-only edits skip re-serialising.
const storedContentHasBody = () => {
	return hasEditorContent(parseStoredEditorJs(lesson.content))
}

// Editor destroyed mid-save can reject; degrade to null so persist still runs.
const serialise = (ed) =>
	ed ? Promise.resolve(ed.save()).catch(() => null) : Promise.resolve(null)

// Fold serialised editor output into lesson; return whether body has content.
const foldEditorData = (bodyData, notesData) => {
	// Editor gone or empty: keep stored content so we don't wipe the body.
	let bodyHasContent = storedContentHasBody()
	if (bodyData && !unreadable.content) {
		bodyData = removeEmptyBlocks(bodyData)
		bodyHasContent = hasEditorContent(bodyData)
		if (bodyHasContent) lesson.content = JSON.stringify(bodyData)
	}

	// Fold notes only after load, else the empty default wipes stored notes.
	if (initialLoadComplete && notesData && !unreadable.instructor_content) {
		notesData = removeEmptyBlocks(notesData)
		lesson.instructor_content = JSON.stringify(notesData)
		// Clear legacy field so removed notes don't reappear via fallback.
		lesson.instructor_notes = ''
	}

	return bodyHasContent
}

// Serialise live editors into lesson on @change, before any teardown race.
// Resolves to whether the blocks differ from the last load or save.
const captureEditors = async () => {
	if (lessonDeleted) return false
	const [bodyData, notesData] = await Promise.all([
		serialise(editor.value),
		serialise(instructorEditor.value),
	])
	// Compare against the load snapshot, not the '' it starts from.
	await snapshotReady
	const changed = editorsKey(bodyData, notesData) !== savedEditors
	foldEditorData(bodyData, notesData)
	return changed
}

function saveLesson({ flush = false, onlyIfChanged = false } = {}) {
	if (isDraft.value) return createDraftLesson({ flush, andSave: true })
	// foldEditorData skips unreadable fields, so `lesson` still holds their stored
	// strings and the write puts them back unchanged rather than blanking them.
	warnUnreadable()

	// Both serialise() calls are made before either is awaited, so the editors
	// are read before unmount destroys them.
	Promise.all([
		serialise(editor.value),
		serialise(instructorEditor.value),
	]).then(([bodyData, notesData]) =>
		persistLesson(bodyData, notesData, flush, onlyIfChanged)
	)
}

function persistLesson(bodyData, notesData, flush, onlyIfChanged) {
	const sentEditors = editorsKey(bodyData, notesData)
	if (onlyIfChanged && sentEditors === savedEditors) return
	const bodyHasContent = foldEditorData(bodyData, notesData)

	// Nothing to save: no title, no body.
	if (shouldSkipLessonSave(lesson.title, bodyHasContent)) return

	// During teardown only an explicit flush may persist.
	if (isUnmounting && !flush) return
	if (lessonDeleted) return
	if (lessonDetails.data?.lesson) {
		editCurrentLesson(sentEditors)
	} else {
		createNewLesson()
	}
}

const keptBlocks = (outputData) =>
	outputData?.blocks?.filter((block) => {
		return Object.keys(block.data).length > 0 || block.type == 'paragraph'
	}) ?? null

const removeEmptyBlocks = (outputData) => {
	outputData.blocks = keptBlocks(outputData)
	return outputData
}

// submitResource, not a bare submit(): createResource rethrows after onError, so
// a validation failure or a 500 left a rejected promise nobody handled. It also
// awaits the chained reference insert, so the create only settles once the
// lesson is actually in a chapter.
const createNewLesson = () => {
	// A previous attempt created the lesson and failed on the reference; another
	// insert would leave a second, orphaned lesson behind. Reuse that one, saving
	// the title the user may have edited before retrying.
	if (createdLesson.value) {
		return submitResource(
			editLesson,
			{ lesson: createdLesson.value },
			{
				validate: validateLesson,
				onSuccess: () => linkLesson(createdLesson.value),
				onError(err) {
					toast.error(resourceErrorMessage(err))
				},
			}
		)
	}
	return submitResource(
		newLessonResource,
		{},
		{
			validate: validateLesson,
			onSuccess(data) {
				createdLesson.value = data.name
				return linkLesson(data.name)
			},
			onError(err) {
				toast.error(resourceErrorMessage(err))
			},
		}
	)
}

const linkLesson = (lessonName) =>
	submitResource(
		lessonReference,
		{ lesson: lessonName },
		{
			onSuccess() {
				if (user.data?.is_system_manager)
					updateOnboardingStep('create_first_lesson')

				toast.success(__('Lesson created successfully'))
				isDirty.value = false
				emit('saved', { isNew: true })
				lessonDetails.reload()
			},
			// The reference insert had no handler at all: it failed silently, and
			// the lesson stayed out of the chapter with nothing said about it.
			onError(err) {
				toast.error(resourceErrorMessage(err))
			},
		}
	)

// Numbers each write, so an older response landing after a newer one (two Save
// clicks, or one and the leave flush) cannot mark the lesson saved.
let saveSeq = 0

// Edits can land while a write is in flight (typing goes on during a save), so
// a success clears the dirty flag only if nothing changed since it was sent.
function settleAfterSave(seq, sentFieldEdits) {
	if (fieldEdits !== sentFieldEdits) return
	Promise.all([
		serialise(editor.value),
		serialise(instructorEditor.value),
	]).then(([bodyData, notesData]) => {
		if (seq !== saveSeq || fieldEdits !== sentFieldEdits) return
		if (editorsKey(bodyData, notesData) === savedEditors) isDirty.value = false
	})
}

const editCurrentLesson = (sentEditors, isRetry = false) => {
	const seq = ++saveSeq
	const sentFieldEdits = fieldEdits
	// Catch the re-thrown rejection: a save racing a delete 404s harmlessly.
	editLesson
		.submit(
			{
				lesson: lessonDetails.data.lesson.name,
			},
			{
				validate() {
					return validateLesson()
				},
				onSuccess() {
					if (seq !== saveSeq) return
					savedEditors = sentEditors
					settleAfterSave(seq, sentFieldEdits)
					emit('saved', {
						name: lessonDetails.data.lesson.name,
						title: lesson.title,
						include_in_preview: lesson.include_in_preview,
						isNew: false,
					})
				},
			}
		)
		.catch((err) => {
			if (lessonDeleted) return
			// The daily untitled-lesson rename can move the docname under an open
			// editor; re-resolve it by index and retry once (a plain reload would
			// drop the unsaved edits we're saving).
			if (!isRetry && err?.exc_type === 'DoesNotExistError') {
				resolveLessonName().then((name) => {
					if (name) editCurrentLesson(sentEditors, true)
					else toast.error(err.messages?.[0] || err.message || err)
				})
				return
			}
			toast.error(err.messages?.[0] || err.message || err)
		})
}

const resolveLessonName = () =>
	call('lms.lms.utils.get_lesson_creation_details', {
		course: props.courseName,
		chapter: props.chapterNumber,
		lesson: props.lessonNumber,
	})
		.then((data) => {
			const name = data?.lesson?.name
			if (name) {
				lessonDetails.data.lesson.name = name
				contentUploadContext.docname = name
				instructorUploadContext.docname = name
			}
			return name || null
		})
		.catch(() => null)

const validateLesson = () => {
	if (!lesson.title) {
		return 'Title is required'
	}
}
</script>
<style>
/* Drop the default disclosure marker; rotate chevron via [open]. */
.instructor-notes > summary {
	list-style: none;
}
.instructor-notes > summary::-webkit-details-marker {
	display: none;
}
.instructor-notes-chevron {
	transition: transform 200ms;
}
.instructor-notes[open] .instructor-notes-chevron {
	transform: rotate(90deg);
}
[dir='rtl'] .instructor-notes:not([open]) .instructor-notes-chevron {
	transform: rotate(180deg);
}

/* Indent so EditorJS's left-gutter controls stay inside the card. */
.instructor-notes-editor .ce-block__content,
.instructor-notes-editor .ce-toolbar__content {
	margin-inline-start: 4.5rem;
}

/* Lift instructor editor so its + menu paints above the content editor. */
.instructor-notes-editor .codex-editor {
	z-index: 2;
}
</style>
