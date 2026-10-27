<template>
	<div class="space-y-3" data-testid="fill-blank-panel">
		<div class="flex items-center justify-between gap-3">
			<div class="text-sm-semibold text-ink-gray-8">{{ __('Blanks') }}</div>
			<span class="text-p-sm text-ink-gray-6" data-testid="fill-blank-total">
				{{ __('Total: {0}').format(marksLabel(total)) }}
			</span>
		</div>

		<p
			v-if="!rows.length"
			data-testid="fill-blank-empty"
			class="text-p-sm"
			:class="noBlanksInvalid ? 'text-ink-red-5' : 'text-ink-gray-6'"
		>
			{{ noBlanksHint }}
		</p>

		<div
			v-for="row in rows"
			:key="row.blank_id"
			role="group"
			class="space-y-2 rounded-6 border border-outline-gray-2 p-3"
			:aria-label="__('Blank {0}').format(row.blank_id)"
			data-testid="fill-blank-row"
		>
			<div class="flex items-center justify-between gap-3">
				<Badge theme="blue" variant="subtle">[[{{ row.blank_id }}]]</Badge>
				<div class="marks-input w-28">
					<FormControl
						type="number"
						variant="outline"
						min="1"
						step="1"
						:class="marksInvalid(row) ? INVALID_INPUT_CLASS : null"
						:modelValue="row.marks"
						:aria-label="__('Marks for blank {0}').format(row.blank_id)"
						:aria-invalid="marksInvalid(row) || undefined"
						:aria-describedby="
							marksInvalid(row) ? messageId(row, 'marks') : undefined
						"
						@update:modelValue="(val) => update(row.blank_id, 'marks', val)"
						@blur="touch(row.blank_id)"
					>
						<template #suffix>
							<span class="text-ink-gray-6">{{
								Number(row.marks) === 1 ? __('mark') : __('marks')
							}}</span>
						</template>
					</FormControl>
				</div>
			</div>
			<FormControl
				type="textarea"
				variant="outline"
				:rows="3"
				:class="answersInvalid(row) ? INVALID_TEXTAREA_CLASS : null"
				:label="__('Accepted answers (one per line)')"
				:placeholder="answersPlaceholder"
				:modelValue="row.answers"
				:aria-invalid="answersInvalid(row) || undefined"
				:aria-describedby="answersDescribedBy(row)"
				@update:modelValue="(val) => update(row.blank_id, 'answers', val)"
				@blur="touch(row.blank_id)"
			/>
			<p :id="messageId(row, 'hint')" class="text-p-sm text-ink-gray-6">
				{{
					__(
						'Hiragana/katakana, full/half-width, spaces, punctuation and okurigana variants match automatically.'
					)
				}}
			</p>
			<p
				v-if="answersInvalid(row)"
				:id="messageId(row, 'answers')"
				class="flex items-center gap-1.5 text-p-sm text-ink-red-5"
			>
				<span class="lucide-circle-alert size-4 shrink-0" />
				{{ __('Add at least one accepted answer') }}
			</p>
			<p
				v-if="marksInvalid(row)"
				:id="messageId(row, 'marks')"
				class="flex items-center gap-1.5 text-p-sm text-ink-red-5"
			>
				<span class="lucide-circle-alert size-4 shrink-0" />
				{{ __('Marks must be a whole number, 1 or more') }}
			</p>
		</div>
	</div>
</template>

<script setup>
import { Badge, FormControl } from 'frappe-ui'
import { computed, reactive, useId } from 'vue'
import { blankErrors, blankToken, totalBlankMarks } from '@/utils/fillBlank'
import { marksLabel } from '@/utils/quizQuestion'

// The rows are kept in step with the body by QuestionEditor; this only edits them.
const props = defineProps({
	question: { type: Object, required: true },
	// A stored question arrives invalid through nobody's fault, so it says so at once.
	revealErrors: { type: Boolean, default: false },
})

const INVALID_INPUT_CLASS = '[&_input]:!border-outline-red-3'
const INVALID_TEXTAREA_CLASS = '[&_textarea]:!border-outline-red-3'

const rows = computed(() => props.question.blanks ?? [])

// One base id per panel, so two editors on a page keep distinct ids; each row
// adds its blank id.
const baseId = useId()
const messageId = (row, part) => `${baseId}-${row.blank_id}-${part}`
const answersDescribedBy = (row) =>
	answersInvalid(row)
		? `${messageId(row, 'hint')} ${messageId(row, 'answers')}`
		: messageId(row, 'hint')

const answersPlaceholder = computed(() =>
	[__('Example: compressor'), __('Example: air compressor')].join('\n')
)
const total = computed(() => totalBlankMarks(rows.value))

// Blur, keyed by blank id, so a row the author has not reached stays quiet.
const touched = reactive({})
const touch = (id) => {
	touched[id] = true
}
const revealed = (id) => props.revealErrors || Boolean(touched[id])
const answersInvalid = (row) =>
	blankErrors(row).answers && revealed(row.blank_id)
const marksInvalid = (row) => blankErrors(row).marks && revealed(row.blank_id)

const noBlanksInvalid = computed(() => props.revealErrors)
const noBlanksHint = computed(() =>
	noBlanksInvalid.value
		? __('Add at least one blank with Insert blank')
		: __(
				'No blanks yet. Use Insert blank to add one at the cursor, for example {0}.'
		  ).format(blankToken(1))
)

// A new array each time, never an edit in place: the card compares the working
// copy against the stored one by value and restores the stored one on Close.
const update = (blankId, field, value) => {
	props.question.blanks = rows.value.map((row) =>
		row.blank_id === blankId ? { ...row, [field]: value } : row
	)
}
</script>
