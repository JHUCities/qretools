/**
 * Livelits (Omar et al., "Filling Typed Holes with Live GUIs", PLDI 2021), as a text
 * editor can have them: a control persistent at a field, whether it's still empty or
 * already holds a value, which opens a picker of what can go there. The text stays the
 * only truth: choosing rewrites the field's value. No splices. Pure: where the pickers
 * go comes from the parse, what can be chosen from the environment (or the app, for what
 * only it holds), and the text a choice writes from `applyLivelit`.
 *
 * A choice names its livelit by `id` (its place), never by offsets: `update` finds the
 * livelit again in the text as it is now and writes there. (A finding's fix keeps its
 * path edits instead: the Findings list shows settled, older findings, so a fix must
 * outlive the text it was offered for; a picker closes on any edit.)
 */
import { SCHEME_NAME } from "../copy.ts";
import type { Fix, Range } from "../findings.ts";
import { labelsKey } from "../fold.ts";
import type { Code, Draft } from "./draft.ts";
import { scalar, sharedScaleSource } from "./edit.ts";
import {
	type Env,
	FIELD_OF,
	inScope,
	type Mention,
	type NamedScheme,
} from "./env.ts";
import { describe, REQUIRABLE_KEYS, scaleSummary } from "./schema.ts";

/** The kinds of shared entry a field can be picked for: every field that names one. */
export const LIVELIT_KINDS: readonly NamedScheme[] = [
	"concept",
	"universe",
	"scale",
	"unit",
	"instruction",
];

/** One thing the author can choose, with what it says. */
export interface Choice {
	readonly name: string;
	/** Its words: a scale's labels, a concept's or unit's label, a universe's text. */
	readonly detail: string;
	/** A scale's options, code by code. */
	readonly codes?: readonly Code[];
}

/**
 * Where a picker's choices come from: the core's environment, the livelit itself, or the
 * app: an instrument's banks' questions (`questionChoices`), the banks it can use
 * (`bankChoices`).
 */
export type Source =
	| { readonly kind: "scheme"; readonly scheme: NamedScheme }
	| { readonly kind: "enum"; readonly values: readonly Choice[] }
	| { readonly kind: "questions" }
	| { readonly kind: "banks" }
	/** The codes of the coded answer a condition names (`codeChoices`). */
	| { readonly kind: "codes"; readonly name: string };

/**
 * What a picker opened on: its choices, or why there are none to offer (a condition's
 * name that has no codes), which it says instead.
 */
export type Offered = readonly Choice[] | { readonly reason: string };

export type Picker =
	| {
			/** One value: choosing it writes it. */
			readonly kind: "one";
			readonly source: Source;
			/** What is written there now, whether or not it is one of the choices. */
			readonly current?: string;
	  }
	| {
			/**
			 * Nothing to choose, only things to do with what is written (its actions), as an
			 * editor's code actions: inline options offer to become a shared scale.
			 */
			readonly kind: "actions";
	  }
	| {
			/** A set of values, chosen together: applying writes them all as a list. */
			readonly kind: "many";
			readonly source: Source;
			/** What the list holds now. */
			readonly chosen: readonly string[];
			/** The fewest that may be applied, when fewer would be wrong (a set needs one). */
			readonly min?: number;
	  };

export interface Livelit {
	/** Its place, as findings name places: what a choice names it by. */
	readonly id: string;
	/** What the button and the picker are called: "Choose a shared scale". */
	readonly label: string;
	/** Where the button is drawn: just after the value, or at the empty value's point. */
	readonly at: number;
	/** The field as written, key to value: the caret anywhere on it opens the picker. */
	readonly field: Range;
	/** The text a choice replaces: the value, or the empty value's point. */
	readonly span: Range;
	readonly picker: Picker;
	/** What else it offers, below the choices: "New shared scale…". */
	readonly actions: readonly Fix[];
	/**
	 * A set of codes inside a condition (`x in {"1", "2"}`): written as the condition
	 * language writes one, raw, escaped for the YAML scalar holding it.
	 */
	readonly set?: "plain" | "double" | "single";
}

/**
 * A field's value as text: from after the colon and its spaces to the value's last
 * character. A block value (a list on the lines below) starts at its newline, so writing
 * there replaces the whole block.
 */
export function valueSpan(source: string, field: Range): Range {
	const text = source.slice(field[0], field[1]);
	let start = text.indexOf(":") + 1;
	while (text[start] === " " || text[start] === "\t") start++;
	let end = text.length;
	while (end > start && /\s/.test(text[end - 1] ?? "")) end--;
	return [field[0] + start, field[0] + end];
}

/** A value a fixed-choice picker can replace: nothing yet, or one plain word. */
const WORD = /^[A-Za-z_][\w-]*$/;

