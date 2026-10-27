import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { RichTextKit } from 'frappe-ui/editor'
import { ImageFrame, frameTargets, isFramed } from '@/components/editor/imageFrame'

// jsdom has no elementFromPoint, which the editor's placeholder plugin calls on mount.
document.elementFromPoint ??= () => null

const html = (frame = false) =>
	`<table><tbody><tr>` +
	`<td><p><img src="/files/a.png" width="410" height="420"${frame ? ' data-frame="true"' : ''}>[[1]]</p></td>` +
	`<td><p><img src="/files/b.png" width="358" height="351"${frame ? ' data-frame="true"' : ''}>[[2]]</p></td>` +
	`</tr></tbody></table><p>outside <img src="/files/c.png"></p>`

let editor: Editor | null = null
const make = (content: string) => {
	editor = new Editor({
		extensions: [RichTextKit.configure({ mention: false }), ImageFrame],
		content,
	})
	return editor
}
afterEach(() => editor?.destroy())

// Puts the cursor in the first table cell, where the images of the table are the target.
const cursorInTable = (e: Editor) => {
	let pos = 0
	e.state.doc.descendants((node, p) => {
		if (!pos && node.type.name === 'tableCell') pos = p + 2
	})
	e.commands.setTextSelection(pos)
}

describe('ImageFrame', () => {
	it('keeps data-frame on the saved <img> and reads it back', () => {
		const e = make(html(true))
		const out = e.getHTML()
		expect(out.match(/data-frame="true"/g)).toHaveLength(2)
		cursorInTable(e)
		expect(isFramed(e.state)).toBe(true)
	})

	it('toggles every image of the table the cursor is in, and only those', () => {
		const e = make(html(false))
		cursorInTable(e)
		expect(frameTargets(e.state)).toHaveLength(2)
		expect(e.commands.toggleImageFrame()).toBe(true)
		let out = e.getHTML()
		expect(out.match(/data-frame="true"/g)).toHaveLength(2)
		expect(out).toContain('src="/files/c.png"')
		expect(out.split('<p>outside')[1]).not.toContain('data-frame')
		e.commands.toggleImageFrame() // second press takes the frame off
		expect(e.getHTML()).not.toContain('data-frame')
	})

	it('does nothing when the cursor is outside a table and no image is selected', () => {
		const e = make(html(false))
		e.commands.setTextSelection(e.state.doc.content.size - 1)
		expect(e.commands.toggleImageFrame()).toBe(false)
	})

	it('sets the frame box size on the images and clears it again', () => {
		const e = make(html(false))
		cursorInTable(e)
		e.commands.toggleImageFrame()
		const sizes: unknown[] = []
		e.state.doc.descendants((n) => {
			if (n.type.name === 'image' && n.attrs.frame) sizes.push([n.attrs.width, n.attrs.height])
		})
		expect(sizes).toEqual([[200, 150], [200, 150]])
		e.commands.toggleImageFrame()
		const after: unknown[] = []
		e.state.doc.descendants((n) => {
			if (n.type.name === 'image' && n.attrs.src !== '/files/c.png') after.push([n.attrs.frame, n.attrs.width, n.attrs.height])
		})
		expect(after).toEqual([[false, null, null], [false, null, null]])
	})
})
