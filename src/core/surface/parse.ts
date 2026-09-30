/**
 * Tolerant parse: any text a student typed becomes a Draft plus Findings.
 * Never throws. The `yaml` Document is created and dropped in here; only plain
 * values (draft, findings, an index of offsets by path) cross the boundary.
 *
 * Every reader returns `Read<T>`: its value (if any) and its findings. Data
 * flow is visible in signatures; nothing is threaded through a mutable
 * accumulator.
 */
import { type Document, isMap, isNode, isScalar, parseDocument } from "yaml";
import type { ZodError } from "zod";
import { compact } from "../compact.js";
import {
	fixLabel,
	NAME_RULE_TEXT,
	SCHEME_NAME,
	SCHEME_SINGULAR,
} from "../copy.js";
import type { Finding, Fix, Range } from "../findings.js";
import { unitKey } from "../fold.js";
import { EXAMPLE, keyText, readCodeMap } from "./codes.js";
import type { Domain, Draft, Named } from "./draft.js";
import {
	type Env,
	FIELD_OF,
	inScope,
	listNames,
	type Mention,
	type NamedScheme,
	type SchemeEntries,
} from "./env.js";
import { holeChips, type Mark, marksOf, ordered } from "./marks.js";
import {
	clampRange,
	EMPTY_HINT,
	error,
	fail,
	hole,
	isPlainObject,
	issueSentence,
	ok,
	opened,
	type Read,
	yamlError,
	yamlErrors,
} from "./read.js";
import {
	DOMAIN_KEYS,
	describe,
	KNOWN_KEYS,
	NAME_PATTERN,
	NumberDomainSchema,
	OpenDomainSchema,
	QuestionSchema,
	REQUIRED_KEYS,
	type SurfaceKey,
	TEXT_KEYS,
} from "./schema.js";

export interface Parsed {
	readonly draft: Draft;
	readonly findings: readonly Finding[];
	/** Source range of every `key` and nested `key.subkey`, plus `""` for the whole text. */
	readonly ranges: Readonly<Record<string, Range>>;
	/** Every scheme name written, resolved or not. */
	readonly mentions: readonly Mention[];
	/** The questions this one says it deliberately resembles (`variant_of`); resolved by the bank index. */
	readonly variants: readonly Variant[];
	/** Where each value written as nothing at all starts, by path: the points holes are drawn at. */
	readonly empties: Readonly<Record<string, number>>;
	/** What the editor colours by meaning: resolved names, codes, `legacy`, holes. */
	readonly marks: readonly Mark[];
}

type TextKey = (typeof TEXT_KEYS)[number];

/** A question named under `variant_of`, and why the two differ. */
export interface Variant {
	readonly name: string;
	readonly path: string;
	readonly why: string;
}

const FIELDS_HINT = `Fields: ${KNOWN_KEYS.join(", ")}. Fields from an older format go under \`legacy\`.`;

