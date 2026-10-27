/**
 * What a question is read against: the bank's shared files. Every name a question
 * uses must be one of these; a name that isn't is a hole. A file's name is its
 * filename. `missing` is one list for the whole bank, not a set of names.
 */

import { isMap, parseDocument } from "yaml";
import type { Finding } from "../findings.ts";
import { DEFAULT_SELECT_ALL, type SelectAll } from "../selectAll.ts";
import type { Code } from "./draft.ts";
import {
	EMPTY_HINT,
	error,
	fail,
	hole,
	isPlainObject,
	ok,
	type Read,
	yamlError,
	yamlErrors,
} from "./read.ts";
import type { Scale } from "./scales.ts";
import type { RequirableKey } from "./schema.ts";

export type Scheme<T> = Readonly<Record<string, T>>;

export interface TextEntry {
	readonly text: string;
}

/**
 * A shared concept, as DDI's Concept (after ISO/IEC 11179): a short label, and what
 * it means. Its name is its filename.
 */
export interface LabelledEntry {
	readonly label: string;
	readonly definition?: string;
}

export interface Env {
	readonly concepts: Scheme<LabelledEntry>;
	/** The bank's units: DDI's MeasurementUnit is a term from such a list. */
	readonly units: Scheme<LabelledEntry>;
	readonly scales: Scheme<Scale>;
	readonly universes: Scheme<TextEntry>;
	readonly instructions: Scheme<TextEntry>;
	/** The bank's missing values, in the author's order; empty when the bank has none. */
	readonly missing: readonly Code[];
	/** The fields the bank also requires of its questions (`workspace.yaml`'s `required`). */
	readonly required: readonly RequirableKey[];
	/**
	 * The fields a folder's questions must also have (`workspace.yaml`'s `required_in`), by
	 * folder. Not read for a question directly: `envAt` folds it into `required`.
	 */
	readonly requiredIn: Readonly<Record<string, readonly RequirableKey[]>>;
	/**
	 * The folder behind each field `envAt` added to `required`, so the hole can name it.
	 * Absent when no folder added any.
	 */
	readonly requiredBy?: Readonly<Record<string, string>>;
	/** How the bank stores the answer to a select-all-that-apply option (`select_all.yaml`). */
	readonly selectAll: SelectAll;
}

/** A kind of shared file a question can name. Not `missing`: it's a list, never named. */
export type NamedScheme =
	| "concept"
	| "scale"
	| "unit"
	| "universe"
	| "instruction";

/**
 * The field where a question names each kind: the one table of them. The parser,
 * the inspector, completion and the name dialog all read it.
 */
export const FIELD_OF: Readonly<Record<NamedScheme, string>> = {
	concept: "concept",
	scale: "responses",
	unit: "number.unit",
	universe: "universe",
	instruction: "instruction",
};

/**
 * A name a question writes where a shared file is named, found or not. A name not
 * found is left out of the Draft, but "used by" must still count it, or a broken
 * scale would look unused just when deleting it matters.
 */
export interface Mention {
	readonly scheme: NamedScheme;
	readonly name: string;
	readonly path: string;
}

/** What each kind of shared file holds. */
export interface SchemeEntries {
	readonly concept: LabelledEntry;
	readonly unit: LabelledEntry;
	readonly scale: Scale;
	readonly universe: TextEntry;
	readonly instruction: TextEntry;
}

/** The names of one kind: the one place a name is looked up. */
export const inScope = <S extends NamedScheme>(
	env: Env,
	scheme: S,
): Scheme<SchemeEntries[S]> => {
	const byScheme: { readonly [K in NamedScheme]: Scheme<SchemeEntries[K]> } = {
		concept: env.concepts,
		unit: env.units,
		scale: env.scales,
		universe: env.universes,
		instruction: env.instructions,
	};
	return byScheme[scheme];
};

export const EMPTY_ENV: Env = {
	concepts: {},
	units: {},
	scales: {},
	universes: {},
	instructions: {},
	missing: [],
	required: [],
	requiredIn: {},
	selectAll: DEFAULT_SELECT_ALL,
};

/**
 * What the question at `path` is read against: `env`, plus the fields its folder also
 * requires. A folder only adds, so it can be stricter, never looser. Returns `env`
 * itself when there's no path (a draft) or the folder adds nothing: callers memoise on
 * the reference, and `selectAll` is compared by reference, so nothing is rebuilt.
 */
