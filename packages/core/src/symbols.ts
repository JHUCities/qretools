/**
 * The bank's symbol table. Each file defines variables, names shared files, and
 * writes content that another file may repeat. "Used by", "also used by" and "the
 * same as" are all lookups in one index of those. Keys are the caller's (the app's
 * numeric ids). Names are only what the index looks up, never what a file is.
 *
 * Pure, and free of the app, so another tool can build the same index over its files.
 *
 * Duplicates are found at three strengths, as code clones are (Roy and Cordy): the same
 * as written; the same once case, punctuation and spacing are ignored (and, for
 * response lists, codes); and, for question text only, similar wording (word overlap).
 * Similar wording is computed for one file against the index, never for every pair.
 */
import {
	type Finding,
	type Fix,
	inDocumentOrder,
	type Range,
} from "./findings.ts";
import { fold, labelsKey } from "./fold.ts";
import { isRoot } from "./kinds.ts";
import type { SchemeKind, SchemeValue } from "./schemes.ts";
import {
	type Code,
	type DefinedVariable,
	definedVariables,
} from "./surface/draft.ts";
import type { Mention, NamedScheme } from "./surface/env.ts";
import type { Parsed, Variant } from "./surface/parse.ts";

/**
 * What a piece of content is, so like is compared with like: a question's list or
 * sentence with other questions', a shared file's with other shared files'. Content
 * equal to a shared file is reported by lint.ts ("use the name"), not here.
 */
export type PrintKind =
	| "text"
	| "list"
	| "universe"
	| "instruction"
	| "scale"
	| "universe-file"
	| "instruction-file"
	| "concept-file"
	| "unit-file";

/** Content a file writes, as written (`raw`) and folded (`key`), at a path in it. */
export interface Fingerprint {
	readonly kind: PrintKind;
	readonly path: string;
	readonly key: string;
	readonly raw: string;
}

export interface Symbols {
	/** A question's own name, which `variant_of` elsewhere refers to. */
	readonly name?: string;
	readonly defines: readonly DefinedVariable[];
	readonly mentions: readonly Mention[];
	readonly variants: readonly Variant[];
	readonly fingerprints: readonly Fingerprint[];
}

/** A response list: labels folded in order, codes ignored; as written, codes and all. */
const listPrint = (
	kind: "list" | "scale",
	path: string,
	codes: readonly Code[],
): Fingerprint => ({
	kind,
	path,
	key: labelsKey(codes),
	raw: codes.map((c) => `${c.code}: ${c.label}`).join("\n"),
});

const print = (
	kind: PrintKind,
	path: string,
	raw: string,
	key = fold(raw),
): Fingerprint => ({ kind, path, key, raw: raw.trim() });

export function symbolsOf(parsed: Parsed): Symbols {
	const { draft } = parsed;
	const { domain } = draft;
	const fingerprints: Fingerprint[] = [];
	if (draft.text !== undefined)
		fingerprints.push(print("text", "text", draft.text));
	if (
		domain?.kind === "responses" &&
		domain.scale === undefined &&
		domain.codes.length > 0
	)
		fingerprints.push(listPrint("list", "responses", domain.codes));
	for (const key of ["universe", "instruction"] as const) {
		const value = draft[key];
		if (value?.kind === "text") fingerprints.push(print(key, key, value.text));
	}
	return {
		...(draft.name !== undefined && { name: draft.name }),
		defines: definedVariables(draft),
		mentions: parsed.mentions,
		variants: parsed.variants,
		fingerprints: fingerprints.filter((f) => f.key !== ""),
	};
}