export function parseSurface(text: string, env: Env): Parsed {
	const doc = parseDocument(text, { prettyErrors: false });
	const { ranges, empties } = indexDocument(doc, text.length);
	const syntax = yamlErrors(doc.errors, text.length);

	const js = toJs(doc);
	if (!isPlainObject(js.value)) {
		const notAMap = error(
			"not-a-map",
			"",
			"A question is a list of `field: value` lines.",
			FIELDS_HINT,
		);
		return {
			draft: {},
			findings: [...syntax, ...js.findings, notAMap],
			ranges,
			empties,
			mentions: [],
			variants: [],
			marks: [],
		};
	}
	const data = js.value;

	const unknown = Object.keys(data)
		.filter((key) => !isKnownKey(key))
		.map((key) =>
			error(
				"unknown-key",
				key,
				`\`${key}\` isn't a question field.`,
				FIELDS_HINT,
			),
		);

	const fields: { -readonly [K in TextKey]?: string } = {};
	const fieldFindings: Finding[] = [];
	for (const key of TEXT_KEYS) {
		const read = readText(key, data[key]);
		if (read.value !== undefined) fields[key] = read.value;
		fieldFindings.push(...read.findings);
	}

	const {
		universe: universeText,
		instruction: instructionText,
		concept: conceptText,
		...plain
	} = fields;
	const universe = refOrProse("universe", universeText, env);
	const instruction = refOrProse("instruction", instructionText, env);
	const concept = refOrProse("concept", conceptText, env);
	const scale = scaleName(doc);
	const mentions: Mention[] = [
		...(scale === undefined
			? []
			: [{ scheme: "scale", name: scale, path: "responses" } as const]),
		// Every other kind, at its place in the table: a name written there, resolved or not.
		...(Object.entries(FIELD_OF) as [NamedScheme, string][]).flatMap(
			([scheme, path]) => {
				if (scheme === "scale") return [];
				const name = nameIn(textAt(data, path));
				return name === undefined ? [] : [{ scheme, name, path }];
			},
		),
	];
	const legacy = readLegacy(data.legacy);
	const variants = readVariants(data.variant_of);
	const domain = readDomain(doc, data, ranges, env);
	const draft: Draft = compact({
		...plain,
		concept: concept.value,
		universe: universe.value,
		instruction: instruction.value,
		legacy: legacy.value,
		domain: domain.value,
	});

	const findings = [
		...syntax,
		...js.findings,
		...unknown,
		...fieldFindings,
		...concept.findings,
		...universe.findings,
		...instruction.findings,
		...legacy.findings,
		...variants.findings,
		...domain.findings,
	];
	return {
		draft,
		findings,
		ranges,
		empties,
		mentions,
		variants: variants.value ?? [],
		marks: ordered([
			...marksOf(doc, mentions, env, text.length),
			...holeChips(findings, empties),
		]),
	};
}

/** `toJS` can itself throw (e.g. an alias before its anchor); that is a syntax finding, not a crash. */
function toJs(doc: Document): Read<unknown> {
	try {
		return { value: doc.toJS() ?? {}, findings: [] };
	} catch (e) {
		return {
			value: {},
			findings: [yamlError(e instanceof Error ? e.message : String(e))],
		};
	}
}

function readText(key: TextKey, value: unknown): Read<string> {
	const required = (REQUIRED_KEYS as readonly string[]).includes(key);
	if (value === undefined) {
		return required
			? fail(hole(key, `\`${key}\` is required.`, describe(key)))
			: fail();
	}
	if (value === null || (typeof value === "string" && value.trim() === "")) {
		// Written but empty: a hole whether the field is required or not. The author opened it.
		return fail(
			hole(key, `\`${key}\` is empty.`, required ? describe(key) : EMPTY_HINT),
		);
	}
	const result = QuestionSchema.shape[key].safeParse(value);
	if (!result.success) {
		// Only `name` has a pattern; everything else fails by not being text.
		const hint = isPlainObject(value)
			? 'A `: ` inside the text starts a nested field. Quote the whole value: "..."'
			: typeof value === "string"
				? NAME_RULE_TEXT
				: "Quote the value so it is read as text.";
		const message =
			typeof value === "string"
				? `\`${key}\` isn't a valid name.`
				: `\`${key}\` must be text.`;
		return fail(error("wrong-type", key, message, hint));
	}
	return result.data === undefined ? fail() : ok(result.data);
}

/** Legacy values are never read; only the field names are kept, so a lint can say they are there. */
/**
 * `variant_of`: other questions by name, each with why the two differ. Written empty,
 * or with an empty reason, it is a hole like any opened key; whether a name exists is
 * the bank index's to say, since the parser sees one file.
 */
