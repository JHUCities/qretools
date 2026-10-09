/**
 * What the editor colours by meaning rather than grammar: a name that resolves in a
 * scheme, a response code, and the `legacy` block the tool never reads. YAML's grammar
 * cannot tell these apart: every key is a property name and every plain value is
 * content. The core decides; the shell only draws. Read from the YAML AST the parser
 * already holds. (Holes are findings, drawn by the editor's lint layer: `pointHoles`.)
 */
import { type Document, isMap, isNode, isScalar } from "yaml";
import type { Range } from "../findings.ts";
import { type Env, inScope, type Mention } from "./env.ts";
import { clampRange } from "./read.ts";

/**
 * `external` is a name in a bank of another repository (an instrument's import): it
 * resolves, but opens where that bank is, never in place. `name` is a name an
 * instrument declares itself (an input, a compute, an `as`, a roster's row number), read
 * in a condition or a placeholder: it follows to its declaration.
 */
export type MarkKind = "ref" | "external" | "name" | "code" | "legacy" | "fill";

export interface Mark {
	readonly kind: MarkKind;
	readonly range: Range;
	/** Where an `external` name's file is, as a web address: the shell's to make. */
	readonly href?: string;
	/** What a `name` is, in words, for its hover (backticked names as code). */
	readonly about?: string;
}

/** A question's marks by meaning: resolved names, response codes, the `legacy` block. */
export function marksOf(
	doc: Document,
	mentions: readonly Mention[],
	env: Env,
	length: number,
): readonly Mark[] {
	const top = doc.contents;
	if (!isMap(top)) return [];
	const marks: Mark[] = [];
	const span = (kind: MarkKind, from: number, to: number) =>
		marks.push({ kind, range: clampRange(from, to, length) });

	for (const m of mentions) {
		// A mention's path is a field, or a field inside one (`number.unit`): never a code.
		const node = top.getIn(m.path.split("."), true);
		if (!isScalar(node) || !node.range || !resolves(m, env)) continue;
		span("ref", node.range[0], node.range[1]);
	}

	for (const pair of top.items) {
		if (!isScalar(pair.key) || !pair.key.range) continue;
		const key = String(pair.key.value);
		const value = pair.value;
		if (key === "legacy") {
			const end = isNode(value) ? value.range?.[1] : undefined;
			span("legacy", pair.key.range[0], end ?? pair.key.range[1]);
		} else if (key === "responses" && isMap(value)) {
			for (const code of value.items)
				if (isScalar(code.key) && code.key.range)
					span("code", code.key.range[0], code.key.range[1]);
		}
	}
	return marks;
}

/** A scale or missing list's marks: the codes of its `labels:` map. */
export function labelMarksOf(doc: Document, length: number): readonly Mark[] {
	const labels = isMap(doc.contents)
		? doc.contents.get("labels", true)
		: undefined;
	if (!isMap(labels)) return [];
	return labels.items.flatMap((pair) =>
		isScalar(pair.key) && pair.key.range
			? [
					{
						kind: "code" as const,
						range: clampRange(pair.key.range[0], pair.key.range[1], length),
					},
				]
			: [],
	);
}

/** Marks in document order. */
export const ordered = (marks: readonly Mark[]): readonly Mark[] =>
	[...marks].sort((a, b) => a.range[0] - b.range[0]);

const resolves = (m: Mention, env: Env): boolean =>
	inScope(env, m.scheme)[m.name] !== undefined;
