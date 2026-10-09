/**
 * Edits to a question's text, described in the document's terms (a path, as a Target
 * names a place) and applied against the text as it is now. A quick fix, "create and
 * use", and renaming a shared file are all lists of these. Pure.
 *
 * An edit replaces the whole `key: value` pair at its path with `key: value`: a
 * path's range runs from its key to the end of its value (a block value takes its
 * trailing newline, which is kept), and replacing only the value would leave a block
 * map's name on a line of its own.
 */
import {
	isMap,
	isScalar,
	parseDocument,
	type Scalar,
	stringify,
	visit,
} from "yaml";
import type { Edit } from "../findings.ts";
import type { NamedScheme } from "./env.ts";
import { EMPTY_ENV } from "./env.ts";
import { indexDocument, parseSurface } from "./parse.ts";
import { KNOWN_KEYS } from "./schema.ts";

export type { Edit, Fix } from "../findings.ts";

/** A value as YAML writes it on one line, quoted only when it must be. */
export const scalar = (value: string): string =>
	stringify(value, { lineWidth: 0 }).trimEnd();

/**
 * The text with every edit applied, or undefined when a path is not in the text (it
 * changed since the fix was offered): a no-op, never a throw.
 */
export function applyEdits(
	source: string,
	edits: readonly Edit[],
): string | undefined {
	const { ranges } = indexDocument(
		parseDocument(source, { prettyErrors: false }),
		source.length,
	);
	const spans: { from: number; to: number; text: string }[] = [];
	for (const edit of edits) {
		const range = ranges[edit.path];
		if (range === undefined || edit.path === "") return undefined;
		const [from, end] = range;
		// A block value's span takes its trailing newline and indentation: keep them.
		const to = from + source.slice(from, end).trimEnd().length;
		// The key as written, from the text: a path's last dotted segment would split a
		// dotted code (`responses.1.5`).
		const key = source.slice(from, to).split(":")[0] ?? "";
		spans.push({ from, to, text: `${key}: ${scalar(edit.value)}` });
	}
	// From the end, so earlier offsets still hold.
	return spans
		.sort((a, b) => b.from - a.from)
		.reduce(
			(text, s) => text.slice(0, s.from) + s.text + text.slice(s.to),
			source,
		);
}

/** The edits that make a question name a shared file by its new name. */
export function renameEdits(
	source: string,
	scheme: NamedScheme,
	from: string,
	to: string,
): readonly Edit[] {
	if (!source.includes(from)) return [];
	return parseSurface(source, EMPTY_ENV)
		.mentions.filter((m) => m.scheme === scheme && m.name === from)
		.map((m) => ({ path: m.path, value: to }));
}

/**
 * The text with a space after `word:` inside what `path` names now, or undefined when
 * the place is gone (it was fixed, or the text changed): a no-op, never a guess.
 */
export function addSpace(
	source: string,
	path: string,
	word: string,
): string | undefined {
	const { ranges } = indexDocument(
		parseDocument(source, { prettyErrors: false }),
		source.length,
	);
	const range = ranges[path];
	if (range === undefined || path === "") return undefined;
	const [from, to] = range;
	// `word` is letters, digits, `_` and `-` (the slip's own pattern): only `-` needs escaping.
	const at = new RegExp(
		`(^|[\\s{,])${word.replace(/[-]/g, "\\-")}:(?=\\S)`,
	).exec(source.slice(from, to));
	if (at === null) return undefined;
	const colon = from + at.index + at[0].length;
	return `${source.slice(0, colon)} ${source.slice(colon)}`;
}

/**
 * Whether text typed at `pos` belongs after a space: the caret is straight after a key's
 * colon (a field, a response code, or a list item's key such as an instrument's
 * `- ask:`), with nothing after it on the line, and the text starts with something other
 * than a space. A key, not words in a block scalar ("Time:"): the parse must have a key
 * starting there. Not covered: a dotted code (`1.5:`); the `missing-space` finding
 * catches it.
 */
