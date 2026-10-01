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
import { isolateHistory } from "@codemirror/commands";
import { yaml, yamlLanguage } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
	type Diagnostic,
	forEachDiagnostic,
	setDiagnostics,
} from "@codemirror/lint";
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
	hoverTooltip,
	keymap,
	ViewPlugin,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import issueDraftSvg from "@primer/octicons/build/svg/issue-draft-16.svg?raw";
import { basicSetup, EditorView } from "codemirror";
import { stateExtensions, updateSchema } from "codemirror-json-schema";
import { yamlCompletion } from "codemirror-json-schema/yaml";
import type { Range } from "../core/findings.js";
import type { Mark } from "../core/surface/marks.js";
import { schemaCompletion, withoutInfo } from "./complete.js";

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
	/** Select a range and focus it; `complete` then opens completion there. */
	reveal(range: Range, complete?: boolean): void;
	/** Tear the editor down; React mounts and unmounts the host, so this must exist. */
	destroy(): void;
}

export function createEditor(
	parent: HTMLElement,
	onEdit: (text: string) => void,
	onCursor: (offset: number) => void,
	/** Go to definition: the open file's id, and the offset of the name to follow. */
	onFollow: (id: number, offset: number) => void = () => {},
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
		yamlLanguage.data.of({ autocomplete: withoutInfo(yamlCompletion()) }),
		yamlLanguage.data.of({ autocomplete: schemaCompletion }),
		// No schema hover: the cursor inspector shows a field's description, and a
		// finding's tooltip shows the finding; a third tooltip repeated both.
		stateExtensions(),
		macCompletionKeys,
		quickFixKey,
		// The id `sync` last opened: a follow names the file it was reported against.
		followDefinition((offset) => {
			if (current !== undefined) onFollow(current, offset);
		}),
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
			const now = view.state.doc.toString();
			if (text !== now) {
				// Only what differs, as its own undo step: a quick fix is one Cmd-Z, and
				// the caret outside the change stays where it was.
				view.dispatch({
					changes: changeBetween(now, text),
					annotations: [external.of(true), isolateHistory.of("full")],
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
		reveal([from, to], complete = false) {
			// Never throw from a click: clamp to the document as it is now.
			const end = view.state.doc.length;
			const anchor = Math.min(Math.max(0, from), end);
			const head = Math.min(Math.max(anchor, to), end);
			view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
			view.focus();
			if (complete && !locked) startCompletion(view);
		},
		destroy() {
			view.destroy();
		},
	};
}

/** The one change that turns `a` into `b`: whatever lies between their common prefix and suffix. */
export function changeBetween(
	a: string,
	b: string,
): { readonly from: number; readonly to: number; readonly insert: string } {
	const most = Math.min(a.length, b.length);
	let start = 0;
	while (start < most && a[start] === b[start]) start++;
	let end = 0;
	while (end < most - start && a[a.length - 1 - end] === b[b.length - 1 - end])
		end++;
	return {
		from: start,
		to: a.length - end,
		insert: b.slice(start, b.length - end),
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

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

const MARK_CLASS = {
	ref: Decoration.mark({ class: "cm-ref" }),
	code: Decoration.mark({ class: "cm-code" }),
	legacy: Decoration.mark({ class: "cm-legacy" }),
} as const;

/** Clamped to the document as it is now: a mark past its end is dropped, never thrown. */
function decorationsOf(marks: readonly Mark[], length: number): DecorationSet {
	const list: Ranged<Decoration>[] = [];
	for (const { kind, range } of marks) {
		const from = Math.min(Math.max(0, range[0]), length);
		const to = Math.min(Math.max(from, range[1]), length);
		if (to > from) list.push(MARK_CLASS[kind].range(from, to));
	}
	return Decoration.set(list, true);
}

/** Cmd on a Mac, Ctrl elsewhere (Ctrl-click on a Mac is the context menu). */
const isMod = (e: MouseEvent | KeyboardEvent): boolean =>
	IS_MAC ? e.metaKey : e.ctrlKey;

/**
 * The shared name (a `ref` mark) at `pos`, if any. With a side, as a hover reports it,
 * a name that only ends (or starts) at `pos` on the other side is not under the pointer.
 */
export function refRangeAt(
	state: EditorState,
	pos: number,
	side = 0,
): { from: number; to: number } | undefined {
	let found: { from: number; to: number } | undefined;
	state.field(semantics).between(pos, pos, (from, to, value) => {
		if (value.spec.class !== "cm-ref") return;
		if ((from === pos && side < 0) || (to === pos && side > 0)) return;
		found = { from, to };
	});
	return found;
}

/** The keys that follow a name, as the hover says them. */
const FOLLOW_KEYS = ` (${IS_MAC ? "⌘" : "Ctrl"}-click or F12)`;

/**
 * Go to definition, as an IDE has it. Mod-click on a shared name (the core marked it
 * `ref`) reports its offset; anywhere else Mod-click still adds a cursor, as CodeMirror
 * does. F12 does the same at the caret, and only there (elsewhere F12 is the
 * browser's). While Mod is held the names underline, as VS Code's do: the state is a
 * class on the content, set as CodeMirror's own crosshairCursor sets its cursor.
 * Hovering a name offers it as a fix's tooltip offers a fix: a link, its keys muted after
 * it (our own markup, styled with lint's action, never lint's classes). None of it on
 * another author's version (read only), which never follows.
 * `update` decides what the name opens; this only says where the author pointed.
 */
function followDefinition(onFollow: (offset: number) => void) {
	const held = ViewPlugin.fromClass(
		class {
			on = false;
			constructor(readonly view: EditorView) {}
			set(on: boolean) {
				if (on === this.on) return;
				this.on = on;
				this.view.update([]);
			}
		},
		{
			eventObservers: {
				keydown(e) {
					this.set(isMod(e));
				},
				keyup(e) {
					this.set(isMod(e));
				},
				// Also on movement: a keyup lost to Cmd-Tab would leave it stuck on.
				mousemove(e) {
					this.set(isMod(e));
				},
			},
			provide: (plugin) =>
				EditorView.contentAttributes.of((view) =>
					view.plugin(plugin)?.on && !view.state.readOnly
						? { class: "cm-follow" }
						: null,
				),
		},
	);
	return [
		held,
		hoverTooltip(
			(view, pos, side) => {
				if (view.state.readOnly) return null;
				const ref = refRangeAt(view.state, pos, side);
				if (ref === undefined) return null;
				return {
					pos: ref.from,
					end: ref.to,
					above: false,
					create: () => {
						const dom = document.createElement("div");
						dom.className = "cm-follow-tip";
						const go = document.createElement("button");
						go.type = "button";
						go.className = "cm-action";
						go.textContent = "Go to definition";
						go.addEventListener("click", () => onFollow(ref.from));
						const keys = document.createElement("span");
						keys.className = "cm-action-keys";
						keys.textContent = FOLLOW_KEYS;
						dom.append(go, keys);
						return { dom };
					},
				};
			},
			// Closed by any edit: the button's offset was taken when it was drawn, and a
			// click must never follow a place that has since moved.
			{ hideOnChange: true },
		),
		EditorView.domEventHandlers({
			mousedown(e, view) {
				if (!isMod(e) || e.button !== 0 || view.state.readOnly) return false;
				const target = e.target instanceof Element ? e.target : null;
				const name = target?.closest(".cm-ref");
				if (!name) return false;
				e.preventDefault();
				onFollow(view.posAtDOM(name));
				return true;
			},
		}),
		keymap.of([
			{
				key: "F12",
				run: (view) => {
					const head = view.state.selection.main.head;
					if (view.state.readOnly || !refRangeAt(view.state, head))
						return false;
					onFollow(head);
					return true;
				},
			},
		]),
	];
}

/**
 * Quick fix, with VS Code's key: Cmd-. (Ctrl-. elsewhere) applies the fix of the first
 * finding at the caret that has one, the one its tooltip shows first. Nothing to fix
 * there, and the key is left alone. The tooltip opens on hover, the key acts at the
 * caret: VS Code has the same gap, accepted.
 */
const quickFixKey = Prec.high(
	keymap.of([
		{
			key: "Mod-.",
			run: (view) => {
				const head = view.state.selection.main.head;
				let fix: (() => void) | undefined;
				forEachDiagnostic(view.state, (d, from, to) => {
					const action = d.actions?.[0];
					if (fix === undefined && action && from <= head && head <= to)
						fix = () => action.apply(view, from, to);
				});
				fix?.();
				return fix !== undefined;
			},
		},
	]),
);

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
 *
 * Contrast (WCAG 2.2, measured 2026-09-29 against Primer primitives 11.10, light and
 * dark, the themes the app loads): every text colour is at least 4.5:1 on the editor,
 * the active line and the hole and lint tints; underlines and the hole icon at least
 * 3:1 (1.4.11). One accepted shortfall (owner, 2026-09-29): muted text (comments,
 * punctuation, `legacy`) on the selection, as low as 2.94:1 in dark over the active
 * line. `drawSelection` paints selection behind the text, so only the background could
 * change, and a paler one would leave the selection barely distinct from the active
 * line; Primer's own pairing does the same. Meaning never rests on colour alone
 * (1.4.1): holes and warnings share amber but differ in form (dashed and a circle,
 * wavy), as do errors and names (a wavy line, a text colour).
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
	// What a name refers to, on its own row (complete.ts): muted, 6.11:1 light and
	// 7.05:1 dark, 5.37 and 6.46 on the selected row. The row already truncates with an
	// ellipsis, and the detail comes last, so it gives way before the name does.
	".cm-completionDetail": {
		color: "var(--fgColor-muted)",
		fontStyle: "normal",
		marginInlineStart: "var(--base-size-8)",
	},
	// A list that shows content keeps one width while the filter narrows it, so it never
	// jumps as the author types.
	".cm-tooltip-autocomplete:has(.cm-completionDetail)": {
		inlineSize: "min(60ch, 95vw)",
	},
	".cm-tooltip-autocomplete:has(.cm-completionDetail) > ul": {
		inlineSize: "100%",
	},
	".cm-panels": {
		color: "var(--fgColor-default)",
		backgroundColor: "var(--bgColor-muted)",
	},
	// Problems by severity, told apart by line style as well as colour (so colour-
	// vision deficiency never hides one): wavy for errors and warnings, dotted for
	// info, dashed for holes (hint). Primer tokens replace CodeMirror's fixed-colour
	// squiggle images. Where findings overlap, CodeMirror draws only the most severe, so
	// a hole inside an error shows as the error; an empty hole keeps its chip (a widget).
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
		color: "var(--prettylights-syntax-stringRegexp)",
	},
	// With Cmd (Ctrl) held, a shared name is a link, underlined as the app's links are.
	".cm-content.cm-follow .cm-ref:hover, .cm-content.cm-follow .cm-ref:hover *":
		{
			cursor: "pointer",
			textDecorationLine: "underline",
			textUnderlinePosition: "under",
			textDecorationThickness: "var(--borderWidth-thin)",
		},
	".cm-code, .cm-code *": {
		color: "var(--prettylights-syntax-constant)",
	},
	".cm-legacy, .cm-legacy *": {
		color: "var(--prettylights-syntax-comment)",
	},
	// A hole: CodeMirror's own point marker (one per place, however many holes it holds),
	// drawn as Primer's dashed circle (`IssueDraftIcon`), as in the Findings panel, so one
	// shape means "to fill in" everywhere. One em square so it matches the glyphs and
	// never grows the line; the icon is a mask, coloured by `currentColor`. Forced
	// colours keep it visible (below).
	".cm-lintPoint-hint": {
		display: "inline-block",
		inlineSize: "1em",
		blockSize: "1em",
		marginInlineStart: "var(--base-size-4)",
		verticalAlign: "text-bottom",
		color: "var(--fgColor-attention)",
		backgroundColor: "currentColor",
		mask: `url("data:image/svg+xml,${encodeURIComponent(issueDraftSvg)}") center / contain no-repeat`,
	},
	".cm-lintPoint-hint:after": { display: "none" },
	// Forced colours override backgrounds, which would blank the mask: the text colour.
	"@media (forced-colors: active)": {
		".cm-lintPoint-hint": {
			forcedColorAdjust: "none",
			backgroundColor: "CanvasText",
		},
	},
	// A dashed underline, not a dashed border: a border spaces its dashes to fit its
	// width, so every keystroke in the hole moved them all (measured: this holds still).
	".cm-lintRange-hint": {
		backgroundImage: "none",
		backgroundColor: "var(--bgColor-attention-muted)",
		textDecoration: "underline dashed var(--fgColor-attention)",
		textDecorationThickness: "var(--borderWidth-thick)",
		textUnderlinePosition: "under",
	},
	".cm-diagnostic-hint": { borderLeftColor: "var(--fgColor-attention)" },
	// A finding's fix, as an IDE offers one: a link on its own line under the message,
	// level with it, not CodeMirror's grey pill; its key muted after it (Mod-., above),
	// on the first fix a tooltip shows only, since that is the one the key applies.
	".cm-diagnosticAction, .cm-action": {
		display: "block",
		margin: "var(--base-size-4) 0 0",
		padding: 0,
		border: "none",
		borderRadius: 0,
		background: "none",
		color: "var(--fgColor-accent)",
		font: "inherit",
		textAlign: "start",
		cursor: "pointer",
	},
	".cm-diagnosticAction:hover, .cm-action:hover": {
		textDecorationLine: "underline",
		textUnderlinePosition: "under",
		textDecorationThickness: "var(--borderWidth-thin)",
	},
	".cm-diagnosticAction:focus-visible, .cm-action:focus-visible": {
		outline: "var(--focus-outline)",
		outlineOffset: "var(--base-size-2)",
	},
	// Go to definition's tooltip: padded as a finding's, so the two read as one family;
	// its link inline, its keys after it.
	".cm-follow-tip": {
		padding: "var(--base-size-4) var(--base-size-8)",
	},
	".cm-follow-tip .cm-action": {
		display: "inline",
		margin: 0,
	},
	".cm-action-keys": { color: "var(--fgColor-muted)" },
	".cm-quickFix::after": {
		content: `" (${IS_MAC ? "⌘." : "Ctrl-."})"`,
		color: "var(--fgColor-muted)",
		display: "inline-block",
		textDecoration: "none",
		whiteSpace: "pre",
	},
	".cm-diagnostic:has(.cm-quickFix) ~ .cm-diagnostic .cm-quickFix::after": {
		content: "none",
	},
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
			color: "var(--prettylights-syntax-entity)",
		},
		{
			tag: [tags.comment, tags.separator, tags.punctuation, tags.meta],
			color: "var(--prettylights-syntax-comment)",
		},
		{ tag: tags.invalid, color: "var(--fgColor-danger)" },
	]),
);