function readVariants(value: unknown): Read<readonly Variant[]> {
	if (value === undefined) return fail();
	if (value === null || value === "")
		return fail(hole("variant_of", "`variant_of` is empty.", EMPTY_HINT));
	if (!isPlainObject(value))
		return fail(
			error(
				"wrong-type",
				"variant_of",
				"`variant_of` must be a map of `question: why they differ` lines.",
			),
		);
	const variants: Variant[] = [];
	const findings: Finding[] = [];
	for (const [name, why] of Object.entries(value)) {
		const path = `variant_of.${name}`;
		if (!NAME_PATTERN.test(name))
			findings.push(
				error(
					"wrong-type",
					path,
					`\`${name}\` isn't a valid name.`,
					NAME_RULE_TEXT,
				),
			);
		else if (why === null || (typeof why === "string" && why.trim() === ""))
			findings.push(
				hole(
					path,
					"Say why the two differ.",
					"For example: split ballot, lower range.",
				),
			);
		else if (typeof why !== "string")
			findings.push(error("wrong-type", path, "The reason must be text."));
		else variants.push({ name, path, why });
	}
	return { value: variants, findings };
}

function readLegacy(value: unknown): Read<readonly string[]> {
	if (value === undefined || value === null) return fail();
	if (!isPlainObject(value))
		return fail(
			error(
				"wrong-type",
				"legacy",
				"`legacy` must be a map of the fields kept from the older format.",
			),
		);
	const keys = Object.keys(value);
	return keys.length === 0 ? fail() : ok(keys);
}

/**
 * A field that names a shared entry, or says it in words: a bare identifier is a name,
 * which must resolve (else a hole, offering to create it); anything else is prose. A
 * concept is always meant to be shared, so its prose is lint's advice, not the parse's.
 */
function refOrProse<K extends "universe" | "instruction" | "concept" | "unit">(
	key: K,
	text: string | undefined,
	env: Env,
): Read<Named<SchemeEntries[K]>> {
	if (text === undefined) return fail();
	const name = nameIn(text);
	if (name === undefined) return ok({ kind: "text", text });
	const scheme = inScope(env, key);
	const value = scheme[name];
	const path = FIELD_OF[key];
	if (value === undefined)
		return fail({
			...hole(
				path,
				`No ${SCHEME_SINGULAR[key]} named \`${name}\`.`,
				listNames(
					SCHEME_SINGULAR[key],
					Object.keys(scheme),
					key === "universe" || key === "instruction",
				),
			),
			fix: nearUnit(key, name, env) ?? {
				kind: "create",
				label: `New ${SCHEME_NAME[key]} \`${name}\``,
				create: { scheme: key, name, text: "", path },
			},
		});
	return ok({ kind: "ref", name, value });
}

/**
 * A unit name that differs from one shared unit only by case or singular and plural
 * (`day` for `days`): use that one, rather than create a near-twin.
 */
function nearUnit(key: string, name: string, env: Env): Fix | undefined {
	if (key !== "unit") return undefined;
	const wanted = unitKey(name);
	const near = Object.entries(env.units)
		.filter(([n, u]) => unitKey(n) === wanted || unitKey(u.label) === wanted)
		.map(([n]) => n);
	const [only] = near;
	return near.length === 1 && only !== undefined
		? {
				kind: "edit",
				label: fixLabel(only),
				edits: [{ path: FIELD_OF.unit, value: only }],
			}
		: undefined;
}

/** The one rule for concept, universe and instruction: a bare identifier is a name. */
const nameIn = (text: string | undefined): string | undefined =>
	text !== undefined && NAME_PATTERN.test(text) ? text : undefined;

/** The one rule for responses: a plain string, rather than a map, names a scale. */
function scaleName(doc: Document): string | undefined {
	const node = isMap(doc.contents)
		? doc.contents.get("responses", true)
		: undefined;
	return isScalar(node) && typeof node.value === "string"
		? node.value
		: undefined;
}

