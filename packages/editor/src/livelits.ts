/**
 * Livelits in the editor: the core says which fields can be picked for (`Livelit`) and
 * what there is to choose (`Choice`); this draws a small button after each such field
 * and, when it is pressed (or Mod-. is pressed with the caret on the field), a picker as
 * a CodeMirror tooltip, outside the editable text. Choosing hands back a `Fix` (the
 * core's `useName`, or `createFor` a new one), which the app applies as it applies any
 * fix: the text stays the only truth, and nothing here decides about surveys.
 */
import {
	Prec,
	type Range as Ranged,
	StateEffect,
	StateField,
} from "@codemirror/state";
import {
	Decoration,
	EditorView,
	keymap,
	showTooltip,
	type Tooltip,
	WidgetType,
} from "@codemirror/view";
import triangleDownSvg from "@primer/octicons/build/svg/triangle-down-16.svg?raw";
import { type Fix, SCHEME_NAME } from "@qretools/core";
import {
	type Choice,
	createFor,
	type Livelit,
	useName,
} from "@qretools/core/editor";

/** What the app gives the editor so it can offer livelits: read when a picker opens. */
export interface LivelitHost {
	/** What there is to choose for a kind, from the open file's environment as it is now. */
	choices(kind: Livelit["kind"]): readonly Choice[];
	/** Apply what was chosen, as a fix is applied. */
	choose(fix: Fix): void;
}

/** The fields that can be picked for, as the core gave them for the text as it is now. */
export const setLivelits = StateEffect.define<readonly Livelit[]>();
const openPicker = StateEffect.define<Livelit | null>();

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
/** The key that opens a picker at the caret, as this platform writes it. */
export const PICK_KEY = IS_MAC ? "⌘." : "Ctrl-.";
const KEYS = PICK_KEY;

/** The livelits, mapped through edits until the next ones arrive with the marks. */
const livelitField = StateField.define<readonly Livelit[]>({
	create: () => [],
	update(livelits, tr) {
		for (const e of tr.effects) if (e.is(setLivelits)) return e.value;
		if (!tr.docChanged) return livelits;
		return livelits.map((l) => ({
			...l,
			at: tr.changes.mapPos(l.at, 1),
			field: [
				tr.changes.mapPos(l.field[0], -1),
				tr.changes.mapPos(l.field[1], 1),
			] as const,
		}));
	},
});

/** The picker open, if any: closed by any edit, since its place was taken before it. */
const pickerField = StateField.define<Livelit | null>({
	create: () => null,
	update(open, tr) {
		for (const e of tr.effects) if (e.is(openPicker)) return e.value;
		return tr.docChanged ? null : open;
	},
});

/** The button after a field: one per livelit, as wide as an icon, moving no line. */
class PickerButton extends WidgetType {
	constructor(
		readonly livelit: Livelit,
		readonly empty: boolean,
		/** Its picker is open: said as `aria-expanded`, as its `aria-haspopup` promises. */
		readonly expanded: boolean,
	) {
		super();
	}
	override eq(other: PickerButton): boolean {
		return (
			other.livelit.kind === this.livelit.kind &&
			other.livelit.path === this.livelit.path &&
			other.empty === this.empty &&
			other.expanded === this.expanded
		);
	}
	override toDOM(view: EditorView): HTMLElement {
		const button = document.createElement("button");
		button.type = "button";
		button.className = this.empty
			? "cm-livelit cm-livelit-empty"
			: "cm-livelit";
		const what = SCHEME_NAME[this.livelit.kind];
		button.setAttribute("aria-label", `Choose a ${what}`);
		button.title = `Choose a ${what} (${KEYS})`;
		button.setAttribute("aria-haspopup", "dialog");
		button.setAttribute("aria-expanded", String(this.expanded));
		// The caret stays where it is: the button opens the picker, it isn't text.
		button.addEventListener("mousedown", (e) => e.preventDefault());
		button.addEventListener("click", () => {
			const livelit = view.state
				.field(livelitField)
				.find(
					(l) => l.kind === this.livelit.kind && l.path === this.livelit.path,
				);
			if (livelit !== undefined)
				view.dispatch({ effects: openPicker.of(livelit) });
		});
		return button;
	}
	override ignoreEvent(): boolean {
		return true;
	}
}

