<template>
	<Teleport to="body">
		<div
			class="fixed inset-0 z-[60] flex items-center justify-center bg-black-overlay-700 p-4"
			role="dialog"
			aria-modal="true"
			data-testid="image-zoom"
			:aria-label="__('Enlarged image')"
			@click="emit('close')"
		>
			<button
				ref="closeButton"
				type="button"
				class="absolute end-4 top-4 flex size-8 items-center justify-center rounded-full bg-surface-base text-ink-gray-9 shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
				:aria-label="__('Close')"
				@click.stop="emit('close')"
				@keydown.tab.prevent
			>
				<span class="lucide-x size-4" aria-hidden="true" />
			</button>
			<img
				:src="safeUrl(url)"
				:alt="alt"
				class="max-h-full max-w-full cursor-zoom-out object-contain"
			/>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { safeUrl } from '@/utils/safeUrl'

defineProps<{ url: string; alt?: string }>()
const emit = defineEmits<{ close: [] }>()

const closeButton = ref<HTMLButtonElement | null>(null)
// Where focus was when the overlay opened, so closing hands it back.
let opener: HTMLElement | null = null

// Capture phase, so Escape closes the overlay and goes no further: a dialog or
// the quiz page underneath must not also act on it.
const onKeydown = (event: KeyboardEvent): void => {
	if (event.key !== 'Escape') return
	event.stopPropagation()
	event.preventDefault()
	emit('close')
}

onMounted(() => {
	opener = document.activeElement as HTMLElement | null
	document.addEventListener('keydown', onKeydown, true)
	closeButton.value?.focus()
})

onBeforeUnmount(() => {
	document.removeEventListener('keydown', onKeydown, true)
	if (opener && document.contains(opener)) opener.focus()
})
</script>
