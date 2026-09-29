/**
 * The only file that touches CodeMirror. The editor is a stateful widget that
 * owns the text while a keystroke is in flight; the Model owns it otherwise.
 * `sync` is idempotent: it pushes the Model's text in only when it differs
 * (loading an example), always pushes the current diagnostics, and pushes the
 * JSON Schema when it is a new value (the bank's scales changed). The core's marks
 * (resolved names, codes, `legacy`, holes) arrive with the diagnostics, in the same
 * transaction, and become decorations only here.
 */
import { startCompletion } from "@codemirror/autocomplete";
import { yaml, yamlLanguage } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import {
	Annotation,
	Compartment,
	EditorState,
	Prec,
	type Range as Ranged,
	StateEffect,
	StateField,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	keymap,
	WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup, EditorView } from "codemirror";
import { stateExtensions, updateSchema } from "codemirror-json-schema";
import { yamlCompletion } from "codemirror-json-schema/yaml";
import type { Range } from "../core/findings.js";
import type { Mark } from "../core/surface/marks.js";
import { schemaCompletion } from "./complete.js";

/** Marks a change we made ourselves, so it is not echoed back as an edit. */
const external = Annotation.define<boolean>();

export interface EditorInputs {
	/** Which question is open. A change resets editor state, so undo history never leaks between questions. */
	readonly id: number;
	readonly text: string;
	readonly diagnostics: readonly Diagnostic[];
	/** What the core colours by meaning; drawn as decorations, never decided here. */
	readonly marks: readonly Mark[];
	readonly schema: object;
	/** Another author's version, from a link: shown, never edited. */
	readonly readOnly?: boolean;
	/** The editor's accessible name, e.g. "Question source (YAML)". */
	readonly label?: string;
}

export interface Editor {
	sync(inputs: EditorInputs): void;
	reveal(range: Range): void;
	/** Tear the editor down; React mounts and unmounts the host, so this must exist. */
	destroy(): void;
}

