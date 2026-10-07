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
import { parseDocument, stringify } from "yaml";
import type { Edit } from "../findings.js";
import type { NamedScheme } from "./env.js";
import { EMPTY_ENV } from "./env.js";
import { indexDocument, parseSurface } from "./parse.js";

export type { Edit, Fix } from "../findings.js";

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
 * colon (a field, or a response code), with nothing after it on the line, and the text
 * starts with something other than a space. A key, not words in a block scalar
 * ("Time:"): the parse must have a key starting there. Not covered (neither occurs in
 * the surface; the `missing-space` finding catches them): a key on a list item's line
 * (`- a:`) and a dotted code (`1.5:`).
 */
export function spaceBefore(
	source: string,
	pos: number,
	inserted: string,
): boolean {
	if (!/^\S/.test(inserted)) return false;
	const lineStart = source.lastIndexOf("\n", pos - 1) + 1;
	const lineEnd = source.indexOf("\n", pos);
	// A plain key or a quoted one (`"1":`, as codes are written).
	const before = /^( *)(?:[\w-]+|"[^"\n]*"|'[^'\n]*'):$/.exec(
		source.slice(lineStart, pos),
	);
	if (before === null) return false;
	if (source.slice(pos, lineEnd === -1 ? undefined : lineEnd).trim() !== "")
		return false;
	const keyStart = lineStart + (before[1]?.length ?? 0);
	const { ranges } = indexDocument(
		parseDocument(source, { prettyErrors: false }),
		source.length,
	);
	return Object.entries(ranges).some(
		([path, [from]]) => path !== "" && from === keyStart,
	);
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
