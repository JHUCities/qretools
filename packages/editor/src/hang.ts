/**
 * A wrapped line continues where its own text starts, not at the left margin. That is past
 * its indentation, any `- ` list markers, a comment's `# ` (and a `1. ` or `- ` item in
 * it), and a `key: `, so a long value hangs under itself.
 * VS Code's wrappingIndent and the CodeMirror forum's recipe know only leading whitespace.
 * Keys, comments and list markers are why this is our own.
 * The hang pads the line and pulls its first row back (a negative text-indent), in `ch`:
 * the editor is monospaced, and YAML indents with spaces only. Which lines continue a
 * value (a `|` block, a value over several lines) comes from the core's parse: there a
 * colon or a `#` is the author's words, so only the indentation hangs.
 */
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import { textLines } from "@qretools/core/editor";

/** The column a wrapped continuation of `line` starts at; `isText` when it continues a value. */
export function hangOf(line: string, isText = false): number {
	if (isText) return /^ */.exec(line)?.[0].length ?? 0;
	const lead = /^ *(?:- +)*/.exec(line)?.[0].length ?? 0;
	const rest = line.slice(lead);
	const comment = /^#+ *(?:(?:\d+\.|-) +)?/.exec(rest);
	if (comment !== null) return lead + comment[0].length;
	// A key with its value on the same line: the value hangs under itself.
	const key = /^[^\s#:"'][^:#]*?: +(?=\S)/.exec(rest);
	return lead + (key?.[0].length ?? 0);
}

function decorate(view: EditorView, text: ReadonlySet<number>): DecorationSet {
	// Never more than half the line's width, so a deep key still leaves room to read;
	// no cap while the editor isn't laid out yet (width 0), until its geometry changes.
	const width = view.contentDOM.clientWidth;
	const most =
		width === 0
			? Number.POSITIVE_INFINITY
			: Math.floor(width / view.defaultCharacterWidth / 2);
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of view.visibleRanges)
		for (let pos = from; pos <= to; ) {
			const line = view.state.doc.lineAt(pos);
			const hang = Math.min(hangOf(line.text, text.has(line.number)), most);
			if (hang > 0)
				builder.add(
					line.from,
					line.from,
					Decoration.line({
						class: "cm-hang",
						// An inline style: a strict style-src would drop it (the hang would just
						// not show); classes per width would be the way then.
						attributes: { style: `--cm-hang: ${hang}ch` },
					}),
				);
			pos = line.to + 1;
		}
	return builder.finish();
}

export const hangingIndent: Extension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		// Parsed again only when the text changes; scrolling and resizing reuse it.
		text: ReadonlySet<number>;
		constructor(view: EditorView) {
			this.text = textLines(view.state.doc.toString());
			this.decorations = decorate(view, this.text);
		}
		update(u: ViewUpdate) {
			if (u.docChanged) this.text = textLines(u.state.doc.toString());
			if (u.docChanged || u.viewportChanged || u.geometryChanged)
				this.decorations = decorate(u.view, this.text);
		}
	},
	{ decorations: (v) => v.decorations },
);
