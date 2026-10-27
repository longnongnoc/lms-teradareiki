// One submission read question by question, from
// lms.lms.quiz_results.get_submission_answers. The server leaves
// `correct_answer` out of a row unless this viewer may see it.
import { parseFillBlankAnswer } from '@/utils/fillBlank'
import { describeChoiceAnswer } from '@/utils/optionKey'

export const SUBMISSION_ANSWERS_METHOD =
	'lms.lms.quiz_results.get_submission_answers'

export interface SubmissionAnswerRow {
	name: string
	question_name: string
	question: string
	question_type: string
	answer: string | null
	marks: number
	marks_out_of: number
	// Fill Blank: { blank_id: accepted answers }. Open Ended: null.
	correct_answer?: string | Record<string, string[]> | null
}

export interface SubmissionAnswers {
	submission: string
	quiz: string
	member: string
	show_correct_answers: boolean
	questions: SubmissionAnswerRow[]
}

const imageLabel = (slot: number) => __('Image option {0}').format(slot)

const blankLine = (map: Record<string, string | string[]>): string =>
	Object.entries(map)
		.map(
			([id, value]) =>
				`[${id}] ${(Array.isArray(value) ? value.join(' / ') : value) || '-'}`
		)
		.join(', ')

// The learner's answer as one line of text. A Fill Blank answer is stored as a
// JSON map of blank to text, a Choices answer as option keys joined with ", ".
export const answerText = (row: SubmissionAnswerRow): string => {
	if (row.question_type === 'Fill Blank')
		return blankLine(parseFillBlankAnswer(row.answer))
	if (row.question_type === 'Choices')
		return describeChoiceAnswer(row.answer, imageLabel)
	return row.answer ?? ''
}

// The correct answer as one line of text, or '' when there is none to show.
export const correctAnswerText = (row: SubmissionAnswerRow): string => {
	const value = row.correct_answer
	if (!value) return ''
	if (typeof value === 'object') return blankLine(value)
	return row.question_type === 'Choices'
		? describeChoiceAnswer(value, imageLabel)
		: value
}
