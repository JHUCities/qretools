/**
 * Fills: a question's text may leave a named, typed gap that an instrument fills when it
 * asks the question ("You said you pay {{rent}} a month."). The question declares each
 * fill and its type under `fills:`; what fills it is the instrument's to say. A `{{…}}`
 * whose inside isn't a name, or names no declared fill, is the author's words.
 */
import { type Document, isMap, isScalar, type Scalar } from "yaml";
import { compact } from "../compact.js";
import type { Finding, Range } from "../findings.js";
import type { Mark } from "./marks.js";
import { clampRange, error, fail, hole, ok, type Read } from "./read.js";
import { FILL_TYPES, NAME_PATTERN } from "./schema.js";

export { FILL_TYPES };
export type FillType = (typeof FILL_TYPES)[number];

export interface Fill {
	readonly name: string;
	/** Absent while it's a hole (`rent:` with nothing after it). */
	readonly type?: FillType;
}

/** Question text in its parts: the author's words, and the fills between them. */
export type Piece =
	| { readonly kind: "words"; readonly text: string }
	| { readonly kind: "fill"; readonly name: string; readonly type?: FillType };

/** `{{name}}`, spaces inside allowed; the one definition of a placeholder. */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Every well-named placeholder in `text`: its name and where it is, `[from, to)`. */
export function placeholders(
	text: string,
): readonly { readonly name: string; readonly range: Range }[] {
	return [...text.matchAll(PLACEHOLDER)].flatMap((m) =>
		m[1] !== undefined && NAME_PATTERN.test(m[1])
			? [{ name: m[1], range: [m.index, m.index + m[0].length] as const }]
			: [],
	);
}

/** Text as the respondent reads it, with every `{{…}}` taken out (for advice on wording). */
export const withoutFills = (text: string): string =>
	text.replace(PLACEHOLDER, "");

/**
 * The text in pieces: each declared fill where it is written, words between. A
 * placeholder naming no declared fill stays words (the parser reports it).
 */
export function piecesOf(
	text: string,
	fills: readonly Fill[],
): readonly Piece[] {
	const declared = new Map(fills.map((f) => [f.name, f]));
	const pieces: Piece[] = [];
	let at = 0;
	for (const { name, range } of placeholders(text)) {
		const fill = declared.get(name);
		if (fill === undefined) continue;
		if (range[0] > at)
			pieces.push({ kind: "words", text: text.slice(at, range[0]) });
		pieces.push(compact({ kind: "fill", name, type: fill.type }) as Piece);
		at = range[1];
	}
	if (at < text.length) pieces.push({ kind: "words", text: text.slice(at) });
	return pieces;
}

/** Whether the text has a fill to show as one: otherwise it is words only. */
export const hasFill = (pieces: readonly Piece[]): boolean =>
	pieces.some((p) => p.kind === "fill");

/** `fills:`, read from the AST in the author's order. Absent means none. */
export function readFills(doc: Document): Read<readonly Fill[]> {
	const node = doc.get("fills", true);
	if (node === undefined) return fail();
	if (isScalar(node) && (node.value === null || node.value === ""))
		return fail(
			hole(
				"fills",
				"`fills` is empty.",
				"Name each fill and its type, such as `rent: number`, or remove the line.",
			),
		);
	if (!isMap(node))
		return fail(
			error(
				"wrong-type",
				"fills",
				"`fills` is a list of `name: type` lines.",
				`Types: ${FILL_TYPES.join(", ")}.`,
			),
		);
	const fills: Fill[] = [];
	const findings: Finding[] = [];
	for (const pair of node.items) {
		if (!isScalar(pair.key)) continue;
		const name = String((pair.key as Scalar).value);
		const at = `fills.${name}`;
		// The first of a repeated name stands: two parameters can't share an ID.
		if (fills.some((f) => f.name === name)) {
			findings.push(
				error("fill-name", at, `The fill \`${name}\` is declared twice.`),
			);
			continue;
		}
		if (!NAME_PATTERN.test(name)) {
			findings.push(
				error(
					"fill-name",
					at,
					`\`${name}\` isn't a valid fill name.`,
					"Lowercase letters, digits and underscores, starting with a letter.",
				),
			);
			continue;
		}
		const value = isScalar(pair.value) ? pair.value.value : pair.value;
		if (value === null || value === undefined || value === "") {
			findings.push(
				hole(
					at,
					`Fill \`${name}\` has no type.`,
					`Types: ${FILL_TYPES.join(", ")}.`,
				),
			);
			fills.push({ name });
		} else if (
			typeof value === "string" &&
			(FILL_TYPES as readonly string[]).includes(value)
		) {
			fills.push({ name, type: value as FillType });
		} else {
			findings.push(
				error(
					"fill-type",
					at,
					`\`${String(value)}\` isn't a fill type.`,
					`Types: ${FILL_TYPES.join(", ")}.`,
				),
			);
			fills.push({ name });
		}
	}
	return ok(fills, ...findings);
}

