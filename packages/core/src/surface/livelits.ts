/**
 * Livelits (Omar et al., "Filling Typed Holes with Live GUIs", PLDI 2021), as a text
 * editor can have them: a control persistent at a field that names a shared entry,
 * whether it's still empty or already names one, which opens a picker of the entries in
 * scope. The text stays the only truth: choosing writes the name, an ordinary edit by
 * path. No splices. Pure: where the fields are comes from the parse, what can be chosen
 * from the environment, and the edit is built when the author chooses.
 */
import { SCHEME_NAME } from "../copy.ts";
import type { Fix, Range } from "../findings.ts";
import type { Code } from "./draft.ts";
import {
	type Env,
	FIELD_OF,
	inScope,
	type Mention,
	type NamedScheme,
} from "./env.ts";
import { scaleSummary } from "./schema.ts";

/** The kinds a field can be picked for. Scales first; the others follow. */
export const LIVELIT_KINDS: readonly NamedScheme[] = ["scale"];

export interface Livelit {
	readonly kind: NamedScheme;
	/** The field, as findings and fixes name places. */
	readonly path: string;
	/** Where its control is drawn: just after the name, or at the empty value's point. */
	readonly at: number;
	/** The field as written, key to value: the caret anywhere on it opens the picker. */
	readonly field: Range;
	/** The name written there, whether or not anything has it. */
	readonly current?: string;
}

/** One entry the author can choose, with what it says. */
export interface Choice {
	readonly name: string;
	/** Its words: a scale's labels, a concept's or unit's label, a universe's text. */
	readonly detail: string;
	/** A scale's options, code by code. */
	readonly codes?: readonly Code[];
}

/**
 * The fields that can be picked for: each kind's field (`FIELD_OF`), written either empty
 * or as a bare name. Not prose, and not a scale's options written inline: those are the
 * author's own words, which a picker would replace.
 */
export function livelitsOf(
	parsed: {
		readonly ranges: Readonly<Record<string, Range>>;
		readonly empties: Readonly<Record<string, number>>;
		readonly mentions: readonly Mention[];
	},
	kinds: readonly NamedScheme[] = LIVELIT_KINDS,
): readonly Livelit[] {
	return kinds.flatMap((kind): Livelit[] => {
		const path = FIELD_OF[kind];
		const field = parsed.ranges[path];
		if (field === undefined) return [];
		const empty = parsed.empties[path];
		if (empty !== undefined) return [{ kind, path, at: empty, field }];
		const named = parsed.mentions.find(
			(m) => m.scheme === kind && m.path === path,
		);
		return named === undefined
			? []
			: [{ kind, path, at: field[1], field, current: named.name }];
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

/** Choosing `name` for the field at `path`: writes it there. */
export const useName = (path: string, name: string): Fix => ({
	kind: "edit",
	label: `Use \`${name}\``,
	edits: [{ path, value: name }],
});

/** A new shared entry of this kind, named in its dialog, then written at `path`. */
export const createFor = (kind: NamedScheme, path: string): Fix => ({
	kind: "create",
	label: `New ${SCHEME_NAME[kind]}…`,
	create: { scheme: kind, name: "", text: "", path },
});
