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
