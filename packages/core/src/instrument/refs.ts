/**
 * Where an instrument names a bank's files: each `ask:` its question, and each
 * `universe:` that names a bank's shared universe, by the place in the source where the
 * name is written and the file it names, in its bank's terms. What go to definition
 * follows, and what the editor colours as a reference. Pure.
 */
import type { Range } from "../findings.ts";
import { schemePath } from "../kinds.ts";
import type { Node } from "./draft.ts";
import type { ParsedInstrument } from "./parse.ts";

export interface InstrumentRef {
	/** Where the name is written: the value alone, not its key. */
	readonly range: Range;
	/** The bank, by the alias `uses` gives it. */
	readonly alias: string;
	/** The file it names, by its path in that bank. */
	readonly path: string;
}

/** The value of `key: value` at `path`: its own range, from where it starts to its end. */
function valueAt(
	parsed: ParsedInstrument,
	source: string,
	path: string,
): Range | undefined {
	const range = parsed.ranges[path];
	if (range === undefined) return undefined;
	const [from, to] = range;
	const colon = source.indexOf(":", from);
	if (colon === -1 || colon >= to) return undefined;
	const written = source.slice(colon + 1, to);
	const start = colon + 1 + (written.length - written.trimStart().length);
	return start < to ? [start, to] : undefined;
}

/** Every step of a flow, at any depth. */
function* steps(flow: readonly Node[]): Generator<Node> {
	for (const node of flow) {
		yield node;
		if (
			node.kind === "section" ||
			node.kind === "roster" ||
			node.kind === "each"
		)
			yield* steps(node.flow);
		else if (node.kind === "if") {
			for (const b of node.branches) yield* steps(b.then);
			if (node.else !== undefined) yield* steps(node.else);
		}
	}
}

/** Every place the instrument names a file of one of its banks, in document order. */
export function instrumentRefs(
	parsed: ParsedInstrument,
	source: string,
): readonly InstrumentRef[] {
	const refs: InstrumentRef[] = [];
	const add = (
		path: string,
		named: { readonly alias: string; readonly path: string } | undefined,
	) => {
		const range =
			named === undefined ? undefined : valueAt(parsed, source, path);
		if (named !== undefined && range !== undefined)
			refs.push({ range, alias: named.alias, path: named.path });
	};
	const universe = parsed.draft.universe;
	if (universe?.kind === "ref")
		add("universe", {
			alias: universe.alias,
			path: schemePath("universe", universe.name),
		});
	for (const node of steps(parsed.draft.flow)) {
		if (node.kind !== "ask") continue;
		add(`${node.path}.ask`, node.question);
		if (node.universe?.kind === "ref")
			add(`${node.path}.universe`, {
				alias: node.universe.alias,
				path: schemePath("universe", node.universe.name),
			});
	}
	return refs.sort((a, b) => a.range[0] - b.range[0]);
}

/** The bank file named at `offset`, if a name is written there. */
export const instrumentRefAt = (
	refs: readonly InstrumentRef[],
	offset: number,
): InstrumentRef | undefined =>
	refs.find((r) => r.range[0] <= offset && offset <= r.range[1]);
