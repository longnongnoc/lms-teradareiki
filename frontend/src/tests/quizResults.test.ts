import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('__', (value: string) => value)

// `String.format` is supplied by Frappe in the browser runtime.
String.prototype.format = function (this: string, ...args: unknown[]) {
	return this.replace(/\{(\d+)\}/g, (_m: string, i: number) => String(args[i]))
}

import {
	buildResultsParams,
	clampPage,
	errorMessage,
	formatNumber,
	formatOutOf,
	formatPractical,
	formatResultDate,
	formatTest,
	formatTotal,
	isResultSummary,
	learnerStatusLabel,
	pageRange,
	pageStart,
	statusLabel,
	statusOptions,
	statusTheme,
	totalPages,
	validatePracticalScore,
} from '@/utils/quizResults'

describe('status mapping', () => {
	it('maps every status to its badge colour', () => {
		expect(statusTheme('Pass')).toBe('green')
		expect(statusTheme('Fail')).toBe('red')
		expect(statusTheme('Pending Practical')).toBe('amber')
		expect(statusTheme('Not Attempted')).toBe('gray')
		expect(statusTheme('anything else')).toBe('gray')
	})

	it('labels statuses for staff and for learners', () => {
		expect(statusLabel('Pending Practical')).toBe('Pending Practical')
		expect(learnerStatusLabel('Pending Practical')).toBe(
			'Waiting for practical score'
		)
		expect(learnerStatusLabel('Pass')).toBe('Pass')
		expect(learnerStatusLabel('Fail')).toBe('Fail')
		expect(learnerStatusLabel('Not Attempted')).toBeNull()
	})

	it('offers the three server filters after an all option', () => {
		expect(statusOptions().map((o) => o.value)).toEqual([
			'',
			'Pass',
			'Fail',
			'Pending Practical',
		])
	})
})

describe('formatting', () => {
	it('trims to two decimals without trailing zeros', () => {
		expect(formatNumber(8)).toBe('8')
		expect(formatNumber(7.5)).toBe('7.5')
		expect(formatNumber(7.256)).toBe('7.26')
		expect(formatNumber('3.10')).toBe('3.1')
		expect(formatNumber(null)).toBe('')
		expect(formatNumber('abc')).toBe('')
	})

	it('writes x of y and a dash for a missing score', () => {
		expect(formatOutOf(7, 10)).toBe('7 of 10')
		expect(formatOutOf(null, 10)).toBe('-')
		expect(formatOutOf(7, null)).toBe('7')
	})

	it('shows the practical column in each of its states', () => {
		expect(formatPractical({ practical_score: 4, practical_max: 5 })).toBe(
			'4 of 5'
		)
		expect(formatPractical({ practical_score: 0, practical_max: 5 })).toBe(
			'0 of 5'
		)
		expect(formatPractical({ practical_score: null, practical_max: 5 })).toBe(
			'Not entered'
		)
		expect(formatPractical({ practical_score: null, practical_max: 0 })).toBe(
			'-'
		)
	})

	it('shows no test score for a quiz not attempted', () => {
		expect(
			formatTest({
				test_score: null,
				test_out_of: 10,
				status: 'Not Attempted',
			})
		).toBe('-')
		expect(formatTest({ test_score: 6, test_out_of: 10, status: 'Fail' })).toBe(
			'6 of 10'
		)
	})

	it('shows no total while it is pending', () => {
		expect(formatTotal({ total_score: null, total_out_of: null })).toBe('-')
		expect(formatTotal({ total_score: 14, total_out_of: 15 })).toBe('14 of 15')
	})

	it('formats a Frappe timestamp and tolerates garbage', () => {
		expect(formatResultDate('2026-10-19 12:30:00.123456')).not.toBe('')
		expect(formatResultDate('nope')).toBe('')
		expect(formatResultDate(null)).toBe('')
	})
})