function readDomain(
	doc: Document,
	data: Record<string, unknown>,
	ranges: Readonly<Record<string, Range>>,
	env: Env,
): Read<Domain> {
	const present = DOMAIN_KEYS.filter((k) => k in data).sort(
		(a, b) =>
			(ranges[a]?.[0] ?? Number.POSITIVE_INFINITY) -
			(ranges[b]?.[0] ?? Number.POSITIVE_INFINITY),
	);
	const [first, ...extra] = present;
	if (first === undefined) {
		return fail(
			hole(
				"",
				"Say how it's answered: `responses` (options to pick from), `number`, or `open` (free text).",
				EXAMPLE,
			),
		);
	}
	const tooMany = extra.map((key) =>
		error(
			"too-many-domains",
			key,
			`A question is answered one way only; \`${first}\` is already set.`,
			`Remove \`${key}\` or \`${first}\`.`,
		),
	);
	const ignoredSelect: Finding[] =
		first !== "responses" && "select" in data
			? [
					{
						code: "ignored-key",
						severity: "warning",
						path: "select",
						message: `\`select\` only applies to \`responses\`; it is ignored for \`${first}\`.`,
					},
				]
			: [];
	const select =
		first === "responses" ? readSelect(data.select) : fail<"one" | "many">();
	const value = data[first];
	// Written but empty: a hole, as for any key (see `opened`), never an empty domain.
	const read =
		value === null || value === ""
			? fail<Domain>(hole(first, `\`${first}\` is empty.`, EMPTY_DOMAIN[first]))
			: first === "responses"
				? readResponses(doc, select.value ?? "one", env)
				: first === "number"
					? readNumber(value, env)
					: readOpen(value);
	return {
		...read,
		findings: [
			...read.findings,
			...select.findings,
			...tooMany,
			...ignoredSelect,
		],
	};
}

const EMPTY_DOMAIN: Readonly<Record<(typeof DOMAIN_KEYS)[number], string>> = {
	responses: EXAMPLE,
	number: "Add `min:`, `max:`… under it, or write `number: {}` for any number.",
	open: "Add `max_length:` under it, or write `open: {}` for any text.",
};

function readResponses(
	doc: Document,
	select: "one" | "many",
	env: Env,
): Read<Domain> {
	const node = isMap(doc.contents)
		? doc.contents.get("responses", true)
		: undefined;
	const name = scaleName(doc);
	return name !== undefined
		? readScaleName(name, env, select)
		: readInlineOptions(doc, node, select);
}

function readScaleName(
	name: string,
	env: Env,
	select: "one" | "many",
): Read<Domain> {
	const scales = inScope(env, "scale");
	const scale = scales[name];
	if (scale === undefined) {
		const names = Object.keys(scales);
		const hint =
			names.length === 0
				? "No shared scales are loaded; write the options inline."
				: listNames("scale", names, false);
		return fail({
			...hole("responses", `No scale named \`${name}\`.`, hint),
			fix: {
				kind: "create",
				label: `New ${SCHEME_NAME.scale} \`${name}\``,
				create: { scheme: "scale", name, text: "", path: "responses" },
			},
		});
	}
	return ok({ kind: "responses", codes: scale.codes, select, scale: name });
}

function readInlineOptions(
	doc: Document,
	node: unknown,
	select: "one" | "many",
): Read<Domain> {
	const codes = readCodeMap(doc, node, "responses", true);
	if (codes.value === undefined) return fail(...codes.findings);
	// Per-option titles and variables describe a select-many option's own variable; on
	// a single select they mean nothing, and saying so is kinder than dropping them.
	const ignored: Finding[] =
		select === "one"
			? codes.value
					.filter((c) => c.title !== undefined || c.variable !== undefined)
					.map((c) => ({
						code: "ignored-key",
						severity: "warning",
						path: `responses.${c.code}`,
						message:
							"`title` and `variable` on an option only apply to `select: many`.",
					}))
			: [];
	return ok(
		{ kind: "responses", codes: codes.value, select },
		...codes.findings,
		...ignored,
	);
}

function readSelect(value: unknown): Read<"one" | "many"> {
	if (value === null || value === "")
		return fail(hole("select", "`select` is empty.", EMPTY_HINT));
	const result = QuestionSchema.shape.select.safeParse(value);
	if (!result.success)
		return fail(
			error("wrong-type", "select", "`select` must be `one` or `many`."),
		);
	return result.data === undefined ? fail() : ok(result.data);
}

