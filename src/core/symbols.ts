/**
 * The bank's symbol table. Each file defines variables, mentions scheme names, and
 * writes content that another file may repeat; "used by", "also defined by" and
 * "the same as" are all queries over one index of those. Keys are the caller's (the
 * shell's numeric ids); names are only what the index is keyed on, never an identity.
 *
 * Pure, and free of the app: another tool can build the same index over its own files.
 *
 * Duplicates are found at three strengths, as code clones are (Roy and Cordy): the same
 * as written; the same once case, punctuation and spacing are folded (and, for response
 * lists, codes ignored); and, for question text only, similar wording (word overlap),
 * computed for one file at a time against the index, never for every pair.
 */
import type { Finding } from "./findings.js";
import { fold, labelsKey } from "./fold.js";
import type { SchemeKind, SchemeValue } from "./schemes.js";
import {
	type Code,
	type DefinedVariable,
	definedVariables,
} from "./surface/draft.js";
import type { Mention, NamedScheme } from "./surface/env.js";
import type { Parsed, Variant } from "./surface/parse.js";

/**
 * What a piece of content is, for comparing like with like. A question's own list or
 * sentence is compared with other questions'; a shared file's with other shared files'.
 * One equal to a shared entry is the parse's to say ("use the name", lint.ts), not this.
 */
export type PrintKind =
	| "text"
	| "list"
	| "universe"
	| "instruction"
	| "unit"
	| "scale"
	| "universe-file"
	| "instruction-file";

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

/**
 * A unit folded further, singular and plural as one: "Days", "day". A heuristic (a
 * trailing "s" off words over three letters), applied to both sides alike; if it ever
 * misfires, a short list of plurals is the fix.
 */
const unitKey = (unit: string): string =>
	fold(unit)
		.split(" ")
		.map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
		.join(" ");

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
	if (domain?.kind === "number" && domain.unit !== undefined)
		fingerprints.push(
			print("unit", "number.unit", domain.unit, unitKey(domain.unit)),
		);
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
	if (value === undefined || kind === "missing")
		return { ...none, fingerprints: [] };
	const fingerprints =
		value.kind === "labels"
			? value.codes.length > 0
				? [listPrint("scale", "labels", value.codes)]
				: []
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
		Exclude<PrintKind, "unit">,
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
		hint: "Keep one question. If both are meant, add `variant_of:` naming the other, with why they differ.",
	},
	list: {
		code: "duplicate-list",
		what: "The same responses",
		where: "are written in",
		hint: "Make them a shared scale, so each question names it and a change reaches both.",
	},
	universe: {
		code: "duplicate-universe",
		what: "The same universe",
		where: "is written in",
		hint: "Make it a shared universe, so each question names it.",
	},
	instruction: {
		code: "duplicate-instruction",
		what: "The same instruction",
		where: "is written in",
		hint: "Make it a shared instruction, so each question names it.",
	},
	scale: {
		code: "duplicate-scale",
		what: "The same labels",
		where: "are in the shared scale",
		hint: "Keep one scale and have questions name it.",
	},
	"universe-file": {
		code: "duplicate-universe",
		what: "The same universe",
		where: "is the shared universe",
		hint: "Keep one and have questions name it.",
	},
	"instruction-file": {
		code: "duplicate-instruction",
		what: "The same instruction",
		where: "is the shared instruction",
		hint: "Keep one and have questions name it.",
	},
};

const listed = (names: readonly string[]): string =>
	names.map((n) => `\`${n}\``).join(", ");

/**
 * Findings that span files, attached to this file where it writes the shared thing;
 * each file involved gets its own, naming the others. A pair either file lists under
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
				message: `Variable \`${d.name}\` is also defined by ${names(keys).join(", ")}.`,
				hint: "A variable is one column in the dataset: give each question its own name.",
				others: keys,
			},
		];
	});

	const unknown = symbols.variants.flatMap((v): BankFinding<K>[] =>
		(index.names.get(v.name) ?? []).some((k) => k !== key)
			? []
			: [
					{
						code: "unknown-variant",
						severity: "warning",
						path: v.path,
						message: `No other question is named \`${v.name}\`.`,
						hint: "Check the name, or remove the line.",
						others: [],
					},
				],
	);

	const repeated = symbols.fingerprints.flatMap((f): BankFinding<K>[] => {
		const sites = others(index.prints.get(printKey(f))).filter(
			(s) => !deliberate(s.key),
		);
		if (f.kind === "unit") {
			const spelled = sites.filter((s) => s.raw !== f.raw);
			if (spelled.length === 0) return [];
			const keys = spelled.map((s) => s.key);
			const ways = [...new Set(spelled.map((s) => `\`${s.raw}\``))];
			return [
				{
					code: "unit-spelling",
					severity: "warning",
					path: f.path,
					message: `\`${f.raw}\` is written ${ways.join(" or ")} in ${listed(names(keys))}.`,
					hint: "Spell a unit the same way everywhere, so the codebook shows one unit.",
					others: keys,
				},
			];
		}
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
					return [
						{
							code: "similar-text",
							severity: "info",
							path: "text",
							message: `Reads like \`${label(t.key)}\`: ${quote(t.raw)}`,
							hint: "If they ask the same thing, keep one. If both are meant, add `variant_of:` naming the other.",
							others: [t.key],
						},
					];
				});

	return [...variables, ...unknown, ...repeated, ...similar];
}
