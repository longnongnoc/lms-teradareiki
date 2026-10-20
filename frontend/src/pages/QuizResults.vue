<template>
	<PageHeader :breadcrumbs="breadcrumbs">
		<template #actions>
			<HeaderButton
				:route="{ name: 'QuizSubmissions' }"
				:label="__('Submissions')"
				icon="lucide-file-check"
			/>
		</template>
	</PageHeader>

	<PageBody :title="__('Results')" :active-filters="activeFilterCount">
		<template #filters>
			<FormControl
				v-model="searchInput"
				type="text"
				:placeholder="__('Search learner')"
				:aria-label="__('Search learner')"
			>
				<template #prefix>
					<span
						class="lucide-search size-4 text-ink-gray-5"
						aria-hidden="true"
					/>
				</template>
			</FormControl>
			<Link
				doctype="LMS Quiz"
				v-model="filters.quiz"
				align="end"
				:placeholder="__('Filter by Quiz')"
				:aria-label="__('Filter by Quiz')"
			/>
			<Select
				v-model="filters.status"
				:options="statusChoices"
				:placeholder="__('Filter by Status')"
				:aria-label="__('Filter by Status')"
			/>
		</template>

		<div class="space-y-3 px-5 pb-5">
			<span class="sr-only" role="status">{{ announcement }}</span>

			<div
				v-if="truncated"
				data-testid="results-truncated"
				class="rounded-6 bg-surface-amber-1 px-4 py-3 text-p-base text-ink-amber-5"
			>
				{{ __('Only the newest 2000 attempts are included') }}
			</div>

			<div
				v-if="error && !rows.length"
				data-testid="results-error"
				role="alert"
				class="flex flex-col items-center gap-3 py-16 text-center"
			>
				<span
					class="lucide-circle-alert size-7 text-ink-red-4"
					aria-hidden="true"
				/>
				<p class="text-base text-ink-gray-8">{{ error }}</p>
				<Button :label="__('Retry')" @click="load" />
			</div>

			<div
				v-else-if="loading && !rows.length"
				data-testid="results-loading"
				aria-busy="true"
				class="space-y-2 motion-safe:animate-pulse"
			>
				<div
					v-for="i in 6"
					:key="i"
					class="h-12 rounded-6 bg-surface-gray-2"
					aria-hidden="true"
				/>
			</div>

			<EmptyStateLayout
				v-else-if="!rows.length"
				data-testid="results-empty"
				name="Results"
				icon="lucide-file-check"
				:title="__('No results found')"
				:description="
					hasActiveFilters
						? __('Try a different search or clear the filters.')
						: __('Results appear here once learners attempt a quiz.')
				"
			/>

			<template v-else>
				<div
					v-if="error"
					role="alert"
					class="rounded-6 bg-surface-red-1 px-4 py-3 text-p-base text-ink-red-4"
				>
					{{ error }}
				</div>
				<div
					class="overflow-x-auto rounded-6 border border-outline-gray-2 transition-opacity"
					:class="loading ? 'opacity-60' : ''"
					:aria-busy="loading"
				>
					<table
						class="w-full min-w-[56rem] text-sm"
						data-testid="results-table"
					>
						<caption class="sr-only">
							{{
								__('Quiz results')
							}}
						</caption>
						<thead class="bg-surface-gray-1 text-ink-gray-6">
							<tr>
								<th scope="col" class="px-3 py-2 text-start font-medium">
									{{ __('Learner') }}
								</th>
								<th scope="col" class="px-3 py-2 text-start font-medium">
									{{ __('Test') }}
								</th>
								<th scope="col" class="px-3 py-2 text-start font-medium">
									{{ __('Attempts') }}
								</th>
								<th scope="col" class="px-3 py-2 text-start font-medium">
									{{ __('Test score') }}
								</th>
								<th scope="col" class="px-3 py-2 text-start font-medium">
									{{ __('Practical score') }}
								</th>
								<th scope="col" class="px-3 py-2 text-start font-medium">
									{{ __('Total') }}
								</th>
								<th scope="col" class="px-3 py-2 text-start font-medium">
									{{ __('Status') }}
								</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-outline-gray-1 text-ink-gray-8">
							<tr
								v-for="row in rows"
								:key="rowKey(row)"
								class="cursor-pointer hover:bg-surface-gray-1"
								@click="openRow(row)"
							>
								<td class="px-3 py-2">
									<button
										type="button"
										class="flex w-full items-center gap-2.5 rounded-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-4"
										aria-haspopup="dialog"
										:aria-label="
											__('Open result for {0}').format(
												row.member.full_name || row.member.name
											)
										"
										@click.stop="openRow(row)"
									>
										<Avatar
											:image="row.member.user_image || ''"
											:label="row.member.full_name || row.member.name"
											size="lg"
										/>
										<span class="min-w-0">
											<span class="block truncate text-ink-gray-9">
												{{ row.member.full_name || row.member.name }}
											</span>
											<span class="block truncate text-xs text-ink-gray-6">
												{{ row.member.email }}
											</span>
										</span>
									</button>
								</td>
								<td class="px-3 py-2">{{ row.quiz.title }}</td>
								<td class="px-3 py-2 tabular-nums">{{ row.attempts_count }}</td>
								<td class="px-3 py-2 tabular-nums">{{ formatTest(row) }}</td>
								<td class="px-3 py-2 tabular-nums">
									{{ formatPractical(row) }}
								</td>
								<td class="px-3 py-2 tabular-nums">
									{{ formatTotal(row) }}
									<span v-if="row.percentage !== null" class="text-ink-gray-6">
										({{ formatPercentage(row.percentage) }})
									</span>
								</td>
								<td class="px-3 py-2">
									<Badge :theme="statusTheme(row.status)">
										{{ statusLabel(row.status) }}
									</Badge>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</template>
		</div>

		<template #footer>
			<nav
				:aria-label="__('Pagination')"
				class="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-2"
			>
				<span
					data-testid="results-range"
					class="text-base tabular-nums text-ink-gray-6"
				>
					{{
						total
							? __('{0}-{1} of {2}').format(range.from, range.to, total)
							: __('0 results')
					}}
				</span>
				<div class="flex items-center gap-2">
					<span class="text-sm tabular-nums text-ink-gray-6">
						{{ __('Page {0} of {1}').format(page, pageCount) }}
					</span>
					<Button
						:label="__('Previous')"
						:disabled="page <= 1 || loading"
						@click="page -= 1"
					/>
					<Button
						:label="__('Next')"
						:disabled="page >= pageCount || loading"
						@click="page += 1"
					/>
				</div>
			</nav>
		</template>
	</PageBody>

	<QuizResultDetail
		v-model:open="detailOpen"
		:row="selectedRow"
		@saved="load"
	/>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounceFn } from '@vueuse/core'
