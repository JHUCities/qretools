/**
 * Where the caret is in a question's structure, for completion: at a value (whose key
 * is `segments`), or at a key under `segments` beside the keys already written there.
 * Read from the YAML the core parses, which copes with holes and half-typed text, never
 * from indentation guessed line by line. Pure; knows YAML, not surveys.
 *
 * Only the caret's own line is read as text: its indent and the word being typed, since
 * a half-written word isn't structure yet. CodeMirror's own YAML tree was tried first
 * and couldn't answer after trailing spaces or at the end of the text (AGENTS.md).
 */
import {
	isMap,
	isScalar,
	type Pair,
	parseDocument,
	visit,
	type YAMLMap,
} from "yaml";
import { keyText } from "./codes.ts";

export type Place =
	| {
			readonly kind: "value";
			readonly segments: readonly string[];
			readonly typed: string;
			/** The caret is straight after the colon, so what's inserted brings its own space. */
			readonly spaced: boolean;
	  }
	| {
			readonly kind: "key";
			readonly segments: readonly string[];
			/** Keys already written at this level, not counting the caret's own line. */
			readonly siblings: readonly string[];
			readonly typed: string;
	  };

// A value's key is a field name: a response code's value is the author's prose, never a choice.
// After the colon: spaces then a word, or nothing at all (`open:`, the caret at the colon).
const VALUE_LINE = /^( *)([A-Za-z_][\w-]*):(?:( +)(\w*))?$/;
const KEY_LINE = /^( *)(\w*)$/;

export function placeAt(source: string, offset: number): Place | undefined {
	const lineStart = lineOf(source, offset);
	const lineEnd = source.indexOf("\n", offset);
	const before = source.slice(lineStart, offset);
	// Only at the end of what the line holds: a caret inside a word inserts nothing.
	if (source.slice(offset, lineEnd === -1 ? undefined : lineEnd).trim() !== "")
		return undefined;
	const value = VALUE_LINE.exec(before);
	const key = value ? undefined : KEY_LINE.exec(before);
	const indent = (value ?? key)?.[1]?.length;
	if (indent === undefined) return undefined;
	const root = parseDocument(source, { prettyErrors: false }).contents;
	const scope = scopeAt(source, root, lineStart, indent);
	if (scope === undefined) return undefined;
	if (value)
		return {
			kind: "value",
			segments: [...scope.segments, value[2] ?? ""],
			typed: value[4] ?? "",
			spaced: value[3] !== undefined,
		};
	return {
		kind: "key",
		segments: scope.segments,
		// Every key written at this level except on the caret's line (a half-typed word).
		siblings: (scope.map?.items ?? []).flatMap((p) =>
			isScalar(p.key) &&
			p.key.range != null &&
			lineOf(source, p.key.range[0]) !== lineStart
				? [keyText(p.key)]
				: [],
		),
		typed: key?.[2] ?? "",
	};
}

/**
 * The lines (numbered from 1) that continue a value begun on a line above: a `|` or
 * `>` block, or a plain or quoted value written over several lines. They hold the
 * author's words, so a colon or a `#` there is neither a key nor a comment.
 */
export function textLines(source: string): ReadonlySet<number> {
	const lines = new Set<number>();
	visit(parseDocument(source, { prettyErrors: false }), {
		Scalar(_, node) {
			if (node.range == null) return;
			// A block's range takes its trailing newline, so its last line holds end - 1.
			const last = lineNumber(source, node.range[1] - 1);
			for (let n = lineNumber(source, node.range[0]) + 1; n <= last; n++)
				lines.add(n);
		},
	});
	return lines;
}

/** The number (from 1) of the line holding `at`. */
const lineNumber = (source: string, at: number): number =>
	source.slice(0, at).split("\n").length;

/** Where the line holding `at` starts. */
const lineOf = (source: string, at: number): number =>
	source.lastIndexOf("\n", at - 1) + 1;

/**
 * The block map a key at `indent` on the line starting at `lineStart` belongs to, and
 * the keys leading to it. Goes down while the last key before that line sits left of
 * the indent; an empty value (or one starting on the caret's line: the author typing its
 * first key) has no map yet. Undefined where completion doesn't help: under a written
 * value, inside a `{…}` map, or indented with no parent.
 */
function scopeAt(
	source: string,
	root: unknown,
	lineStart: number,
	indent: number,
): { segments: readonly string[]; map: YAMLMap | undefined } | undefined {
	if (
		root === null ||
		root === undefined ||
		(isScalar(root) && root.value === null)
	)
		return indent === 0 ? { segments: [], map: undefined } : undefined;
	if (!isMap(root) || root.flow) return undefined;
	const segments: string[] = [];
	let map: YAMLMap = root;
	for (;;) {
		const pair = map.items.findLast(
			(p: Pair) =>
				isScalar(p.key) && p.key.range != null && p.key.range[0] < lineStart,
		);
		const key = isScalar(pair?.key) ? pair.key : undefined;
		const from = key?.range?.[0];
		if (pair === undefined || key === undefined || from === undefined) break;
		if (from - lineOf(source, from) >= indent) break;
		segments.push(keyText(key));
		const v = pair.value;
		if (isMap(v) && !v.flow) {
			map = v;
			continue;
		}
		const empty =
			v === null ||
			(isScalar(v) &&
				((v.value === null && v.source === "") ||
					(v.range != null && v.range[0] >= lineStart)));
		return empty ? { segments, map: undefined } : undefined;
	}
	return indent === 0 || segments.length > 0 ? { segments, map } : undefined;
}
