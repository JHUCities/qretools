/**
 * Where a question is asked, read from an instrument's control constructs: for each
 * QuestionConstruct, the conditions on the way to it, the loops around it and the order
 * its section and its options are shown in. One parent map, from every construct to
 * the constructs that hold it and on which branch; walking it up from an ask gives
 * one path per place the ask is held. Conditions are the producer's commands, verbatim:
 * nothing is parsed, so any program language reads.
 */

import {
	asList,
	asObj,
	type DdiIndex,
	deref,
	type Indexed,
	str,
} from "@qretools/core";
import { type Ref, refOf } from "./text.ts";

/** A command as written, in its program language (`VTL`) when it says. */
export interface Command {
	readonly language?: string;
	readonly command: string;
}

/** A condition on the way to an ask: its command, or that the command is not true. */
export interface Condition extends Command {
	readonly negated: boolean;
}

/** One place a question is asked. */
export interface Asking {
	/** The QuestionConstruct's URN. */
	readonly construct: string;
	/** Every condition that must hold for it to be asked, outermost first. */
	readonly conditions: readonly Condition[];
	/** The loops it is repeated in (Loop, RepeatUntil, RepeatWhile), nearest first. */
	readonly loops: readonly Ref[];
	/** The nearest enclosing Sequence's `ItemSequenceType` (`Random`, `Rotate`), verbatim. */
	readonly order?: string;
	/** The ask's own `ResponseSequence.ItemSequenceType`: the order its options are shown in. */
	readonly responseOrder?: string;
}

type Branch =
	| { readonly kind: "in" }
	| { readonly kind: "then" }
	| { readonly kind: "elseIf"; readonly index: number }
	| { readonly kind: "else" }
	| { readonly kind: "loop" };

interface Edge {
	readonly parent: Indexed;
	readonly branch: Branch;
}

/** The constructs a construct holds, in order, and on which branch. */
const childrenOf = (it: Indexed): readonly (readonly [unknown, Branch])[] => {
	const o = it.item;
	const each = (r: unknown, branch: Branch) =>
		(Array.isArray(r) ? r : r === undefined ? [] : [r]).map(
			(x) => [x, branch] as const,
		);
	switch (it.type) {
		case "Instrument":
		case "Sequence":
			return each(o.ControlConstructReference, { kind: "in" });
		case "Loop":
			return each(o.ControlConstructReference, { kind: "loop" });
		case "RepeatUntil":
			return each(o.UntilConstructReference, { kind: "loop" });
		case "RepeatWhile":
			return each(o.WhileConstructReference, { kind: "loop" });
		case "IfThenElse":
			return [
				...each(o.ThenConstructReference, { kind: "then" }),
				...asList(o.ElseIf).flatMap((e, index) =>
					each(e.ThenConstructReference, { kind: "elseIf", index }),
				),
				...each(o.ElseConstructReference, { kind: "else" }),
			];
		default:
			return [];
	}
};

/** A CommandCode's first command. */
// shortcut: a CommandCode may hold the same command in several languages; the first is shown.
export function commandOf(code: unknown): Command | undefined {
	const c = asList(asObj(code)?.Command)[0];
	const command = str(c?.CommandContent);
	const language = str(asObj(c?.ProgramLanguage)?.StringValue);
	return command === undefined
		? undefined
		: { command, ...(language !== undefined && { language }) };
}

/** The conditions a branch of an IfThenElse is taken on: an else's are every earlier one, negated. */
function conditionsOn(it: Indexed, branch: Branch): Condition[] {
	const conds = [
		commandOf(it.item.IfCondition),
		...asList(it.item.ElseIf).map((e) => commandOf(e.IfCondition)),
	];
	const taken =
		branch.kind === "then"
			? 0
			: branch.kind === "elseIf"
				? branch.index + 1
				: conds.length;
	// Every condition before the branch taken is false; the branch's own (an else has none) is true.
	return conds
		.slice(0, taken + 1)
		.flatMap((c, i) => (c === undefined ? [] : [{ ...c, negated: i < taken }]));
}

export interface Flow {
	/** Every place a question is asked, by the question's URN. */
	readonly asked: ReadonlyMap<string, readonly Asking[]>;
	/** Each asking's construct, for its universes. */
	readonly constructs: ReadonlyMap<string, Indexed>;
	/** Each question's position in the instruments' flow, by the question's URN. */
	readonly position: ReadonlyMap<string, number>;
}

/**
 * The flow of every instrument in the index. `follow` derefs a reference and reports one
 * that names nothing in the document.
 */
export function flowOf(
	index: DdiIndex,
	follow: (from: Indexed, r: unknown) => Indexed | undefined,
	lang?: string,
): Flow {
	// Only each construct's highest version: an older one left in the document isn't the flow.
	const current = [...new Set(index.latest.values())];
	const parents = new Map<Indexed, Edge[]>();
	const children = new Map<Indexed, Indexed[]>();
	for (const it of current)
		for (const [r, branch] of childrenOf(it)) {
			const child = follow(it, r);
			if (child === undefined) continue;
			parents.set(child, [
				...(parents.get(child) ?? []),
				{ parent: it, branch },
			]);
			children.set(it, [...(children.get(it) ?? []), child]);
		}

	const askings = (ask: Indexed): Asking[] => {
		const responseOrder = str(
			asObj(ask.item.ResponseSequence)?.ItemSequenceType,
		);
		const out: Asking[] = [];
		const up = (
			node: Indexed,
			conditions: readonly Condition[],
			loops: readonly Ref[],
			order: string | undefined,
			seen: ReadonlySet<Indexed>,
		) => {
			const edges = (parents.get(node) ?? []).filter(
				(e) => !seen.has(e.parent),
			);
			if (edges.length === 0)
				out.push({
					construct: ask.urn,
					conditions,
					loops,
					...(order !== undefined && { order }),
					...(responseOrder !== undefined && { responseOrder }),
				});
			for (const { parent, branch } of edges) {
				const sequence =
					parent.type === "Sequence"
						? str(asObj(parent.item.ConstructSequence)?.ItemSequenceType)
						: undefined;
				up(
					parent,
					parent.type === "IfThenElse"
						? [...conditionsOn(parent, branch), ...conditions]
						: conditions,
					branch.kind === "loop" ? [...loops, refOf(parent, lang)] : loops,
					order ?? sequence,
					new Set([...seen, parent]),
				);
			}
		};
		up(ask, [], [], undefined, new Set([ask]));
		return out;
	};

	const asked = new Map<string, Asking[]>();
	const constructs = new Map<string, Indexed>();
	for (const it of current) {
		if (it.type !== "QuestionConstruct") continue;
		const question = follow(it, it.item.QuestionReference);
		if (question === undefined) continue;
		constructs.set(it.urn, it);
		asked.set(question.urn, [
			...(asked.get(question.urn) ?? []),
			...askings(it),
		]);
	}

	// Depth first from each instrument: the order its questions are first asked in.
	const position = new Map<string, number>();
	const seen = new Set<Indexed>();
	const visit = (it: Indexed) => {
		if (seen.has(it)) return;
		seen.add(it);
		if (it.type === "QuestionConstruct") {
			const q = deref(index, it.item.QuestionReference);
			if (q !== undefined && !position.has(q.urn))
				position.set(q.urn, position.size);
		}
		for (const child of children.get(it) ?? []) visit(child);
	};
	for (const it of current) if (it.type === "Instrument") visit(it);
	return { asked, constructs, position };
}
