import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

// "Frame" for images in the rich text editor, the same idea as the Background
// toggle of the lesson image block: every framed image is shown in a box of one
// fixed shape (200 x 150, the picture kept whole on a light backdrop) so pictures
// of different sizes line up in a table and the blank under each one sits at the
// same height. A framed image carries `frame` (saved as data-frame="true") and
// the box size as its width and height attributes; the look (object-fit,
// backdrop) is CSS in index.css, keyed on those attributes so it applies in the
// editor's node view and in the saved HTML alike, with no editor plugin.
export const FRAME_WIDTH = 200
export const FRAME_HEIGHT = 150

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		imageFrame: {
			/** Frame or unframe the selected images, or every image of the table the cursor is in. */
			toggleImageFrame: () => ReturnType
		}
	}
}

type Target = { pos: number; node: ProseMirrorNode }

const imagesIn = (doc: ProseMirrorNode, from: number, to: number): Target[] => {
	const found: Target[] = []
	doc.nodesBetween(from, to, (node, pos) => {
		if (node.type.name === 'image') found.push({ pos, node })
	})
	return found
}

// The images the toggle acts on: those in the selection, or, with none selected,
// every image of the table the cursor is in (the usual case, a grid of pictures).
export const frameTargets = (state: EditorState): Target[] => {
	const { selection, doc } = state
	const own = imagesIn(doc, selection.from, selection.to)
	if (own.length) return own
	const $from = selection.$from
	for (let depth = $from.depth; depth > 0; depth--) {
		const node = $from.node(depth)
		if (node.type.name === 'table') {
			const start = $from.before(depth)
			return imagesIn(doc, start, start + node.nodeSize)
		}
	}
	return []
}

export const isFramed = (state: EditorState): boolean => {
	const targets = frameTargets(state)
	return targets.length > 0 && targets.every((t) => Boolean(t.node.attrs.frame))
}

export const ImageFrame = Extension.create({
	name: 'imageFrame',

	addGlobalAttributes() {
		return [
			{
				types: ['image'],
				attributes: {
					frame: {
						default: false,
						parseHTML: (element: HTMLElement) =>
							element.getAttribute('data-frame') === 'true',
						renderHTML: (attributes: Record<string, unknown>) =>
							attributes.frame ? { 'data-frame': 'true' } : {},
					},
				},
			},
		]
	},

	addCommands() {
		return {
			toggleImageFrame:
				() =>
				({ state, tr, dispatch }: { state: EditorState; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
					const targets = frameTargets(state)
					if (!targets.length) return false
					const next = !targets.every((t) => Boolean(t.node.attrs.frame))
					if (dispatch) {
						for (const { pos, node } of targets)
							tr.setNodeMarkup(pos, undefined, {
								...node.attrs,
								frame: next,
								width: next ? FRAME_WIDTH : null,
								height: next ? FRAME_HEIGHT : null,
							})
					}
					return true
				},
		}
	},
})

// Toolbar button: same shape as the items frappe-ui ships (see its menu.ts).
export const FrameImages = {
	label: 'Frame images',
	icon: 'lucide-frame',
	action: (editor: Editor) => editor.chain().focus().toggleImageFrame().run(),
	isActive: (editor: Editor) => isFramed(editor.state),
	isDisabled: (editor: Editor) => !frameTargets(editor.state).length,
}
