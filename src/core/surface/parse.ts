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
import { NAME_RULE_TEXT } from "../copy.js";
import type { Finding, Range } from "../findings.js";
import { EXAMPLE, keyText, readCodeMap } from "./codes.js";
import type { Domain, Draft, Named } from "./draft.js";
import {
	type Env,
	listNames,
	type Mention,
	type Scheme,
	type TextEntry,
} from "./env.js";
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
import type { Scales } from "./scales.js";
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
} from "./schema.js";

export interface Parsed {
	readonly draft: Draft;
	readonly findings: readonly Finding[];
	/** Source range of every `key` and nested `key.subkey`, plus `""` for the whole text. */
	readonly ranges: Readonly<Record<string, Range>>;
	/** Every scheme name written, resolved or not. */
	readonly mentions: readonly Mention[];
}

const TEXT_KEYS = [
	"name",
	"title",
	"text",
	"intent",
	"concept",
	"universe",
	"instruction",
	"source",
	"note",
] as const;
type TextKey = (typeof TEXT_KEYS)[number];

const FIELDS_HINT = `Fields: ${KNOWN_KEYS.join(", ")}. Fields from an older format go under \`legacy\`.`;

export function parseSurface(text: string, env: Env): Parsed {
	const doc = parseDocument(text, { prettyErrors: false });
	const ranges = indexRanges(doc, text.length);
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
			mentions: [],
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
		...plain
	} = fields;
	const universe = refOrProse("universe", universeText, env.universes);
	const instruction = refOrProse(
		"instruction",
		instructionText,
		env.instructions,
	);
	const scale = scaleName(doc);
	const mentions: Mention[] = [
		...(scale === undefined
			? []
			: [{ scheme: "scale", name: scale, path: "responses" } as const]),
		...(["universe", "instruction"] as const).flatMap((key) => {
			const name = nameIn(fields[key]);
			return name === undefined ? [] : [{ scheme: key, name, path: key }];
		}),
	];
	const legacy = readLegacy(data.legacy);
	const domain = readDomain(doc, data, ranges, env.scales);
	const draft: Draft = compact({
		...plain,
		universe: universe.value,
		instruction: instruction.value,
		legacy: legacy.value,
		domain: domain.value,
	});

	return {
		draft,
		findings: [
			...syntax,
			...js.findings,
			...unknown,
			...fieldFindings,
			...universe.findings,
			...instruction.findings,
			...legacy.findings,
			...domain.findings,
		],
		ranges,
		mentions,
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
 * Syntax decides: a bare identifier is a name in a scheme, anything else is prose.
 * A name that resolves is a reference; one that does not is a hole, and the hint
 * says what exists and that a sentence is also fine.
 */
function refOrProse(
	key: "universe" | "instruction",
	text: string | undefined,
	scheme: Scheme<TextEntry>,
): Read<Named<TextEntry>> {
	if (text === undefined) return fail();
	const name = nameIn(text);
	if (name === undefined) return ok({ kind: "text", text });
	const value = scheme[name];
	if (value === undefined)
		return fail(
			hole(
				key,
				`No ${key} named \`${name}\`.`,
				listNames(key, Object.keys(scheme), true),
			),
		);
	return ok({ kind: "ref", name, value });
}

/** The one rule for universe and instruction: a bare identifier is a name. */
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
	ranges: Record<string, Range>,
	scales: Scales,
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
	const read =
		first === "responses"
			? readResponses(doc, data.select, scales)
			: first === "number"
				? readNumber(data.number)
				: readOpen(data.open);
	return {
		...read,
		findings: [...read.findings, ...tooMany, ...ignoredSelect],
	};
}

function readResponses(
	doc: Document,
	select: unknown,
	scales: Scales,
): Read<Domain> {
	const selectRead = readSelect(select);
	const chosen = selectRead.value ?? "one";
	const node = isMap(doc.contents)
		? doc.contents.get("responses", true)
		: undefined;
	const name = scaleName(doc);
	const read =
		node === undefined || (isScalar(node) && node.value === null)
			? fail<Domain>(hole("responses", "`responses` is empty.", EXAMPLE))
			: name !== undefined
				? readScaleName(name, scales, chosen)
				: readInlineOptions(doc, node, chosen);
	return { ...read, findings: [...read.findings, ...selectRead.findings] };
}

function readScaleName(
	name: string,
	scales: Scales,
	select: "one" | "many",
): Read<Domain> {
	const scale = scales[name];
	if (scale === undefined) {
		const names = Object.keys(scales);
		const hint =
			names.length === 0
				? "No shared scales are loaded; write the options inline."
				: listNames("scale", names, false);
		return fail(hole("responses", `No scale named \`${name}\`.`, hint));
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

function readNumber(value: unknown): Read<Domain> {
	const { rest, holes } = opened(value ?? {}, "number");
	const result = NumberDomainSchema.safeParse(rest);
	if (!result.success)
		return fail(...issueFindings("number", result.error), ...holes);
	const { min, max } = result.data;
	if (min !== undefined && max !== undefined && min > max) {
		return fail(
			error(
				"bad-range",
				"number",
				`\`min\` (${min}) is greater than \`max\` (${max}).`,
				"Swap them, or remove one.",
			),
			...holes,
		);
	}
	return ok(compact({ kind: "number", ...result.data }), ...holes);
}

function readOpen(value: unknown): Read<Domain> {
	const { rest, holes } = opened(value ?? {}, "open");
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
	indexRanges(parseDocument(text, { prettyErrors: false }), text.length);

export function indexRanges(
	doc: Document,
	length: number,
): Record<string, Range> {
	const ranges: Record<string, Range> = { "": [0, length] };
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
			walk(pair.value, path);
		}
	};
	walk(doc.contents, "");
	return ranges;
}

const isKnownKey = (key: string): key is SurfaceKey =>
	(KNOWN_KEYS as readonly string[]).includes(key);
