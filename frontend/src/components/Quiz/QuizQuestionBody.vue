<template>
	<div
		ref="host"
		v-bind="$attrs"
		@click="onHostClick"
		@keydown="onHostKeydown"
	></div>
	<Teleport v-for="entry in slots" :key="entry.key" :to="entry.el">
		<span
			v-if="review"
			data-testid="blank-result"
			:data-blank-id="entry.id"
			class="inline-flex flex-wrap items-center gap-x-1.5 rounded-4 border px-1.5 py-0.5 align-middle text-base font-normal text-ink-gray-9"
			:class="
				resultFor(entry.id)?.is_correct
					? 'border-outline-green-3 bg-surface-green-1'
					: 'border-outline-red-3 bg-surface-red-1'
			"
		>
			<span
				:class="
					resultFor(entry.id)?.is_correct
						? 'lucide-check-circle text-ink-green-4'
						: 'lucide-x-circle text-ink-red-5'
				"
				class="size-4 shrink-0"
				aria-hidden="true"
			/>
			<span class="sr-only">
				{{
					resultFor(entry.id)?.is_correct
						? __('Your answer, correct')
						: __('Your answer, incorrect')
				}}
			</span>
			<span v-if="answerFor(entry.id).trim()" class="break-words">
				{{ answerFor(entry.id) }}
			</span>
			<span v-else class="italic text-ink-gray-6">{{ __('No answer') }}</span>
			<span
				v-if="resultFor(entry.id)"
				class="text-sm tabular-nums text-ink-gray-6"
			>
				({{
					__('{0} of {1}').format(
						resultFor(entry.id)?.marks,
						resultFor(entry.id)?.marks_out_of
					)
				}})
			</span>
			<span
				v-if="
					!resultFor(entry.id)?.is_correct &&
					resultFor(entry.id)?.accepted?.length
				"
				class="text-sm text-ink-gray-7"
			>
				{{ __('Accepted answers') }}:
				{{ resultFor(entry.id)?.accepted?.join(' / ') }}
			</span>
		</span>
		<input
			v-else
			type="text"
			data-blank-input
			class="h-7 w-36 max-w-full rounded-4 border border-outline-gray-3 bg-surface-base px-2 align-middle text-base font-normal text-ink-gray-9 placeholder:text-ink-gray-4 focus:border-outline-gray-5 focus:ring-0 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			:aria-label="__('Blank {0}').format(entry.id)"
			:disabled="disabled"
			:value="answerFor(entry.id)"
			@input="onInput(entry.id, $event)"
			@compositionstart="onCompositionStart"
			@compositionend="onCompositionEnd(entry.id, $event)"
			@keydown.enter="onEnter($event)"
		/>
	</Teleport>
	<ImageZoomOverlay
		v-if="zoom"
		:url="zoom.url"
		:alt="zoom.alt"
		@close="closeZoom"
	/>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { sanitizeAtFragment } from '@/directives/safeHtmlLevels'
import { splitBlankTokens } from '@/utils/fillBlank'
import type { BlankResult } from '@/utils/fillBlank'
import ImageZoomOverlay from '@/components/Quiz/ImageZoomOverlay.vue'

// The question body, sanitized once as DOM nodes. For a Fill Blank question each
// {{id}} token in a text node becomes an empty placeholder span, and a Vue input
// (or, in review, a result chip) is teleported into it. The sanitizer is not
// widened: an <input> never appears in the markup it sees, and the placeholders
// are made after it ran, with createElement and setAttribute, not by markup.
// Images in the body open an enlarged view on click, Enter or Space.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
	defineProps<{
		html?: string | null
		fillBlank?: boolean
		review?: boolean
		disabled?: boolean
		answers?: Record<string, string>
		results?: Record<string, BlankResult> | null
	}>(),
	{
		html: '',
		fillBlank: false,
		review: false,
		disabled: false,
		answers: () => ({}),
		results: null,
	}
)
const emit = defineEmits<{ 'update:blank': [id: string, value: string] }>()

type Slot = { key: string; id: string; el: HTMLElement }

const host = ref<HTMLElement | null>(null)
const slots = shallowRef<Slot[]>([])
const zoom = ref<{ url: string; alt: string } | null>(null)

