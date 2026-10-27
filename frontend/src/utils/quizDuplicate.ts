import { call, toast } from 'frappe-ui'
import type { Router } from 'vue-router'
import { resourceErrorMessage } from '@/utils/resource'

// The server copies the saved quiz, never its submissions, and the copy opens
// in the form so it can be renamed straight away.
export const duplicateQuiz = async (
	quiz: string,
	router: Router
): Promise<void> => {
	try {
		const name: string = await call(
			'lms.lms.doctype.lms_quiz.lms_quiz.duplicate_quiz',
			{ quiz }
		)
		toast.success(__('Quiz duplicated'))
		await router.push({ name: 'QuizForm', params: { quizID: name } })
	} catch (error) {
		toast.error(resourceErrorMessage(error, __('Could not duplicate the quiz')))
	}
}
