<template>
	<Dialog
		v-model:open="show"
		:title="editing ? __('Edit Review') : __('Write a Review')"
		size="xl"
		:actions="[
			{
				label: 'Submit',
				variant: 'solid',
				onClick: ({ close }) => submitReview(close),
			},
		]"
	>
		<template #default>
			<div class="flex flex-col gap-4">
				<Rating v-model="review.rating" :label="__('Rating')" />
				<FormControl
					:label="__('Review')"
					type="textarea"
					v-model="review.review"
					:rows="5"
				/>
			</div>
		</template>
	</Dialog>
</template>
<script setup lang="ts">
import { Dialog, FormControl, createResource, toast, Rating } from 'frappe-ui'
import type { FrappeResourceError } from 'frappe-ui'
import { resourceErrorMessage, submitResource } from '@/utils/resource'
import { reactive, watch } from 'vue'
import type { CourseReviewInfo, Resource } from '@/types'

const show = defineModel<boolean>()
const reviews = defineModel<Resource<unknown> | undefined>('reloadReviews')
const hasReviewed = defineModel<Resource<unknown> | undefined>('hasReviewed')

const review = reactive<{ review: string; rating: number }>({
	review: '',
	rating: 0,
})

const props = defineProps<{
	courseName: string
	// The learner's own review to edit; null writes a new one.
	editing?: CourseReviewInfo | null
}>()

// Start from the review being edited, or blank for a new one, each time it opens.
watch(show, (open) => {
	if (!open) return
	review.rating = props.editing?.rating ?? 0
	review.review = props.editing?.review ?? ''
})

const createReview = createResource({
	url: 'frappe.client.insert',
	makeParams() {
		return {
			doc: {
				doctype: 'LMS Course Review',
				course: props.courseName,
				review: review.review,
				// the Rating control is 0–5; the doctype stores a 0–1 fraction
				rating: review.rating / 5,
			},
		}
	},
})

const updateReview = createResource({
	url: 'frappe.client.set_value',
	makeParams() {
		return {
			doctype: 'LMS Course Review',
			name: props.editing?.name,
			fieldname: { review: review.review, rating: review.rating / 5 },
		}
	},
})

function submitReview(close: () => void) {
	submitResource(props.editing ? updateReview : createReview, review, {
		validate() {
			if (!review.rating) {
				return 'Please enter a rating.'
			}
		},
		onSuccess() {
			reviews.value?.reload()
			hasReviewed.value?.reload()
			close()
		},
		onError(err: string | FrappeResourceError) {
			toast.error(resourceErrorMessage(err, 'Error'))
		},
	})
}
</script>