export function createEditor(
	parent: HTMLElement,
	onEdit: (text: string) => void,
	onCursor: (offset: number) => void,
): Editor {
	let schema: object | undefined;
	let current: number | undefined;
	let locked = false;
	const readOnly = new Compartment();
	const label = new Compartment();
	let named = "Source";
	const extensions = [
		basicSetup,
		yaml(),
		// We compose the schema features ourselves. The package's bundled extension
		// adds its own linter, which would double-report and call holes errors.
		yamlLanguage.data.of({ autocomplete: yamlCompletion() }),
		yamlLanguage.data.of({ autocomplete: schemaCompletion }),
		// No schema hover: the cursor inspector shows a field's description, and a
		// finding's tooltip shows the finding; a third tooltip repeated both.
		stateExtensions(),
		macCompletionKeys,
		EditorView.lineWrapping,
		primerTheme,
		primerHighlight,
		semantics,
		// The accessible name of the text area, which changes with the file open.
		label.of(EditorView.contentAttributes.of({ "aria-label": "Source" })),
		readOnly.of(EditorState.readOnly.of(false)),
		// `docChanged` is essential: setDiagnostics also triggers this listener.
		EditorView.updateListener.of((u) => {
			if (u.docChanged && !u.transactions.some((t) => t.annotation(external)))
				onEdit(u.state.doc.toString());
			// Only when the caret actually moved, so a message is never sent for nothing.
			const head = u.state.selection.main.head;
			if (u.selectionSet && head !== u.startState.selection.main.head)
				onCursor(head);
		}),
	];
	const view = new EditorView({ parent, extensions });
	return {
		sync({
			id,
			text,
			diagnostics,
			marks,
			schema: next,
			readOnly: lock = false,
			label: name = "Source (YAML)",
		}) {
			if (id !== current) {
				// A fresh state: new document, empty undo history, and the schema state
				// starts over, so it must be pushed again below. So does read-only.
				current = id;
				schema = undefined;
				locked = false;
				named = "Source";
				view.setState(EditorState.create({ doc: text, extensions }));
			}
			if (name !== named) {
				named = name;
				view.dispatch({
					effects: label.reconfigure(
						EditorView.contentAttributes.of({ "aria-label": name }),
					),
				});
			}
			if (lock !== locked) {
				locked = lock;
				view.dispatch({
					effects: readOnly.reconfigure(EditorState.readOnly.of(lock)),
				});
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
			// One transaction: findings and marks describe the same text, so they never
			// show against different versions of it.
			view.dispatch({
				effects: [
					...asArray(setDiagnostics(view.state, [...diagnostics]).effects),
					setSemantics.of(marks),
				],
			});
		},
		reveal([from, to]) {
			// Never throw from a click: clamp to the document as it is now.
			const end = view.state.doc.length;
			const anchor = Math.min(Math.max(0, from), end);
			const head = Math.min(Math.max(anchor, to), end);
			view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
			view.focus();
		},
		destroy() {
			view.destroy();
		},
	};
}

const asArray = <T>(x: T | readonly T[] | undefined): readonly T[] =>
	x === undefined ? [] : Array.isArray(x) ? x : [x as T];

/** The core's marks for the text as it is now; mapped through edits until the next ones. */
const setSemantics = StateEffect.define<readonly Mark[]>();

const semantics = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, tr) {
		let next = decorations.map(tr.changes);
		for (const e of tr.effects)
			if (e.is(setSemantics))
				next = decorationsOf(e.value, tr.state.doc.length);
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

const MARK_CLASS = {
	ref: Decoration.mark({ class: "cm-ref" }),
	code: Decoration.mark({ class: "cm-code" }),
	legacy: Decoration.mark({ class: "cm-legacy" }),
} as const;

/**
 * A hole as Hazel draws one: a small box after the colon. Decorative (the finding
 * says it in words, to a screen reader too), so hidden from assistive technology;
 * the "?" is CSS content, never text, so it cannot be selected or copied.
 */
class HoleChip extends WidgetType {
	override eq(other: WidgetType): boolean {
		return other instanceof HoleChip;
	}
	toDOM(): HTMLElement {
		const chip = document.createElement("span");
		chip.className = "cm-hole";
		chip.setAttribute("aria-hidden", "true");
		return chip;
	}
}

const HOLE = Decoration.widget({ widget: new HoleChip(), side: 1 });

/** Clamped to the document as it is now: a mark past its end is dropped, never thrown. */
function decorationsOf(marks: readonly Mark[], length: number): DecorationSet {
	const list: Ranged<Decoration>[] = [];
	for (const { kind, range } of marks) {
		const from = Math.min(Math.max(0, range[0]), length);
		const to = Math.min(Math.max(from, range[1]), length);
		if (kind === "hole") list.push(HOLE.range(from));
		else if (to > from) list.push(MARK_CLASS[kind].range(from, to));
	}
	return Decoration.set(list, true);
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

/**
 * The editor in Primer's own terms: every colour is one of Primer's tokens, which are
 * CSS variables, so one theme serves light and dark alike. Holes are invitations, not
 * mistakes: dashed and tinted, never red.
 */
const primerTheme = EditorView.theme({
	"&": {
		height: "100%",
		color: "var(--codeMirror-fgColor)",
		backgroundColor: "var(--codeMirror-bgColor)",
		fontSize: "var(--text-codeBlock-size)",
	},
	".cm-scroller": {
		fontFamily: "var(--fontStack-monospace)",
		lineHeight: "var(--text-codeBlock-lineHeight)",
	},
	".cm-content": { caretColor: "var(--codeMirror-cursor-fgColor)" },
	".cm-cursor, .cm-dropCursor": {
		borderLeftColor: "var(--codeMirror-cursor-fgColor)",
	},
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
		{ backgroundColor: "var(--codeMirror-selection-bgColor)" },
	".cm-activeLine": { backgroundColor: "var(--codeMirror-activeline-bgColor)" },
	".cm-gutters": {
		color: "var(--codeMirror-lineNumber-fgColor)",
		backgroundColor: "var(--codeMirror-gutters-bgColor)",
		borderRight: "var(--borderWidth-thin) solid var(--borderColor-default)",
	},
	// Not `--codeMirror-gutterMarker-fgColor-default`: Primer sets it to the page
	// background, which left the number (and the fold arrow) unreadable. This class is
	// on the active line in every gutter.
	".cm-activeLineGutter": {
		color: "var(--fgColor-default)",
		backgroundColor: "var(--codeMirror-activeline-bgColor)",
	},
	".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
		color: "var(--codeMirror-matchingBracket-fgColor)",
		backgroundColor: "transparent",
		outline: "var(--borderWidth-thin) solid var(--borderColor-default)",
	},
	".cm-tooltip": {
		color: "var(--fgColor-default)",
		backgroundColor: "var(--overlay-bgColor)",
		border: "var(--borderWidth-thin) solid var(--borderColor-default)",
		borderRadius: "var(--borderRadius-medium)",
		boxShadow: "var(--shadow-floating-small)",
		// A readable line length, never the editor's full width.
		maxInlineSize: "60ch",
	},
	".cm-tooltip-autocomplete > ul > li[aria-selected]": {
		color: "var(--fgColor-default)",
		backgroundColor: "var(--bgColor-accent-muted)",
	},
	".cm-panels": {
		color: "var(--fgColor-default)",
		backgroundColor: "var(--bgColor-muted)",
	},
	// Problems by severity, told apart by line style as well as colour (so colour-
	// vision deficiency never hides one): wavy for errors and warnings, dotted for
	// info. Primer tokens replace CodeMirror's fixed-colour squiggle images. Holes
	// (hint) keep a border, so one inside an error range draws both lines.
	".cm-lintRange-error": {
		backgroundImage: "none",
		textDecoration: "underline wavy var(--fgColor-danger)",
		textDecorationThickness: "var(--borderWidth-thin)",
		textUnderlinePosition: "under",
	},
	".cm-lintPoint-error:after": { borderBottomColor: "var(--fgColor-danger)" },
	".cm-diagnostic-error": { borderLeftColor: "var(--fgColor-danger)" },
	".cm-lintRange-warning": {
		backgroundImage: "none",
		textDecoration: "underline wavy var(--fgColor-attention)",
		textDecorationThickness: "var(--borderWidth-thin)",
		textUnderlinePosition: "under",
	},
	".cm-lintPoint-warning:after": {
		borderBottomColor: "var(--fgColor-attention)",
	},
	".cm-diagnostic-warning": { borderLeftColor: "var(--fgColor-attention)" },
	".cm-lintRange-info": {
		backgroundImage: "none",
		textDecoration: "underline dotted var(--fgColor-accent)",
		textDecorationThickness: "var(--borderWidth-thick)",
		textUnderlinePosition: "under",
	},
	".cm-lintPoint-info:after": { borderBottomColor: "var(--fgColor-accent)" },
	".cm-diagnostic-info": { borderLeftColor: "var(--fgColor-accent)" },
	".cm-lintRange-active": { backgroundColor: "var(--bgColor-accent-muted)" },
	// The core's marks. Each colour wins however the highlighter's spans nest with
	// ours (inside or outside), so a code keeps its colour although YAML calls it a key.
	".cm-ref, .cm-ref *": {
		color: "var(--color-prettylights-syntax-string-regexp)",
	},
	".cm-code, .cm-code *": {
		color: "var(--color-prettylights-syntax-constant)",
	},
	".cm-legacy, .cm-legacy *": {
		color: "var(--color-prettylights-syntax-comment)",
	},
	// A hole: Hazel's small box with a question mark, in Primer's attention colours.
	".cm-hole": {
		display: "inline-block",
		marginInlineStart: "var(--base-size-4)",
		paddingInline: "var(--base-size-4)",
		fontFamily: "var(--fontStack-monospace)",
		fontSize: "var(--text-caption-size)",
		lineHeight: "1",
		verticalAlign: "text-bottom",
		color: "var(--fgColor-attention)",
		backgroundColor: "var(--bgColor-attention-muted)",
		border: "var(--borderWidth-thin) solid var(--fgColor-attention)",
		borderRadius: "var(--borderRadius-small)",
	},
	".cm-hole::before": { content: '"?"' },
	// Where a chip sits, CodeMirror's own point marker for the same hole would be a
	// second one. The lint point is a widget at side 0, so it comes just before the chip.
	".cm-lintPoint-hint:has(+ .cm-hole)": {
		display: "none",
	},
	".cm-lintRange-hint": {
		backgroundImage: "none",
		backgroundColor: "var(--bgColor-attention-muted)",
		borderBottom: "var(--borderWidth-thick) dashed var(--fgColor-attention)",
	},
	".cm-lintPoint-hint:after": { borderBottomColor: "var(--fgColor-attention)" },
	".cm-diagnostic-hint": { borderLeftColor: "var(--fgColor-attention)" },
	".cm-finding-hint": { color: "var(--fgColor-muted)" },
	".cm-finding-detail": {
		color: "var(--fgColor-muted)",
		fontFamily: "var(--fontStack-monospace)",
		fontSize: "var(--text-caption-size)",
	},
});

/**
 * Colour marks roles, not grammar. The author's words stay plain at full contrast;
 * field names take Primer's entity colour; comments and punctuation are muted (not
 * read by the tool; the `legacy` block is muted the same way, by its mark). No bold or italic,
 * keywords uncoloured. YAML's grammar gives every plain value one `content` tag and
 * every key, response codes included, `definition(propertyName)`, so telling codes,
 * constants and resolved names apart is the core's job (its marks, drawn as decorations). These
 * are Primer's prettylights tokens, what github.com highlights code with; they would
 * follow Primer's colour-blind themes too, were the app to load them (it loads light
 * and dark only).
 */
const primerHighlight = syntaxHighlighting(
	HighlightStyle.define([
		{
			tag: [tags.propertyName, tags.definition(tags.propertyName)],
			color: "var(--color-prettylights-syntax-entity)",
		},
		{
			tag: [tags.comment, tags.separator, tags.punctuation, tags.meta],
			color: "var(--color-prettylights-syntax-comment)",
		},
		{ tag: tags.invalid, color: "var(--fgColor-danger)" },
	]),
);
