import { describe, expect, it } from 'vitest'
import {
	MAX_GROUPS,
	MAX_GROUP_LENGTH,
	normalizeGroup,
	orderQuizQuestions,
	sectionHeadings,
	sectionNames,
	validateSections,
} from '@/utils/quizSections'
import { isValidPracticalMaxMarks } from '@/utils/quizSettings'

type Row = { question: string; group?: string | null }
const r = (question: string, group?: string | null): Row => ({
	question,
	group,
})
const names = (rows: Row[]) => rows.map((row) => row.question)

// Replays fixed values, then 0, so a shuffle is reproducible.
const sequence = (...values: number[]) => {
	let i = 0
	return () => values[i++] ?? 0
}

describe('normalizeGroup', () => {
	it('trims, and reads anything else as no section', () => {
		expect(normalizeGroup('  Theory ')).toBe('Theory')
		expect(normalizeGroup('   ')).toBe('')
		expect(normalizeGroup(null)).toBe('')
		expect(normalizeGroup(undefined)).toBe('')
		expect(normalizeGroup(3)).toBe('')
	})
})

describe('sectionNames and sectionHeadings', () => {
	const rows = [r('1', 'A'), r('2', 'A'), r('3'), r('4', ' B '), r('5', 'B')]

	it('lists each title once, in authored order', () => {
		expect(sectionNames(rows)).toEqual(['A', 'B'])
	})

	it('marks only the first row of each run', () => {
		expect(sectionHeadings(rows)).toEqual(['A', null, null, 'B', null])
	})

	it('has no heading for a quiz without sections', () => {
		expect(sectionHeadings([r('1'), r('2', ''), r('3', null)])).toEqual([
			null,
			null,
			null,
		])
	})

	it('prints a heading again where a title comes back after another row', () => {
		expect(sectionHeadings([r('1', 'A'), r('2', 'B'), r('3', 'A')])).toEqual([
			'A',
			'B',
			'A',
		])
	})
})

describe('validateSections', () => {
	it('accepts contiguous sections, ungrouped rows and no sections', () => {
		expect(validateSections([])).toEqual([])
		expect(validateSections([r('1'), r('2')])).toEqual([])
		expect(
			validateSections([r('1', 'A'), r('2', 'A'), r('3'), r('4', 'B')])
		).toEqual([])
	})

	it('names a section split by another row, with the rows involved', () => {
		expect(validateSections([r('1', 'A'), r('2', 'B'), r('3', 'A')])).toEqual([
			{ kind: 'split', group: 'A', rows: [1, 3] },
		])
	})

	it('treats an ungrouped row between two rows of a title as a split', () => {
		expect(validateSections([r('1', 'A'), r('2'), r('3', 'A')])).toEqual([
			{ kind: 'split', group: 'A', rows: [1, 3] },
		])
	})

	it('compares trimmed titles', () => {
		expect(validateSections([r('1', 'A '), r('2', ' A')])).toEqual([])
		expect(validateSections([r('1', 'A '), r('2', 'B'), r('3', ' A')])).toEqual(
			[{ kind: 'split', group: 'A', rows: [1, 3] }]
		)
	})

	it('limits a title to 140 characters', () => {
		const ok = 'x'.repeat(MAX_GROUP_LENGTH)
		expect(validateSections([r('1', ok)])).toEqual([])
		expect(validateSections([r('1', ok + 'x')])).toEqual([
			{ kind: 'too_long', group: ok + 'x', rows: [1] },
		])
	})

	it('limits a quiz to 40 sections', () => {
		const make = (count: number) =>
			Array.from({ length: count }, (_, i) => r(String(i), `S${i}`))
		expect(validateSections(make(MAX_GROUPS))).toEqual([])
		expect(validateSections(make(MAX_GROUPS + 1))).toEqual([
			{ kind: 'too_many', count: MAX_GROUPS + 1 },
		])
	})
})

