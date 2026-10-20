import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QuizQuestionBody from '@/components/Quiz/QuizQuestionBody.vue'

String.prototype.format = function (...args: unknown[]) {
	return this.replace(/\{(\d+)\}/g, (_match: string, index: number) =>
		String(args[index])
	)
}

const mountBody = async (props: Record<string, unknown>) => {
	const wrapper = mount(QuizQuestionBody, {
		props,
		attachTo: document.body,
		global: { mocks: { __: (s: string) => s } },
	})
	await flushPromises()
	return wrapper
}

const TABLE =
	'<table><tbody><tr><td>Part</td><td>Name</td></tr>' +
	'<tr><td>A</td><td>[[1]]</td></tr><tr><td>B</td><td>[[2]]</td></tr></tbody></table>'

describe('QuizQuestionBody tokens', () => {
	it('puts a labelled input where each token is, in paragraphs and table cells', async () => {
		const wrapper = await mountBody({
			html: `<p>The [[1]] compresses.</p>${TABLE}`,
			fillBlank: true,
		})

		const inputs = wrapper.findAll('input')
		expect(inputs).toHaveLength(3)
		expect(inputs.map((i) => i.attributes('aria-label'))).toEqual([
			'Blank 1',
			'Blank 1',
			'Blank 2',
		])
		expect(wrapper.text()).not.toContain('[[')
		expect(wrapper.find('p').text()).toContain('The')
		expect(wrapper.find('p input').exists()).toBe(true)
		expect(wrapper.find('td input').exists()).toBe(true)
		wrapper.unmount()
	})

	it('only treats [[n]] with ASCII digits as a blank', async () => {
		const wrapper = await mountBody({
			html: '<p>{{1}} [[a]] [[１]] [[ 1 ]] [[2]]</p>',
			fillBlank: true,
		})
		expect(wrapper.findAll('input')).toHaveLength(1)
		expect(wrapper.text()).toContain('{{1}} [[a]] [[１]] [[ 1 ]]')
		wrapper.unmount()
	})

	it('leaves tokens alone for any other question type', async () => {
		const wrapper = await mountBody({ html: '<p>[[1]]</p>' })
		expect(wrapper.findAll('input')).toHaveLength(0)
		expect(wrapper.text()).toContain('[[1]]')
		wrapper.unmount()
	})

	it('does not let the author put a control of their own in', async () => {
		const wrapper = await mountBody({
			html: '<p>[[1]]<input name="evil"><button>x</button><img src="x" onerror="window.__pwned = 1"></p>',
			fillBlank: true,
		})
		expect(wrapper.findAll('input')).toHaveLength(1)
		expect(wrapper.find('input[name="evil"]').exists()).toBe(false)
		expect(wrapper.find('button').exists()).toBe(false)
		expect(wrapper.find('img').attributes('onerror')).toBeUndefined()
		wrapper.unmount()
	})

	it('does not turn a token inside an attribute into a control', async () => {
		const wrapper = await mountBody({
			html: '<p><img src="/files/a.png" alt="[[1]]"> [[2]]</p>',
			fillBlank: true,
		})
		expect(wrapper.findAll('input')).toHaveLength(1)
		expect(wrapper.find('input').attributes('aria-label')).toBe('Blank 2')
		expect(wrapper.find('img').attributes('alt')).toBe('[[1]]')
		wrapper.unmount()
	})

	it('shows typed text and reports each change with its blank id', async () => {
		const wrapper = await mountBody({
			html: '<p>[[1]] and [[2]]</p>',
			fillBlank: true,
			answers: { '1': '圧縮機' },
		})
		const [first, second] = wrapper.findAll('input')
		expect((first.element as HTMLInputElement).value).toBe('圧縮機')
		expect((second.element as HTMLInputElement).value).toBe('')

		await second.setValue('ループ')
		expect(wrapper.emitted('update:blank')).toEqual([['2', 'ループ']])
		wrapper.unmount()
	})

	it('disables the inputs once the question is checked', async () => {
		const wrapper = await mountBody({
			html: '<p>[[1]]</p>',
			fillBlank: true,
			disabled: true,
		})
		expect(wrapper.find('input').attributes('disabled')).toBeDefined()
		wrapper.unmount()
	})

	it('redraws when the body changes', async () => {
		const wrapper = await mountBody({ html: '<p>[[1]]</p>', fillBlank: true })
		await wrapper.setProps({ html: '<p>[[1]] [[2]]</p>' })
		await flushPromises()
		expect(wrapper.findAll('input')).toHaveLength(2)
		wrapper.unmount()
	})
})

