/**
 * The instruments in this workspace that use a bank's file: a question they ask or read
 * (an option variable included) in a condition, a shared universe on the instrument or
 * a step, a shared scale an input's answers are on. Each instrument is listed once per
 * file, with how many places name it and the first of them. Derived from the
 * instruments' own references, never stored on the file: a use is a fact about the
 * instrument (AGENTS: "asked" is derived).
 */
import { inBank, type Range } from "@qretools/core";
import { pathAt } from "@qretools/core/editor";
import type { Evaluations } from "./evaluations.js";
import type { Id, InstrumentEntry, Path } from "./model.js";

export interface InstrumentUse {
	readonly id: Id;
	readonly name: string;
	/** How many places in it name the file. */
	readonly places: number;
	/** The first of them, in document order. */
	readonly first: Range;
	/** The same place in the instrument's own terms (`flow.1.ask`), for a link to it. */
	readonly at: string;
}

type Slices = Parameters<Evaluations["instrument"]>[0];

/** Every bank file this workspace's instruments name, by its path, with the instruments naming it (by name). */
export type InstrumentUses = ReadonlyMap<Path, readonly InstrumentUse[]>;

/**
 * One pass over the instruments here: a ref names a file when its alias's use is a
 * bank of this workspace, at the file's path there. A use is about the file, not the
 * alias: two aliases for one bank both count. Only this workspace's instruments are
 * known; one in another repository can't be.
 */
export function instrumentUses(
	model: Slices,
	evaluations: Evaluations,
): InstrumentUses {
	const out = new Map<Path, InstrumentUse[]>();
	const instruments = Object.values(model.local.workspace)
		.filter((e): e is InstrumentEntry => e.kind === "instrument")
		.sort((a, b) => a.name.localeCompare(b.name));
	for (const e of instruments) {
		const read = evaluations.instrument(model, e);
		const byPath = new Map<Path, Range[]>();
		for (const r of read.instrument.refs) {
			if (r.kind !== "bank") continue;
			const use = read.uses[r.alias];
			if (use?.kind !== "local") continue;
			const path = inBank(use.folder, r.path);
			byPath.set(path, [...(byPath.get(path) ?? []), r.range]);
		}
		for (const [path, ranges] of byPath) {
			const [first] = ranges;
			if (first === undefined) continue;
			out.set(path, [
				...(out.get(path) ?? []),
				{
					id: e.id,
					name: e.name,
					places: ranges.length,
					first,
					at: pathAt(read.instrument.ranges, first[0]),
				},
			]);
		}
	}
	return out;
}

/**
 * The instruments using the file at `path`: none for a file with no path yet (a question
 * never saved, which nothing can name).
 */
export const instrumentsUsing = (
	uses: InstrumentUses,
	path: Path | undefined,
): readonly InstrumentUse[] =>
	path === undefined ? [] : (uses.get(path) ?? []);
