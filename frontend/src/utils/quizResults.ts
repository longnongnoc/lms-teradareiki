// Pure helpers for the quiz result pages: the admin results table, its detail
// panel and the learner's result summary. They mirror the rules of
// lms.lms.quiz_results so the UI never offers what the server would refuse.

export type ResultStatus =
	'Not Attempted' | 'Pending Practical' | 'Pass' | 'Fail'

export type BadgeTheme = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet'

export interface ResultAttempt {
	name: string
	attempt_no: number
	score: number
	score_out_of: number
	percentage: number
	creation: string
	is_counting: boolean | number
}

export interface ResultSummary {
	quiz: string
	member: string
	passing_percentage: number
	attempts_count: number
	counting_attempt: string | null
	test_score: number | null
	test_out_of: number | null
	practical_score: number | null
	practical_max: number
	practical_note?: string | null
	practical_scored_by?: string | null
	practical_scored_on?: string | null
	total_score: number | null
	total_out_of: number | null
	percentage: number | null
	status: ResultStatus
	attempts?: ResultAttempt[]
}

export interface ResultRow extends Omit<ResultSummary, 'quiz' | 'member'> {
	quiz: { name: string; title: string }
	member: {
		name: string
		full_name: string
		email: string
		user_image?: string | null
	}
}

export interface ResultsPage {
	rows: ResultRow[]
	total: number
	truncated: boolean
}

export const RESULTS_PAGE_LENGTH = 20
export const SEARCH_DEBOUNCE_MS = 300
export const TRUNCATION_LIMIT = 2000

export const SUMMARY_METHOD = 'lms.lms.quiz_results.get_quiz_result_summary'
export const RESULTS_METHOD = 'lms.lms.quiz_results.get_quiz_results'
export const SET_PRACTICAL_METHOD = 'lms.lms.quiz_results.set_practical_score'
export const DELETE_PRACTICAL_METHOD =
	'lms.lms.quiz_results.delete_practical_score'

export const statusTheme = (status: ResultStatus | string): BadgeTheme => {
	switch (status) {
		case 'Pass':
			return 'green'
		case 'Fail':
			return 'red'
		case 'Pending Practical':
			return 'amber'
		default:
			return 'gray'
	}
}

export const statusLabel = (status: ResultStatus | string): string => {
	switch (status) {
		case 'Pass':
			return __('Pass')
		case 'Fail':
			return __('Fail')
		case 'Pending Practical':
			return __('Pending Practical')
		default:
			return __('Not Attempted')
	}
}

// What a learner reads: a pending practical is a wait, not a state of theirs.
export const learnerStatusLabel = (
	status: ResultStatus | string
): string | null => {
	switch (status) {
		case 'Pass':
			return __('Pass')
		case 'Fail':
			return __('Fail')
		case 'Pending Practical':
			return __('Waiting for practical score')
		default:
			return null
	}
}

export const statusOptions = (): { label: string; value: string }[] => [
	{ label: __('All statuses'), value: '' },
	{ label: statusLabel('Pass'), value: 'Pass' },
	{ label: statusLabel('Fail'), value: 'Fail' },
	{ label: statusLabel('Pending Practical'), value: 'Pending Practical' },
]

// Up to two decimals, no trailing zeros: 7.5, 8, 7.25.
export const formatNumber = (value: number | string | null | undefined) => {
	if (value === null || value === undefined || value === '') return ''
	const num = Number(value)
	if (!Number.isFinite(num)) return ''
	return String(Math.round(num * 100) / 100)
}

export const formatPercentage = (value: number | null | undefined): string => {
	const text = formatNumber(value)
	return text === '' ? '' : `${text}%`
}

export const formatOutOf = (
	score: number | null | undefined,
	outOf: number | null | undefined
): string => {
	const left = formatNumber(score)
	if (left === '') return '-'
	const right = formatNumber(outOf)
	return right === '' ? left : __('{0} of {1}').format(left, right)
}

type Practical = Pick<ResultSummary, 'practical_score' | 'practical_max'>

export const hasPractical = (summary: Pick<Practical, 'practical_max'>) =>
	Number(summary.practical_max) > 0

export const formatTest = (
	summary: Pick<ResultSummary, 'test_score' | 'test_out_of' | 'status'>
): string =>
	summary.status === 'Not Attempted'
		? '-'
		: formatOutOf(summary.test_score, summary.test_out_of)

