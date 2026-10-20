/**
 * Quiz sections: a run of adjacent question rows that share one `group` title.
 * Mirrors LMS Quiz.validate_question_groups, so the form blocks a save the server
 * would refuse, and the player orders rows by the same notion of a block.
 */

export const MAX_GROUP_LENGTH = 140
export const MAX_GROUPS = 40

type GroupedRow = { group?: string | null }

export type SectionIssue =
	| { kind: 'split'; group: string; rows: number[] }
	| { kind: 'too_long'; group: string; rows: number[] }
	| { kind: 'too_many'; count: number }

/** A title is trimmed, and an empty one means no section at all. */
export const normalizeGroup = (value: unknown): string =>
	typeof value === 'string' ? value.trim() : ''

/** Distinct titles in authored order, for the suggestion list. */
export const sectionNames = (rows: GroupedRow[]): string[] => {
	const seen = new Set<string>()
	for (const row of rows) {
		const group = normalizeGroup(row.group)
		if (group) seen.add(group)
	}
	return [...seen]
}

/**
 * The title to print above each row, or null where no band belongs: only the
 * first row of a contiguous run of one title gets it.
 */
export const sectionHeadings = (rows: GroupedRow[]): (string | null)[] =>
	rows.map((row, index) => {
		const group = normalizeGroup(row.group)
		if (!group) return null
		return index > 0 && normalizeGroup(rows[index - 1].group) === group
			? null
			: group
	})

/** Everything the server would reject, in a stable order. Empty means saveable. */
export const validateSections = (rows: GroupedRow[]): SectionIssue[] => {
	const positions = new Map<string, number[]>()
	rows.forEach((row, index) => {
		const group = normalizeGroup(row.group)
		if (!group) return
		const list = positions.get(group)
		if (list) list.push(index + 1)
		else positions.set(group, [index + 1])
	})

	const issues: SectionIssue[] = []
	for (const [group, list] of positions) {
		if (group.length > MAX_GROUP_LENGTH)
			issues.push({ kind: 'too_long', group, rows: list })
		if (list[list.length - 1] - list[0] + 1 !== list.length)
			issues.push({ kind: 'split', group, rows: list })
	}
	if (positions.size > MAX_GROUPS)
		issues.push({ kind: 'too_many', count: positions.size })
	return issues
}

const shuffleInPlace = <T>(array: T[], random: () => number): T[] => {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1))
		;[array[i], array[j]] = [array[j], array[i]]
	}
	return array
}

/**
 * The order a learner sees. Without shuffle the authored order is kept. With it,
 * each contiguous run of one title (an ungrouped run is a block too) is shuffled
 * inside itself while the blocks keep their authored order, so with no sections
 * at all this is a plain shuffle of the whole list. `limit` then keeps the first
 * N of that sequence.
 */
export const orderQuizQuestions = <T extends GroupedRow>(
	rows: T[],
	{
		shuffle = false,
		limit = 0,
		random = Math.random,
	}: { shuffle?: boolean; limit?: number | null; random?: () => number } = {}
): T[] => {
	if (!shuffle) return rows
	const ordered: T[] = []
	let block: T[] = []
	let blockGroup = ''
	const flush = () => {
		ordered.push(...shuffleInPlace(block, random))
		block = []
	}
	rows.forEach((row, index) => {
		const group = normalizeGroup(row.group)
		// An ungrouped row never opens a section, but it still shares a block with its ungrouped neighbours.
		if (index > 0 && group !== blockGroup) flush()
		blockGroup = group
		block.push(row)
	})
	flush()
	const keep = Number(limit) || 0
	return keep > 0 ? ordered.slice(0, keep) : ordered
}
