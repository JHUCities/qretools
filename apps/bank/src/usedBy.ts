/**
 * The instruments in this workspace that use a question: ask it, or read it (or one of
 * its option variables) in a condition. Each is listed once, with how many places name
 * it and the first of them. Derived from the instruments' own references, never stored
 * on the question: a use is a fact about the instrument (AGENTS: "asked" is derived).
 */
import { inBank, type Range } from "@qretools/core";
import { pathAt } from "@qretools/core/editor";
import type { Evaluations } from "./evaluations.js";
import type { Id, InstrumentEntry, Question } from "./model.js";

export interface InstrumentUse {
	readonly id: Id;
	readonly name: string;
	/** How many places in it name the question. */
	readonly places: number;
	/** The first of them, in document order. */
	readonly first: Range;
	/** The same place in the instrument's own terms (`flow.1.ask`), for a link to it. */
	readonly at: string;
}

type Slices = Parameters<Evaluations["instrument"]>[0];

/**
 * The instruments using `q`, by name. A question never saved has no path in its bank
 * yet, so nothing can name it. Only this workspace's instruments are known: one in
 * another repository can't be.
 */
export function instrumentsUsing(
	model: Slices,
	evaluations: Evaluations,
	q: Question,
): readonly InstrumentUse[] {
	const path = q.base?.path;
	if (path === undefined) return [];
	return Object.values(model.local.workspace)
		.filter((e): e is InstrumentEntry => e.kind === "instrument")
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap((e) => {
			const read = evaluations.instrument(model, e);
			// A use is about the file, not the alias: two aliases for one bank both count.
			const here = read.instrument.refs.filter((r) => {
				if (r.kind !== "bank") return false;
				const use = read.uses[r.alias];
				return use?.kind === "local" && inBank(use.folder, r.path) === path;
			});
			const [first] = here;
			return first === undefined
				? []
				: [
						{
							id: e.id,
							name: e.name,
							places: here.length,
							first: first.range,
							at: pathAt(read.instrument.ranges, first.range[0]),
						},
					];
		});
}
