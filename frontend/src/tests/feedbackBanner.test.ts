// Guards the correct/incorrect variants of the shared assessment verdict bar.
// Came with this branch's shared FeedbackBanner change.
// Added on feat/assessment-visual-redesign so quiz and exercise verdicts agree.
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import FeedbackBanner from '@/components/Assessment/FeedbackBanner.vue'

describe('FeedbackBanner', () => {
	it('renders the green/correct variant', () => {
		const wrapper = mount(FeedbackBanner, {
			props: { correct: true },
			slots: { default: 'Correct. Nice work.' },
		})
		expect(wrapper.classes().join(' ')).toContain('green')
		expect(wrapper.find('.lucide-check-circle').exists()).toBe(true)
		expect(wrapper.text()).toContain('Correct. Nice work.')
	})

	it('renders the red/incorrect variant', () => {
		const wrapper = mount(FeedbackBanner, {
			props: { correct: false },
			slots: { default: 'Not quite.' },
		})
		expect(wrapper.classes().join(' ')).toContain('red')
		expect(wrapper.find('.lucide-x-circle').exists()).toBe(true)
	})

	it('renders the amber/partial variant with its own icon', () => {
		const wrapper = mount(FeedbackBanner, {
			props: { correct: false, partial: true },
			slots: { default: 'Partly correct, 1 of 3 marks' },
		})
		expect(wrapper.classes().join(' ')).toContain('amber')
		expect(wrapper.classes().join(' ')).not.toContain('red')
		expect(wrapper.find('.lucide-contrast').exists()).toBe(true)
		expect(wrapper.find('.lucide-x-circle').exists()).toBe(false)
		expect(wrapper.get('.lucide-contrast').attributes('aria-hidden')).toBe(
			'true'
		)
	})

	it('lets correct win over partial', () => {
		const wrapper = mount(FeedbackBanner, {
			props: { correct: true, partial: true },
		})
		expect(wrapper.classes().join(' ')).toContain('green')
	})

	// Guards: a live role or exposed icon here doubles the quiz announcement.
	// Introduced in #2823; test added with the a11y audit remediation.
	it('stays presentational: no live role, icon hidden from assistive tech', () => {
		const wrapper = mount(FeedbackBanner, {
			props: { correct: true },
			slots: { default: 'Correct' },
		})
		expect(wrapper.attributes('role')).toBeUndefined()
		expect(wrapper.get('.lucide-check-circle').attributes('aria-hidden')).toBe(
			'true'
		)
	})
})