/** The fixed choices of a question's own fields: how many may be chosen, a fill's type. */
const SELECT: readonly Choice[] = [
	{ name: "one", detail: "The respondent picks one response" },
	{ name: "many", detail: "Select all that apply" },
];
const FILL_TYPE: readonly Choice[] = [
	{ name: "number", detail: "A number, such as a count or an amount" },
	{ name: "text", detail: "Words" },
];

/** A picker of fixed values at a field written empty or as one word; none elsewhere. */
export function enumAt(
	source: string,
	parsed: {
		readonly ranges: Readonly<Record<string, Range>>;
		readonly empties: Readonly<Record<string, number>>;
	},
	id: string,
	label: string,
	values: readonly Choice[],
): Livelit[] {
	const field = parsed.ranges[id];
	if (field === undefined) return [];
	const source_ = { kind: "enum" as const, values };
	const empty = parsed.empties[id];
	if (empty !== undefined)
		return [
			{
				id,
				label,
				at: empty,
				field,
				span: [empty, empty],
				picker: { kind: "one", source: source_ },
				actions: [],
			},
		];
	const span = valueSpan(source, field);
	const written = source.slice(span[0], span[1]);
	return WORD.test(written)
		? [
				{
					id,
					label,
					at: span[1],
					field,
					span,
					picker: { kind: "one", source: source_, current: written },
					actions: [],
				},
			]
		: [];
}

/**
 * The pickers of a question: each field that names a shared entry (`FIELD_OF`), written
 * either empty or as a bare name. Not prose, and not a scale's options written inline:
 * those are the author's own words, which a picker would replace.
 */
export function livelitsOf(
	source: string,
	parsed: {
		readonly ranges: Readonly<Record<string, Range>>;
		readonly empties: Readonly<Record<string, number>>;
		readonly mentions: readonly Mention[];
		readonly draft: Draft;
	},
	/** What it was read against: options a shared scale already has aren't offered to share. */
	env: Env,
): readonly Livelit[] {
	const fills = Object.keys(parsed.ranges).filter((p) =>
		/^fills\.[^.]+$/.test(p),
	);
	return [
		...namedLivelits(source, parsed, LIVELIT_KINDS),
		...shareLivelit(source, parsed, env),
		...enumAt(
			source,
			parsed,
			"select",
			"Choose how many may be chosen",
			SELECT,
		),
		...fills.flatMap((id) =>
			enumAt(source, parsed, id, "Choose the fill's type", FILL_TYPE),
		),
	];
}

/**
 * At options written inline, an offer to make them a shared scale, when that loses
 * nothing (plain `code: label` lines, `sharedScaleSource`) and no shared scale already has
 * these labels: then `matches-scale` offers its name instead, and only that is offered.
 */
function shareLivelit(
	source: string,
	parsed: {
		readonly ranges: Readonly<Record<string, Range>>;
		readonly draft: Draft;
	},
	env: Env,
): Livelit[] {
	const field = parsed.ranges.responses;
	const { domain } = parsed.draft;
	if (
		field === undefined ||
		domain?.kind !== "responses" ||
		domain.scale !== undefined ||
		sharedScaleSource(source) === undefined
	)
		return [];
	const key = labelsKey(domain.codes);
	if (Object.values(env.scales).some((s) => labelsKey(s.codes) === key))
		return [];
	// The button after the field's key, on its own line: the options are below it.
	const keyEnd = field[0] + "responses:".length;
	return [
		{
			id: "responses",
			label: "Share these responses",
			at: keyEnd,
			field,
			span: [keyEnd, keyEnd],
			picker: { kind: "actions" },
			actions: [
				{
					kind: "share",
					label: "Make these a shared scale…",
					path: "responses",
				},
			],
		},
	];
}

function namedLivelits(
	source: string,
	parsed: {
		readonly ranges: Readonly<Record<string, Range>>;
		readonly empties: Readonly<Record<string, number>>;
		readonly mentions: readonly Mention[];
	},
	kinds: readonly NamedScheme[],
): readonly Livelit[] {
	return kinds.flatMap((scheme): Livelit[] => {
		const id = FIELD_OF[scheme];
		const field = parsed.ranges[id];
		if (field === undefined) return [];
		const common = {
			id,
			label: `Choose a ${SCHEME_NAME[scheme]}`,
			field,
			actions: [createFor(scheme, id)],
		};
		const empty = parsed.empties[id];
		if (empty !== undefined)
			return [
				{
					...common,
					at: empty,
					span: [empty, empty],
					picker: { kind: "one", source: { kind: "scheme", scheme } },
				},
			];
		const named = parsed.mentions.find(
			(m) => m.scheme === scheme && m.path === id,
		);
		return named === undefined
			? []
			: [
					{
						...common,
						at: field[1],
						span: valueSpan(source, field),
						picker: {
							kind: "one",
							source: { kind: "scheme", scheme },
							current: named.name,
						},
					},
				];
	});
}

