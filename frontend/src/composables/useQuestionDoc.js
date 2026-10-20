// One LMS Question's local working copy. The card and the dialog each carried a
// full copy, so a rule fixed on one stayed wrong on the other. Plain JS: a .ts
// module here would add a TS7016.

import { computed, reactive, ref } from 'vue'
import { createResource } from 'frappe-ui'
import {
	MAX_OPTIONS,
	blankOptionFields,
	isQuestionValid,
	toBackendType,
	toUiType,
} from '@/utils/quizQuestion'
import {
	blanksPayload,
	extractBlankIds,
	parseBlanks,
	syncBlanks,
	totalBlankMarks,
} from '@/utils/fillBlank'

const DOCTYPE = 'LMS Question'

// `blanks` goes out as the server's child rows for a Fill Blank question. For any
// other type it is left off, unless rows are still held from before a type switch:
// then an empty list clears them.
const withBlanks = (doc) => {
	const { blanks, ...rest } = doc
	if (rest.type === 'Fill Blank')
		return { ...rest, blanks: blanksPayload(blanks) }
	return blanks?.length ? { ...rest, blanks: [] } : rest
}

// No onError, so the promise rejects and the caller owns the failure. Nothing
// catches it behind them: main.js sets `resourceFetcher` only, and frappe-ui
// rethrows when neither an onError nor a `fallbackErrorHandler` exists.
const submit = (url, params) =>
	createResource({ url, auto: false }).submit(params)

export const getQuestion = (name) =>
	submit('frappe.client.get', { doctype: DOCTYPE, name })

export const updateQuestion = (name, fieldname) =>
	submit('frappe.client.set_value', { doctype: DOCTYPE, name, fieldname })

export const createQuestion = (fields) =>
	submit('frappe.client.insert', { doc: { doctype: DOCTYPE, ...fields } })

/**
 * A working copy seeded from `uiType` and `marks`. Marks are the question's own
 * field: a quiz row starts on this number and may still carry a different one
 * of its own afterwards.
 */
export function useQuestionDoc({
	uiType: seedUiType = 'single',
	marks = 1,
} = {}) {
	const seedFields = () => ({
		question: '',
		...toBackendType(seedUiType),
		marks,
		...blankOptionFields(),
		blanks: [],
	})

	const uiType = ref(seedUiType)
	const working = reactive(seedFields())
	const loaded = ref(false)

	const isValid = computed(() => isQuestionValid(working, uiType.value))

	// applyDoc copies only keys the skeleton already has, so this stays the whole
	// document however many fields the server grows.
	const fields = () => withBlanks({ ...working })

	// For the surface that leaves working.type alone while editing and resolves
	// it once, on save.
	const fieldsWithType = () =>
		withBlanks({
			...working,
			...toBackendType(uiType.value),
		})

	/** `overrides` win over the doc, for a field the caller owns rather than the bank record. */
	const applyDoc = (doc, overrides) => {
		// The blank skeleton first, so a previous question's options go away
		// instead of surviving wherever this one leaves a gap.
		Object.assign(working, blankOptionFields())
		Object.keys(doc).forEach((key) => {
			if (key in working) working[key] = doc[key]
		})
		// The server sends these as 1/0/null and the checkboxes want a number, so
		// a null against a 0 would read as an edit to anything diffing the two.
		for (let i = 1; i <= MAX_OPTIONS; i++) {
			working[`is_correct_${i}`] = doc[`is_correct_${i}`] ? 1 : 0
			// The server sends an empty image as null. '' keeps a cleared image equal to
			// a never-set one, and Save sends '' to clear the stored file.
			working[`option_${i}_image`] = doc[`option_${i}_image`] || ''
		}
		if (overrides) Object.assign(working, overrides)
		// Rows come back with name, idx and parent; the editor keeps three fields,
		// in the order the tokens appear, and the question's marks are their sum.
		working.blanks = []
		if (doc.type === 'Fill Blank') {
			working.blanks = syncBlanks(
				parseBlanks(doc.blanks),
				extractBlankIds(working.question)
			)
			const total = totalBlankMarks(working.blanks)
			if (total > 0) working.marks = total
		}
		uiType.value = toUiType(doc)
		loaded.value = true
	}

	const load = async (name, overrides) =>
		applyDoc(await getQuestion(name), overrides)

	const reset = () => {
		Object.assign(working, seedFields())
		uiType.value = seedUiType
		loaded.value = false
	}

	return {
		uiType,
		working,
		loaded,
		isValid,
		fields,
		fieldsWithType,
		applyDoc,
		load,
		reset,
	}
}