/** A shared file's content, for finding two shared files that say the same. */
export function schemeSymbols(
	kind: SchemeKind,
	value: SchemeValue | undefined,
): Symbols {
	const none = { defines: [], mentions: [], variants: [] };
	// `value.kind` too, though `isRoot` covers it: it narrows the value for what follows.
	if (
		value === undefined ||
		isRoot(kind) ||
		value.kind === "settings" ||
		value.kind === "coding"
	)
		return { ...none, fingerprints: [] };
	const fingerprints =
		value.kind === "labels"
			? value.codes.length > 0
				? [listPrint("scale", "labels", value.codes)]
				: []
			: value.kind === "labelled"
				? [
						print(
							kind === "unit" ? "unit-file" : "concept-file",
							"label",
							value.entry.label,
						),
					]
				: [
						print(
							kind === "universe" ? "universe-file" : "instruction-file",
							"text",
							value.text,
						),
					];
	return { ...none, fingerprints: fingerprints.filter((f) => f.key !== "") };
}

export interface Site<K> {
	readonly key: K;
	readonly path: string;
}

interface Printed<K> extends Site<K> {
	readonly raw: string;
}

interface Wording<K> {
	readonly key: K;
	readonly folded: string;
	readonly raw: string;
	readonly words: ReadonlySet<string>;
}

export interface Index<K> {
	/** Variable name → where it is defined. */
	readonly variables: ReadonlyMap<string, readonly Site<K>[]>;
	/** `scheme:name` → where it is mentioned. */
	readonly mentions: ReadonlyMap<string, readonly Site<K>[]>;
	/** `kind:folded content` → where it is written. */
	readonly prints: ReadonlyMap<string, readonly Printed<K>[]>;
	/** Question name → the files that declare it. */
	readonly names: ReadonlyMap<string, readonly K[]>;
	/** Each file's own name and the names it lists under `variant_of`. */
	readonly files: ReadonlyMap<
		K,
		{ readonly name?: string; readonly variants: ReadonlySet<string> }
	>;
	/** Every question text, for similar wording. */
	readonly texts: readonly Wording<K>[];
}

export const mentionKey = (scheme: NamedScheme, name: string): string =>
	`${scheme}:${name}`;

const printKey = (f: Fingerprint): string => `${f.kind}:${f.key}`;

const words = (folded: string): ReadonlySet<string> =>
	new Set(folded.split(" ").filter((w) => w !== ""));

export function indexOf<K>(
	entries: Iterable<{ readonly key: K; readonly symbols: Symbols }>,
): Index<K> {
	const variables = new Map<string, Site<K>[]>();
	const mentions = new Map<string, Site<K>[]>();
	const prints = new Map<string, Printed<K>[]>();
	const names = new Map<string, K[]>();
	const files = new Map<
		K,
		{ readonly name?: string; readonly variants: ReadonlySet<string> }
	>();
	const texts: Wording<K>[] = [];
	const push = <V>(m: Map<string, V[]>, at: string, value: V) => {
		const list = m.get(at);
		if (list) list.push(value);
		else m.set(at, [value]);
	};
	for (const { key, symbols } of entries) {
		for (const d of symbols.defines)
			push(variables, d.name, { key, path: d.path });
		for (const m of symbols.mentions)
			push(mentions, mentionKey(m.scheme, m.name), { key, path: m.path });
		for (const f of symbols.fingerprints) {
			push(prints, printKey(f), { key, path: f.path, raw: f.raw });
			if (f.kind === "text")
				texts.push({ key, folded: f.key, raw: f.raw, words: words(f.key) });
		}
		if (symbols.name !== undefined) push(names, symbols.name, key);
		files.set(key, {
			...(symbols.name !== undefined && { name: symbols.name }),
			variants: new Set(symbols.variants.map((v) => v.name)),
		});
	}
	return { variables, mentions, prints, names, files, texts };
}

/** Where a scheme name is used, resolved or not. */
export const usedBy = <K>(
	index: Index<K>,
	scheme: NamedScheme,
	name: string,
): readonly Site<K>[] => index.mentions.get(mentionKey(scheme, name)) ?? [];

/** A finding that spans files: the others involved, so the shell can link to them. */
export interface BankFinding<K> extends Finding {
	readonly others: readonly K[];
}

