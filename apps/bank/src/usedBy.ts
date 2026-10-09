/**
 * The instruments in this workspace that use a bank's file: a question they ask or read
 * (an option variable included) in a condition, a shared universe on the instrument or
 * a step, a shared scale an input's answers are on. Each instrument is listed once per
 * file, with each step that names it, labelled as its outline labels it. Derived from the
 * instruments' own references, never stored on the file: a use is a fact about the
 * instrument (AGENTS: "asked" is derived).
 */
import { inBank, type Range } from "@qretools/core";
import {
	type OutlineItem,
	type OutlinePart,
	outlineOf,
	pathAt,
} from "@qretools/core/editor";
import type { Evaluations } from "./evaluations.js";
import type { Id, InstrumentEntry, Path } from "./model.js";

export interface InstrumentUse {
	readonly id: Id;
	readonly name: string;
	/** Each step that names the file, once, in document order. */
	readonly places: readonly Place[];
}

/** A step of an instrument that names a file: where, and how its outline says it. */
export interface Place {
	/** The place in the instrument's own terms (`flow.1.ask`), for a link to it. */
	readonly at: string;
	/** The step's label, as the outline gives it ("Stop if `hh.consent = "2"`"). */
	readonly label: readonly OutlinePart[];
}

/** Every outline item, at any depth, longest path first: the first prefix is the step. */
const flat = (items: readonly OutlineItem[]): readonly OutlineItem[] =>
	items.flatMap((i) => [i, ...flat(i.children)]);

/** The outline item of the step holding `at`: the longest path that is it or holds it. */
const stepOf = (
	items: readonly OutlineItem[],
	at: string,
): OutlineItem | undefined =>
	[...items]
		.filter((i) => at === i.path || at.startsWith(`${i.path}.`))
		.sort((a, b) => b.path.length - a.path.length)[0];

/** A place outside the flow, as a reader would name it. */
const outside = (at: string): readonly OutlinePart[] =>
	at === "universe"
		? [{ kind: "keyword", text: "Universe" }]
		: at.startsWith("inputs.")
			? [
					{ kind: "keyword", text: "Input" },
					{ kind: "code", text: at.split(".")[1] ?? "" },
				]
			: [{ kind: "text", text: at }];

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
		const items = flat(outlineOf(read.instrument.draft));
		const byPath = new Map<Path, Range[]>();
		for (const r of read.instrument.refs) {
			if (r.kind !== "bank") continue;
			const use = read.uses[r.alias];
			if (use?.kind !== "local") continue;
			const path = inBank(use.folder, r.path);
			byPath.set(path, [...(byPath.get(path) ?? []), r.range]);
		}
		for (const [path, ranges] of byPath) {
			// One place per step: a name read twice in one condition is one place. What is
			// outside the flow (the instrument's own universe, an input) says where it is.
			const places = new Map<string, Place>();
			for (const range of ranges) {
				const at = pathAt(read.instrument.ranges, range[0]);
				const step = stepOf(items, at);
				const key = step?.path ?? at;
				if (!places.has(key))
					places.set(key, {
						at,
						label: step?.label ?? outside(at),
					});
			}
			out.set(path, [
				...(out.get(path) ?? []),
				{ id: e.id, name: e.name, places: [...places.values()] },
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