describe('validatePracticalScore', () => {
	it('accepts the bounds and two decimals', () => {
		expect(validatePracticalScore('0', 10)).toMatchObject({
			valid: true,
			value: 0,
		})
		expect(validatePracticalScore(10, 10)).toMatchObject({
			valid: true,
			value: 10,
		})
		expect(validatePracticalScore('7.25', 10)).toMatchObject({
			valid: true,
			value: 7.25,
		})
		expect(validatePracticalScore('7.50', 10).valid).toBe(true)
		expect(validatePracticalScore('7.500', 10).valid).toBe(true)
		expect(validatePracticalScore('.5', 10).valid).toBe(true)
	})

	it('rejects blank and non numeric input', () => {
		expect(validatePracticalScore('', 10).valid).toBe(false)
		expect(validatePracticalScore('   ', 10).valid).toBe(false)
		expect(validatePracticalScore(null, 10).valid).toBe(false)
		expect(validatePracticalScore('abc', 10)).toMatchObject({
			valid: false,
			error: 'Enter a valid number',
		})
		expect(validatePracticalScore('1e3', 10).valid).toBe(false)
	})

	it('rejects scores outside 0 to the maximum', () => {
		expect(validatePracticalScore('-1', 10)).toMatchObject({
			valid: false,
			error: 'Enter a score between 0 and 10',
		})
		expect(validatePracticalScore('10.01', 10).valid).toBe(false)
		expect(validatePracticalScore('1', 0).valid).toBe(false)
	})

	it('rejects more than two decimals', () => {
		expect(validatePracticalScore('1.234', 10)).toMatchObject({
			valid: false,
			error: 'Use at most 2 decimal places',
		})
	})
})

describe('query building and pagination', () => {
	it('omits blank filters and trims the rest', () => {
		expect(
			buildResultsParams({ quiz: '', search: '  ', status: '', page: 1 })
		).toEqual({ start: 0, page_length: 20 })
		expect(
			buildResultsParams({
				quiz: 'q-1',
				search: ' ann ',
				status: 'Pass',
				page: 3,
			})
		).toEqual({
			quiz: 'q-1',
			search: 'ann',
			status: 'Pass',
			start: 40,
			page_length: 20,
		})
	})

	it('tolerates null filters from a cleared control', () => {
		expect(
			buildResultsParams({
				quiz: null as unknown as string,
				status: null as unknown as string,
			})
		).toEqual({ start: 0, page_length: 20 })
	})

	it('honours a custom page length', () => {
		expect(buildResultsParams({ page: 2, pageLength: 5 })).toEqual({
			start: 5,
			page_length: 5,
		})
	})

	it('does the page arithmetic', () => {
		expect(pageStart(1, 20)).toBe(0)
		expect(pageStart(0, 20)).toBe(0)
		expect(pageStart(2, 20)).toBe(20)
		expect(totalPages(0, 20)).toBe(1)
		expect(totalPages(20, 20)).toBe(1)
		expect(totalPages(21, 20)).toBe(2)
		expect(clampPage(5, 21, 20)).toBe(2)
		expect(clampPage(0, 21, 20)).toBe(1)
		expect(clampPage(Number.NaN, 21, 20)).toBe(1)
		expect(pageRange(1, 0, 20)).toEqual({ from: 0, to: 0 })
		expect(pageRange(1, 45, 20)).toEqual({ from: 1, to: 20 })
		expect(pageRange(3, 45, 20)).toEqual({ from: 41, to: 45 })
	})
})

describe('errorMessage', () => {
	it('prefers the server message and strips markup', () => {
		expect(
			errorMessage({ messages: ['<div>Score must be <b>5</b> or less</div>'] })
		).toBe('Score must be 5 or less')
	})

	it('falls back to the client message, then a default', () => {
		expect(errorMessage({ message: 'Network down' })).toBe('Network down')
		expect(errorMessage(undefined, 'Nope')).toBe('Nope')
		expect(errorMessage({})).toBe('Something went wrong. Please try again.')
	})
})

describe('isResultSummary', () => {
	it('accepts an object with a status and nothing else', () => {
		expect(isResultSummary({ status: 'Pass' })).toBe(true)
		expect(isResultSummary(null)).toBe(false)
		expect(isResultSummary(undefined)).toBe(false)
		expect(isResultSummary({})).toBe(false)
		expect(isResultSummary('Pass')).toBe(false)
	})
})