export function envAt(env: Env, path?: string): Env {
	if (path === undefined) return env;
	// Whole segments: `questions/nh` isn't above `questions/nhd/x.yaml`. Questions are one
	// folder deep today, so at most one folder matches; deeper, every folder above would.
	const by: Record<string, string> = {};
	const added: RequirableKey[] = [];
	for (const [folder, fields] of Object.entries(env.requiredIn))
		if (path.startsWith(`${folder}/`))
			for (const k of fields)
				if (!env.required.includes(k) && !added.includes(k)) {
					added.push(k);
					by[k] = folder;
				}
	return added.length === 0
		? env
		: { ...env, required: [...env.required, ...added], requiredBy: by };
}

export interface ParsedTextEntry {
	readonly entry?: TextEntry;
	readonly findings: readonly Finding[];
}

/** A universe or instruction file: one `text:` line. */
export function parseTextEntry(source: string): ParsedTextEntry {
	const doc = parseDocument(source, { prettyErrors: false });
	const syntax: Finding[] = yamlErrors(doc.errors, source.length);
	let js: unknown;
	try {
		js = doc.toJS() ?? {};
	} catch (e) {
		return {
			findings: [
				...syntax,
				yamlError(e instanceof Error ? e.message : String(e)),
			],
		};
	}
	// An empty file is unwritten: its `text` is a hole, as in an empty question.
	if ((doc.contents !== null && !isMap(doc.contents)) || !isPlainObject(js))
		return {
			findings: [
				...syntax,
				error(
					"not-a-map",
					"",
					"A shared universe or instruction is one `text:` line.",
				),
			],
		};
	const unknown = Object.keys(js)
		.filter((k) => k !== "text")
		.map((k) =>
			error(
				"unknown-key",
				k,
				`\`${k}\` isn't a field here.`,
				"Only `text` is used here.",
			),
		);
	const text = js.text;
	if (text === undefined)
		return {
			findings: [
				...syntax,
				...unknown,
				hole("text", "Add a `text:` line.", "For example: `text: All adults`."),
			],
		};
	if (text === null || (typeof text === "string" && text.trim() === ""))
		return {
			findings: [
				...syntax,
				...unknown,
				hole("text", "`text` is empty.", "Write the words after `text:`."),
			],
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

export interface ParsedLabelled {
	readonly entry?: LabelledEntry;
	readonly findings: readonly Finding[];
}

/**
 * A concept or unit file: `label:` (required) and `definition:` (optional).
 * `what` names the kind in messages.
 */
export function parseLabelled(source: string, what: string): ParsedLabelled {
	const doc = parseDocument(source, { prettyErrors: false });
	const syntax: Finding[] = yamlErrors(doc.errors, source.length);
	let js: unknown;
	try {
		js = doc.toJS() ?? {};
	} catch (e) {
		return {
			findings: [
				...syntax,
				yamlError(e instanceof Error ? e.message : String(e)),
			],
		};
	}
	if ((doc.contents !== null && !isMap(doc.contents)) || !isPlainObject(js))
		return {
			findings: [
				...syntax,
				error(
					"not-a-map",
					"",
					`A ${what} is a \`label:\` line, with a \`definition:\` if you want one.`,
				),
			],
		};
	const unknown = Object.keys(js)
		.filter((k) => k !== "label" && k !== "definition")
		.map((k) =>
			error(
				"unknown-key",
				k,
				`\`${k}\` isn't a field here.`,
				"Only `label` and `definition` are used here.",
			),
		);
	const text = (key: "label" | "definition"): Read<string> => {
		const v = js[key];
		if (v === undefined)
			return key === "label"
				? fail(
						hole(
							"label",
							`Add a \`label:\` line: the ${what} as people write it.`,
						),
					)
				: fail();
		if (v === null || (typeof v === "string" && v.trim() === ""))
			return fail(
				hole(
					key,
					`\`${key}\` is empty.`,
					key === "definition" ? EMPTY_HINT : undefined,
				),
			);
		if (typeof v !== "string")
			return fail(error("wrong-type", key, `\`${key}\` must be text.`));
		return ok(v);
	};
	const label = text("label");
	const definition = text("definition");
	const findings = [
		...syntax,
		...unknown,
		...label.findings,
		...definition.findings,
	];
	return label.value === undefined
		? { findings }
		: {
				entry: {
					label: label.value,
					...(definition.value !== undefined && {
						definition: definition.value,
					}),
				},
				findings,
			};
}

/** The hint under a name not found: the names there are, and that words also work. */
export function listNames(
	what: string,
	names: readonly string[],
	proseAllowed: boolean,
): string {
	const shown =
		names.length === 0
			? `The bank has no shared ${what}s yet.`
			: `Shared ${what}s: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}.`;
	return proseAllowed ? `${shown} Or write it out in words.` : shown;
}