const answerFor = (id: string): string =>
	props.answers?.[id] ?? props.results?.[id]?.answer ?? ''
const resultFor = (id: string): BlankResult | undefined => props.results?.[id]

const replaceTokens = (fragment: DocumentFragment): Slot[] => {
	const doc = fragment.ownerDocument
	const walker = doc.createTreeWalker(fragment, NodeFilter.SHOW_TEXT)
	const texts: Text[] = []
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.nodeValue?.includes('{{')) texts.push(node as Text)
	}
	const found: Slot[] = []
	for (const text of texts) {
		const parts = splitBlankTokens(text.nodeValue ?? '')
		if (!parts.some((part) => part.type === 'blank')) continue
		const nodes = parts.map((part) => {
			if (part.type === 'text') return doc.createTextNode(part.value)
			const el = doc.createElement('span')
			el.setAttribute('data-blank-slot', part.id)
			el.className = 'mx-0.5 inline-block max-w-full'
			found.push({ key: `${found.length}-${part.id}`, id: part.id, el })
			return el
		})
		text.replaceWith(...nodes)
	}
	return found
}

const makeImagesReachable = (fragment: DocumentFragment): void => {
	for (const img of Array.from(fragment.querySelectorAll('img'))) {
		if (img.closest('a')) continue
		const alt = img.getAttribute('alt') ?? ''
		img.setAttribute('tabindex', '0')
		img.setAttribute('role', 'button')
		img.setAttribute(
			'aria-label',
			alt ? __('Enlarge image: {0}').format(alt) : __('Enlarge image')
		)
		img.classList.add('cursor-zoom-in')
	}
}

const render = (): void => {
	const root = host.value
	if (!root) return
	const fragment = sanitizeAtFragment('rich', props.html)
	const found = props.fillBlank ? replaceTokens(fragment) : []
	makeImagesReachable(fragment)
	root.replaceChildren(fragment)
	slots.value = found
}

onMounted(render)
watch(() => [props.html, props.fillBlank], render, { flush: 'post' })

const openZoom = (img: HTMLImageElement): void => {
	const src = img.currentSrc || img.getAttribute('src')
	if (!src) return
	zoom.value = { url: src, alt: img.getAttribute('alt') ?? '' }
}

const closeZoom = (): void => {
	zoom.value = null
}

const imageFrom = (event: Event): HTMLImageElement | null => {
	const target = event.target
	if (!(target instanceof Element)) return null
	const img = target.closest('img')
	return img && host.value?.contains(img) && !img.closest('a') ? img : null
}

const onHostClick = (event: MouseEvent): void => {
	const img = imageFrom(event)
	if (img) openZoom(img)
}

const onHostKeydown = (event: KeyboardEvent): void => {
	if (event.isComposing || (event.key !== 'Enter' && event.key !== ' ')) return
	const img = imageFrom(event)
	if (!img) return
	event.preventDefault()
	openZoom(img)
}

// Vue's own v-model holds back updates while an IME composes; the same here, so
// a half-converted Japanese word is never stored as the answer.
type Composing = HTMLInputElement & { composing?: boolean }

const onInput = (id: string, event: Event): void => {
	const input = event.target as Composing
	if (input.composing) return
	emit('update:blank', id, input.value)
}

const onCompositionStart = (event: Event): void => {
	;(event.target as Composing).composing = true
}

const onCompositionEnd = (id: string, event: Event): void => {
	const input = event.target as Composing
	input.composing = false
	emit('update:blank', id, input.value)
}

// Enter moves to the next blank. Never while an IME is composing: that Enter
// confirms the conversion, and keyCode 229 covers browsers that report it
// after compositionend.
const onEnter = (event: KeyboardEvent): void => {
	if (event.isComposing || event.keyCode === 229) return
	event.preventDefault()
	const inputs = Array.from(
		host.value?.querySelectorAll<HTMLInputElement>('input[data-blank-input]') ??
			[]
	)
	const next = inputs[inputs.indexOf(event.target as HTMLInputElement) + 1]
	nextTick(() => next?.focus())
}
</script>
