/**
 * Fills: a question's text can leave a named, typed gap that an instrument fills when it
 * asks the question ("You said you pay {{rent}} a month."). The question lists each fill
 * and its type under `fills:`; the instrument says what goes in it. A `{{…}}` that holds
 * no name, or a name not under `fills:`, is the author's words.
 */
import { type Document, isMap, isScalar, type Scalar } from "yaml";
import { compact } from "../compact.ts";
import type { Finding, Range } from "../findings.ts";
import type { Mark } from "./marks.ts";
import { clampRange, error, fail, hole, ok, type Read } from "./read.ts";
import { FILL_TYPES, NAME_PATTERN } from "./schema.ts";

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

/** `{{name}}`, spaces inside allowed: the one definition of a placeholder. */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/**
 * Every `{{…}}` in a text, whatever is inside, and where it is: an instrument's
 * placeholders name things with an alias (`bank.hou_rent`), which a fill name can't have.
 */
export function placeholderSpans(
	text: string,
): readonly { readonly name: string; readonly range: Range }[] {
	return [...text.matchAll(PLACEHOLDER)].map((m) => ({
		name: m[1] ?? "",
		range: [m.index, m.index + m[0].length] as const,
	}));
}

/** Every placeholder in `text` that holds a valid name: the name and where it is, `[from, to)`. */
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
 * The text in pieces: each listed fill where it's written, and the words between. A
 * placeholder whose name isn't under `fills:` stays words (the parser reports it).
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

/** Whether the text has a fill to show as one; otherwise it's words only. */
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
				"Write `fills` as `name: type` lines, one per fill.",
				`Types: ${FILL_TYPES.join(", ")}.`,
			),
		);
	const fills: Fill[] = [];
	const findings: Finding[] = [];
	for (const pair of node.items) {
		if (!isScalar(pair.key)) continue;
		const name = String((pair.key as Scalar).value);
		const at = `fills.${name}`;
		// The first of a repeated name wins: two DDI parameters can't share an ID.
		if (fills.some((f) => f.name === name)) {
			findings.push(
				error(
					"fill-name",
					at,
					`The fill \`${name}\` is listed twice.`,
					`Only the first \`${name}\` is used. Remove or rename the other.`,
				),
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
 * What the text and `fills:` say about each other. A placeholder whose name isn't under
 * `fills:` is a hole where it's written; a fill the text never uses is advice.
 * `textRange` is where `text` is in the source; placeholders are found there, so their
 * ranges are the source's, quoted or folded alike.
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
						`\`${name}\` isn't listed under \`fills:\`.`,
						`Add \`${name}\` under \`fills:\`, such as \`${name}: number\`.`,
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
				hint: `Write \`{{${f.name}}}\` in the text where it goes, or remove \`${f.name}\` from \`fills:\`.`,
			});
	return findings;
}

/** What the editor colours as a fill: each listed fill in the text, and each name under `fills:`. */
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
 * Unquoted text that starts with a fill reads to YAML as a map (`{` opens one): say
 * so. No quick fix: YAML's range for the broken value ends mid-line, so an edit there
 * would rewrite only part of it. Undefined for anything else.
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
		hint: `Without quotes, a \`{\` at the start isn't read as text. Put it in quotes: ${JSON.stringify(written)}.`,
	};
}
