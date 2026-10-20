export const PRACTICAL_MAX_MARKS_LIMIT = 999.99

/** 0 to 999.99 with at most two decimals. Empty reads as 0, which the field defaults to. */
export const isValidPracticalMaxMarks = (value: unknown): boolean => {
	if (value === null || value === undefined) return true
	const text = String(value).trim()
	if (!text) return true
	if (!/^\d+(\.\d{1,2})?$/.test(text)) return false
	return Number(text) <= PRACTICAL_MAX_MARKS_LIMIT
}
