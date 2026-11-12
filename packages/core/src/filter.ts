/**
 * Answers filtered by access level, from the DDI alone: each Variable's level is the name
 * of its embargo (none: the most open level), and the levels' order is the bank's
 * `access-levels` code list (`ACCESS_LEVELS_ID`), each level's rank its code. Nothing
 * here holds a value it reports: a removed variable is named by its URN and name, and
 * every refusal by URNs, levels and lines.
 */

import { ACCESS_LEVELS_ID } from "./ddi/elaborate.ts";
import {
	asList,
	asObj,
	type DdiIndex,
	deref,
	type Indexed,
	itemKeyOf,
	str,
	words,
} from "./ddi/read.ts";
import type { Answer } from "./responses.ts";
import { err, ok, type Result } from "./result.ts";

/** Why answers can't be filtered: nothing is kept then, so nothing is written. */
export type FilterRefusal =
	/** The DDI's access levels can't be read: a list unreadable, two lists that differ, an embargo with no list. */
	| { readonly kind: "unreadable-levels"; readonly reason: string }
	/** A level the DDI doesn't list. */
	| {
			readonly kind: "unknown-level";
			readonly level: string;
			readonly levels: readonly string[];
	  }
	/** Answers to variables the DDI doesn't have: their level is unknown. */
	| { readonly kind: "unknown-variables"; readonly urns: readonly string[] }
	/** Variables under an embargo the DDI's list doesn't name. */
	| { readonly kind: "unlisted-level"; readonly urns: readonly string[] }
	/** After filtering, answers above the level remain: a bug, so nothing is kept. */
	| { readonly kind: "leak"; readonly urns: readonly string[] };

/** A variable whose answers were removed: never a value. */
export interface Removed {
	readonly urn: string;
	readonly name: string;
	readonly level: string;
}

const LIST_ID = `${ACCESS_LEVELS_ID}.codes`;

/**
 * The DDI's access levels, most open first; empty when it defines none (no list and no
 * embargo). Every list it holds (one per bank an instrument asks from, and per version)
 * must give the same levels in the same order.
 */
export function accessLevelsOf(
	index: DdiIndex,
): Result<readonly string[], FilterRefusal> {
	const unreadable = (reason: string) =>
		err({ kind: "unreadable-levels", reason } as const);
	let levels: readonly string[] | undefined;
	for (const it of index.byUrn.values()) {
		const key = itemKeyOf(it.urn);
		if (it.type !== "CodeList" || key?.slice(key.indexOf(":") + 1) !== LIST_ID)
			continue;
		const ranked = asList(it.item.Code).map((c) => ({
			rank: str(asObj(c.Value)?.StringValue),
			level: words(deref(index, c.CategoryReference)?.item.Label),
		}));
		const read = ranked.flatMap(({ rank, level }) =>
			rank !== undefined && /^[1-9]\d*$/.test(rank) && level !== undefined
				? [{ rank: Number(rank), level }]
				: [],
		);
		const these = read.sort((a, b) => a.rank - b.rank).map((r) => r.level);
		if (
			read.length === 0 ||
			read.length < ranked.length ||
			new Set(read.map((r) => r.rank)).size < read.length ||
			new Set(these).size < these.length
		)
			return unreadable(
				`its list of levels ${it.urn} has a code with no rank or no level, or one twice`,
			);
		if (levels !== undefined && levels.join("\n") !== these.join("\n"))
			return unreadable(
				`it has two lists of levels that differ, one of them ${it.urn}`,
			);
		levels = these;
	}
	if (levels !== undefined) return ok(levels);
	const embargoed = [...index.byUrn.values()].find(
		(it) => it.type === "Variable" && it.item.EmbargoReference !== undefined,
	);
	return embargoed === undefined
		? ok([])
		: unreadable(
				`${embargoed.urn} has an embargo, and the DDI has no list of levels`,
			);
}

