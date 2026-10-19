/**
 * A wrapped line continues where its own text starts, not at the left margin: past its
 * indentation, any `- ` list markers, a comment's `# ` (and a `1. ` or `- ` item in it),
 * and a `key: `, so a long value hangs under itself. VS Code's wrappingIndent and the
 * CodeMirror forum's recipe know only leading whitespace; a key, a comment and a list
 * marker are why this is our own. The hang is drawn by padding the line and pulling its
 * first row back (a negative text-indent), in `ch`: the editor is monospaced, and YAML
 * indents with spaces only. Read from the line's text alone, as it only changes how the
 * line looks.
 */
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";

/** The column a wrapped continuation of `line` starts at. */
export function hangOf(line: string): number {
	const lead = /^ *(?:- +)*/.exec(line)?.[0].length ?? 0;
	const rest = line.slice(lead);
	const comment = /^#+ *(?:(?:\d+\.|-) +)?/.exec(rest);
	if (comment !== null) return lead + comment[0].length;
	// A key with its value on the same line: the value hangs under itself.
	const key = /^[^\s#:"'][^:#]*?: +(?=\S)/.exec(rest);
	return lead + (key?.[0].length ?? 0);
}

function decorate(view: EditorView): DecorationSet {
	// Never more than half the line's width, so a deep key still leaves room to read.
	const most = Math.floor(
		view.contentDOM.clientWidth / view.defaultCharacterWidth / 2,
	);
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of view.visibleRanges)
		for (let pos = from; pos <= to; ) {
			const line = view.state.doc.lineAt(pos);
			const hang = Math.min(hangOf(line.text), most);
			if (hang > 0)
				builder.add(
					line.from,
					line.from,
					Decoration.line({
						class: "cm-hang",
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
		constructor(view: EditorView) {
			this.decorations = decorate(view);
		}
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged || u.geometryChanged)
				this.decorations = decorate(u.view);
		}
	},
	{ decorations: (v) => v.decorations },
);
