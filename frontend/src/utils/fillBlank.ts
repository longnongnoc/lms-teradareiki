// Pure helpers for the Fill in the Blanks question type. The body is rich HTML
// holding [[n]] tokens, and the rules here mirror the server's (lms/fill_blank.py
// and LMS Question's blank validation) so the authoring UI never offers a save
// the server would refuse.

// Same pattern as the server's BLANK_TOKEN: ASCII digits only, so full-width
// digits are not markers on either side. A fresh RegExp per call, because a
// shared /g regex carries lastIndex between uses.
const TOKEN_SOURCE = String.raw`\[\[([0-9]+)\]\]`
const tokenRegex = (): RegExp => new RegExp(TOKEN_SOURCE, 'g')

export type BlankRow = {
	blank_id: string
	// One accepted answer per line, exactly as the author typed it.
	answers: string
	// Kept as typed while editing; coerced by blanksPayload.
	marks: number | string
}

export type BlankMeta = { blank_id: string; marks?: number }

export type BlankResult = {
	blank_id: string
	answer: string
	is_correct: boolean
	marks: number
	marks_out_of: number
	// Present only when the viewer may see the answer key.
	accepted?: string[]
}

export type FillBlankGrade = {
	results: BlankResult[]
	marks: number
	marks_out_of: number
	is_correct: boolean
}

export type TokenPart =
	| { type: 'text'; value: string }
	| { type: 'blank'; id: string }

export const blankToken = (id: string | number): string => `[[${id}]]`

// Ids in order of first appearance, each once.
export const extractBlankIds = (html?: string | null): string[] => {
	const ids: string[] = []
	for (const match of (html ?? '').matchAll(tokenRegex())) {
		if (!ids.includes(match[1])) ids.push(match[1])
	}
	return ids
}

// The smallest positive whole number no token uses yet, so deleting [[2]] and
// inserting again hands 2 back rather than climbing forever.
export const nextBlankId = (used: Iterable<string>): string => {
	const taken = new Set(Array.from(used, String))
	let n = 1
	while (taken.has(String(n))) n++
	return String(n)
}

// Text and blank markers in reading order. Used on a single text node, so a
// token is never matched across markup.
export const splitBlankTokens = (text: string): TokenPart[] => {
	const parts: TokenPart[] = []
	let last = 0
	for (const match of text.matchAll(tokenRegex())) {
		const start = match.index ?? 0
		if (start > last)
			parts.push({ type: 'text', value: text.slice(last, start) })
		parts.push({ type: 'blank', id: match[1] })
		last = start + match[0].length
	}
	if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
	return parts
}