export const formatPractical = (summary: Practical): string => {
	if (!hasPractical(summary)) return '-'
	if (summary.practical_score === null || summary.practical_score === undefined)
		return __('Not entered')
	return formatOutOf(summary.practical_score, summary.practical_max)
}

export const formatTotal = (
	summary: Pick<ResultSummary, 'total_score' | 'total_out_of'>
): string => formatOutOf(summary.total_score, summary.total_out_of)

// Frappe sends "YYYY-MM-DD HH:MM:SS.ffffff"; the T keeps Safari parsing it.
export const formatResultDate = (value: string | null | undefined): string => {
	if (!value) return ''
	const date = new Date(String(value).replace(' ', 'T'))
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}

export const isResultSummary = (value: unknown): value is ResultSummary =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as { status?: unknown }).status === 'string'

export type PracticalValidation =
	| { valid: true; value: number; error: '' }
	| { valid: false; value: null; error: string }

const invalid = (error: string): PracticalValidation => ({
	valid: false,
	value: null,
	error,
})

// Same limits as set_practical_score: 0..max inclusive, two decimals at most.
export const validatePracticalScore = (
	input: string | number | null | undefined,
	max: number
): PracticalValidation => {
	const text = input === null || input === undefined ? '' : String(input).trim()
	if (text === '') return invalid(__('Enter a score'))
	if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) {
		return invalid(__('Enter a valid number'))
	}
	const fraction = text.split('.')[1] ?? ''
	if (fraction.replace(/0+$/, '').length > 2) {
		return invalid(__('Use at most 2 decimal places'))
	}
	const value = Number(text)
	if (value < 0 || value > max) {
		return invalid(
			__('Enter a score between 0 and {0}').format(formatNumber(max))
		)
	}
	return { valid: true, value, error: '' }
}

export interface ResultsQuery {
	quiz?: string
	search?: string
	status?: string
	page?: number
	pageLength?: number
}

export interface ResultsParams {
	quiz?: string
	search?: string
	status?: string
	start: number
	page_length: number
}

export const pageStart = (page: number, pageLength: number): number =>
	Math.max(Math.floor(page) - 1, 0) * pageLength

export const totalPages = (total: number, pageLength: number): number =>
	Math.max(Math.ceil(Math.max(total, 0) / pageLength), 1)

export const clampPage = (
	page: number,
	total: number,
	pageLength: number
): number =>
	Math.min(Math.max(Math.floor(page) || 1, 1), totalPages(total, pageLength))

// 1-based, inclusive; both 0 when there is nothing to show.
export const pageRange = (
	page: number,
	total: number,
	pageLength: number
): { from: number; to: number } => {
	if (total <= 0) return { from: 0, to: 0 }
	const from = pageStart(page, pageLength) + 1
	return { from, to: Math.min(from + pageLength - 1, total) }
}

// Empty filters are left out rather than sent blank, so the server never
// reads "" as a value to match.
export const buildResultsParams = (query: ResultsQuery): ResultsParams => {
	const pageLength = query.pageLength || RESULTS_PAGE_LENGTH
	const params: ResultsParams = {
		start: pageStart(query.page ?? 1, pageLength),
		page_length: pageLength,
	}
	const quiz = query.quiz?.trim()
	const search = query.search?.trim()
	const status = query.status?.trim()
	if (quiz) params.quiz = quiz
	if (search) params.search = search
	if (status) params.status = status
	return params
}

interface ServerError {
	messages?: unknown[]
	message?: string
	exc_type?: string
}

// Frappe keeps the readable half of a server error in `messages`; `message`
// carries a network or client failure. The messages can be HTML or JSON, so
// markup is stripped before it is shown in a toast.
export const errorMessage = (error: unknown, fallback?: string): string => {
	const err = (error ?? {}) as ServerError
	const first = err.messages?.[0]
	const raw =
		(typeof first === 'string' && first) ||
		(typeof err.message === 'string' && err.message) ||
		(typeof error === 'string' && error) ||
		''
	const text = raw
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
	return text || fallback || __('Something went wrong. Please try again.')
}

export const isCountingAttempt = (
	attempt: Pick<ResultAttempt, 'is_counting'>
) => Boolean(attempt.is_counting)
