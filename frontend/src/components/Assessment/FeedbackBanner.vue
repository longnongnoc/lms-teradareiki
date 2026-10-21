<template>
	<div
		class="flex items-start gap-2 rounded-6 border p-3 text-p-base"
		:class="
			correct
				? 'border-outline-green-3 bg-surface-green-2 text-ink-green-7'
				: partial
				? 'border-outline-amber-3 bg-surface-amber-2 text-ink-amber-8'
				: 'border-outline-red-3 bg-surface-red-2 text-ink-red-7'
		"
	>
		<span
			:class="
				correct
					? 'lucide-check-circle'
					: partial
					? 'lucide-contrast'
					: 'lucide-x-circle'
			"
			class="mt-0.5 size-4 shrink-0"
			aria-hidden="true"
		/>
		<span><slot /></span>
	</div>
</template>

<script setup lang="ts">
// `partial` is for a question that earns some of its marks but not all: it reads
// as neither a pass nor a fail. `correct` wins if both are set.
defineProps<{ correct: boolean; partial?: boolean }>()
</script>
