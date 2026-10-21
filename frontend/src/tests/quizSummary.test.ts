import { describe, expect, it } from 'vitest'
import { joinSentences } from '@/utils/quizSummary'

describe('joinSentences', () => {
	it('keeps one space between English sentences', () => {
		expect(joinSentences('Deduct marks.', 'Blanks lose marks.')).toBe(
			'Deduct marks. Blanks lose marks.'
		)
	})

	it('adds no space after a Japanese full stop', () => {
		expect(joinSentences('不正解の場合は減点します。', '穴埋め問題は減点されます。')).toBe(
			'不正解の場合は減点します。穴埋め問題は減点されます。'
		)
	})

	it('adds no space after other full-width sentence ends', () => {
		expect(joinSentences('本当ですか？', 'はい')).toBe('本当ですか？はい')
		expect(joinSentences('注意！', '続き')).toBe('注意！続き')
	})

	it('skips empty parts', () => {
		expect(joinSentences('', 'One.', '', 'Two.')).toBe('One. Two.')
		expect(joinSentences('', '')).toBe('')
	})
})