/**
 * The other files a finding names, read from the finding itself (never looked up by
 * object identity: a list that settles after typing shows older objects).
 */
export const othersOf = <K>(f: Finding): readonly K[] =>
	"others" in f && Array.isArray(f.others) ? (f.others as readonly K[]) : [];

/** How close two wordings must be to be called similar: word overlap (Jaccard). */
export const SIMILAR = 0.9;

const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
	let shared = 0;
	for (const w of a) if (b.has(w)) shared++;
	const all = a.size + b.size - shared;
	return all === 0 ? 0 : shared / all;
};

const quote = (raw: string): string => {
	const text = raw.replace(/\s+/g, " ");
	return `“${text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text}”`;
};

/** What each kind of duplicate says, and what to do about it. */
const SAID: Readonly<
	Record<
		PrintKind,
		{
			readonly code: BankFinding<unknown>["code"];
			readonly what: string;
			readonly where: string;
			readonly hint: string;
		}
	>
> = {
	text: {
		code: "duplicate-text",
		what: "The same question text",
		where: "is in",
		hint: "Keep one question. If you need both, add `variant_of:` naming the other, and say how they differ.",
	},
	list: {
		code: "duplicate-list",
		what: "The same responses",
		where: "are written in",
		hint: "If each option is a plain `code: label` line, make the list a shared scale, so one change updates every question.",
	},
	universe: {
		code: "duplicate-universe",
		what: "The same universe",
		where: "is written in",
		hint: "Make this universe a shared one, so one change updates every question.",
	},
	instruction: {
		code: "duplicate-instruction",
		what: "The same instruction",
		where: "is written in",
		hint: "Make this instruction a shared one, so one change updates every question.",
	},
	scale: {
		code: "duplicate-scale",
		what: "The same labels",
		where: "are in the shared scale",
		hint: "Keep one of these shared scales, and have questions name that one.",
	},
	"universe-file": {
		code: "duplicate-universe",
		what: "The same text",
		where: "is in the shared universe",
		hint: "Keep one of these shared universes, and have questions name that one.",
	},
	"instruction-file": {
		code: "duplicate-instruction",
		what: "The same text",
		where: "is in the shared instruction",
		hint: "Keep one of these shared instructions, and have questions name that one.",
	},
	"concept-file": {
		code: "duplicate-concept",
		what: "The same label",
		where: "is in the shared concept",
		hint: "Keep one of these shared concepts, and have questions name that one.",
	},
	"unit-file": {
		code: "duplicate-unit",
		what: "The same label",
		where: "is in the shared unit",
		hint: "Keep one of these shared units, and have questions name that one.",
	},
};

const listed = (names: readonly string[]): string =>
	names.map((n) => `\`${n}\``).join(", ");

/**
 * Findings that span files, placed where this file writes the repeated thing. Each
 * file involved gets its own, naming the others. A pair that either file lists under
 * `variant_of` is deliberate and not reported. `label` names a file.
 */