export function spaceBefore(
	source: string,
	pos: number,
	inserted: string,
): boolean {
	if (!/^\S/.test(inserted)) return false;
	const lineStart = source.lastIndexOf("\n", pos - 1) + 1;
	const lineEnd = source.indexOf("\n", pos);
	// A plain key or a quoted one (`"1":`, as codes are written), after any list markers.
	const before = /^( *(?:- +)*)(?:[\w-]+|"[^"\n]*"|'[^'\n]*'):$/.exec(
		source.slice(lineStart, pos),
	);
	if (before === null) return false;
	if (source.slice(pos, lineEnd === -1 ? undefined : lineEnd).trim() !== "")
		return false;
	const keyStart = lineStart + (before[1]?.length ?? 0);
	let key = false;
	visit(parseDocument(source, { prettyErrors: false }), {
		Pair(_, pair) {
			if (isScalar(pair.key) && pair.key.range?.[0] === keyStart) {
				key = true;
				return visit.BREAK;
			}
		},
	});
	return key;
}

/**
 * The text with the response code at `path` in quotes, spelled as written (`010` becomes
 * `"010"`), or undefined when the place is gone or already quoted: a no-op, never a
 * guess. Only the code changes; its label, an option's fields and comments stay.
 */
export function quoteCode(
	source: string,
	path: string,
	code: string,
): string | undefined {
	const { ranges } = indexDocument(
		parseDocument(source, { prettyErrors: false }),
		source.length,
	);
	const from = ranges[path]?.[0];
	if (from === undefined || path === "") return undefined;
	const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (!new RegExp(`^${escaped}\\s*:`).test(source.slice(from)))
		return undefined;
	return `${source.slice(0, from)}${JSON.stringify(code)}${source.slice(from + code.length)}`;
}

/**
 * Where a top-level key's lines start: its own line, or the comments and blank lines just
 * above it, which introduce it and stay with it.
 */
function above(source: string, at: number): number {
	let start = source.lastIndexOf("\n", at - 1) + 1;
	while (start > 0) {
		const prev = source.lastIndexOf("\n", start - 2) + 1;
		// Only a line starting at column 0 is a top-level comment: an indented `#` may be a
		// block of text's own words.
		const line = source.slice(prev, start - 1);
		if (line.trim() !== "" && !line.startsWith("#")) break;
		start = prev;
	}
	return start;
}

/**
 * The text with each of `keys` it lacks at the top level added as an empty `key:` line,
 * where the question's field order puts it: before the first field written that comes
 * after it in that order (`KNOWN_KEYS`), else at the end. A new question takes its
 * bank's required fields this way, each a hole where the author will fill it in: once, at
 * creation, never later (a field the bank requires afterwards shows as a hole, not a line).
 */
export function withFields(source: string, keys: readonly string[]): string {
	const fields = topFields(source);
	if (fields === undefined) return source;
	const { written, base } = fields;
	// What goes before each place, in the fields' own order.
	const at = new Map<number, string>();
	for (const key of [...new Set(keys)].sort((a, b) => order(a) - order(b))) {
		if (written.some((w) => w.key === key)) continue;
		const place = placeFor(fields, key);
		at.set(place, `${at.get(place) ?? ""}${key}:\n`);
	}
	if (at.size === 0) return source;
	return [...at]
		.sort(([a], [b]) => b - a)
		.reduce(
			(text, [place, lines]) =>
				text.slice(0, place) + lines + text.slice(place),
			base,
		);
}

/** A field's place in the question's field order (`KNOWN_KEYS`); unknown keys last. */
const order = (k: string): number => {
	const i = (KNOWN_KEYS as readonly string[]).indexOf(k);
	return i === -1 ? Number.POSITIVE_INFINITY : i;
};

interface TopFields {
	/** The fields written, each with where its lines start (its comments above included). */
	readonly written: readonly { readonly key: string; readonly at: number }[];
	/** The text, ending with a newline, which a field added at the end needs. */
	readonly base: string;
}

/**
 * The top-level fields as written, or undefined for text that isn't fields on lines of
 * their own (a list, a word, `{name: q}`): the author's to fix, not ours to add to.
 */
function topFields(source: string): TopFields | undefined {
	const contents = parseDocument(source, { prettyErrors: false }).contents;
	if (contents !== null && (!isMap(contents) || contents.flow))
		return undefined;
	const written = isMap(contents)
		? contents.items.flatMap((p) =>
				isScalar(p.key) && p.key.range !== undefined && p.key.range !== null
					? [{ key: String(p.key.value), at: above(source, p.key.range[0]) }]
					: [],
			)
		: [];
	// At the end, after a last line with no newline of its own.
	const base = source === "" || source.endsWith("\n") ? source : `${source}\n`;
	return { written, base };
}

/** Where a field `key` not yet written goes: before the first written after it in order. */
const placeFor = ({ written, base }: TopFields, key: string): number =>
	written
		.filter((w) => order(w.key) > order(key))
		.sort((a, b) => a.at - b.at)[0]?.at ?? base.length;