const buttons = EditorView.decorations.compute(
	[livelitField, pickerField],
	(state) => {
		const open = state.field(pickerField);
		return Decoration.set(
			state.field(livelitField).map(
				(l): Ranged<Decoration> =>
					Decoration.widget({
						widget: new PickerButton(
							l,
							l.current === undefined,
							open !== null && open.kind === l.kind && open.path === l.path,
						),
						side: 1,
					}).range(l.at),
			),
			true,
		);
	},
);

/** The picker, below the field: what there is to choose, then a new one. */
function picker(host: LivelitHost) {
	return showTooltip.compute([pickerField], (state): Tooltip | null => {
		const open = state.field(pickerField);
		if (open === null) return null;
		return {
			pos: open.at,
			above: false,
			create: (view) => pickerDOM(view, host, open),
		};
	});
}

/** Lists longer than this get a filter first. */
const FILTER_FROM = 8;

function pickerDOM(view: EditorView, host: LivelitHost, open: Livelit) {
	const what = SCHEME_NAME[open.kind];
	const choices = host.choices(open.kind);
	const dom = document.createElement("div");
	dom.className = "cm-livelit-picker";
	dom.setAttribute("role", "dialog");
	dom.setAttribute("aria-label", `Choose a ${what}`);
	const close = (refocus: boolean) => {
		view.dispatch({ effects: openPicker.of(null) });
		if (refocus) view.focus();
	};
	const choose = (fix: Fix) => {
		close(false);
		host.choose(fix);
	};
	const list = document.createElement("ul");
	list.className = "cm-livelit-list";
	const items = choices.map((c) => {
		const li = document.createElement("li");
		const button = document.createElement("button");
		button.type = "button";
		button.className = "cm-livelit-choice";
		if (c.name === open.current) button.setAttribute("aria-current", "true");
		const name = document.createElement("span");
		name.className = "cm-livelit-name";
		name.textContent = c.name;
		button.append(name);
		if (c.detail !== "") {
			const detail = document.createElement("span");
			detail.className = "cm-livelit-detail";
			detail.textContent = c.detail;
			button.append(detail);
		}
		button.addEventListener("click", () => choose(useName(open.path, c.name)));
		li.append(button);
		list.append(li);
		return { choice: c, li, button };
	});
	const visible = () => items.filter((i) => !i.li.hidden).map((i) => i.button);
	let filter: HTMLInputElement | undefined;
	if (choices.length > FILTER_FROM) {
		filter = document.createElement("input");
		filter.type = "search";
		filter.className = "cm-livelit-filter";
		filter.placeholder = `Filter ${what}s`;
		filter.setAttribute("aria-label", `Filter ${what}s`);
		const input = filter;
		input.addEventListener("input", () => {
			const q = input.value.trim().toLowerCase();
			for (const i of items)
				i.li.hidden =
					q !== "" &&
					!`${i.choice.name} ${i.choice.detail}`.toLowerCase().includes(q);
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				visible()[0]?.focus();
			}
			if (e.key === "Enter") {
				const [only] = visible();
				if (visible().length === 1 && only) {
					e.preventDefault();
					only.click();
				}
			}
		});
		dom.append(input);
	}
	if (choices.length === 0) {
		const none = document.createElement("p");
		none.className = "cm-livelit-none";
		none.textContent = `No ${what}s yet.`;
		dom.append(none);
	} else dom.append(list);
	const create = document.createElement("button");
	create.type = "button";
	create.className = "cm-action cm-livelit-create";
	const fresh = createFor(open.kind, open.path);
	create.textContent = fresh.label;
	create.addEventListener("click", () => choose(fresh));
	dom.append(create);
	// A press on one of the picker's buttons keeps focus where it is: Safari and Firefox on
	// a Mac don't focus a clicked button, so focus would leave for nowhere (a null
	// `relatedTarget`), the picker would close, and the click would never land.
	dom.addEventListener("mousedown", (e) => {
		if ((e.target as Element).closest("button")) e.preventDefault();
	});
	// Arrows move through the choices, as in a menu; Escape gives the caret back.
	dom.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			close(true);
			return;
		}
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const all = [...visible(), create];
		const at = all.indexOf(document.activeElement as HTMLButtonElement);
		if (at === -1) return;
		e.preventDefault();
		const next = e.key === "ArrowDown" ? at + 1 : at - 1;
		if (next < 0) filter?.focus();
		else all[Math.min(next, all.length - 1)]?.focus();
	});
	// Focus leaving the picker for anywhere else closes it.
	dom.addEventListener("focusout", (e) => {
		const to = e.relatedTarget as Node | null;
		if (to === null || !dom.contains(to)) close(false);
	});
	return {
		dom,
		mount() {
			const current = items.find((i) => i.choice.name === open.current);
			(filter ?? current?.button ?? items[0]?.button ?? create).focus();
		},
	};
}

