/**
 * The environment a question is read against: the bank's schemes. Every name a
 * question mentions is a binding in one of these; an unbound name is a hole.
 * Filenames are names. `missing` is one bank-level list, not a namespace.
 */
import { isMap, parseDocument } from "yaml";
import type { Finding } from "../findings.js";
import type { Code } from "./draft.js";
import { error, hole, isPlainObject } from "./read.js";
import type { Scale } from "./scales.js";

export type Scheme<T> = Readonly<Record<string, T>>;

export interface TextEntry {
	readonly text: string;
}

export interface Env {
	readonly scales: Scheme<Scale>;
	readonly universes: Scheme<TextEntry>;
	readonly instructions: Scheme<TextEntry>;
	/** The bank's missing-value codes, in author order; empty when the bank declares none. */
	readonly missing: readonly Code[];
}

export const EMPTY_ENV: Env = {
	scales: {},
	universes: {},
	instructions: {},
	missing: [],
};

export interface ParsedTextEntry {
	readonly entry?: TextEntry;
	readonly findings: readonly Finding[];
}

/** A universe or instruction file: one `text:` line. */
export function parseTextEntry(source: string): ParsedTextEntry {
	const doc = parseDocument(source, { prettyErrors: false });
	const syntax: Finding[] = doc.errors.map((e) =>
		error("yaml-syntax", "", e.message),
	);
	let js: unknown;
	try {
		js = doc.toJS() ?? {};
	} catch (e) {
		return {
			findings: [
				...syntax,
				error("yaml-syntax", "", e instanceof Error ? e.message : String(e)),
			],
		};
	}
	// An empty file is an unwritten one: its `text` is a hole, as in an empty question.
	if ((doc.contents !== null && !isMap(doc.contents)) || !isPlainObject(js))
		return {
			findings: [
				...syntax,
				error("not-a-map", "", "This file is a `text:` line."),
			],
		};
	const unknown = Object.keys(js)
		.filter((k) => k !== "text")
		.map((k) =>
			error(
				"unknown-key",
				k,
				`\`${k}\` is not a field here.`,
				"The only field is `text`.",
			),
		);
	const text = js.text;
	if (text === undefined)
		return {
			findings: [
				...syntax,
				...unknown,
				hole("text", "This file needs a `text:` line."),
			],
		};
	if (text === null || (typeof text === "string" && text.trim() === ""))
		return {
			findings: [...syntax, ...unknown, hole("text", "`text` is empty.")],
		};
	if (typeof text !== "string")
		return {
			findings: [
				...syntax,
				...unknown,
				error("wrong-type", "text", "`text` must be text."),
			],
		};
	return { entry: { text }, findings: [...syntax, ...unknown] };
}

/** The hint under an unresolved name: what exists, and that a sentence is also fine. */
export function listNames(
	what: string,
	names: readonly string[],
	proseAllowed: boolean,
): string {
	const shown =
		names.length === 0
			? `No ${what}s are defined.`
			: `${capital(what)}s: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}.`;
	return proseAllowed ? `${shown} Or write it as a sentence.` : shown;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