describe('QuizQuestionBody and Japanese IME', () => {
	const press = (input: HTMLInputElement, init: KeyboardEventInit) => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter',
			bubbles: true,
			cancelable: true,
			...init,
		})
		input.dispatchEvent(event)
		return event
	}

	it('moves to the next blank on Enter, but not while composing', async () => {
		const wrapper = await mountBody({
			html: '<p>[[1]] [[2]]</p>',
			fillBlank: true,
		})
		const [first, second] = wrapper.findAll('input')
		const firstEl = first.element as HTMLInputElement
		firstEl.focus()

		const composing = press(firstEl, { isComposing: true })
		await flushPromises()
		expect(composing.defaultPrevented).toBe(false)
		expect(document.activeElement).toBe(firstEl)

		const afterIme = press(firstEl, { keyCode: 229 })
		await flushPromises()
		expect(afterIme.defaultPrevented).toBe(false)
		expect(document.activeElement).toBe(firstEl)

		const plain = press(firstEl, {})
		await flushPromises()
		expect(plain.defaultPrevented).toBe(true)
		expect(document.activeElement).toBe(second.element)
		wrapper.unmount()
	})

	it('stores the converted text, not the half-typed one', async () => {
		const wrapper = await mountBody({ html: '<p>[[1]]</p>', fillBlank: true })
		const input = wrapper.find('input')
		const el = input.element as HTMLInputElement

		await input.trigger('compositionstart')
		el.value = 'あつ'
		await input.trigger('input')
		expect(wrapper.emitted('update:blank')).toBeUndefined()

		el.value = '圧縮機'
		await input.trigger('compositionend')
		expect(wrapper.emitted('update:blank')).toEqual([['1', '圧縮機']])
		wrapper.unmount()
	})
})

describe('QuizQuestionBody review', () => {
	const results = {
		'1': {
			blank_id: '1',
			answer: '圧縮機',
			is_correct: true,
			marks: 2,
			marks_out_of: 2,
		},
		'2': {
			blank_id: '2',
			answer: 'ポンプ',
			is_correct: false,
			marks: 0,
			marks_out_of: 1,
			accepted: ['凝縮器', 'condenser'],
		},
	}

	it('fills each blank with the answer and marks it right or wrong, with its marks', async () => {
		const wrapper = await mountBody({
			html: '<p>[[1]] / [[2]]</p>',
			fillBlank: true,
			review: true,
			results,
		})
		expect(wrapper.findAll('input')).toHaveLength(0)
		const chips = wrapper.findAll('[data-testid="blank-result"]')
		expect(chips).toHaveLength(2)
		expect(chips[0].text()).toContain('圧縮機')
		expect(chips[0].text()).toContain('Your answer, correct')
		expect(chips[0].text()).toContain('2 of 2')
		expect(chips[1].text()).toContain('ポンプ')
		expect(chips[1].text()).toContain('Your answer, incorrect')
		expect(chips[1].text()).toContain('0 of 1')
		wrapper.unmount()
	})

	it('shows accepted answers for an incorrect blank only', async () => {
		const wrapper = await mountBody({
			html: '<p>[[1]] / [[2]]</p>',
			fillBlank: true,
			review: true,
			results: {
				...results,
				'1': { ...results['1'], accepted: ['圧縮機'] },
			},
		})
		const chips = wrapper.findAll('[data-testid="blank-result"]')
		expect(chips[0].text()).not.toContain('Accepted answers')
		expect(chips[1].text()).toContain('Accepted answers: 凝縮器 / condenser')
		wrapper.unmount()
	})

	it('keeps the verdict when the server withheld the answer key', async () => {
		const { accepted: _hidden, ...hidden } = results['2']
		const wrapper = await mountBody({
			html: '<p>[[2]]</p>',
			fillBlank: true,
			review: true,
			results: { '2': hidden },
		})
		const chip = wrapper.get('[data-testid="blank-result"]')
		expect(chip.text()).toContain('Your answer, incorrect')
		expect(chip.text()).not.toContain('Accepted answers')
		wrapper.unmount()
	})

	it('escapes what the learner typed', async () => {
		const wrapper = await mountBody({
			html: '<p>[[1]]</p>',
			fillBlank: true,
			review: true,
			results: {
				'1': { ...results['2'], answer: '<img src=x onerror=alert(1)>' },
			},
		})
		expect(wrapper.find('[data-testid="blank-result"] img').exists()).toBe(
			false
		)
		expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
		wrapper.unmount()
	})

	it('says so when a blank was left empty', async () => {
		const wrapper = await mountBody({
			html: '<p>[[2]]</p>',
			fillBlank: true,
			review: true,
			results: { '2': { ...results['2'], answer: '' } },
		})
		expect(wrapper.text()).toContain('No answer')
		wrapper.unmount()
	})
})

