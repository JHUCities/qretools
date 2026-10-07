/**
 * Readers return their value (if any) and their findings; nothing is threaded
 * through a mutable accumulator, so data flow is visible in signatures.
 */
import type { ZodError } from "zod";
import { compact } from "../compact.js";
import type { Finding, ParseCode, Range } from "../findings.js";

export interface Read<T> {
	readonly value?: T;
	readonly findings: readonly Finding[];
}

export const ok = <T>(value: T, ...findings: Finding[]): Read<T> => ({
	value,
	findings,
});
export const fail = <T>(...findings: Finding[]): Read<T> => ({ findings });

export const hole = (path: string, message: string, hint?: string): Finding =>
	compact({ code: "hole", severity: "hole", path, message, hint });

export const error = (
	code: Exclude<ParseCode, "hole">,
	path: string,
	message: string,
	hint?: string,
): Finding => compact({ code, severity: "error", path, message, hint });

export const EMPTY_HINT = "Fill it in, or remove the line.";

/**
 * The YAML parser's complaint, in plain words, its own kept as detail. With a range
 * it is about a line; without one, about the text as a whole.
 */
export const yamlError = (detail: string, range?: Range): Finding =>
	compact({
		code: "yaml-syntax" as const,
		severity: "error" as const,
		path: "",
		message:
			range === undefined
				? "This can't be read as YAML."
				: "This line can't be read as YAML.",
		detail,
		range,
	});

/** The parser's errors on a text of `length`, each at its own line. */
export const yamlErrors = (
	errors: readonly {
		readonly message: string;
		readonly pos: readonly [number, number];
	}[],
	length: number,
): Finding[] =>
	errors.map((e) =>
		yamlError(e.message, clampRange(e.pos[0], e.pos[1], length)),
	);

/** A range that CodeMirror will accept: inside the text, non-empty where possible, `from <= to`. */
export function clampRange(from: number, to: number, length: number): Range {
	const f = Math.min(Math.max(0, from), length);
	return [f, Math.min(length, Math.max(f + 1, to))];
}

type Issue = ZodError["issues"][number];

const EXPECTED: Readonly<Record<string, string>> = {
	string: "text",
	number: "a number",
	int: "a whole number",
	boolean: "`true` or `false`",
	object: "a map of `key: value` lines",
	record: "a map of `key: value` lines",
	array: "a list",
};

/**
 * A Zod issue about `field` as a plain sentence. Zod's own message is kept as the hint
 * only where the schema wrote it (a name's pattern), since only then is it ours.
 */
export function issueSentence(
	field: string,
	issue: Issue,
): {
	readonly message: string;
	readonly hint?: string;
	readonly detail?: string;
} {
	const f = `\`${field}\``;
	switch (issue.code) {
		case "invalid_type":
			return {
				message: `${f} must be ${EXPECTED[issue.expected] ?? issue.expected}.`,
			};
		case "too_small":
			return {
				message: `${f} must be ${issue.inclusive ? "at least" : "more than"} ${issue.minimum}.`,
			};
		case "too_big":
			return {
				message: `${f} must be ${issue.inclusive ? "at most" : "less than"} ${issue.maximum}.`,
			};
		case "invalid_format":
			return {
				message: `${f} isn't written the right way.`,
				hint: issue.message,
			};
		case "invalid_value":
			return {
				message: `${f} must be ${issue.values.map((v) => `\`${String(v)}\``).join(" or ")}.`,
			};
		default:
			return {
				message: `${f} can't be used as written.`,
				detail: issue.message,
			};
	}
}

export const isPlainObject = (
	value: unknown,
): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Keys written with no value are holes: the author opened them, as typing `?`
 * opens a hole in Hazel. They are never type errors. Anything that is not a map
 * is passed through untouched for the schema to judge.
 */
export function opened(
	value: unknown,
	at: string,
): { readonly rest: unknown; readonly holes: readonly Finding[] } {
	if (!isPlainObject(value)) return { rest: value, holes: [] };
	const rest: Record<string, unknown> = {};
	const holes: Finding[] = [];
	for (const [k, v] of Object.entries(value)) {
		if (v === null || v === "")
			holes.push(hole(`${at}.${k}`, `\`${k}\` is empty.`, EMPTY_HINT));
		else rest[k] = v;
	}
	return { rest, holes };
}
