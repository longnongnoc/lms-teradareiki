<template>
	<Dialog
		v-model:open="show"
		:title="__('Import tests from JSON')"
		size="lg"
		@after-leave="reset"
	>
		<template #default>
			<div class="space-y-4 text-p-base">
				<p class="text-ink-gray-6">
					{{
						__(
							'Choose a .json file. It is checked first, and nothing is written until you confirm.'
						)
					}}
				</p>
				<input
					data-testid="quiz-import-file"
					type="file"
					accept=".json,application/json"
					:aria-label="__('JSON file')"
					:disabled="busy"
					@change="pickFile"
				/>

				<p v-if="busy" class="text-ink-gray-6">{{ __('Checking file…') }}</p>

				<template v-if="result">
					<div
						v-if="result.errors.length"
						data-testid="quiz-import-errors"
						role="alert"
						class="space-y-1 rounded-6 bg-surface-red-1 px-3 py-2 text-ink-red-5"
					>
						<div class="font-medium">
							{{
								imported
									? __('Some tests could not be imported.')
									: __('The file has errors. Nothing was imported.')
							}}
						</div>
						<ul class="list-disc ps-5">
							<li v-for="error in result.errors" :key="error">{{ error }}</li>
						</ul>
					</div>

					<div
						v-for="group in groups"
						:key="group.key"
						:data-testid="`quiz-import-${group.key}`"
						class="space-y-1"
					>
						<div class="text-sm font-medium text-ink-gray-8">
							{{ group.label }}
						</div>
						<ul class="space-y-0.5 text-ink-gray-7">
							<li v-for="row in group.rows" :key="row.title">
								{{ row.title }}
								<span class="text-ink-gray-6">
									{{
										row.reason
											? `(${row.reason})`
											: `(${__('{0} questions').format(row.questions)})`
									}}
								</span>
							</li>
						</ul>
					</div>

					<div v-if="result.warnings.length" class="space-y-1">
						<div class="text-sm font-medium text-ink-gray-8">
							{{ __('Warnings') }}
						</div>
						<ul class="list-disc ps-5 text-ink-gray-6">
							<li v-for="warning in result.warnings" :key="warning">
								{{ warning }}
							</li>
						</ul>
					</div>
				</template>
			</div>
		</template>
		<template #actions="{ close }">
			<div class="flex justify-end gap-2">
				<Button @click="close">
					{{ imported ? __('Close') : __('Cancel') }}
				</Button>
				<Button
					v-if="!imported"
					data-testid="quiz-import-confirm"
					variant="solid"
					:disabled="!canConfirm"
					:loading="busy"
					@click="runImport"
				>
					{{ __('Confirm import') }}
				</Button>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, call, Dialog, toast } from 'frappe-ui'
import { resourceErrorMessage } from '@/utils/resource'

// What lms.lms.test_import.import_tests returns, dry run or not.
interface ImportRow {
	title: string
	quiz?: string | null
	questions?: number
	reason?: string
}
interface ImportResult {
	ok: boolean
	errors: string[]
	warnings: string[]
	created: ImportRow[]
	updated: ImportRow[]
	skipped: ImportRow[]
}

const show = defineModel<boolean>({ required: true, default: false })
const emit = defineEmits<{ imported: [] }>()

const text = ref('')
const result = ref<ImportResult | null>(null)
const busy = ref(false)
// Set once the real import has run, so the same file cannot be imported twice.
const imported = ref(false)

const canConfirm = computed(
	() =>
		!busy.value &&
		!!result.value &&
		!result.value.errors.length &&
		result.value.created.length + result.value.updated.length > 0
)

const groups = computed(() => {
	if (!result.value) return []
	return [
		{
			key: 'created',
			label: imported.value ? __('Created') : __('Will be created'),
			rows: result.value.created,
		},
		{
			key: 'updated',
			label: imported.value ? __('Updated') : __('Will be updated'),
			rows: result.value.updated,
		},
		{ key: 'skipped', label: __('Skipped'), rows: result.value.skipped },
	].filter((group) => group.rows.length)
})

const importTests = (dryRun: boolean) =>
	call('lms.lms.test_import.import_tests', {
		data: text.value,
		dry_run: dryRun ? 1 : 0,
	}) as Promise<ImportResult>

const pickFile = async (event: Event) => {
	const file = (event.target as HTMLInputElement).files?.[0]
	result.value = null
	imported.value = false
	if (!file) return
	busy.value = true
	try {
		text.value = await file.text()
		result.value = await importTests(true)
	} catch (error) {
		toast.error(resourceErrorMessage(error, __('Could not check the file')))
	} finally {
		busy.value = false
	}
}

const runImport = async () => {
	if (!canConfirm.value) return
	busy.value = true
	try {
		result.value = await importTests(false)
		imported.value = true
		const count = result.value.created.length + result.value.updated.length
		if (count) {
			toast.success(__('{0} tests imported').format(count))
			emit('imported')
		}
	} catch (error) {
		toast.error(resourceErrorMessage(error, __('Could not import the tests')))
	} finally {
		busy.value = false
	}
}

const reset = () => {
	text.value = ''
	result.value = null
	imported.value = false
}
</script>