/**
 * What the environment offers for a kind, in the bank's order, each with its words: a
 * scale's labels (and codes), a concept's or unit's label, a universe's or instruction's
 * text. One branch per kind, so a change to an entry's shape is the compiler's to catch.
 */
export function choicesOf(env: Env, kind: NamedScheme): readonly Choice[] {
	switch (kind) {
		case "scale":
			return Object.entries(env.scales).map(([name, scale]) => ({
				name,
				detail: scaleSummary(scale),
				codes: scale.codes,
			}));
		case "concept":
		case "unit":
			return Object.entries(inScope(env, kind)).map(([name, e]) => ({
				name,
				detail: e.label,
			}));
		case "universe":
		case "instruction":
			return Object.entries(inScope(env, kind)).map(([name, e]) => ({
				name,
				detail: e.text,
			}));
		default:
			return kind satisfies never;
	}
}

/** The choices a source holds itself, or undefined for one the environment or app resolves. */
export const ownChoices = (source: Source): readonly Choice[] | undefined =>
	source.kind === "enum" ? source.values : undefined;

/**
 * The text with `value` written at the livelit (found again in this very text, so its
 * span is current), and where the caret goes: after what was written. Undefined when
 * there is nothing to write.
 */
export function applyLivelit(
	source: string,
	livelit: Livelit,
	value: string | readonly string[],
): { readonly text: string; readonly caret: number } | undefined {
	// An actions picker has nothing to choose: nothing is ever written through it.
	if (value === "" || livelit.picker.kind === "actions") return undefined;
	const [from, to] = livelit.span;
	// Quoted only where YAML needs it (`010`, `yes: no`), as a fix writes a value. A list
	// keeps the author's form: a block list stays a block at its indent (a comment on an
	// item is lost with it), anything else is written on one line, `[title, concept]`.
	// Straight after the colon (an empty value) it takes the space it needs.
	const block = /^\n([ \t]*)-/.exec(source.slice(from, to));
	const text =
		livelit.set !== undefined
			? setText(typeof value === "string" ? [value] : value, livelit.set)
			: typeof value === "string"
				? scalar(value)
				: block !== null && value.length > 0
					? value.map((v) => `\n${block[1]}- ${scalar(v)}`).join("")
					: `[${value.map(scalar).join(", ")}]`;
	if (text === undefined) return undefined;
	const written =
		source[from - 1] === ":" && !text.startsWith("\n") ? ` ${text}` : text;
	// Nothing changes (an Apply with the same ticks): nothing is written, no undo step.
	if (written === source.slice(from, to)) return undefined;
	return {
		text: source.slice(0, from) + written + source.slice(to),
		caret: from + written.length,
	};
}

/**
 * A set of codes as a condition writes it, `{"1", "2"}`, for the scalar holding it: inside
 * double quotes each `"` is `\"`. Undefined for a code that can't be written there (one
 * holding a quote or a backslash, which codes never do), never a guess at escaping.
 */
function setText(
	codes: readonly string[],
	form: NonNullable<Livelit["set"]>,
): string | undefined {
	if (codes.some((c) => /["'\\]/.test(c))) return undefined;
	const quote = form === "double" ? '\\"' : '"';
	return `{${codes.map((c) => `${quote}${c}${quote}`).join(", ")}}`;
}

/**
 * The picker of a bank's details (`bank.yaml`): which fields every question must also
 * have, chosen together as a checklist, where `required` is written (empty or a list).
 */
export function settingsLivelits(
	source: string,
	index: {
		readonly ranges: Readonly<Record<string, Range>>;
		readonly empties: Readonly<Record<string, number>>;
	},
	chosen: readonly string[],
): readonly Livelit[] {
	const id = "required";
	const field = index.ranges[id];
	if (field === undefined) return [];
	const empty = index.empties[id];
	const span: Range =
		empty !== undefined ? [empty, empty] : valueSpan(source, field);
	return [
		{
			id,
			label: "Choose the fields every question must have",
			at: span[1],
			field,
			span,
			picker: {
				kind: "many",
				source: {
					kind: "enum",
					values: REQUIRABLE_KEYS.map((name) => ({
						name,
						detail: describe(name),
					})),
				},
				chosen,
			},
			actions: [],
		},
	];
}

/** A new shared entry of this kind, named in its dialog, then written at `path`. */
export const createFor = (kind: NamedScheme, path: string): Fix => ({
	kind: "create",
	label: `New ${SCHEME_NAME[kind]}…`,
	create: { scheme: kind, name: "", text: "", path },
});