/** The text written at a dotted path (a field, or a field inside one), if it is text. */
function textAt(
	data: Record<string, unknown>,
	path: string,
): string | undefined {
	let node: unknown = data;
	for (const part of path.split(".")) {
		if (!isPlainObject(node)) return undefined;
		node = node[part];
	}
	return typeof node === "string" ? node : undefined;
}

function readNumber(value: unknown, env: Env): Read<Domain> {
	const { rest, holes } = opened(value, "number");
	const result = NumberDomainSchema.safeParse(rest);
	if (!result.success)
		return fail(...issueFindings("number", result.error), ...holes);
	const { unit: unitText, ...plain } = result.data;
	const unit = refOrProse("unit", unitText, env);
	const { min, max } = plain;
	if (min !== undefined && max !== undefined && min > max) {
		return fail(
			error(
				"bad-range",
				"number",
				`\`min\` (${min}) is greater than \`max\` (${max}).`,
				"Swap them, or remove one.",
			),
			...holes,
			...unit.findings,
		);
	}
	return ok(
		compact({ kind: "number", ...plain, unit: unit.value }),
		...holes,
		...unit.findings,
	);
}

function readOpen(value: unknown): Read<Domain> {
	const { rest, holes } = opened(value, "open");
	const result = OpenDomainSchema.safeParse(rest);
	if (!result.success)
		return fail(...issueFindings("open", result.error), ...holes);
	return ok(
		compact({ kind: "open", maxLength: result.data.max_length }),
		...holes,
	);
}

function issueFindings(kind: "number" | "open", zodError: ZodError): Finding[] {
	return zodError.issues.flatMap((issue) => {
		if (issue.code === "unrecognized_keys") {
			return issue.keys.map((k) =>
				error(
					"unknown-key",
					`${kind}.${k}`,
					`\`${k}\` isn't a \`${kind}\` field.`,
					describe(kind),
				),
			);
		}
		const sub = issue.path.map(String).join(".");
		const said = issueSentence(sub || kind, issue);
		return [
			compact({
				...error(
					"wrong-type",
					sub ? `${kind}.${sub}` : kind,
					said.message,
					said.hint ?? describe(kind),
				),
				detail: said.detail,
			}),
		];
	});
}

/** Where each path is in a text. Depends on nothing but the YAML, so any file kind can use it. */
export const rangesOf = (text: string): Readonly<Record<string, Range>> =>
	indexDocument(parseDocument(text, { prettyErrors: false }), text.length)
		.ranges;

export interface DocumentIndex {
	/** Source range of every `key` and nested `key.subkey`, plus `""` for the whole text. */
	readonly ranges: Readonly<Record<string, Range>>;
	/**
	 * Where each value written as nothing at all (`key:` and the line ends) starts,
	 * just after the colon. A hole finding at one of these paths is drawn there.
	 */
	readonly empties: Readonly<Record<string, number>>;
}

/** One walk over the YAML AST, by path. Any file kind can use it. */
export function indexDocument(doc: Document, length: number): DocumentIndex {
	const ranges: Record<string, Range> = { "": [0, length] };
	const empties: Record<string, number> = {};
	const walk = (node: unknown, prefix: string): void => {
		if (!isMap(node)) return;
		for (const pair of node.items) {
			if (!isScalar(pair.key) || !pair.key.range) continue;
			const path = prefix
				? `${prefix}.${keyText(pair.key)}`
				: keyText(pair.key);
			const from = pair.key.range[0];
			const to =
				isNode(pair.value) && pair.value.range
					? pair.value.range[1]
					: pair.key.range[1];
			ranges[path] = clampRange(from, to, length);
			const v = pair.value;
			if (isScalar(v) && v.value === null && v.source === "" && v.range)
				empties[path] = clampRange(v.range[0], v.range[0], length)[0];
			walk(v, path);
		}
	};
	walk(doc.contents, "");
	return { ranges, empties };
}

const isKnownKey = (key: string): key is SurfaceKey =>
	(KNOWN_KEYS as readonly string[]).includes(key);