describe('QuizQuestionBody image zoom', () => {
	const html = '<p>[[1]]<img src="/files/diagram.png" alt="Cycle diagram"></p>'

	it('opens the full-size image on click and closes it on click', async () => {
		const wrapper = await mountBody({ html, fillBlank: true })
		const img = wrapper.get('img')
		expect(img.attributes('role')).toBe('button')
		expect(img.attributes('tabindex')).toBe('0')
		expect(img.attributes('aria-label')).toBe('Enlarge image: Cycle diagram')

		await img.trigger('click')
		const overlay = document.body.querySelector('[data-testid="image-zoom"]')
		expect(overlay).not.toBeNull()
		expect(overlay?.getAttribute('role')).toBe('dialog')
		expect(overlay?.getAttribute('aria-modal')).toBe('true')
		expect(overlay?.querySelector('img')?.getAttribute('src')).toBe(
			'/files/diagram.png'
		)
		;(overlay as HTMLElement).click()
		await flushPromises()
		expect(document.body.querySelector('[data-testid="image-zoom"]')).toBeNull()
		wrapper.unmount()
	})

	it('closes on Escape and hands focus back to the image', async () => {
		const wrapper = await mountBody({ html })
		const img = wrapper.get('img').element as HTMLImageElement
		img.focus()
		img.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
		)
		await flushPromises()
		const overlay = document.body.querySelector('[data-testid="image-zoom"]')
		expect(overlay).not.toBeNull()
		expect(document.activeElement).toBe(overlay?.querySelector('button'))

		document.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
		)
		await flushPromises()
		expect(document.body.querySelector('[data-testid="image-zoom"]')).toBeNull()
		expect(document.activeElement).toBe(img)
		wrapper.unmount()
	})

	it('does not open for a click on a blank input', async () => {
		const wrapper = await mountBody({ html, fillBlank: true })
		await wrapper.get('input').trigger('click')
		expect(document.body.querySelector('[data-testid="image-zoom"]')).toBeNull()
		await wrapper.get('input').setValue('x')
		expect(wrapper.emitted('update:blank')).toEqual([['1', 'x']])
		wrapper.unmount()
	})

	it('works in review mode and for questions that are not fill in the blank', async () => {
		const wrapper = await mountBody({ html: '<p><img src="/files/a.png"></p>' })
		await wrapper.get('img').trigger('click')
		expect(
			document.body.querySelector('[data-testid="image-zoom"]')
		).not.toBeNull()
		wrapper.unmount()
	})
})
