// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
	acceptedAnswerLines,
	blankErrors,
	blanksPayload,
	blankToken,
	extractBlankIds,
	hasFillBlankAnswer,
	hasValidBlanks,
	indexBlankResults,
	nextBlankId,
	parseBlanks,
	parseFillBlankAnswer,
	serializeFillBlankAnswers,
	splitBlankTokens,
	syncBlanks,
	totalBlankMarks,
} from '@/utils/fillBlank'
import type { BlankRow } from '@/utils/fillBlank'

const row = (blank_id: string, answers = 'a', marks: number | string = 1) =>
	({ blank_id, answers, marks } as BlankRow)

describe('extractBlankIds', () => {
	it('lists each id once, in order of appearance', () => {
		expect(extractBlankIds('<p>[[2]] and [[1]] and [[2]]</p>')).toEqual([
			'2',
			'1',
		])
	})

	it('accepts the server pattern: ASCII digits only', () => {
		expect(extractBlankIds('[[1]] [[10]] [[007]]')).toEqual(['1', '10', '007'])
	})

	it('ignores broken tokens and empty input', () => {
		expect(
			extractBlankIds('[[]] [[ 1 ]] [[a]] [[a-b]] [[1.5]] [1] [[1] {{1}}')
		).toEqual([])
		expect(extractBlankIds('[[１]] [[１２]] [[圧縮]]')).toEqual([])
		expect(extractBlankIds(null)).toEqual([])
		expect(extractBlankIds(undefined)).toEqual([])
	})

	it('is repeatable, with no state kept between calls', () => {
		const html = '[[1]]'
		expect(extractBlankIds(html)).toEqual(['1'])
		expect(extractBlankIds(html)).toEqual(['1'])
	})
})

describe('nextBlankId', () => {
	it('starts at 1', () => {
		expect(nextBlankId([])).toBe('1')
	})

	it('takes the smallest unused whole number', () => {
		expect(nextBlankId(['1', '3'])).toBe('2')
		expect(nextBlankId(['1', '2', '3'])).toBe('4')
	})

	it('ignores ids that are not numbers', () => {
		expect(nextBlankId(['a', '1'])).toBe('2')
	})
})

describe('splitBlankTokens', () => {
	it('splits text and blanks in reading order', () => {
		expect(splitBlankTokens('A [[1]] B[[2]]')).toEqual([
			{ type: 'text', value: 'A ' },
			{ type: 'blank', id: '1' },
			{ type: 'text', value: ' B' },
			{ type: 'blank', id: '2' },
		])
	})

	it('returns plain text whole', () => {
		expect(splitBlankTokens('no tokens')).toEqual([
			{ type: 'text', value: 'no tokens' },
		])
		expect(splitBlankTokens('')).toEqual([])
	})
})

describe('syncBlanks', () => {
	it('keeps what was entered for ids that remain, in body order', () => {
		const rows = [row('1', 'one', 2), row('2', 'two', 3)]
		expect(syncBlanks(rows, ['2', '1'])).toEqual([
			row('2', 'two', 3),
			row('1', 'one', 2),
		])
	})

	it('drops the row of an id that left the body', () => {
		expect(syncBlanks([row('1'), row('2')], ['1'])).toEqual([row('1')])
	})

	it('starts a new id with no answers and one mark', () => {
		expect(syncBlanks([row('1')], ['1', '2'])).toEqual([
			row('1'),
			{ blank_id: '2', answers: '', marks: 1 },
		])
	})

	it('hands back the same array when nothing changed', () => {
		const rows = [row('1'), row('2')]
		expect(syncBlanks(rows, ['1', '2'])).toBe(rows)
	})

	it('copes with no rows at all', () => {
		expect(syncBlanks(undefined, [])).toEqual([])
		expect(syncBlanks(null, ['1'])).toEqual([
			{ blank_id: '1', answers: '', marks: 1 },
		])
	})
})

describe('answers and marks rules', () => {
	it('counts only non-empty trimmed lines as accepted answers', () => {
		expect(acceptedAnswerLines(' a \r\n\n  b\n   ')).toEqual(['a', 'b'])
		expect(acceptedAnswerLines('')).toEqual([])
		expect(acceptedAnswerLines(null)).toEqual([])
	})

	it('flags a blank with no answer line', () => {
		expect(blankErrors(row('1', '  \n '))).toEqual({
			answers: true,
			marks: false,
		})
	})

	it.each([0, -1, 1.5, '', 'x', null])(
		'flags marks %s as not a whole number of 1 or more',
		(marks) => {
			expect(blankErrors({ ...row('1'), marks: marks as any }).marks).toBe(true)
		}
	)

	it.each([1, 2, '3'])('accepts marks %s', (marks) => {
		expect(blankErrors(row('1', 'a', marks)).marks).toBe(false)
	})

	it('totals only valid marks', () => {
		expect(totalBlankMarks([row('1', 'a', 2), row('2', 'a', '3')])).toBe(5)
		expect(totalBlankMarks([row('1', 'a', 0), row('2', 'a', 1.5)])).toBe(0)
		expect(totalBlankMarks(undefined)).toBe(0)
	})
})

