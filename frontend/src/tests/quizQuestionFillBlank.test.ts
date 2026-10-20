// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
	allowedQuestionTypesFor,
	allowedUiTypesFor,
	isQuestionValid,
	nextQuestionUiType,
	toBackendType,
	toUiType,
} from '@/utils/quizQuestion'

vi.mock('frappe-ui', () => ({ createResource: vi.fn() }))

const body = '<p>{{1}} is the heart, {{2}} the loop</p>'
const blanks = [
	{ blank_id: '1', answers: '圧縮機', marks: 1 },
	{ blank_id: '2', answers: 'ループ\nloop', marks: 2 },
]

describe('Fill Blank type mapping', () => {
	it('maps both ways', () => {
		expect(toUiType({ type: 'Fill Blank' })).toBe('fill_blank')
		expect(toBackendType('fill_blank')).toEqual({
			type: 'Fill Blank',
			multiple: 0,
		})
	})

	it('leaves the other mappings alone', () => {
		expect(toUiType({ type: 'Choices', multiple: 1 })).toBe('multiple')
		expect(toUiType({ type: 'User Input' })).toBe('user_input')
		expect(toUiType({ type: 'Open Ended' })).toBe('open_ended')
	})
})

describe('Fill Blank mixing', () => {
	const row = (type: string) => ({ name: type, type })

	it('is offered in a quiz of choices and user input, and a fresh quiz', () => {
		expect(allowedUiTypesFor([], null)).toContain('fill_blank')
		expect(
			allowedUiTypesFor([row('Choices'), row('User Input')], null)
		).toContain('fill_blank')
		expect(allowedUiTypesFor([row('Fill Blank')], null)).toEqual(
			expect.arrayContaining(['single', 'multiple', 'user_input', 'fill_blank'])
		)
	})

	it('keeps the Open Ended rule: it stays alone', () => {
		expect(allowedUiTypesFor([row('Open Ended')], null)).toEqual(['open_ended'])
		expect(allowedUiTypesFor([row('Fill Blank')], null)).not.toContain(
			'open_ended'
		)
		expect(nextQuestionUiType([row('Open Ended')])).toBe('open_ended')
		expect(nextQuestionUiType([row('Fill Blank')])).toBe('single')
	})

	it('puts Fill Blank among the bank types that may be added', () => {
		expect(allowedQuestionTypesFor([row('Choices')])).toContain('Fill Blank')
		expect(allowedQuestionTypesFor([row('Open Ended')])).toEqual(['Open Ended'])
	})
})

describe('isQuestionValid for fill_blank', () => {
	it('accepts a body whose tokens match valid blanks', () => {
		expect(isQuestionValid({ question: body, blanks }, 'fill_blank')).toBe(true)
	})

	it('needs content, a blank, an answer per blank and whole marks', () => {
		expect(isQuestionValid({ question: '', blanks }, 'fill_blank')).toBe(false)
		expect(
			isQuestionValid({ question: '<p>none</p>', blanks: [] }, 'fill_blank')
		).toBe(false)
		expect(
			isQuestionValid(
				{ question: body, blanks: [blanks[0], { ...blanks[1], answers: ' ' }] },
				'fill_blank'
			)
		).toBe(false)
		expect(
			isQuestionValid(
				{ question: body, blanks: [blanks[0], { ...blanks[1], marks: 0 }] },
				'fill_blank'
			)
		).toBe(false)
	})

	it('refuses tokens and rows that disagree', () => {
		expect(
			isQuestionValid({ question: body, blanks: [blanks[0]] }, 'fill_blank')
		).toBe(false)
		expect(
			isQuestionValid({ question: '<p>{{1}}</p>', blanks }, 'fill_blank')
		).toBe(false)
	})
})

describe('useQuestionDoc with blanks', () => {
	it('parses the API rows into the editor and sends them back as the payload', async () => {
		const { useQuestionDoc } = await import('@/composables/useQuestionDoc')
		const doc = useQuestionDoc()
		doc.applyDoc(
			{
				type: 'Fill Blank',
				question: body,
				marks: 3,
				blanks: [
					{
						name: 'r2',
						idx: 2,
						blank_id: '2',
						answers: 'ループ\nloop',
						marks: 2,
					},
					{ name: 'r1', idx: 1, blank_id: '1', answers: '圧縮機', marks: 1 },
				],
			},
			{ marks: 99 }
		)

		expect(doc.uiType.value).toBe('fill_blank')
		expect(doc.working.blanks).toEqual(blanks)
		expect(doc.working.marks).toBe(3)
		expect(doc.isValid.value).toBe(true)
		expect(doc.fields().blanks).toEqual(blanks)
		expect(doc.fieldsWithType()).toMatchObject({
			type: 'Fill Blank',
			multiple: 0,
			blanks,
		})
	})

	it('sends no blanks for a question of another type', async () => {
		const { useQuestionDoc } = await import('@/composables/useQuestionDoc')
		const doc = useQuestionDoc()
		expect(doc.fields()).not.toHaveProperty('blanks')
	})

	it('clears held rows when the type is switched away', async () => {
		const { useQuestionDoc } = await import('@/composables/useQuestionDoc')
		const doc = useQuestionDoc()
		doc.working.blanks = blanks.map((b) => ({ ...b }))
		doc.uiType.value = 'single'
		expect(doc.fieldsWithType().blanks).toEqual([])
	})
})
