/**
 * What the editor colours by meaning rather than grammar: a name that resolves in a
 * scheme, a response code, the `legacy` block the tool never reads, and a key written
 * with nothing after it (a hole, drawn as Hazel draws one). YAML's grammar cannot tell
 * these apart: every key is a property name and every plain value is content. The core
 * decides; the shell only draws. Read from the YAML AST the parser already holds.
 */
import { type Document, isMap, isNode, isScalar, type YAMLMap } from "yaml";
import type { Range } from "../findings.js";
import type { Env, Mention } from "./env.js";
import { clampRange } from "./read.js";
import { DOMAIN_KEYS, TEXT_KEYS } from "./schema.js";

export type MarkKind = "ref" | "code" | "legacy" | "hole";

export interface Mark {
	readonly kind: MarkKind;
	/** A hole is a point, `[at, at]`, just after its key's colon. */
	readonly range: Range;
}

/** Top-level keys that are holes when written empty; `number:` and `open:` read as empty domains. */
const HOLE_KEYS: ReadonlySet<string> = new Set(TEXT_KEYS);

/** A question's marks. Holes follow the parser's rule (`opened()` and the readers), and only there. */
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
	const point = (at: number) => {
		const [p] = clampRange(at, at, length);
		marks.push({ kind: "hole", range: [p, p] });
	};

	for (const m of mentions) {
		const node = top.get(m.path, true);
		if (!isScalar(node) || !node.range || !resolves(m, env)) continue;
		span("ref", node.range[0], node.range[1]);
	}

	// Only the first domain written is read; the others are errors, not holes.
	const domain = top.items
		.map((p) => (isScalar(p.key) ? String(p.key.value) : undefined))
		.find(
			(k) => k !== undefined && (DOMAIN_KEYS as readonly string[]).includes(k),
		);

	for (const pair of top.items) {
		if (!isScalar(pair.key) || !pair.key.range) continue;
		const key = String(pair.key.value);
		const value = pair.value;
		if (key === "legacy") {
			const end = isNode(value) ? value.range?.[1] : undefined;
			span("legacy", pair.key.range[0], end ?? pair.key.range[1]);
			continue;
		}
		const empty = emptyAt(value);
		if (empty !== undefined) {
			if (
				HOLE_KEYS.has(key) ||
				(domain === "responses" && (key === "responses" || key === "select"))
			)
				point(empty);
			continue;
		}
		if (key === "responses" && isMap(value)) {
			for (const code of value.items) {
				if (isScalar(code.key) && code.key.range)
					span("code", code.key.range[0], code.key.range[1]);
				if (domain !== "responses") continue;
				const at = emptyAt(code.value);
				if (at !== undefined) point(at);
				else if (isMap(code.value)) emptyValues(code.value).forEach(point);
			}
		} else if ((key === "number" || key === "open") && key === domain) {
			if (isMap(value)) emptyValues(value).forEach(point);
		}
	}
	return marks;
}

/** A scheme file's marks: codes and holes of a `labels:` map, or the hole of an empty `text:`. */
export function schemeMarksOf(
	shape: "labels" | "text",
	doc: Document,
	length: number,
): readonly Mark[] {
	const top = doc.contents;
	if (!isMap(top)) return [];
	const marks: Mark[] = [];
	const point = (at: number) => {
		const [p] = clampRange(at, at, length);
		marks.push({ kind: "hole", range: [p, p] });
	};
	if (shape === "text") {
		const at = emptyAt(top.get("text", true));
		if (at !== undefined) point(at);
		return marks;
	}
	const labels = top.get("labels", true);
	if (!isMap(labels)) return marks;
	for (const pair of labels.items) {
		if (isScalar(pair.key) && pair.key.range)
			marks.push({
				kind: "code",
				range: clampRange(pair.key.range[0], pair.key.range[1], length),
			});
		const at = emptyAt(pair.value);
		if (at !== undefined) point(at);
	}
	return marks;
}

const resolves = (m: Mention, env: Env): boolean =>
	(m.scheme === "scale"
		? env.scales
		: m.scheme === "universe"
			? env.universes
			: env.instructions)[m.name] !== undefined;

/** Where a value written as nothing at all starts (just after the colon), else undefined. */
function emptyAt(node: unknown): number | undefined {
	return isScalar(node) &&
		node.value === null &&
		node.source === "" &&
		node.range
		? node.range[0]
		: undefined;
}

const emptyValues = (map: YAMLMap): number[] =>
	map.items.flatMap((p) => {
		const at = emptyAt(p.value);
		return at === undefined ? [] : [at];
	});
