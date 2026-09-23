/**
 * Readers return their value (if any) and their findings; nothing is threaded
 * through a mutable accumulator, so data flow is visible in signatures.
 */
import { compact } from "../compact.js";
import type { Finding, ParseCode } from "../findings.js";

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
