/**
 * Answers filtered by access level, from the DDI alone. Each Variable's level is its
 * embargo's name, read against the policy the embargo names (`ACCESS_POLICY_KEY`): its
 * home bank's levels in order, a code list whose codes are the ranks. A level is never
 * read against another bank's policy, nor by its name alone. Nothing here holds a value
 * it reports: a removed variable is named by its URN and name, every refusal by URNs and
 * levels.
 */

import { ACCESS_POLICY_KEY, ACCESS_POLICY_PREFIX } from "./ddi/elaborate.ts";
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

/** Why answers can't be filtered: then nothing is kept, so nothing is written. */
export type FilterRefusal =
	/** A policy's list can't be read: a code with no rank or no level, or one twice. */
	| { readonly kind: "unreadable-levels"; readonly reason: string }
	/** The DDI holds no policy, so no level means anything. */
	| { readonly kind: "no-levels" }
	/** A level that one or more of the DDI's policies don't list. */
	| {
			readonly kind: "unknown-level";
			readonly level: string;
			/** The policies without it. */
			readonly policies: readonly Policy[];
	  }
	/** Answers to variables the DDI doesn't have. */
	| { readonly kind: "unknown-variables"; readonly urns: readonly string[] }
	/** Variables whose level can't be traced to exactly one policy. */
	| { readonly kind: "untraced"; readonly urns: readonly string[] }
	/** After filtering, answers above the level remain: a bug, so nothing is kept. */
	| { readonly kind: "leak"; readonly urns: readonly string[] };

/** A bank's access policy as the DDI publishes it: its list's URN and its levels, most open first. */
export interface Policy {
	readonly urn: string;
	readonly levels: readonly string[];
}

/** A variable whose answers were removed: never a value. */
export interface Removed {
	readonly urn: string;
	readonly name: string;
	readonly level: string;
}

/** Where a variable stands: its policy and its rank there, or why it can't be told. */
type Standing =
	| { readonly kind: "ranked"; readonly policy: Policy; readonly rank: number }
	| { readonly kind: "open" }
	| { readonly kind: "untraced" }
	| { readonly kind: "unknown" };

const isPolicyList = (it: Indexed): boolean => {
	const key = itemKeyOf(it.urn);
	const id = key?.slice(key.indexOf(":") + 1) ?? "";
	return (
		it.type === "CodeList" &&
		id.startsWith(ACCESS_POLICY_PREFIX) &&
		id.endsWith(".codes")
	);
};

/** One policy's levels, by its codes' ranks: undefined where a code has no rank or level, or one twice. */
function policyOf(index: DdiIndex, it: Indexed): Policy | undefined {
	const codes = asList(it.item.Code);
	const read = codes.flatMap((c) => {
		const rank = str(asObj(c.Value)?.StringValue);
		const level = words(deref(index, c.CategoryReference)?.item.Label);
		return rank !== undefined && /^[1-9]\d*$/.test(rank) && level !== undefined
			? [{ rank: Number(rank), level }]
			: [];
	});
	const levels = read.sort((a, b) => a.rank - b.rank).map((r) => r.level);
	return read.length === 0 ||
		read.length < codes.length ||
		new Set(read.map((r) => r.rank)).size < read.length ||
		new Set(levels).size < levels.length
		? undefined
		: { urn: it.urn, levels };
}

/** The DDI's policies, each once, by its list's item. */
function policiesIn(
	index: DdiIndex,
): Result<ReadonlyMap<Indexed, Policy>, FilterRefusal> {
	const policies = new Map<Indexed, Policy>();
	for (const it of new Set(index.byUrn.values())) {
		if (!isPolicyList(it)) continue;
		const p = policyOf(index, it);
		if (p === undefined)
			return err({
				kind: "unreadable-levels",
				reason: `its list of levels ${it.urn} has a code with no rank or no level, or one twice`,
			});
		policies.set(it, p);
	}
	return ok(policies);
}

/**
 * Where the variable a URN names stands. Ranked only when its embargo names a level of
 * the policy the embargo links; open only when it has no embargo and the DDI no policy.
 */
const standingIn =
	(index: DdiIndex, policies: ReadonlyMap<Indexed, Policy>) =>
	(urn: string): Standing => {
		const v = deref(index, urn);
		if (v?.type !== "Variable") return { kind: "unknown" };
		const embargo = asList(v.item.EmbargoReference)[0];
		if (embargo === undefined)
			return policies.size === 0 ? { kind: "open" } : { kind: "untraced" };
		const linked = asList(embargo.UserAttributePair).filter(
			(p) => str(asObj(p.AttributeKey)?.StringValue) === ACCESS_POLICY_KEY,
		);
		const list =
			linked.length === 1
				? deref(index, str(asObj(linked[0]?.AttributeValue)?.StringValue))
				: undefined;
		const policy = list === undefined ? undefined : policies.get(list);
		const rank = policy?.levels.indexOf(words(embargo.EmbargoName) ?? "") ?? -1;
		return policy === undefined || rank < 0
			? { kind: "untraced" }
			: { kind: "ranked", policy, rank };
	};

