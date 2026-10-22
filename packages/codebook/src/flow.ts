/**
 * Where a question is asked, read from an instrument's control constructs: for each
 * QuestionConstruct, the conditions on the way to it, the loops around it and the order
 * its section and its options are shown in. Walked down from each instrument, following
 * each reference as written (a version it names, else the newest), so a construct no
 * instrument reaches is asked nowhere, and every path to an ask is a place it is asked.
 * Conditions are the producer's commands, verbatim: nothing is parsed, so any program
 * language reads.
 */

import {
	asList,
	asObj,
	type DdiIndex,
	type Indexed,
	latestOf,
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
	/** Every place a question is asked, by the URN of the question's newest version. */
	readonly asked: ReadonlyMap<string, readonly Asking[]>;
	/** Each asking's construct, for its universes. */
	readonly constructs: ReadonlyMap<string, Indexed>;
	/** Each question's position in the instruments' flow, by the URN of its newest version. */
	readonly position: ReadonlyMap<string, number>;
}

/** What holds on the way down to a construct. */
interface Context {
	readonly conditions: readonly Condition[];
	readonly loops: readonly Ref[];
	readonly order?: string;
}

/**
 * The flow of every instrument in the index, its newest version. `follow` derefs a
 * reference and reports one that names nothing in the document.
 */
export function flowOf(
	index: DdiIndex,
	follow: (from: Indexed, r: unknown) => Indexed | undefined,
	lang?: string,
): Flow {
	const asked = new Map<string, Asking[]>();
	const constructs = new Map<string, Indexed>();
	const position = new Map<string, number>();
	// Depth first, so questions are positioned in the order first asked; `path` stops a cycle.
	// shortcut: every path is walked, so constructs shared many times over multiply the work; memoise per construct and context if a real document is slow.
	const down = (node: Indexed, at: Context, path: ReadonlySet<Indexed>) => {
		if (node.type === "QuestionConstruct") {
			const found = follow(node, node.item.QuestionReference);
			if (found === undefined) return;
			const question = latestOf(index, found).urn;
			if (!position.has(question)) position.set(question, position.size);
			constructs.set(node.urn, node);
			const responseOrder = str(
				asObj(node.item.ResponseSequence)?.ItemSequenceType,
			);
			asked.set(question, [
				...(asked.get(question) ?? []),
				{
					construct: node.urn,
					conditions: at.conditions,
					loops: at.loops,
					...(at.order !== undefined && { order: at.order }),
					...(responseOrder !== undefined && { responseOrder }),
				},
			]);
			return;
		}
		const sequence =
			node.type === "Sequence"
				? str(asObj(node.item.ConstructSequence)?.ItemSequenceType)
				: undefined;
		for (const [r, branch] of childrenOf(node)) {
			const child = follow(node, r);
			if (child === undefined || path.has(child)) continue;
			down(
				child,
				{
					conditions:
						node.type === "IfThenElse"
							? [...at.conditions, ...conditionsOn(node, branch)]
							: at.conditions,
					loops:
						branch.kind === "loop"
							? [refOf(node, lang), ...at.loops]
							: at.loops,
					// The nearest enclosing sequence's order.
					...((sequence ?? at.order) !== undefined && {
						order: sequence ?? at.order,
					}),
				},
				new Set([...path, child]),
			);
		}
	};
	for (const it of new Set(index.latest.values()))
		if (it.type === "Instrument")
			down(it, { conditions: [], loops: [] }, new Set([it]));
	return { asked, constructs, position };
}
