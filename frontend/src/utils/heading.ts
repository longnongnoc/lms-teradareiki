import Header from '@editorjs/header'
import type { HeaderData } from '@editorjs/header'

type HeaderOptions = ConstructorParameters<typeof Header>[0]

/**
 * A heading is one line. EditorJS's Enter handler returns early on Shift+Enter
 * (`BlockEvents.enter`), so the browser's default runs and drops a `<br>` into
 * the contenteditable. The header tool's sanitize config allows no `<br>`
 * (unlike paragraph's), so the break is stripped on save and the two lines are
 * glued into one word: the editor shows a multi-line heading that silently
 * collapses on reload. Refuse the break instead of losing text.
 */
export class Heading extends Header {
	private editorApi: HeaderOptions['api']

	constructor(options: HeaderOptions) {
		super(options)
		this.editorApi = options.api
	}

	// Bound in getTag(), not render(): changing the heading level rebuilds the
	// element (Header's `data` setter swaps the node), which would drop a
	// listener attached once at render time.
	getTag(): HTMLElement {
		const tag = super.getTag()
		flattenLineBreaks(tag)
		tag.addEventListener('keydown', refuseLineBreak)
		tag.addEventListener('keydown', (event) => this.splitIfUnhandled(event))
		return tag
	}

	// Backspace at the start of a paragraph merges it into the heading above,
	// carrying that paragraph's line breaks with it.
	merge(data: Partial<HeaderData>): void {
		super.merge({ ...data, text: stripLineBreaks(data.text ?? '') })
	}

	// EditorJS 2.29 also skips plain Enter while it still counts a toolbar as
	// open, which it does right after a heading is picked from the + menu. The
	// browser then puts a <div> in the heading and the next line is glued onto
	// it on save. EditorJS's block handler runs after this one (it listens on
	// the block holder), so check once the event reaches the document.
	private splitIfUnhandled(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
		document.addEventListener(
			'keydown',
			(late) => {
				if (late !== event || event.defaultPrevented) return
				event.preventDefault()
				const { blocks, caret } = this.editorApi
				if (!blocks || !caret) return
				const next = blocks.getCurrentBlockIndex() + 1
				blocks.insert(undefined, undefined, undefined, next, true)
				caret.setToBlock(next)
			},
			{ once: true }
		)
	}
}

function refuseLineBreak(event: KeyboardEvent): void {
	// Plain Enter still splits the block. That stays EditorJS's to handle.
	if (event.key === 'Enter' && event.shiftKey) {
		event.preventDefault()
	}
}

function stripLineBreaks(html: string): string {
	return html.replace(/<br\s*\/?>/gi, ' ')
}

// Content written before this guard (or imported from markdown) can still
// arrive with breaks in it.
function flattenLineBreaks(tag: HTMLElement): void {
	tag.querySelectorAll('br').forEach((br) => br.replaceWith(' '))
}