/** A level and each policy's rank for it, or why it can't be used. */
function allowedIn(
	index: DdiIndex,
	level: string,
): Result<
	{
		readonly standing: (urn: string) => Standing;
		readonly allows: (s: Standing) => boolean;
	},
	FilterRefusal
> {
	const policies = policiesIn(index);
	if (!policies.ok) return policies;
	if (policies.value.size === 0) return err({ kind: "no-levels" });
	const lacking = [...policies.value.values()].filter(
		(p) => !p.levels.includes(level),
	);
	if (lacking.length > 0)
		return err({ kind: "unknown-level", level, policies: lacking });
	return ok({
		standing: standingIn(index, policies.value),
		allows: (s) =>
			s.kind === "ranked" && s.rank <= s.policy.levels.indexOf(level),
	});
}

/**
 * The DDI's policies, each with how many of its Variables stand at each level, and the
 * Variables whose level can't be traced. Refused when a policy's list can't be read.
 */
export function accessPoliciesOf(index: DdiIndex): Result<
	{
		readonly policies: readonly (Policy & {
			readonly counts: readonly number[];
		})[];
		readonly untraced: readonly string[];
	},
	FilterRefusal
> {
	const policies = policiesIn(index);
	if (!policies.ok) return policies;
	const standing = standingIn(index, policies.value);
	const counts = new Map<Policy, number[]>(
		[...policies.value.values()].map((p) => [p, p.levels.map(() => 0)]),
	);
	const untraced: string[] = [];
	for (const it of new Set(index.byUrn.values())) {
		if (it.type !== "Variable" || it.owner !== undefined) continue;
		const s = standing(it.urn);
		if (s.kind === "ranked") {
			const c = counts.get(s.policy);
			if (c !== undefined) c[s.rank] = (c[s.rank] ?? 0) + 1;
		} else if (s.kind === "untraced") untraced.push(it.urn);
	}
	return ok({
		policies: [...counts].map(([p, c]) => ({ ...p, counts: c })),
		untraced,
	});
}

/**
 * The variables of answers that `level` may not see, each once: those above it in their
 * own policy and, failing closed, those the DDI doesn't have or whose level can't be
 * traced. Empty means the answers are fit for `level`. `filterAnswers` checks what it
 * keeps with this; any program can check an answer set with it.
 */
export function aboveLevel(
	index: DdiIndex,
	answers: readonly Answer[],
	level: string,
): Result<readonly string[], FilterRefusal> {
	const allowed = allowedIn(index, level);
	if (!allowed.ok) return allowed;
	const { standing, allows } = allowed.value;
	return ok(
		[...new Set(answers.map((a) => a.variable))].filter(
			(u) => !allows(standing(u)),
		),
	);
}

/**
 * The answers to variables at `level` or a more open one of their own policy, and the
 * variables whose answers were removed. The answers and the DDI are one unit: refused,
 * with nothing kept, when the DDI holds no policy, a policy can't be read or doesn't
 * list `level`, an answer's variable isn't in the DDI or its level can't be traced to
 * exactly one policy, or (`aboveLevel`, after filtering) an answer above `level` remains.
 */
export function filterAnswers(
	index: DdiIndex,
	answers: readonly Answer[],
	level: string,
): Result<
	{ readonly kept: readonly Answer[]; readonly removed: readonly Removed[] },
	FilterRefusal
> {
	const allowed = allowedIn(index, level);
	if (!allowed.ok) return allowed;
	const { standing, allows } = allowed.value;
	const urns = [...new Set(answers.map((a) => a.variable))];
	const unknown = urns.filter((u) => standing(u).kind === "unknown");
	if (unknown.length > 0)
		return err({ kind: "unknown-variables", urns: unknown });
	const untraced = urns.filter((u) => standing(u).kind !== "ranked");
	if (untraced.length > 0) return err({ kind: "untraced", urns: untraced });
	const above = new Set(urns.filter((u) => !allows(standing(u))));
	const kept = answers.filter((a) => !above.has(a.variable));
	// Checked again on what is kept, answer by answer: a mistake above must not leak.
	const leak = aboveLevel(index, kept, level);
	if (!leak.ok) return leak;
	if (leak.value.length > 0) return err({ kind: "leak", urns: leak.value });
	const removed = [...above].sort().map((urn): Removed => {
		const s = standing(urn);
		return {
			urn,
			name: words(deref(index, urn)?.item.VariableName) ?? urn,
			level: s.kind === "ranked" ? (s.policy.levels[s.rank] ?? "") : "",
		};
	});
	return ok({ kept, removed });
}
