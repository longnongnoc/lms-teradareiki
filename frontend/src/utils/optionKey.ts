// The answer key of one Choices option, shared by the player and the author UI.
// The server keys an option by its trimmed text, or by "[image:N]" when it has
// none (N is the 1-based slot), so an image-only option can be chosen and graded.

export const MAX_OPTION_SLOTS = 10
export const OPTION_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const OPTION_IMAGE_MAX_BYTES = 5 * 1024 * 1024

const RESERVED_KEY = /^\[image:\d+\]$/
const IMAGE_KEY = /^\[image:(\d+)\]$/

type OptionDoc = Record<string, unknown> | null | undefined

const trimmed = (text: unknown): string =>
	typeof text === 'string' ? text.trim() : ''

export const imageKey = (slot: number): string => `[image:${slot}]`

export const optionKey = (text: unknown, slot: number): string =>
	trimmed(text) || imageKey(slot)

export const isOptionPresent = (text: unknown, image: unknown): boolean =>
	Boolean(trimmed(text)) || Boolean(trimmed(image))

// Text the server refuses because it would collide with an image key.
export const isReservedOptionText = (text: unknown): boolean =>
	RESERVED_KEY.test(trimmed(text))

export const imageSlotFromKey = (key: unknown): number | null => {
	const match = typeof key === 'string' ? IMAGE_KEY.exec(key.trim()) : null
	return match ? Number(match[1]) : null
}

export const optionText = (doc: OptionDoc, slot: number): string =>
	String(doc?.[`option_${slot}`] ?? '')

export const optionImage = (doc: OptionDoc, slot: number): string =>
	String(doc?.[`option_${slot}_image`] ?? '')

export const presentOptionSlots = (doc: OptionDoc): number[] =>
	Array.from({ length: MAX_OPTION_SLOTS }, (_, i) => i + 1).filter((slot) =>
		isOptionPresent(optionText(doc, slot), optionImage(doc, slot))
	)

// The slot a saved or submitted key stands for, or 0 when none does. An older
// saved answer holds the raw text, so an untrimmed match counts too.
export const slotForKey = (doc: OptionDoc, key: unknown): number => {
	if (typeof key !== 'string') return 0
	for (const slot of presentOptionSlots(doc)) {
		const text = optionText(doc, slot)
		if (optionKey(text, slot) === key.trim() || (text && text === key))
			return slot
	}
	return 0
}

export const keysForSlots = (doc: OptionDoc, slots: number[]): string[] =>
	slots
		.filter((slot) =>
			isOptionPresent(optionText(doc, slot), optionImage(doc, slot))
		)
		.map((slot) => optionKey(optionText(doc, slot), slot))

// A stored Choices answer is its keys joined with ", ". Only a segment that is
// exactly an image key is replaced, so a text option is left as it was.
export const describeChoiceAnswer = (
	answer: string | null | undefined,
	label: (slot: number) => string
): string =>
	String(answer ?? '')
		.split(', ')
		.map((part) => {
			const slot = imageSlotFromKey(part)
			return slot === null ? part : label(slot)
		})
		.join(', ')

// An error message, or '' when the file may be uploaded as an option image.
export const optionImageError = (
	file: { type?: string; size?: number },
	message: { type: string; size: string }
): string => {
	if (!OPTION_IMAGE_TYPES.includes(String(file.type ?? '').toLowerCase()))
		return message.type
	if ((file.size ?? 0) > OPTION_IMAGE_MAX_BYTES) return message.size
	return ''
}
