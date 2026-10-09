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
import type { Code } from "./draft.ts";
import { scalar } from "./edit.ts";
import {
	type Env,
	FIELD_OF,
	inScope,
	type Mention,
	type NamedScheme,
} from "./env.ts";
import { scaleSummary } from "./schema.ts";

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

/** Where a picker's choices come from: the core's environment, the livelit itself, or the app. */
export type Source =
	| { readonly kind: "scheme"; readonly scheme: NamedScheme }
	| { readonly kind: "enum"; readonly values: readonly Choice[] };

export type Picker = {
	readonly kind: "one";
	readonly source: Source;
	/** What is written there now, whether or not it is one of the choices. */
	readonly current?: string;
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
}

/** Where a one-line value starts in its field: after the colon and its spaces. */
function valueSpan(source: string, field: Range): Range {
	const text = source.slice(field[0], field[1]);
	let start = text.indexOf(":") + 1;
	while (text[start] === " " || text[start] === "\t") start++;
	return [field[0] + start, field[1]];
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
	},
	kinds: readonly NamedScheme[] = LIVELIT_KINDS,
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
	value: string,
): { readonly text: string; readonly caret: number } | undefined {
	if (value === "") return undefined;
	const [from, to] = livelit.span;
	// Quoted only where YAML needs it (`010`, `yes: no`), as a fix writes a value; at an
	// empty value's point (straight after the colon), with the space it needs.
	const written = from === to ? ` ${scalar(value)}` : scalar(value);
	return {
		text: source.slice(0, from) + written + source.slice(to),
		caret: from + written.length,
	};
}

/** A new shared entry of this kind, named in its dialog, then written at `path`. */
export const createFor = (kind: NamedScheme, path: string): Fix => ({
	kind: "create",
	label: `New ${SCHEME_NAME[kind]}…`,
	create: { scheme: kind, name: "", text: "", path },
});
