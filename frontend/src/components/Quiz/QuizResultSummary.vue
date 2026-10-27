<template>
	<section
		v-if="summary && summary.status !== 'Not Attempted'"
		data-testid="quiz-result-summary"
		:aria-label="__('Your overall result')"
		class="space-y-3 rounded-6 border border-outline-gray-2 p-3.5"
	>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h3 class="text-sm-semibold text-ink-gray-9">
				{{ __('Your overall result') }}
			</h3>
			<Badge
				v-if="statusText"
				data-testid="summary-status"
				size="md"
				:theme="statusTheme(summary.status)"
			>
				{{ statusText }}
			</Badge>
		</div>

		<dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
			<div>
				<dt class="text-ink-gray-6">{{ __('Test score') }}</dt>
				<dd data-testid="summary-test" class="font-medium tabular-nums">
					{{ formatTest(summary) }}
				</dd>
			</div>
			<div v-if="hasPractical(summary)">
				<dt class="text-ink-gray-6">{{ __('Practical score') }}</dt>
				<dd data-testid="summary-practical" class="font-medium tabular-nums">
					{{
						summary.status === 'Pending Practical'
							? __('Waiting for practical score')
							: formatPractical(summary)
					}}
				</dd>
			</div>
			<div v-if="summary.total_score !== null">
				<dt class="text-ink-gray-6">{{ __('Total') }}</dt>
				<dd data-testid="summary-total" class="font-medium tabular-nums">
					{{ formatTotal(summary) }}
					<span
						v-if="summary.percentage !== null"
						data-testid="summary-percentage"
						class="text-ink-gray-6"
					>
						({{ formatPercentage(summary.percentage) }})
					</span>
				</dd>
			</div>
			<div>
				<dt class="text-ink-gray-6">{{ __('Pass mark') }}</dt>
				<dd data-testid="summary-pass-mark" class="font-medium tabular-nums">
					{{ formatPercentage(summary.passing_percentage) }}
				</dd>
			</div>
		</dl>

		<div v-if="attempts.length" class="overflow-x-auto">
			<table
				data-testid="summary-attempts"
				class="!w-max min-w-full !table-auto whitespace-nowrap text-start text-sm"
			>
				<caption class="sr-only">
					{{
						__('Your attempts')
					}}
				</caption>
				<thead class="text-ink-gray-6">
					<tr>
						<th scope="col" class="py-1 pe-2 text-start font-normal">
							{{ __('Attempt') }}
						</th>
						<th scope="col" class="py-1 pe-2 text-start font-normal">
							{{ __('Date') }}
						</th>
						<th scope="col" class="py-1 pe-2 text-start font-normal">
							{{ __('Score') }}
						</th>
						<th scope="col" class="py-1 pe-2 text-start font-normal">
							{{ __('Percentage') }}
						</th>
						<th scope="col" class="py-1 text-start font-normal">
							<span class="sr-only">{{ __('Counting') }}</span>
						</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-outline-gray-1 text-ink-gray-8">
					<tr v-for="attempt in attempts" :key="attempt.name">
						<td class="py-1.5 pe-2 tabular-nums">{{ attempt.attempt_no }}</td>
						<td class="py-1.5 pe-2">
							{{ formatResultDate(attempt.creation) }}
						</td>
						<td class="py-1.5 pe-2 tabular-nums">
							{{ formatOutOf(attempt.score, attempt.score_out_of) }}
						</td>
						<td class="py-1.5 pe-2 tabular-nums">
							{{ formatPercentage(attempt.percentage) }}
						</td>
						<td class="py-1.5">
							<Badge v-if="isCountingAttempt(attempt)" size="sm" theme="blue">
								{{ __('Counting') }}
							</Badge>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Badge, call } from 'frappe-ui'
import {
	SUMMARY_METHOD,
	formatOutOf,
	formatPercentage,
	formatPractical,
	formatResultDate,
	formatTest,
	formatTotal,
	hasPractical,
	isCountingAttempt,
	isResultSummary,
	learnerStatusLabel,
	statusTheme,
} from '@/utils/quizResults'
import type { ResultSummary } from '@/utils/quizResults'

// The learner's overall result for one quiz. It is an addition to the quiz
// screen, never part of it: a failed call leaves nothing on screen.
const props = defineProps<{
	quiz: string
	// Changes whenever a new attempt is saved, so the summary refetches.
	refreshKey?: string | number | null
}>()
// The summary once it has loaded, or null when the call failed, so the quiz
// screen can take its pass or fail from here rather than ask again.
const emit = defineEmits<{
	(e: 'loaded', summary: ResultSummary | null): void
}>()

const summary = ref<ResultSummary | null>(null)
let latestRequest = 0

const attempts = computed(() => summary.value?.attempts ?? [])
const statusText = computed(() =>
	summary.value ? learnerStatusLabel(summary.value.status) : null
)

async function load(): Promise<void> {
	const request = ++latestRequest
	if (!props.quiz) {
		summary.value = null
		return
	}
	try {
		const data = await call(SUMMARY_METHOD, { quiz: props.quiz })
		if (request !== latestRequest) return
		summary.value = isResultSummary(data) ? data : null
	} catch {
		if (request !== latestRequest) return
		summary.value = null
	}
	emit('loaded', summary.value)
}

watch(() => [props.quiz, props.refreshKey], load, { immediate: true })

onBeforeUnmount(() => {
	latestRequest++
})
</script>