/**
 * The text naming question `name` under `variant_of`, with an empty reason where the
 * caret goes (a hole: why the two differ is the author's to write), or why it can't be:
 * `name` is named there already, or `variant_of` (or the text) isn't written as lines a
 * line can be added to (a flow map, a word), which the author edits by hand. Added where
 * the field order puts `variant_of`, at the indent its entries already have, after its
 * last entry; written empty, under its key, any comment after the colon kept on its line.
 */
export function addVariant(
	source: string,
	name: string,
):
	| { readonly kind: "written"; readonly text: string; readonly caret: number }
	| { readonly kind: "named" }
	| { readonly kind: "unwritable" } {
	const fields = topFields(source);
	if (fields === undefined) return { kind: "unwritable" };
	const top = parseDocument(source, { prettyErrors: false }).contents;
	const pair = isMap(top)
		? top.items.find((p) => isScalar(p.key) && p.key.value === "variant_of")
		: undefined;
	const entry = `${scalar(name)}:`;
	if (pair === undefined) {
		const place = placeFor(fields, "variant_of");
		const lines = `variant_of:\n  ${entry}`;
		const { base } = fields;
		return {
			kind: "written",
			text: `${base.slice(0, place)}${lines}\n${base.slice(place)}`,
			caret: place + lines.length,
		};
	}
	const key = pair.key as Scalar;
	const keyStart = key.range?.[0] ?? 0;
	const column = keyStart - (source.lastIndexOf("\n", keyStart - 1) + 1);
	const v = pair.value;
	// After the line holding `end`: a new line there, at `indent`.
	const after = (end: number, indent: string) => {
		const lineEnd = source.indexOf("\n", end);
		const at = lineEnd === -1 ? source.length : lineEnd;
		const line = `\n${indent}${entry}`;
		return {
			kind: "written" as const,
			text: source.slice(0, at) + line + source.slice(at),
			caret: at + line.length,
		};
	};
	if (v === null || (isScalar(v) && v.value === null && v.source === ""))
		return after(key.range?.[1] ?? keyStart, " ".repeat(column + 2));
	if (!isMap(v) || v.flow) return { kind: "unwritable" };
	if (v.items.some((p) => isScalar(p.key) && String(p.key.value) === name))
		return { kind: "named" };
	const first = v.items[0]?.key;
	const firstStart =
		isScalar(first) && first.range != null ? first.range[0] : undefined;
	const indent =
		firstStart === undefined
			? " ".repeat(column + 2)
			: " ".repeat(firstStart - (source.lastIndexOf("\n", firstStart - 1) + 1));
	// The map's last character, before any newline or space that follows it.
	let end = v.range?.[1] ?? keyStart;
	while (end > 0 && /\s/.test(source[end - 1] ?? "")) end--;
	return after(end, indent);
}

/**
 * A shared scale's text from a question's options written inline, copied as written (its
 * codes as spelled, its order, its comments) under `labels:`, or undefined when they
 * aren't options a scale can hold as they stand: a block of plain `code: label` lines.
 * An option written as a map (`{label: …, title: …}`) carries what is the question's own.
 */
export function sharedScaleSource(source: string): string | undefined {
	const top = parseDocument(source, { prettyErrors: false }).contents;
	const pair = isMap(top)
		? top.items.find((p) => isScalar(p.key) && p.key.value === "responses")
		: undefined;
	const options = pair?.value;
	if (!isMap(options) || options.flow || options.items.length === 0)
		return undefined;
	if (
		!options.items.every(
			(p) =>
				isScalar(p.key) &&
				isScalar(p.value) &&
				typeof p.value.value === "string" &&
				p.value.value !== "",
		)
	)
		return undefined;
	// Every key is a scalar (checked above), and there is at least one.
	const first = (options.items[0]?.key as Scalar | undefined)?.range?.[0] ?? 0;
	const from = source.lastIndexOf("\n", first - 1) + 1;
	const indent = first - from;
	let to = options.range?.[1] ?? first;
	while (to > from && /\s/.test(source[to - 1] ?? "")) to--;
	// Each line moved from the options' indent to two spaces; a less indented line (a
	// comment at column 0) keeps its own.
	const lines = source
		.slice(from, to)
		.split("\n")
		.map((line) =>
			line.slice(0, indent).trim() === "" ? `  ${line.slice(indent)}` : line,
		);
	return `labels:\n${lines.join("\n")}\n`;
}
