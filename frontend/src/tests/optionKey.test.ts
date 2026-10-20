// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
	describeChoiceAnswer,
	imageSlotFromKey,
	isOptionPresent,
	isReservedOptionText,
	keysForSlots,
	optionImageError,
	optionKey,
	presentOptionSlots,
	slotForKey,
} from '@/utils/optionKey'
import {
	blankOptionFields,
	hasRequiredCorrectOptions,
	hasRequiredOptions,
	isQuestionValid,
	optionProblems,
} from '@/utils/quizQuestion'

describe('optionKey', () => {
	it('is the trimmed text when there is some', () => {
		expect(optionKey('  four ', 2)).toBe('four')
		expect(optionKey('four', 2)).toBe('four')
	})

	it('is the slot key when the text is empty, blank or missing', () => {
		expect(optionKey('', 3)).toBe('[image:3]')
		expect(optionKey('   ', 1)).toBe('[image:1]')
		expect(optionKey(null, 10)).toBe('[image:10]')
		expect(optionKey(undefined, 4)).toBe('[image:4]')
	})

	it('reads the slot back off an image key only', () => {
		expect(imageSlotFromKey('[image:7]')).toBe(7)
		expect(imageSlotFromKey('four')).toBeNull()
		expect(imageSlotFromKey('see [image:7]')).toBeNull()
	})

	it('treats text or an image as a present option', () => {
		expect(isOptionPresent('a', '')).toBe(true)
		expect(isOptionPresent('', '/files/a.png')).toBe(true)
		expect(isOptionPresent('  ', null)).toBe(false)
		expect(isOptionPresent(null, undefined)).toBe(false)
	})

	it('flags exactly the reserved spelling', () => {
		expect(isReservedOptionText('[image:2]')).toBe(true)
		expect(isReservedOptionText(' [image:12] ')).toBe(true)
		expect(isReservedOptionText('[image:x]')).toBe(false)
		expect(isReservedOptionText('a [image:2]')).toBe(false)
	})
})

describe('mapping answers to slots', () => {
	const doc = {
		option_1: '',
		option_1_image: '/files/a.png',
		option_2: '  Beta ',
		option_3: '',
		option_3_image: '/files/c.png',
		option_4: '   ',
	}

	it('lists the present slots in order', () => {
		expect(presentOptionSlots(doc)).toEqual([1, 2, 3])
	})

	it('finds the slot of an image key, a text key and an older raw text answer', () => {
		expect(slotForKey(doc, '[image:3]')).toBe(3)
		expect(slotForKey(doc, 'Beta')).toBe(2)
		expect(slotForKey(doc, '  Beta ')).toBe(2)
		expect(slotForKey(doc, '[image:4]')).toBe(0)
		expect(slotForKey(doc, 'Gamma')).toBe(0)
		expect(slotForKey(doc, null)).toBe(0)
	})

	it('builds the keys for chosen slots, skipping a slot with nothing in it', () => {
		expect(keysForSlots(doc, [1, 2, 3, 4])).toEqual([
			'[image:1]',
			'Beta',
			'[image:3]',
		])
	})

	it('describes a stored choice answer with a label for image keys only', () => {
		const label = (slot: number) => `Image option ${slot}`
		expect(describeChoiceAnswer('[image:2], Beta, [image:5]', label)).toBe(
			'Image option 2, Beta, Image option 5'
		)
		expect(describeChoiceAnswer('four', label)).toBe('four')
		expect(describeChoiceAnswer(null, label)).toBe('')
	})
})

describe('optionImageError', () => {
	const message = { type: 'bad type', size: 'too big' }
	const FIVE_MB = 5 * 1024 * 1024

	it('accepts jpeg, png and webp up to 5 MB', () => {
		for (const type of ['image/jpeg', 'image/png', 'image/webp'])
			expect(optionImageError({ type, size: FIVE_MB }, message)).toBe('')
	})

	it('rejects another type and anything over 5 MB', () => {
		expect(optionImageError({ type: 'image/gif', size: 10 }, message)).toBe(
			'bad type'
		)
		expect(optionImageError({ type: 'image/svg+xml', size: 10 }, message)).toBe(
			'bad type'
		)
		expect(
			optionImageError({ type: 'image/png', size: FIVE_MB + 1 }, message)
		).toBe('too big')
	})
})

describe('option validity with images', () => {
	const choices = (over: Record<string, unknown> = {}) => ({
		question: '<p>Which?</p>',
		...blankOptionFields(),
		option_1: 'one',
		option_2: 'two',
		is_correct_1: 1,
		...over,
	})

	it('counts an image as a present option, wherever it sits', () => {
		expect(
			hasRequiredOptions(choices({ option_2: '', option_2_image: '/f/a.png' }))
		).toBe(true)
		expect(hasRequiredOptions(choices({ option_2: '  ' }))).toBe(false)
		expect(
			hasRequiredOptions(
				choices({
					option_1: '',
					option_2: '',
					option_3: 'c',
					option_4_image: '/f/d.png',
				})
			)
		).toBe(true)
	})

	it('accepts a question whose options are all images', () => {
		const q = choices({
			option_1: '',
			option_1_image: '/f/a.png',
			option_2: '',
			option_2_image: '/f/b.png',
		})
		expect(isQuestionValid(q, 'single')).toBe(true)
	})

	it('needs a correct flag, and two for a multiple choice', () => {
		expect(
			hasRequiredCorrectOptions(choices({ is_correct_1: 0 }), 'single')
		).toBe(false)
		expect(isQuestionValid(choices(), 'multiple')).toBe(false)
		expect(isQuestionValid(choices({ is_correct_2: 1 }), 'multiple')).toBe(true)
	})

	it('refuses a correct flag on an option with neither text nor image', () => {
		const q = choices({ is_correct_3: 1 })
		expect(optionProblems(q).emptyCorrect).toEqual([3])
		expect(isQuestionValid(q, 'single')).toBe(false)
		expect(
			isQuestionValid({ ...q, option_3_image: '/f/c.png' }, 'single')
		).toBe(true)
	})

	it('does not count a flag on an empty option toward the correct answers', () => {
		const q = choices({ is_correct_1: 0, is_correct_3: 1 })
		expect(hasRequiredCorrectOptions(q, 'single')).toBe(false)
	})

	it('refuses two options with the same text and image', () => {
		const same = choices({ option_2: 'one' })
		expect(optionProblems(same).duplicates).toEqual([2])
		expect(isQuestionValid(same, 'single')).toBe(false)
		expect(
			optionProblems(
				choices({
					option_1: 'one',
					option_1_image: '/f/a.png',
					option_2: ' one ',
					option_2_image: '/f/a.png',
				})
			).duplicates
		).toEqual([2])
	})

	it('allows the same text with another image, or the same image with other text', () => {
		expect(
			optionProblems(
				choices({
					option_1_image: '/f/a.png',
					option_2: 'one',
					option_2_image: '/f/b.png',
				})
			).duplicates
		).toEqual([])
		expect(
			optionProblems(
				choices({
					option_1: 'one',
					option_1_image: '/f/a.png',
					option_2: 'two',
					option_2_image: '/f/a.png',
				})
			).duplicates
		).toEqual([])
	})

	it('refuses text that spells an image key', () => {
		const q = choices({ option_2: '[image:2]' })
		expect(optionProblems(q).reserved).toEqual([2])
		expect(isQuestionValid(q, 'single')).toBe(false)
	})

	it('leaves other question types alone', () => {
		expect(
			isQuestionValid(
				{ question: '<p>Q</p>', possibility_1: 'x' },
				'user_input'
			)
		).toBe(true)
	})
})
