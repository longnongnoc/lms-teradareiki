<template>
	<Dialog
		v-model:open="open"
		:title="row ? row.member.full_name || row.member.name : ''"
		size="3xl"
	>
		<template #default>
			<div v-if="row" class="space-y-5" data-testid="result-detail">
				<div class="flex flex-wrap items-center gap-3">
					<Avatar
						:image="row.member.user_image || ''"
						:label="row.member.full_name || row.member.name"
						size="xl"
					/>
					<div class="min-w-0 text-sm">
						<div class="truncate text-ink-gray-8">{{ row.member.email }}</div>
						<div class="truncate text-ink-gray-6">{{ row.quiz.title }}</div>
					</div>
				</div>

				<p
					v-if="loading && !summary"
					role="status"
					class="text-sm text-ink-gray-6"
				>
					{{ __('Loading…') }}
				</p>
				<div v-else-if="loadError && !summary" class="space-y-2" role="alert">
					<p class="text-sm text-ink-red-5">{{ loadError }}</p>
					<Button size="sm" :label="__('Retry')" @click="loadSummary" />
				</div>

				<template v-if="summary">
					<dl
						class="grid grid-cols-2 gap-3 sm:grid-cols-5"
						data-testid="detail-cards"
					>
						<div class="rounded-6 border border-outline-gray-2 p-3">
							<dt class="text-xs text-ink-gray-6">{{ __('Test') }}</dt>
							<dd class="mt-1 text-base font-medium tabular-nums">
								{{ formatTest(summary) }}
							</dd>
						</div>
						<div class="rounded-6 border border-outline-gray-2 p-3">
							<dt class="text-xs text-ink-gray-6">{{ __('Practical') }}</dt>
							<dd class="mt-1 text-base font-medium tabular-nums">
								{{ formatPractical(summary) }}
							</dd>
						</div>
						<div class="rounded-6 border border-outline-gray-2 p-3">
							<dt class="text-xs text-ink-gray-6">{{ __('Total') }}</dt>
							<dd class="mt-1 text-base font-medium tabular-nums">
								{{ formatTotal(summary) }}
							</dd>
						</div>
						<div class="rounded-6 border border-outline-gray-2 p-3">
							<dt class="text-xs text-ink-gray-6">{{ __('Percentage') }}</dt>
							<dd class="mt-1 text-base font-medium tabular-nums">
								{{ formatPercentage(summary.percentage) || '-' }}
							</dd>
						</div>
						<div class="rounded-6 border border-outline-gray-2 p-3">
							<dt class="text-xs text-ink-gray-6">{{ __('Status') }}</dt>
							<dd class="mt-1">
								<Badge :theme="statusTheme(summary.status)">
									{{ statusLabel(summary.status) }}
								</Badge>
							</dd>
						</div>
					</dl>
					<p class="text-sm text-ink-gray-6">
						{{
							__('Pass mark: {0}').format(
								formatPercentage(summary.passing_percentage)
							)
						}}
					</p>

					<div class="space-y-2">
						<h3 class="text-sm-semibold text-ink-gray-9">
							{{ __('Attempts') }}
						</h3>
						<p
							v-if="!(summary.attempts && summary.attempts.length)"
							class="text-sm text-ink-gray-6"
						>
							{{ __('No attempts yet.') }}
						</p>
						<div v-else class="overflow-x-auto">
							<table class="w-full text-sm" data-testid="detail-attempts">
								<caption class="sr-only">
									{{
										__('Attempts')
									}}
								</caption>
								<thead class="text-ink-gray-6">
									<tr>
										<th scope="col" class="py-1 pe-3 text-start font-normal">
											{{ __('Attempt') }}
										</th>
										<th scope="col" class="py-1 pe-3 text-start font-normal">
											{{ __('Date') }}
										</th>
										<th scope="col" class="py-1 pe-3 text-start font-normal">
											{{ __('Score') }}
										</th>
										<th scope="col" class="py-1 pe-3 text-start font-normal">
											{{ __('Percentage') }}
										</th>
										<th scope="col" class="py-1 text-start font-normal">
											<span class="sr-only">{{ __('Details') }}</span>
										</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-outline-gray-1 text-ink-gray-8">
									<tr v-for="attempt in summary.attempts" :key="attempt.name">
										<td class="py-1.5 pe-3 tabular-nums">
											{{ attempt.attempt_no }}
											<Badge
												v-if="isCountingAttempt(attempt)"
												class="ms-1.5"
												size="sm"
												theme="blue"
											>
												{{ __('Counting') }}
											</Badge>
										</td>
										<td class="py-1.5 pe-3">
											{{ formatResultDate(attempt.creation) }}
										</td>
										<td class="py-1.5 pe-3 tabular-nums">
											{{ formatOutOf(attempt.score, attempt.score_out_of) }}
										</td>
										<td class="py-1.5 pe-3 tabular-nums">
											{{ formatPercentage(attempt.percentage) }}
										</td>
										<td class="py-1.5 text-end">
											<router-link
												:to="{
													name: 'QuizSubmission',
													params: { submission: attempt.name },
												}"
												class="text-ink-gray-7 underline underline-offset-2 hover:text-ink-gray-9"
											>
												{{ __('View attempt') }}
											</router-link>
										</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div>

					<div
						class="space-y-3 border-t border-outline-gray-1 pt-4"
						data-testid="practical-section"
					>
						<h3 class="text-sm-semibold text-ink-gray-9">
							{{ __('Practical score') }}
						</h3>
						<p
							v-if="!hasPractical(summary)"
							class="text-sm text-ink-gray-6"
							data-testid="no-practical"
						>
							{{ __('This test has no practical score.') }}
						</p>
						<form
							v-else
							class="space-y-3"
							novalidate
							@submit.prevent="savePractical"
						>
							<FormControl
								v-model="scoreInput"
								type="number"
								min="0"
								:max="summary.practical_max"
								step="0.01"
								inputmode="decimal"
								:label="
									__('Practical score (out of {0})').format(
										formatNumber(summary.practical_max)
									)
								"
								:error="scoreError"
								:disabled="isOwnResult || busy"
								class="sm:w-60"
								data-testid="practical-input"
								@blur="touched = true"
							/>
							<FormControl
								v-model="noteInput"
								type="textarea"
								:rows="3"
								:label="__('Note (optional)')"
								:disabled="isOwnResult || busy"
								data-testid="practical-note"
							/>
							<p
								v-if="isOwnResult"
								class="text-sm text-ink-gray-6"
								data-testid="own-result-notice"
							>
								{{ __('You cannot score your own result.') }}
							</p>
							<p
								v-if="summary.practical_scored_by"
								class="text-xs text-ink-gray-6"
								data-testid="scored-by"
							>
								{{
									__('Scored by {0} on {1}').format(
										summary.practical_scored_by,
										formatResultDate(summary.practical_scored_on)
									)
								}}
							</p>
							<div class="flex flex-wrap items-center gap-2">
								<Button
									type="submit"
									variant="solid"
									:label="__('Save')"
									:loading="saving"
									:disabled="!canSave"
									data-testid="practical-save"
								/>
								<Button
									v-if="
										summary.practical_score !== null &&
										summary.practical_score !== undefined
									"
									theme="red"
									:label="__('Clear')"
									:disabled="isOwnResult || busy"
									data-testid="practical-clear"
									@click="confirmClear"
								/>
							</div>
						</form>
					</div>
				</template>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import {
	Avatar,
	Badge,
	Button,
	Dialog,
	FormControl,
	call,
	toast,
} from 'frappe-ui'
import { createDialog } from '@/utils/dialogs'
import {
	DELETE_PRACTICAL_METHOD,
	SET_PRACTICAL_METHOD,
	SUMMARY_METHOD,
	errorMessage,
	formatNumber,
	formatOutOf,
	formatPercentage,
	formatPractical,
	formatResultDate,
	formatTest,
	formatTotal,
	hasPractical,
	isCountingAttempt,
	isResultSummary,
	statusLabel,
	statusTheme,
	validatePracticalScore,
} from '@/utils/quizResults'
import type { ResultRow, ResultSummary } from '@/utils/quizResults'
import type { SessionUser } from '@/types'