describe('orderQuizQuestions', () => {
	const grouped = [
		r('a1', 'A'),
		r('a2', 'A'),
		r('a3', 'A'),
		r('b1', 'B'),
		r('b2', 'B'),
		r('c1', 'C'),
	]

	it('keeps the authored order without shuffle, and ignores the limit', () => {
		const rows = [r('1'), r('2'), r('3')]
		expect(orderQuizQuestions(rows)).toBe(rows)
		expect(orderQuizQuestions(grouped, { limit: 2 })).toBe(grouped)
	})

	it('shuffles inside each section and keeps the sections in authored order', () => {
		// random 0 sends the last element to the front on every swap.
		const out = orderQuizQuestions(grouped, {
			shuffle: true,
			random: () => 0,
		})
		expect(names(out)).toEqual(['a2', 'a3', 'a1', 'b2', 'b1', 'c1'])
		expect(names(out).map((n) => n[0])).toEqual(['a', 'a', 'a', 'b', 'b', 'c'])
	})

	it('never moves a question out of its section, whatever the draw', () => {
		for (const random of [() => 0, () => 0.5, () => 0.999999]) {
			const out = orderQuizQuestions(grouped, { shuffle: true, random })
			expect(names(out).slice(0, 3).sort()).toEqual(['a1', 'a2', 'a3'])
			expect(names(out).slice(3, 5).sort()).toEqual(['b1', 'b2'])
			expect(names(out)[5]).toBe('c1')
		}
	})

	it('treats a run of ungrouped rows as a block of its own, between sections', () => {
		const rows = [r('u1'), r('u2'), r('a1', 'A'), r('a2', 'A'), r('u3')]
		const out = orderQuizQuestions(rows, { shuffle: true, random: () => 0 })
		expect(names(out)).toEqual(['u2', 'u1', 'a2', 'a1', 'u3'])
	})

	it('does not merge ungrouped rows that a section separates', () => {
		const rows = [r('u1'), r('a1', 'A'), r('u2')]
		const out = orderQuizQuestions(rows, { shuffle: true, random: () => 0 })
		expect(names(out)).toEqual(['u1', 'a1', 'u2'])
	})

	it('takes the first N of the resulting sequence', () => {
		const out = orderQuizQuestions(grouped, {
			shuffle: true,
			limit: 4,
			random: () => 0,
		})
		expect(names(out)).toEqual(['a2', 'a3', 'a1', 'b2'])
	})

	it('treats a zero, empty or null limit as no limit', () => {
		for (const limit of [0, null, undefined]) {
			expect(
				orderQuizQuestions(grouped, { shuffle: true, limit, random: () => 0 })
			).toHaveLength(grouped.length)
		}
	})

	it('shuffles the whole list exactly as before when no question has a section', () => {
		const rows = [r('1'), r('2', ''), r('3', null), r('4'), r('5')]
		const draw = [0.9, 0.1, 0.5, 0.3]
		// The previous implementation, Fisher-Yates over the whole copy.
		const expected = [...rows]
		const old = sequence(...draw)
		for (let i = expected.length - 1; i > 0; i--) {
			const j = Math.floor(old() * (i + 1))
			;[expected[i], expected[j]] = [expected[j], expected[i]]
		}
		expect(
			orderQuizQuestions(rows, { shuffle: true, random: sequence(...draw) })
		).toEqual(expected)
	})

	it('does not mutate the rows it is given', () => {
		const rows = [...grouped]
		orderQuizQuestions(rows, { shuffle: true, random: () => 0 })
		expect(rows).toEqual(grouped)
	})

	it('returns an empty list for no rows', () => {
		expect(orderQuizQuestions([], { shuffle: true, limit: 3 })).toEqual([])
	})
})

describe('isValidPracticalMaxMarks', () => {
	it.each([0, '0', 5, '12.5', '999.99', 999.99, '0.01', '', null, undefined])(
		'accepts %s',
		(value) => {
			expect(isValidPracticalMaxMarks(value)).toBe(true)
		}
	)

	it.each(['1000', '999.995', '-1', '1.234', 'abc', '1e3', '.5', '1.'])(
		'rejects %s',
		(value) => {
			expect(isValidPracticalMaxMarks(value)).toBe(false)
		}
	)

	it('rejects a number past the limit or with a third decimal', () => {
		expect(isValidPracticalMaxMarks(1000)).toBe(false)
		expect(isValidPracticalMaxMarks(1.005)).toBe(false)
		expect(isValidPracticalMaxMarks(-0.5)).toBe(false)
	})
})
