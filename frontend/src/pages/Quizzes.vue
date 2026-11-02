<template>
	<ListPage
		:breadcrumbs="breadcrumbs"
		layout="list"
		:columns="quizColumns"
		:rows="quizzes.data || []"
		:list-options="listOptions"
		:list-resource="quizzes"
		:loading="quizzes.list.loading"
		:has-next-page="quizzes.hasNextPage"
		v-model:search="search"
		empty-name="Quizzes"
		empty-icon="lucide-circle-help"
		@load-more="quizzes.next()"
	>
		<template #name="{ totalCount }">
			{{ __('{0} Quizzes').format(totalCount || 0) }}
		</template>

		<template #actions>
			<HeaderButton
				v-if="isStaff"
				:route="{ name: 'QuizSubmissions' }"
				:label="__('Submissions')"
				icon="lucide-file-check"
			/>
			<HeaderButton
				v-if="isStaff"
				:route="{ name: 'Questions' }"
				:label="__('Questions')"
				icon="lucide-circle-help"
			/>
			<Button
				v-if="isStaff && !readOnlyMode"
				variant="solid"
				@click="createQuiz"
			>
				<template #prefix>
					<span class="lucide-plus size-4" />
				</template>
				{{ __('New Quiz') }}
			</Button>
		</template>

		<template #cell="{ column, row, value }">
			<Checkbox
				v-if="column.key == 'show_answers'"
				:modelValue="Boolean(value)"
				:disabled="true"
			/>
			<div v-else-if="column.key == 'modified'" class="text-sm text-ink-gray-6">
				{{ value }}
			</div>
			<div v-else-if="column.key == 'practical_max_marks'">
				{{ Number(value) ? value : '-' }}
			</div>
			<div v-else-if="column.key == 'total_questions'">
				{{ Number(value) || 0 }}
			</div>
			<div v-else>{{ value }}</div>
		</template>

		<template #selection-actions="{ selections }">
			<span class="sr-only" role="status">{{ deleteAnnouncement }}</span>
			<Button
				variant="ghost"
				:label="deleting ? __('Deleting…') : __('Delete')"
				:aria-disabled="deleting"
				:class="deleting ? 'cursor-not-allowed' : ''"
				@click="deleteQuiz(selections)"
			>
				<template #icon>
					<span
						class="lucide-trash-2 size-4"
						:class="deleting ? 'opacity-60' : ''"
						aria-hidden="true"
					/>
				</template>
			</Button>
		</template>
	</ListPage>
</template>
<script setup>
import { Button, Checkbox, createListResource, usePageMeta } from 'frappe-ui'
import ListPage from '@/components/Layouts/pages/ListPage.vue'
import HeaderButton from '@/components/HeaderButton.vue'
import { useRouter } from 'vue-router'
import { computed, inject, onMounted, ref, watch } from 'vue'

import { sessionStore } from '@/stores/session'
import { useBulkDeleteAction } from '@/utils/bulkDelete'

const { brand } = sessionStore()
const user = inject('$user')
const dayjs = inject('$dayjs')
const router = useRouter()
const search = ref('')
const readOnlyMode = window.read_only_mode
const quizFilters = ref({})

// Staff manage quizzes here. Learners get the same list, already narrowed by
// quiz_query_conditions to the quizzes their courses and batches place, and
// open a quiz to take it rather than to edit it.
const isStaff = computed(
	() =>
		user.data?.is_moderator ||
		user.data?.is_instructor ||
		user.data?.is_evaluator
)

onMounted(() => {
	if (!user.data) {
		router.push({ name: 'Courses' })
	}
})

watch(search, () => {
	quizFilters.value['title'] = ['like', `%${search.value}%`]
	quizzes.update({
		filters: quizFilters.value,
	})
	quizzes.reload()
})