import {
	Avatar,
	Badge,
	Button,
	FormControl,
	call,
	usePageMeta,
} from 'frappe-ui'
import { sessionStore } from '@/stores/session'
import EmptyStateLayout from '@/components/Layouts/EmptyStateLayout.vue'
import PageBody from '@/components/Layouts/pages/PageBody.vue'
import PageHeader from '@/components/Layouts/pages/PageHeader.vue'
import HeaderButton from '@/components/HeaderButton.vue'
import Link from '@/components/Controls/Link.vue'
import Select from '@/components/Controls/Select.vue'
import QuizResultDetail from '@/components/Quiz/QuizResultDetail.vue'
import {
	RESULTS_METHOD,
	RESULTS_PAGE_LENGTH,
	SEARCH_DEBOUNCE_MS,
	buildResultsParams,
	clampPage,
	errorMessage,
	formatPercentage,
	formatPractical,
	formatTest,
	formatTotal,
	pageRange,
	statusLabel,
	statusOptions,
	statusTheme,
	totalPages,
} from '@/utils/quizResults'
import type { ResultRow, ResultsPage } from '@/utils/quizResults'
import type { Breadcrumb, SessionUser } from '@/types'

const { brand } = sessionStore()
const user = inject('$user') as SessionUser
const router = useRouter()

const searchInput = ref('')
const search = ref('')
const filters = ref({ quiz: '', status: '' })
const page = ref(1)
const rows = ref<ResultRow[]>([])
const total = ref(0)
const truncated = ref(false)
const loading = ref(false)
const error = ref('')
const selectedRow = ref<ResultRow | null>(null)
const detailOpen = ref(false)
let latestRequest = 0

const statusChoices = computed(() => statusOptions())
const pageCount = computed(() => totalPages(total.value, RESULTS_PAGE_LENGTH))
const range = computed(() =>
	pageRange(page.value, total.value, RESULTS_PAGE_LENGTH)
)
const hasActiveFilters = computed(
	() => !!(search.value || filters.value.quiz || filters.value.status)
)
const activeFilterCount = computed(
	() =>
		[search.value, filters.value.quiz, filters.value.status].filter(Boolean)
			.length
)
const announcement = computed(() => {
	if (loading.value) return __('Loading…')
	if (error.value) return error.value
	return __('{0} results').format(total.value)
})

const rowKey = (row: ResultRow): string =>
	`${row.quiz.name}::${row.member.name}`

const isStaff = (): boolean =>
	!!(
		user.data?.is_moderator ||
		user.data?.is_instructor ||
		user.data?.is_evaluator
	)

async function load(): Promise<void> {
	const request = ++latestRequest
	loading.value = true
	error.value = ''
	try {
		const data = (await call(
			RESULTS_METHOD,
			buildResultsParams({
				quiz: filters.value.quiz,
				search: search.value,
				status: filters.value.status,
				page: page.value,
				pageLength: RESULTS_PAGE_LENGTH,
			})
		)) as ResultsPage
		if (request !== latestRequest) return
		rows.value = data?.rows ?? []
		total.value = data?.total ?? 0
		truncated.value = !!data?.truncated
		// A refresh can leave the page past the end (the last row left the
		// filter), and an empty page would read as no results at all.
		const clamped = clampPage(page.value, total.value, RESULTS_PAGE_LENGTH)
		if (clamped !== page.value) page.value = clamped
	} catch (err) {
		if (request !== latestRequest) return
		error.value = errorMessage(err, __('Could not load the results.'))
	} finally {
		if (request === latestRequest) loading.value = false
	}
}

const applySearch = useDebounceFn((value: string) => {
	search.value = value.trim()
}, SEARCH_DEBOUNCE_MS)

watch(searchInput, (value) => applySearch(value))

watch([() => filters.value.quiz, () => filters.value.status, search], () => {
	if (!isStaff()) return
	// Changing page triggers its own load; only fetch here when it did not.
	if (page.value !== 1) page.value = 1
	else load()
})

watch(page, () => {
	if (isStaff()) load()
})

onMounted(() => {
	if (!isStaff()) {
		router.push({ name: 'Courses' })
		return
	}
	load()
})

onBeforeUnmount(() => {
	latestRequest++
})

function openRow(row: ResultRow): void {
	selectedRow.value = row
	detailOpen.value = true
}

const breadcrumbs = computed<Breadcrumb[]>(() => [
	{ label: __('Quizzes'), route: { name: 'Quizzes' } },
	{ label: __('Submissions'), route: { name: 'QuizSubmissions' } },
	{ label: __('Results') },
])

usePageMeta(() => ({
	title: __('Quiz Results'),
	icon: brand.favicon,
}))
</script>