const props = defineProps<{ row: ResultRow | null }>()
const emit = defineEmits<{ (e: 'saved'): void }>()
const open = defineModel<boolean>('open', { default: false })

const user = inject<SessionUser>('$user')

const summary = ref<ResultSummary | null>(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const clearing = ref(false)
const scoreInput = ref<string | number>('')
const noteInput = ref('')
const touched = ref(false)
let latestRequest = 0

const busy = computed(() => saving.value || clearing.value)
const isOwnResult = computed(
	() => !!props.row && user?.data?.name === props.row.member.name
)
const validation = computed(() =>
	validatePracticalScore(scoreInput.value, summary.value?.practical_max ?? 0)
)
// Silent until the field has been touched or typed in: an empty form is not
// yet an error.
const scoreError = computed(() =>
	(touched.value || String(scoreInput.value) !== '') && !validation.value.valid
		? validation.value.error
		: ''
)
const canSave = computed(
	() =>
		!!summary.value &&
		hasPractical(summary.value) &&
		validation.value.valid &&
		!isOwnResult.value &&
		!busy.value
)

function applySummary(next: ResultSummary): void {
	summary.value = next
	scoreInput.value =
		next.practical_score === null || next.practical_score === undefined
			? ''
			: formatNumber(next.practical_score)
	noteInput.value = next.practical_note ?? ''
	touched.value = false
}

async function loadSummary(): Promise<void> {
	const row = props.row
	const request = ++latestRequest
	if (!row) return
	loading.value = true
	loadError.value = ''
	try {
		const data = await call(SUMMARY_METHOD, {
			quiz: row.quiz.name,
			member: row.member.name,
		})
		if (request !== latestRequest) return
		if (!isResultSummary(data)) throw new Error()
		applySummary(data)
	} catch (error) {
		if (request !== latestRequest) return
		loadError.value = errorMessage(error, __('Could not load this result.'))
	} finally {
		if (request === latestRequest) loading.value = false
	}
}

watch(
	() => [open.value, props.row?.quiz.name, props.row?.member.name],
	() => {
		if (!open.value || !props.row) {
			latestRequest++
			return
		}
		summary.value = null
		loadSummary()
	},
	{ immediate: true }
)

async function savePractical(): Promise<void> {
	const row = props.row
	const check = validation.value
	if (!canSave.value || !row || !check.valid) return
	saving.value = true
	try {
		const result = await call(SET_PRACTICAL_METHOD, {
			quiz: row.quiz.name,
			member: row.member.name,
			score: check.value,
			note: noteInput.value.trim() || null,
		})
		if (isResultSummary(result?.summary)) applySummary(result.summary)
		else await loadSummary()
		toast.success(__('Practical score saved'))
		emit('saved')
	} catch (error) {
		toast.error(errorMessage(error))
	} finally {
		saving.value = false
	}
}

async function clearPractical(close: () => void): Promise<void> {
	const row = props.row
	if (!row || clearing.value) return
	clearing.value = true
	try {
		const result = await call(DELETE_PRACTICAL_METHOD, {
			quiz: row.quiz.name,
			member: row.member.name,
		})
		if (isResultSummary(result?.summary)) applySummary(result.summary)
		else await loadSummary()
		toast.success(__('Practical score cleared'))
		emit('saved')
		close()
	} catch (error) {
		toast.error(errorMessage(error))
	} finally {
		clearing.value = false
	}
}

function confirmClear(): void {
	if (isOwnResult.value || busy.value) return
	createDialog({
		title: __('Clear the practical score?'),
		message: __(
			'The result will go back to waiting for a practical score. This cannot be undone.'
		),
		actions: [
			{
				label: __('Clear'),
				theme: 'red',
				variant: 'solid',
				onClick({ close }: { close: () => void }) {
					clearPractical(close)
				},
			},
		],
	})
}
</script>
