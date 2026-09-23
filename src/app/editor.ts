/**
 * The only file that touches CodeMirror. The editor is a stateful widget that
 * owns the text while a keystroke is in flight; the Model owns it otherwise.
 * `sync` is idempotent: it pushes the Model's text in only when it differs
 * (loading an example), always pushes the current diagnostics, and pushes the
 * JSON Schema when it is a new value (the bank's scales changed).
 */
import { startCompletion } from "@codemirror/autocomplete";
import { yaml, yamlLanguage } from "@codemirror/lang-yaml";
import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { Annotation, EditorState, Prec } from "@codemirror/state";
import { hoverTooltip, keymap } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import { stateExtensions, updateSchema } from "codemirror-json-schema";
import { yamlCompletion, yamlSchemaHover } from "codemirror-json-schema/yaml";
import type { Range } from "../core/findings.js";
import { schemaCompletion } from "./complete.js";

/** Marks a change we made ourselves, so it is not echoed back as an edit. */
const external = Annotation.define<boolean>();

export interface EditorInputs {
	/** Which question is open. A change resets editor state, so undo history never leaks between questions. */
	readonly id: number;
	readonly text: string;
	readonly diagnostics: readonly Diagnostic[];
	readonly schema: object;
}

export interface Editor {
	sync(inputs: EditorInputs): void;
	reveal(range: Range): void;
}

export function createEditor(
	parent: HTMLElement,
	onEdit: (text: string) => void,
): Editor {
	let schema: object | undefined;
	let current: number | undefined;
	const extensions = [
		basicSetup,
		yaml(),
		// We compose the schema features ourselves. The package's bundled extension
		// adds its own linter, which would double-report and call holes errors.
		yamlLanguage.data.of({ autocomplete: yamlCompletion() }),
		yamlLanguage.data.of({ autocomplete: schemaCompletion }),
		hoverTooltip(yamlSchemaHover()),
		stateExtensions(),
		macCompletionKeys,
		EditorView.lineWrapping,
		holeTheme,
		// `docChanged` is essential: setDiagnostics also triggers this listener.
		EditorView.updateListener.of((u) => {
			if (u.docChanged && !u.transactions.some((t) => t.annotation(external)))
				onEdit(u.state.doc.toString());
		}),
	];
	const view = new EditorView({ parent, extensions });
	return {
		sync({ id, text, diagnostics, schema: next }) {
			if (id !== current) {
				// A fresh state: new document, empty undo history, and the schema state
				// starts over, so it must be pushed again below.
				current = id;
				schema = undefined;
				view.setState(EditorState.create({ doc: text, extensions }));
			}
			if (next !== schema) {
				schema = next;
				updateSchema(view, next as never);
			}
			if (text !== view.state.doc.toString()) {
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: text },
					annotations: external.of(true),
				});
			}
			view.dispatch(setDiagnostics(view.state, [...diagnostics]));
		},
		reveal([from, to]) {
			// Never throw from a click: clamp to the document as it is now.
			const end = view.state.doc.length;
			const anchor = Math.min(Math.max(0, from), end);
			const head = Math.min(Math.max(anchor, to), end);
			view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
			view.focus();
		},
	};
}

/**
 * Opening completion on a Mac. Ctrl-Space is often taken by macOS for switching
 * input sources, and CodeMirror's own `Alt-i` cannot fire where Option-I is a dead
 * key (US layout: the circumflex). We do not force Option-I to work, because that
 * would stop authors typing accented text such as "rôle" in a question. Instead
 * we bind what VS Code binds on a Mac: Cmd-I and Option-Esc. Cmd-I replaces
 * CodeMirror's default "select parent syntax", which a question editor can spare.
 */
const macCompletionKeys = Prec.highest(
	keymap.of([
		{ mac: "Cmd-i", run: startCompletion },
		{ mac: "Alt-Escape", run: startCompletion },
	]),
);

/** Holes are invitations, not mistakes: dashed and tinted, never red. */
const holeTheme = EditorView.theme({
	".cm-lintRange-hint": {
		backgroundImage: "none",
		backgroundColor: "var(--hole-bg)",
		borderBottom: "2px dashed var(--hole)",
	},
	".cm-lintPoint-hint:after": { borderBottomColor: "var(--hole)" },
	".cm-diagnostic-hint": { borderLeftColor: "var(--hole)" },
	"&": { height: "100%", fontSize: "14px" },
	".cm-scroller": { fontFamily: "var(--mono)" },
});