const quizzes = createListResource({
	doctype: 'LMS Quiz',
	filters: quizFilters,
	fields: [
		'name',
		'title',
		'passing_percentage',
		'practical_max_marks',
		'total_marks',
		'total_questions',
		'show_answers',
		'max_attempts',
		'modified',
	],
	auto: true,
	cache: ['quizzes', user.data?.name],
	orderBy: 'modified desc',
	pageLength: 24,
	transform(data) {
		return data.map((quiz) => {
			return {
				...quiz,
				modified: dayjs(quiz.modified).format('DD MMM YYYY'),
			}
		})
	},
})

const listOptions = computed(() => ({
	showTooltip: false,
	selectable: isStaff.value,
	getRowRoute: (row) => ({
		name: isStaff.value ? 'QuizForm' : 'QuizPage',
		params: { quizID: row.name },
	}),
}))

// Nothing is written here. A quiz named "Untitled Quiz" before the author had
// typed anything took its docname from that placeholder and kept it for good.
const createQuiz = () => router.push({ name: 'NewQuiz' })

const {
	deleting,
	announcement: deleteAnnouncement,
	run: deleteQuiz,
} = useBulkDeleteAction('LMS Quiz', {
	announcement: () => __('Deleting quizzes…'),
	onDeleted: () => {
		// Nothing refetches on its own now that `quizzes.delete` is not what
		// deletes. `reload()` rather than `list.fetch()`: past the first page the
		// latter appends the refetch onto the rows it just refetched.
		quizzes.reload()
	},
	success: (deleted) =>
		deleted === 1
			? __('Quiz deleted successfully')
			: __('{0} quizzes deleted successfully').format(deleted),
	allFailed: ({ total, error }) =>
		(total === 1
			? __('Error deleting quiz: {0}')
			: __('Error deleting quizzes: {0}')
		).format(error),
	partial: ({ deleted, total, error }) =>
		__('{0} of {1} quizzes deleted; the rest remain selected: {2}').format(
			deleted,
			total,
			error
		),
})

// Authoring settings a learner has no use for.
const STAFF_ONLY_COLUMNS = ['practical_max_marks', 'show_answers', 'modified']

const quizColumns = computed(() => {
	const columns = [
		{
			label: __('Title'),
			key: 'title',
			width: 2,
			icon: 'lucide-file-text',
		},
		{
			label: __('Questions'),
			key: 'total_questions',
			hideOnMobile: true,
			width: 0.5,
			align: 'left',
			icon: 'lucide-list-checks',
		},
		{
			label: __('Total Marks'),
			key: 'total_marks',
			hideOnMobile: true,
			width: 0.5,
			align: 'left',
			icon: 'lucide-hash',
		},
		{
			label: __('Passing Percentage'),
			key: 'passing_percentage',
			hideOnMobile: true,
			width: 1,
			align: 'left',
			icon: 'lucide-percent',
		},
		{
			label: __('Practical'),
			key: 'practical_max_marks',
			hideOnMobile: true,
			width: 0.5,
			align: 'left',
			icon: 'lucide-clipboard-check',
		},
		{
			label: __('Max Attempts'),
			key: 'max_attempts',
			hideOnMobile: true,
			width: 0.5,
			align: 'left',
			icon: 'lucide-repeat',
		},
		{
			label: __('Show Answers'),
			key: 'show_answers',
			hideOnMobile: true,
			width: 0.5,
			align: 'left',
			icon: 'lucide-eye',
		},
		{
			label: __('Updated On'),
			key: 'modified',
			width: 1,
			align: 'left',
			icon: 'lucide-clock',
		},
	]
	return isStaff.value
		? columns
		: columns.filter((column) => !STAFF_ONLY_COLUMNS.includes(column.key))
})

const breadcrumbs = computed(() => {
	return [
		{
			label: __('Quizzes'),
			route: {
				name: 'Quizzes',
			},
		},
	]
})

usePageMeta(() => {
	return {
		title: __('Quizzes'),
		icon: brand.favicon,
	}
})
</script>