describe('hasValidBlanks', () => {
	const body = '<p>[[1]] then [[2]]</p>'

	it('accepts rows that match the tokens and are each valid', () => {
		expect(hasValidBlanks(body, [row('1'), row('2')])).toBe(true)
	})

	it('needs at least one blank', () => {
		expect(hasValidBlanks('<p>no blanks</p>', [])).toBe(false)
		expect(hasValidBlanks('', undefined)).toBe(false)
	})

	it('needs the rows and the tokens to name the same ids', () => {
		expect(hasValidBlanks(body, [row('1')])).toBe(false)
		expect(hasValidBlanks(body, [row('1'), row('3')])).toBe(false)
		expect(hasValidBlanks(body, [row('1'), row('2'), row('3')])).toBe(false)
	})

	it('refuses a duplicate id', () => {
		expect(hasValidBlanks(body, [row('1'), row('1')])).toBe(false)
	})

	it('refuses a row with no answer or bad marks', () => {
		expect(hasValidBlanks(body, [row('1'), row('2', '')])).toBe(false)
		expect(hasValidBlanks(body, [row('1'), row('2', 'a', 0)])).toBe(false)
	})
})

describe('payload build and parse', () => {
	it('builds the child rows: trimmed lines, whole marks', () => {
		expect(
			blanksPayload([
				row('1', ' 圧縮機 \n\n コンプレッサ ', '2'),
				row('2', 'x', 1),
			])
		).toEqual([
			{ blank_id: '1', answers: '圧縮機\nコンプレッサ', marks: 2 },
			{ blank_id: '2', answers: 'x', marks: 1 },
		])
		expect(blanksPayload(undefined)).toEqual([])
	})

	it('parses API rows down to the three fields the editor owns', () => {
		expect(
			parseBlanks([
				{
					name: 'abc',
					idx: 1,
					parent: 'Q',
					blank_id: '1',
					answers: 'a\nb',
					marks: 2,
				} as any,
				{ blank_id: 2, answers: null, marks: null } as any,
			])
		).toEqual([
			{ blank_id: '1', answers: 'a\nb', marks: 2 },
			{ blank_id: '2', answers: '', marks: 1 },
		])
		expect(parseBlanks(undefined)).toEqual([])
	})

	it('survives a save and a reload', () => {
		const edited = [row('1', 'a\nb', 2), row('2', 'c', 1)]
		expect(parseBlanks(blanksPayload(edited))).toEqual(edited)
	})
})

describe('learner answers', () => {
	it('counts a question as answered when any blank has non-whitespace text', () => {
		expect(hasFillBlankAnswer({ '1': '', '2': '  ' })).toBe(false)
		expect(hasFillBlankAnswer({ '1': '', '2': 'x' })).toBe(true)
		expect(hasFillBlankAnswer({})).toBe(false)
		expect(hasFillBlankAnswer(null)).toBe(false)
	})

	it('serialises every blank of the question as a JSON map', () => {
		expect(
			JSON.parse(serializeFillBlankAnswers(['1', '2'], { '1': '圧縮機' }))
		).toEqual({ '1': '圧縮機', '2': '' })
		expect(serializeFillBlankAnswers(['1'], { '1': 'a', stray: 'b' })).toBe(
			'{"1":"a"}'
		)
	})

	it('reads a saved answer back, dropping anything that is not strings', () => {
		expect(parseFillBlankAnswer('{"1":"a","2":3,"3":null}')).toEqual({
			'1': 'a',
		})
		expect(parseFillBlankAnswer('not json')).toEqual({})
		expect(parseFillBlankAnswer('[1,2]')).toEqual({})
		expect(parseFillBlankAnswer('null')).toEqual({})
		expect(parseFillBlankAnswer(undefined)).toEqual({})
	})

	it('round-trips through serialize and parse', () => {
		const answers = { '1': '圧縮機', '2': 'x y' }
		expect(
			parseFillBlankAnswer(serializeFillBlankAnswers(['1', '2'], answers))
		).toEqual(answers)
	})
})

describe('misc', () => {
	it('writes a token', () => {
		expect(blankToken(3)).toBe('[[3]]')
		expect(extractBlankIds(blankToken('3'))).toEqual(['3'])
	})

	it('indexes results by blank id', () => {
		const result = {
			blank_id: '1',
			answer: 'a',
			is_correct: true,
			marks: 1,
			marks_out_of: 1,
		}
		expect(indexBlankResults([result])).toEqual({ '1': result })
		expect(indexBlankResults(undefined)).toEqual({})
	})
})
