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
import { isMap, isScalar, parseDocument, stringify, visit } from "yaml";
import type { Edit } from "../findings.ts";
import type { NamedScheme } from "./env.ts";
import { EMPTY_ENV } from "./env.ts";
import { indexDocument, parseSurface } from "./parse.ts";
import { KNOWN_KEYS } from "./schema.ts";

export type { Edit, Fix } from "../findings.ts";

/** A value as YAML writes it on one line, quoted only when it must be. */
const scalar = (value: string): string =>
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
	const doc = parseDocument(source, { prettyErrors: false });
	const contents = doc.contents;
	// Text that isn't fields on lines of their own (a list, a word, `{name: q}`) is the
	// author's to fix, not ours to add to.
	if (contents !== null && (!isMap(contents) || contents.flow)) return source;
	const written = isMap(contents)
		? contents.items.flatMap((p) =>
				isScalar(p.key) && p.key.range !== undefined && p.key.range !== null
					? [{ key: String(p.key.value), at: above(source, p.key.range[0]) }]
					: [],
			)
		: [];
	const order = (k: string): number => {
		const i = (KNOWN_KEYS as readonly string[]).indexOf(k);
		return i === -1 ? Number.POSITIVE_INFINITY : i;
	};
	// At the end, after a last line with no newline of its own.
	const base = source === "" || source.endsWith("\n") ? source : `${source}\n`;
	// What goes before each place, in the fields' own order.
	const at = new Map<number, string>();
	for (const key of [...new Set(keys)].sort((a, b) => order(a) - order(b))) {
		if (written.some((w) => w.key === key)) continue;
		const next = written
			.filter((w) => order(w.key) > order(key))
			.sort((a, b) => a.at - b.at)[0];
		const place = next?.at ?? base.length;
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