export const acceptedAnswerLines = (answers?: string | null): string[] =>
	String(answers ?? '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)

export const isWholeMarks = (marks: unknown): boolean => {
	if (marks === '' || marks === null || marks === undefined) return false
	const n = Number(marks)
	return Number.isInteger(n) && n >= 1
}

export const blankErrors = (
	blank?: Partial<BlankRow> | null
): { answers: boolean; marks: boolean } => ({
	answers: acceptedAnswerLines(blank?.answers).length === 0,
	marks: !isWholeMarks(blank?.marks),
})

export const isBlankValid = (blank?: Partial<BlankRow> | null): boolean => {
	const errors = blankErrors(blank)
	return !errors.answers && !errors.marks
}

export const totalBlankMarks = (blanks?: Partial<BlankRow>[] | null): number =>
	(blanks ?? []).reduce(
		(total, blank) =>
			total + (isWholeMarks(blank.marks) ? Number(blank.marks) : 0),
		0
	)

// One row per id in the body, in body order. Rows for ids that are still there
// keep what the author entered; rows for ids that went are dropped; a new id
// starts with no answers and one mark. Returns the same array when nothing
// changes, so a watcher that writes the result back does not loop.
// `removed` is the owner's memory of dropped rows: a row that goes is put in it,
// and an id that comes back takes its row out again, so deleting a marker by
// mistake (or retyping it) does not cost the author its answers and marks.
export const syncBlanks = (
	blanks: BlankRow[] | null | undefined,
	ids: string[],
	removed?: Map<string, BlankRow>
): BlankRow[] => {
	const current = blanks ?? []
	if (
		current.length === ids.length &&
		current.every((row, i) => row.blank_id === ids[i])
	)
		return current as BlankRow[]
	const byId = new Map(current.map((row) => [row.blank_id, row]))
	if (removed) {
		for (const row of current)
			if (!ids.includes(row.blank_id)) removed.set(row.blank_id, row)
	}
	return ids.map((id) => {
		const kept = byId.get(id)
		if (kept) return kept
		const back = removed?.get(id)
		if (back) {
			removed?.delete(id)
			return back
		}
		return { blank_id: id, answers: '', marks: 1 }
	})
}

// Ids that appear in more than one marker. The learner would get two boxes
// sharing one answer, so the author is asked to number them apart.
export const duplicateBlankIds = (html?: string | null): string[] => {
	const seen = new Set<string>()
	const repeated: string[] = []
	for (const match of (html ?? '').matchAll(tokenRegex())) {
		if (seen.has(match[1]) && !repeated.includes(match[1]))
			repeated.push(match[1])
		seen.add(match[1])
	}
	return repeated
}

// A marker that looks right but is not one: full-width or corner brackets, or
// full-width digits, as a Japanese IME produces them. Tags are stripped first so
// markup never counts.
const NEAR_MISS_SOURCE = String.raw`[\[［「『【]{2}\s*[0-9０-９]+\s*[\]］」』】]{2}`
export const hasNearMissMarker = (html?: string | null): boolean => {
	const text = (html ?? '').replace(/<[^>]*>/g, '')
	for (const match of text.matchAll(new RegExp(NEAR_MISS_SOURCE, 'g'))) {
		if (!new RegExp(`^${TOKEN_SOURCE}$`).test(match[0])) return true
	}
	return false
}

// The server's checks: at least one blank, the body's tokens and the rows name
// the same ids, and every row is valid. A marker used twice is refused here too.
export const hasValidBlanks = (
	html: string | null | undefined,
	blanks: BlankRow[] | null | undefined
): boolean => {
	const ids = extractBlankIds(html)
	const rows = blanks ?? []
	if (!ids.length || rows.length !== ids.length) return false
	if (duplicateBlankIds(html).length) return false
	const rowIds = new Set(rows.map((row) => row.blank_id))
	if (rowIds.size !== rows.length) return false
	if (!ids.every((id) => rowIds.has(id))) return false
	return rows.every(isBlankValid)
}

// What goes to the server in `blanks`. Answers are trimmed per line and empty
// lines dropped, which the server would do again when it grades.
export const blanksPayload = (
	blanks?: Partial<BlankRow>[] | null
): { blank_id: string; answers: string; marks: number }[] =>
	(blanks ?? []).map((blank) => ({
		blank_id: String(blank.blank_id ?? ''),
		answers: acceptedAnswerLines(blank.answers).join('\n'),
		marks: Number(blank.marks),
	}))

// The API's child rows (name, idx, parent and so on) down to the three fields
// the editor owns.
export const parseBlanks = (rows?: Partial<BlankRow>[] | null): BlankRow[] =>
	(Array.isArray(rows) ? rows : []).map((row) => ({
		blank_id: String(row.blank_id ?? ''),
		answers: String(row.answers ?? ''),
		marks:
			row.marks === undefined || row.marks === null ? 1 : Number(row.marks),
	}))

export const hasFillBlankAnswer = (
	answers?: Record<string, string> | null
): boolean =>
	Object.values(answers ?? {}).some(
		(value) => typeof value === 'string' && value.trim() !== ''
	)

// {"1": "text", ...} for every blank the question has, so the server sees an
// empty string for a blank left alone rather than a missing key.
export const serializeFillBlankAnswers = (
	blankIds: string[],
	answers?: Record<string, string> | null
): string =>
	JSON.stringify(
		Object.fromEntries(blankIds.map((id) => [id, answers?.[id] ?? '']))
	)

// A saved answer back into the map. Anything that is not a JSON object of
// strings is dropped, because localStorage is the learner's to tamper with.
export const parseFillBlankAnswer = (
	saved?: string | null
): Record<string, string> => {
	if (!saved) return {}
	try {
		const parsed = JSON.parse(saved)
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return {}
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		)
	} catch {
		return {}
	}
}

export const indexBlankResults = (
	results?: BlankResult[] | null
): Record<string, BlankResult> =>
	Object.fromEntries((results ?? []).map((item) => [item.blank_id, item]))