export function bankFindings<K>(
	key: K,
	symbols: Symbols,
	index: Index<K>,
	label: (key: K) => string,
): readonly BankFinding<K>[] {
	const others = <S extends Site<K>>(sites: readonly S[] | undefined) =>
		(sites ?? []).filter((s) => s.key !== key);
	const names = (keys: readonly K[]) => [...new Set(keys.map(label))];
	// Deliberate: either side names the other under `variant_of`.
	const deliberate = (other: K): boolean => {
		const them = index.files.get(other);
		return (
			(them?.name !== undefined &&
				symbols.variants.some((v) => v.name === them.name)) ||
			(symbols.name !== undefined && them?.variants.has(symbols.name) === true)
		);
	};

	const variables = symbols.defines.flatMap((d): BankFinding<K>[] => {
		const sites = others(index.variables.get(d.name));
		if (sites.length === 0) return [];
		const keys = sites.map((s) => s.key);
		return [
			{
				code: "duplicate-variable",
				severity: "warning",
				path: d.path,
				message: `Variable \`${d.name}\` is also used by ${names(keys).join(", ")}.`,
				hint: d.path.startsWith("responses.")
					? "Two variables can't share a name. Give this option a different `variable:`."
					: "Two variables can't share a name. Rename this question.",
				others: keys,
			},
		];
	});

	// Two questions with one name would get the same DDI IDs.
	const named = symbols.name;
	const sameName =
		named === undefined
			? []
			: (index.names.get(named) ?? []).filter((k) => k !== key);
	const duplicateName: BankFinding<K>[] =
		sameName.length === 0
			? []
			: [
					{
						code: "duplicate-name",
						severity: "warning",
						path: "name",
						message: `${sameName.length === 1 ? "Another question is" : "Other questions are"} also named \`${named}\`.`,
						hint: "Each question needs its own name. Rename this question.",
						others: sameName,
					},
				];

	const unknown = symbols.variants.flatMap((v): BankFinding<K>[] =>
		(index.names.get(v.name) ?? []).some((k) => k !== key)
			? []
			: [
					{
						code: "unknown-variant",
						severity: "warning",
						path: v.path,
						message: `No other question is named \`${v.name}\`.`,
						hint: "Check the name under `variant_of`, or remove it.",
						others: [],
					},
				],
	);

	const repeated = symbols.fingerprints.flatMap((f): BankFinding<K>[] => {
		const sites = others(index.prints.get(printKey(f))).filter(
			(s) => !deliberate(s.key),
		);
		if (sites.length === 0) return [];
		const said = SAID[f.kind];
		const keys = sites.map((s) => s.key);
		const exact = sites.every((s) => s.raw === f.raw);
		const apart =
			f.kind === "list" || f.kind === "scale"
				? " (apart from codes, case or punctuation)"
				: " (apart from case or punctuation)";
		return [
			{
				code: said.code,
				severity: "warning",
				path: f.path,
				message: `${said.what} ${said.where} ${listed(names(keys))}${exact ? "" : apart}.`,
				hint: said.hint,
				others: keys,
			},
		];
	});

	// Similar wording: question text only, this file against every other.
	const text = symbols.fingerprints.find((f) => f.kind === "text");
	const mine = text === undefined ? undefined : words(text.key);
	const similar =
		text === undefined || mine === undefined
			? []
			: index.texts.flatMap((t): BankFinding<K>[] => {
					if (t.key === key || t.folded === text.key || deliberate(t.key))
						return [];
					if (overlap(mine, t.words) < SIMILAR) return [];
					// Offered only when the other's name is its alone, and this question has
					// a name for the other to list back.
					const other = index.files.get(t.key)?.name;
					const fix: Fix | undefined =
						other !== undefined &&
						symbols.name !== undefined &&
						(index.names.get(other) ?? []).length === 1
							? {
									kind: "variant",
									label: `Mark as a variant of \`${other}\``,
									name: other,
								}
							: undefined;
					return [
						{
							code: "similar-text",
							severity: "info",
							path: "text",
							message: `Reads like \`${label(t.key)}\`: ${quote(t.raw)}`,
							hint: "If both questions ask the same thing, keep one. If you need both, add `variant_of:` naming the other, and say how they differ.",
							others: [t.key],
							...(fix !== undefined && { fix }),
						},
					];
				});

	return [...duplicateName, ...variables, ...unknown, ...repeated, ...similar];
}

/**
 * Everything a file reports: its own findings and the bank's about it, in document
 * order. The one place they are merged, so a whole-bank check and the editor agree.
 */
export const fileFindings = <K>(
	key: K,
	evaluation: {
		readonly findings: readonly Finding[];
		readonly symbols: Symbols;
		readonly ranges: Readonly<Record<string, Range>>;
	},
	index: Index<K>,
	label: (key: K) => string,
): readonly Finding[] =>
	inDocumentOrder(
		[
			...evaluation.findings,
			...bankFindings(key, evaluation.symbols, index, label),
		],
		evaluation.ranges,
	);