/** A Variable's level by its embargo's name: undefined for none, the most open. */
const embargoOf = (v: Indexed): string | null | undefined =>
	v.item.EmbargoReference === undefined
		? undefined
		: (words(asList(v.item.EmbargoReference)[0]?.EmbargoName) ?? null);

/** A variable's rank among `levels`: -1 where the DDI has no Variable for it, -2 where its embargo names no listed level. */
const rankIn =
	(index: DdiIndex, levels: readonly string[]) =>
	(urn: string): number => {
		const v = deref(index, urn);
		if (v?.type !== "Variable") return -1;
		const name = embargoOf(v);
		if (name === undefined) return 0;
		const rank = name === null ? -2 : levels.indexOf(name);
		return rank < 0 ? -2 : rank;
	};

/** The levels and `level`'s rank among them; with no levels, rank 0: nothing is restricted. */
function allowedRank(
	index: DdiIndex,
	level: string,
): Result<
	{ readonly levels: readonly string[]; readonly rank: number },
	FilterRefusal
> {
	const levels = accessLevelsOf(index);
	if (!levels.ok) return levels;
	const rank = levels.value.length === 0 ? 0 : levels.value.indexOf(level);
	return rank < 0
		? err({ kind: "unknown-level", level, levels: levels.value })
		: ok({ levels: levels.value, rank });
}

/**
 * The variables of answers that `level` may not see, each once: those above it and,
 * failing closed, those the DDI doesn't have or whose level it doesn't list. Empty means
 * the answers are fit for `level`. `filterAnswers` checks what it keeps with this; any
 * program can check an answer set with it.
 */
export function aboveLevel(
	index: DdiIndex,
	answers: readonly Answer[],
	level: string,
): Result<readonly string[], FilterRefusal> {
	const allowed = allowedRank(index, level);
	if (!allowed.ok) return allowed;
	const rankOf = rankIn(index, allowed.value.levels);
	return ok(
		[...new Set(answers.map((a) => a.variable))].filter((u) => {
			const rank = rankOf(u);
			return rank < 0 || rank > allowed.value.rank;
		}),
	);
}

/**
 * The answers to variables at `level` or a more open one, and the variables whose
 * answers were removed. Refused, with nothing kept, when the DDI's levels can't be read,
 * `level` isn't one of them, an answer's variable isn't in the DDI or its level isn't
 * listed, or (`aboveLevel`, after filtering) an answer above `level` remains. A DDI that
 * defines no levels restricts nothing: every answer is kept.
 */
export function filterAnswers(
	index: DdiIndex,
	answers: readonly Answer[],
	level: string,
): Result<
	{ readonly kept: readonly Answer[]; readonly removed: readonly Removed[] },
	FilterRefusal
> {
	const allowed = allowedRank(index, level);
	if (!allowed.ok) return allowed;
	const rankOf = rankIn(index, allowed.value.levels);
	const urns = [...new Set(answers.map((a) => a.variable))];
	const unknown = urns.filter((u) => rankOf(u) === -1);
	if (unknown.length > 0)
		return err({ kind: "unknown-variables", urns: unknown });
	const unlisted = urns.filter((u) => rankOf(u) === -2);
	if (unlisted.length > 0)
		return err({ kind: "unlisted-level", urns: unlisted });
	const above = new Set(urns.filter((u) => rankOf(u) > allowed.value.rank));
	const kept = answers.filter((a) => !above.has(a.variable));
	// Checked again on what is kept, answer by answer: a mistake above must not leak.
	const leak = aboveLevel(index, kept, level);
	if (!leak.ok) return leak;
	if (leak.value.length > 0) return err({ kind: "leak", urns: leak.value });
	const removed = [...above].sort().map((urn): Removed => {
		const v = deref(index, urn);
		return {
			urn,
			name: words(v?.item.VariableName) ?? urn,
			level: (v === undefined ? undefined : embargoOf(v)) ?? "",
		};
	});
	return ok({ kept, removed });
}