/** Mod-. with the caret on a field that can be picked for: open its picker. */
const pickerKey = Prec.highest(
	keymap.of([
		{
			key: "Mod-.",
			run: (view) => {
				const head = view.state.selection.main.head;
				const livelit = view.state
					.field(livelitField)
					.find((l) => l.field[0] <= head && head <= l.at);
				if (livelit === undefined) return false;
				view.dispatch({ effects: openPicker.of(livelit) });
				return true;
			},
		},
	]),
);

/** Everything a livelit needs in the editor, given the app's host. */
export const livelits = (host: LivelitHost) => [
	livelitField,
	pickerField,
	buttons,
	picker(host),
	pickerKey,
	livelitTheme,
];

const livelitTheme = EditorView.baseTheme({
	// An icon-wide button after the field, its icon a mask in the muted text colour; after
	// an empty field it clears the hole's circle (drawn 4px past the point, 1em wide).
	".cm-livelit": {
		display: "inline-block",
		inlineSize: "1em",
		blockSize: "1em",
		marginInlineStart: "var(--base-size-4)",
		padding: 0,
		border: "none",
		verticalAlign: "text-bottom",
		backgroundColor: "var(--fgColor-muted)",
		mask: `url("data:image/svg+xml,${encodeURIComponent(triangleDownSvg)}") center / contain no-repeat`,
		cursor: "pointer",
	},
	// Past the hole's circle (editor.ts draws it at --cm-hole-inset, --cm-hole-size wide).
	".cm-livelit-empty": {
		marginInlineStart:
			"calc(var(--cm-hole-inset) + var(--cm-hole-size) + var(--base-size-4))",
	},
	".cm-livelit:hover": { backgroundColor: "var(--fgColor-accent)" },
	"@media (forced-colors: active)": {
		".cm-livelit": { forcedColorAdjust: "none", backgroundColor: "ButtonText" },
	},
	".cm-livelit-picker": {
		padding: "var(--base-size-8)",
		display: "grid",
		gap: "var(--base-size-8)",
		inlineSize: "min(48ch, 90vw)",
	},
	".cm-livelit-filter": {
		font: "inherit",
		padding: "var(--base-size-4) var(--base-size-8)",
		border: "var(--borderWidth-thin) solid var(--borderColor-default)",
		borderRadius: "var(--borderRadius-medium)",
		backgroundColor: "var(--bgColor-default)",
		color: "var(--fgColor-default)",
	},
	".cm-livelit-list": {
		listStyle: "none",
		margin: 0,
		padding: 0,
		maxBlockSize: "16lh",
		overflowY: "auto",
	},
	".cm-livelit-choice": {
		display: "grid",
		inlineSize: "100%",
		padding: "var(--base-size-4) var(--base-size-8)",
		border: "none",
		borderRadius: "var(--borderRadius-medium)",
		background: "none",
		color: "inherit",
		font: "inherit",
		textAlign: "start",
		cursor: "pointer",
	},
	".cm-livelit-choice:hover, .cm-livelit-choice:focus-visible": {
		backgroundColor: "var(--bgColor-accent-muted)",
		outline: "none",
	},
	".cm-livelit-choice[aria-current]": { fontWeight: "600" },
	".cm-livelit-name": {
		color: "var(--prettylights-syntax-stringRegexp)",
		fontFamily: "var(--fontStack-monospace)",
	},
	// Whole, wrapping: a scale's labels are what it's chosen by.
	".cm-livelit-detail": {
		color: "var(--fgColor-muted)",
		fontSize: "var(--text-body-size-small)",
	},
	".cm-livelit-none": { margin: 0, color: "var(--fgColor-muted)" },
	".cm-livelit-create": { margin: 0 },
});
