/**
 * The environment a question is read against: the bank's schemes. Every name a
 * question mentions is a binding in one of these; an unbound name is a hole.
 * Filenames are names. `missing` is one bank-level list, not a namespace.
 */
import { isMap, parseDocument } from "yaml";
import type { Finding } from "../findings.ts";
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
 * A shared concept, as DDI's Concept (after ISO/IEC 11179): a short label people say,
 * and what it means. Its name is its filename.
 */
export interface LabelledEntry {
	readonly label: string;
	readonly definition?: string;
}

export interface Env {
	readonly concepts: Scheme<LabelledEntry>;
	/** A vocabulary of measurement units: DDI's MeasurementUnit is a term from one. */
	readonly units: Scheme<LabelledEntry>;
	readonly scales: Scheme<Scale>;
	readonly universes: Scheme<TextEntry>;
	readonly instructions: Scheme<TextEntry>;
	/** The bank's missing-value codes, in author order; empty when the bank declares none. */
	readonly missing: readonly Code[];
	/** The DDI agency the bank declares (`bank.yaml`); absent while it declares none. */
	readonly agency?: string;
	/** The fields the bank also requires of its questions (`bank.yaml`'s `required`). */
	readonly required: readonly RequirableKey[];
}

/** A scheme a question can name. `missing` is not one: it is a list, never named. */
export type NamedScheme =
	| "concept"
	| "scale"
	| "unit"
	| "universe"
	| "instruction";

/**
 * Where a question names each kind: the one table of reference positions. The parser's
 * mentions, the inspector, completion and the name dialog all read it.
 */
export const FIELD_OF: Readonly<Record<NamedScheme, string>> = {
	concept: "concept",
	scale: "responses",
	unit: "number.unit",
	universe: "universe",
	instruction: "instruction",
};

/**
 * A name a question writes in a reference position, whether or not it resolves.
 * An unresolved name is absent from the Draft; "used by" must still count it, or a
 * broken scale would look unused exactly when deleting it matters.
 */
export interface Mention {
	readonly scheme: NamedScheme;
	readonly name: string;
	readonly path: string;
}

/** What each named scheme holds. */
export interface SchemeEntries {
	readonly concept: LabelledEntry;
	readonly unit: LabelledEntry;
	readonly scale: Scale;
	readonly universe: TextEntry;
	readonly instruction: TextEntry;
}

/** The names in scope for a scheme: the one place a name is looked up. */
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
};

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
	// An empty file is an unwritten one: its `text` is a hole, as in an empty question.
	if ((doc.contents !== null && !isMap(doc.contents)) || !isPlainObject(js))
		return {
			findings: [
				...syntax,
				error("not-a-map", "", "This is one `text:` line."),
			],
		};
	const unknown = Object.keys(js)
		.filter((k) => k !== "text")
		.map((k) =>
			error(
				"unknown-key",
				k,
				`\`${k}\` isn't a field here.`,
				"The only field is `text`.",
			),
		);
	const text = js.text;
	if (text === undefined)
		return {
			findings: [...syntax, ...unknown, hole("text", "Add a `text:` line.")],
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

export interface ParsedLabelled {
	readonly entry?: LabelledEntry;
	readonly findings: readonly Finding[];
}

/**
 * A labelled file (a concept, a unit): `label:` (required) and `definition:`
 * (optional). `what` names the kind in messages.
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
					`A ${what} is a \`label:\` line, and a \`definition:\` if you like.`,
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
				"The fields are `label` and `definition`.",
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
