/**
 * Where each question is asked, from the instruments as the core reads them
 * (`readInstruments`): for each ask, the conditions on the way to it, the loops around it,
 * and the order of its section and options. The map is drawn from the same steps, so the
 * map and the "Asked" places can't disagree.
 */

import {
	type Condition,
	type DdiIndex,
	type FlowInstrument,
	type FlowStep,
	latestOf,
	type Part,
	readInstruments,
	type Source,
} from "@qretools/core";
import { type Ref, refOf, type Text } from "./text.ts";

/** A condition on the way to an ask: it holds, or (`negated`) it doesn't. */
export interface Asked {
	readonly cond: Condition;
	readonly negated: boolean;
}

/** One place a question is asked. */
export interface Asking {
	/** The QuestionConstruct's URN. */
	readonly construct: string;
	/** Every condition that must hold for it to be asked, outermost first. */
	readonly conditions: readonly Asked[];
	/** The loops it is repeated in, nearest first. */
	readonly loops: readonly Ref[];
	/** It comes after a screen-out, which says its condition once. */
	readonly afterStop?: true;
	/** The nearest enclosing section's `ItemSequenceType` (`Random`, `Rotate`), verbatim. */
	readonly order?: string;
	/** The ask's own `ResponseSequence.ItemSequenceType`: the order its options are shown in. */
	readonly responseOrder?: string;
}

/** An entry as a link names it: the anchor to go to, and its words. */
export interface Linked {
	readonly urn: string;
	readonly name?: string;
	readonly label?: Text;
}

/** The steps a step holds, in order. */
export const inner = (s: FlowStep): readonly FlowStep[] => {
	switch (s.kind) {
		case "if":
			return [...s.branches.flatMap((b) => b.then), ...(s.else ?? [])];
		case "stop":
			return [...s.say, ...s.else];
		case "count":
		case "repeat":
		case "loop":
		case "section":
			return s.flow;
		default:
			return [];
	}
};

/** Every step in a tree of steps, in order, each before the steps it holds. */
export const allStepsOf = (steps: readonly FlowStep[]): FlowStep[] =>
	steps.flatMap((s) => [s, ...allStepsOf(inner(s))]);

export interface Flow {
	/** Each instrument, newest versions, in document order. */
	readonly instruments: readonly FlowInstrument[];
	/** Every place a question is asked, by the URN of the question's newest version. */
	readonly asked: ReadonlyMap<string, readonly Asking[]>;
	/** Each question's position in the instruments' flow, by the URN of its newest version. */
	readonly position: ReadonlyMap<string, number>;
}

/** What holds on the way down to a step. */
interface Context {
	readonly conditions: readonly Asked[];
	readonly loops: readonly Ref[];
	readonly afterStop?: true;
	readonly order?: string;
}

/** The newest URN of a question the reader names by the URN it cites. */
export const newestOf = (index: DdiIndex, urn: string): string => {
	const it = index.byUrn.get(urn);
	return it === undefined ? urn : latestOf(index, it).urn;
};

/**
 * The flow of every instrument in the index, its newest version, as the core reads it,
 * and from it every place a question is asked. What the reader can't read is left out.
 */
export function flowOf(index: DdiIndex, lang?: string): Flow {
	const { instruments } = readInstruments(index, lang).value;
	const loopRef = (urn: string): Ref => {
		const it = index.byUrn.get(urn);
		return it === undefined
			? { kind: "ref", type: "Loop", urn }
			: refOf(it, lang);
	};
	// Depth first, so questions are positioned in the order first asked.
	const asked = new Map<string, Asking[]>();
	const position = new Map<string, number>();
	const visit = (steps: readonly FlowStep[], at: Context): void => {
		for (const s of steps)
			switch (s.kind) {
				case "ask": {
					const q = newestOf(index, s.question.urn);
					if (!position.has(q)) position.set(q, position.size);
					asked.set(q, [
						...(asked.get(q) ?? []),
						{
							construct: s.urn,
							conditions: at.conditions,
							loops: at.loops,
							...(at.afterStop && { afterStop: true }),
							...(at.order !== undefined && { order: at.order }),
							...(s.responseOrder !== undefined && {
								responseOrder: s.responseOrder,
							}),
						},
					]);
					break;
				}
				case "if": {
					// Every branch before the one taken is false; its own condition true.
					const not = (n: number): Asked[] =>
						s.branches
							.slice(0, n)
							.map((b) => ({ cond: b.cond, negated: true }));
					s.branches.forEach((b, i) => {
						visit(b.then, {
							...at,
							conditions: [
								...at.conditions,
								...not(i),
								{ cond: b.cond, negated: false },
							],
						});
					});
					if (s.else !== undefined)
						visit(s.else, {
							...at,
							conditions: [...at.conditions, ...not(s.branches.length)],
						});
					break;
				}
				case "stop":
					visit(s.say, {
						...at,
						conditions: [...at.conditions, { cond: s.cond, negated: false }],
					});
					// What follows a stop is the rest of the interview: the stop says its condition once.
					visit(s.else, { ...at, afterStop: true });
					break;
				case "count":
				case "repeat":
				case "loop":
					visit(s.flow, { ...at, loops: [loopRef(s.urn), ...at.loops] });
					break;
				case "section":
					visit(s.flow, {
						...at,
						...((s.order ?? at.order) !== undefined && {
							order: s.order ?? at.order,
						}),
					});
					break;
			}
	};
	for (const i of instruments) visit(i.flow, { conditions: [], loops: [] });
	return {
		instruments,
		asked,
		position,
	};
}

/** What a tree of steps reads: the names in its conditions and values, and the values piped into its texts. */
export const readsOf = (steps: readonly FlowStep[]): Source[] => {
	const of = (c: Condition) =>
		c.kind === "parsed" ? [...c.sources.values()] : [];
	const piped = (text: readonly Part[]) =>
		text.flatMap((p) => (p.kind === "value" ? [p.source] : []));
	return allStepsOf(steps).flatMap((s): Source[] => {
		switch (s.kind) {
			case "ask":
				return [
					...piped(s.text),
					...s.checks.flatMap((c) => [
						...of(c.ensure),
						...piped(c.message ?? []),
					]),
				];
			case "say":
				return piped(s.text);
			case "compute":
				return of(s.value);
			case "if":
				return s.branches.flatMap((b) => of(b.cond));
			case "stop":
			case "loop":
				return of(s.cond);
			case "count":
				return of(s.count);
			case "repeat":
				return of(s.more);
			default:
				return [];
		}
	});
};
