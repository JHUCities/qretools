/**
 * What the editor colours by meaning rather than grammar: a name that resolves in a
 * scheme, a response code, the `legacy` block the tool never reads, and a key written
 * with nothing after it (a hole, drawn as Hazel draws one). YAML's grammar cannot tell
 * these apart: every key is a property name and every plain value is content. The core
 * decides; the shell only draws. Codes and names are read from the YAML AST the parser
 * already holds; holes come out of the parser itself, as findings at an empty value.
 */
import { type Document, isMap, isNode, isScalar } from "yaml";
import type { Finding, Range } from "../findings.js";
import { type Env, inScope, type Mention } from "./env.js";
import { clampRange } from "./read.js";

export type MarkKind = "ref" | "code" | "legacy" | "hole";

export interface Mark {
	readonly kind: MarkKind;
	/** A hole is a point, `[at, at]`, just after its key's colon. */
	readonly range: Range;
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
		const node = top.get(m.path, true);
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

/**
 * The holes to draw: a hole finding at a key written with nothing after it is a
 * chip just after the colon. The parser decides what a hole is (`opened()` and the
 * readers); the parse index says where the empty value starts. One chip per path.
 */
export function holeChips(
	findings: readonly Finding[],
	empties: Readonly<Record<string, number>>,
): readonly Mark[] {
	const paths = new Set(
		findings
			.filter((f) => f.severity === "hole" && f.path in empties)
			.map((f) => f.path),
	);
	return [...paths].flatMap((path) => {
		const at = empties[path];
		return at === undefined ? [] : [{ kind: "hole" as const, range: [at, at] }];
	});
}

/** Marks in document order. */
export const ordered = (marks: readonly Mark[]): readonly Mark[] =>
	[...marks].sort((a, b) => a.range[0] - b.range[0]);

const resolves = (m: Mention, env: Env): boolean =>
	inScope(env, m.scheme)[m.name] !== undefined;
