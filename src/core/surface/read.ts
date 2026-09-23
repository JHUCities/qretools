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