/**
 * What the text and the declarations say about each other: a placeholder naming no
 * declared fill is a hole where it's written; a declared fill the text never uses is
 * advice. `textRange` is where `text` is in the source; placeholders are found there,
 * so their ranges are the source's, quoted or folded alike.
 */
export function fillFindings(
	source: string,
	textRange: Range | undefined,
	fills: readonly Fill[],
): readonly Finding[] {
	const declared = new Set(fills.map((f) => f.name));
	const used = new Set<string>();
	const findings: Finding[] = [];
	if (textRange !== undefined)
		for (const { name, range } of placeholders(
			source.slice(textRange[0], textRange[1]),
		)) {
			used.add(name);
			if (!declared.has(name))
				findings.push({
					...hole(
						"text",
						`\`${name}\` isn't a declared fill.`,
						`Declare it under \`fills:\`, such as \`${name}: number\`.`,
					),
					range: [textRange[0] + range[0], textRange[0] + range[1]],
				});
		}
	for (const f of fills)
		if (!used.has(f.name))
			findings.push({
				code: "fill-unused",
				severity: "warning",
				path: `fills.${f.name}`,
				message: `The fill \`${f.name}\` isn't used in the text.`,
				hint: `Write \`{{${f.name}}}\` where it goes, or remove it.`,
			});
	return findings;
}

/** What the editor colours as a fill: each declared fill in the text, and each name under `fills:`. */
export function fillMarks(
	doc: Document,
	source: string,
	textRange: Range | undefined,
	fills: readonly Fill[],
): readonly Mark[] {
	const mark = (from: number, to: number): Mark => ({
		kind: "fill",
		range: clampRange(from, to, source.length),
	});
	const declared = new Set(fills.map((f) => f.name));
	const inText =
		textRange === undefined
			? []
			: placeholders(source.slice(textRange[0], textRange[1]))
					.filter((p) => declared.has(p.name))
					.map((p) =>
						mark(textRange[0] + p.range[0], textRange[0] + p.range[1]),
					);
	const node = doc.get("fills", true);
	const keys = isMap(node)
		? node.items.flatMap((pair): Mark[] =>
				isScalar(pair.key) && pair.key.range
					? [mark(pair.key.range[0], pair.key.range[1])]
					: [],
			)
		: [];
	return [...keys, ...inText];
}

/**
 * Text that starts with a fill, unquoted, reads to YAML as a map (`{` opens one): say
 * so. No quick fix: YAML's range for the broken value ends mid-line, so an edit at the
 * path would rewrite part of it. Undefined for anything else.
 */
export function leadingFill(
	source: string,
	textRange: Range | undefined,
	value: unknown,
): Finding | undefined {
	if (textRange === undefined || value === null || typeof value !== "object")
		return undefined;
	const line = source.slice(textRange[0]).split("\n")[0] ?? "";
	const written = line.replace(/^text:\s*/, "").trim();
	if (!written.startsWith("{{")) return undefined;
	return {
		code: "wrong-type",
		severity: "error",
		path: "text",
		message: "Text that starts with a fill needs quotes.",
		hint: `YAML reads a \`{\` at the start of a value as a map. Write it as text: ${JSON.stringify(written)}`,
	};
}
