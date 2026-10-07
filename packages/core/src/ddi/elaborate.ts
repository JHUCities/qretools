/**
 * Elaboration: a Draft becomes a DDI-Lifecycle 4.0 document. Total: any Draft,
 * holes included, elaborates. What is present is emitted; a hole emits nothing.
 * Parse already reported the holes, so elaboration reports none of its own.
 *
 * A reference into a scheme becomes one shared item, identified by scheme and
 * name (`scale-agree4`, `universe-renters`); prose becomes a per-question item.
 *
 * Every question yields its dataset Variables, as the codebook lists them: one
 * named like the question, or, for select-many, one per option. A variable is
 * keyed by its own name (`variable-<name>`), never by its question's, and points
 * back with `QuestionReference`: role 2 may ask one question twice and name two
 * variables. Hyphenated prefixes are namespaces (`NAME_PATTERN` has no hyphen, so
 * they cannot collide with a question); the one allowed dot hangs parts off a base.
 */

import { BINARY, BINARY_SCALE } from "../binary.ts";
import { compact } from "../compact.ts";
import { schemePath } from "../kinds.ts";
import type { SchemeKind } from "../schemes.ts";
import {
	type Code,
	type DefinedVariable,
	type Domain,
	type Draft,
	definedVariables,
	labelOf,
	type Named,
} from "../surface/draft.ts";
import type { LabelledEntry, TextEntry } from "../surface/env.ts";
import { hasFill, piecesOf } from "../surface/fills.ts";
import {
	codeValue,
	type DdiDocument,
	documentOf,
	dynamicText,
	type Identity,
	type Item,
	type ItemType,
	identity,
	intl,
	item,
	type JsonObject,
	literalText,
	obj,
	ref,
	structured,
} from "./document.ts";
import {
	UNVERSIONED,
	type Version,
	type Versions,
	versionFields,
} from "./version.ts";

/** ID used while `name` is still a hole. Never leaks into QuestionItemName. */
const UNTITLED = "untitled-question";

/** The bank's missing-value list: one managed representation, referenced by every Variable. */
const MISSING_ID = "missing-values";

/**
 * What is known of the versions a question's items take: its own file's, and each
 * shared file's by path. Absent, an item is `UNVERSIONED`.
 */
export interface Versioning {
	readonly own?: Version;
	readonly shared?: Versions;
}

/** A question as one DDI document: its items, keyed once (see `documentOf`). */
export const elaborate = (
	draft: Draft,
	agency: string,
	missing: readonly Code[],
	versioning: Versioning = {},
): DdiDocument =>
	documentOf(elaborateItems(draft, agency, missing, versioning));

/** Who publishes the items, and at which version each file's items are. */
interface Ctx {
	readonly agency: string;
	readonly own: Version;
	readonly shared: (kind: SchemeKind, name: string) => Version;
}

/** An item at a version; the file's principal item also carries the version's UserID. */
const versioned = (
	ctx: Ctx,
	type: ItemType,
	id: string,
	version: Version,
	body: JsonObject,
	principal = false,
): Item =>
	item(type, identity(ctx.agency, id, version.number), {
		...body,
		...versionFields(version, principal),
	});

/**
 * A question's DDI items, unkeyed: an export of many questions (an instrument, a
 * bank) concatenates their lists and calls `documentOf` once, at its edge.
 */
export function elaborateItems(
	draft: Draft,
	agency: string,
	missing: readonly Code[],
	versioning: Versioning = {},
): readonly Item[] {
	const ctx: Ctx = {
		agency,
		own: versioning.own ?? UNVERSIONED,
		shared: (kind, name) =>
			versioning.shared?.[schemePath(kind, name)] ?? UNVERSIONED,
	};
	const qid = draft.name ?? UNTITLED;
	const named = (suffix: string) => `${qid}.${suffix}`;

	const concept = maybe(draft.concept, (c) =>
		conceptItem(c, ctx, named("concept")),
	);
	const universe = maybe(draft.universe, (u) =>
		universeItem(u, ctx, named("universe")),
	);
	const instruction = maybe(draft.instruction, (i) =>
		instructionItem(i, ctx, named("instruction")),
	);
	const domain = maybe(draft.domain, (d) => elaborateDomain(d, ctx, qid));

	// Each declared fill is a typed parameter of the question; the text names it where it goes.
	const fills = (draft.fills ?? []).map((f) => {
		const id = identity(ctx.agency, named(`fill-${f.name}`), ctx.own.number);
		return {
			name: f.name,
			id,
			parameter: obj({
				...id,
				ParameterName: [intl(f.name)],
				Alias: f.name,
				ValueRepresentation: maybe(f.type, (t) => ({
					$type: t === "number" ? "NumericDomain" : "TextDomain",
				})),
			}),
		};
	});
	const question = versioned(
		ctx,
		"QuestionItem",
		qid,
		ctx.own,
		obj({
			QuestionItemName: maybe(draft.name, (n) => [intl(n)]),
			Label: maybe(draft.title, (t) => [structured(t)]),
			Description: maybe(draft.note, structured),
			QuestionText: maybe(draft.text, (t) => [questionText(t, fills)]),
			InParameter: fills.length > 0 ? fills.map((f) => f.parameter) : undefined,
			QuestionIntent: maybe(draft.intent, structured),
			ResponseDomain: domain?.responseDomain,
			ConceptReference: maybe(concept, (c) => [ref(c)]),
			InterviewerInstructionAttachment: maybe(instruction, (i) => [
				{ InterviewerInstructionReference: ref(i) },
			]),
			BasedOnObject: maybe(draft.source, (s) => ({
				BasedOnRationaleDescription: intl(s),
			})),
		}),
		true,
	);

	// No name or no domain, no variable: it would have no name or no values.
	const specs = variableSpecs(
		definedVariables(draft),
		draft.title,
		domain?.value,
		ctx,
	);
	const missingItems =
		missing.length > 0 && specs.variables.length > 0
			? missingValueItems(ctx, missing)
			: undefined;
	const variables = specs.variables.map((v) =>
		variableItem(v, ctx, {
			question,
			universe,
			concept,
			missing: missingItems?.representation,
		}),
	);

	return [
		question,
		...(domain?.items ?? []),
		...variables,
		...specs.items,
		concept,
		instruction,
		universe,
		...(missingItems?.items ?? []),
	].filter((it) => it !== undefined);
}

/**
 * Question text: literal unless a declared fill is written in it, then dynamic, the
 * words and each fill's parameter in order. Without fills it is exactly as before.
 */
function questionText(
	text: string,
	fills: readonly { readonly name: string; readonly id: Identity }[],
): JsonObject {
	const pieces = piecesOf(
		text,
		fills.map((f) => ({ name: f.name })),
	);
	if (!hasFill(pieces)) return literalText(text);
	const ids = new Map(fills.map((f) => [f.name, f.id]));
	return dynamicText(
		pieces.flatMap((p): ({ text: string } | { parameter: Identity })[] => {
			if (p.kind === "words") return [{ text: p.text }];
			const parameter = ids.get(p.name);
			return parameter === undefined ? [] : [{ parameter }];
		}),
	);
}

/**
 * A shared concept is the bank's one Concept (ISO/IEC 11179, as DDI has it): its name,
 * its label, and its definition as the Description. Prose, advice to share it, stays
 * this question's own, as before.
 */
function conceptItem(c: Named<LabelledEntry>, ctx: Ctx, own: string): Item {
	return c.kind === "text"
		? versioned(ctx, "Concept", own, ctx.own, { ConceptName: [intl(c.text)] })
		: versioned(
				ctx,
				"Concept",
				`concept-${c.name}`,
				ctx.shared("concept", c.name),
				{
					ConceptName: [intl(c.name)],
					Label: [structured(c.value.label)],
					...(c.value.definition !== undefined && {
						Description: structured(c.value.definition),
					}),
				},
				true,
			);
}

/** Prose is this question's own universe; a reference is the bank's, named as the bank names it. */
function universeItem(u: Named<TextEntry>, ctx: Ctx, own: string): Item {
	return u.kind === "text"
		? versioned(ctx, "Universe", own, ctx.own, {
				UniverseName: [intl(u.text)],
				Description: structured(u.text),
			})
		: versioned(
				ctx,
				"Universe",
				`universe-${u.name}`,
				ctx.shared("universe", u.name),
				{
					UniverseName: [intl(u.name)],
					Label: [structured(u.value.text)],
					Description: structured(u.value.text),
				},
				true,
			);
}

function instructionItem(i: Named<TextEntry>, ctx: Ctx, own: string): Item {
	return i.kind === "text"
		? versioned(ctx, "Instruction", own, ctx.own, {
				InstructionText: [literalText(i.text)],
			})
		: versioned(
				ctx,
				"Instruction",
				`instruction-${i.name}`,
				ctx.shared("instruction", i.name),
				{
					InstructionName: [intl(i.name)],
					InstructionText: [literalText(i.value.text)],
				},
				true,
			);
}

/**
 * DDI attaches missing values to variables, not questions: `MissingValuesReference`
 * lives on the variable's representation. So the bank's list becomes one
 * ManagedMissingValuesRepresentation over a CodeList whose categories are marked
 * missing, referenced from every Variable.
 */
function missingValueItems(
	ctx: Ctx,
	missing: readonly Code[],
): { representation: Item; items: readonly Item[] } {
	const version = ctx.shared("missing", "missing");
	const { codeList, categories } = codeListItems(
		ctx,
		version,
		MISSING_ID,
		missing,
		{ isMissing: true },
	);
	const representation = versioned(
		ctx,
		"ManagedMissingValuesRepresentation",
		MISSING_ID,
		version,
		{
			MissingCodeRepresentation: [{ CodeListReference: ref(codeList) }],
		},
		true,
	);
	return { representation, items: [representation, codeList, ...categories] };
}

interface ElaboratedDomain {
	/** How the question is answered. */
	readonly responseDomain: JsonObject;
	/** How one variable holds the answer: the same domain without its cardinality. */
	readonly value: JsonObject;
	readonly items: readonly Item[];
}

/**
 * The JSON property is always `ResponseDomain`, so the XML element name that
 * would say which kind it is (CodeDomain, NumericDomain, TextDomain) is lost.
 * We keep it as `$type`, using the XML element name (a label for the reader)
 * rather than the schema definition name (`CodeDomainType`); the schema permits it.
 */
function elaborateDomain(
	domain: Domain,
	ctx: Ctx,
	qid: string,
): ElaboratedDomain {
	switch (domain.kind) {
		case "responses":
			return elaborateResponses(domain, ctx, qid);
		case "number": {
			const numeric = obj({
				$type: "NumericDomain",
				NumberRange: numberRange(domain.min, domain.max),
				// `decimals: 0` and no `decimals` both mean whole numbers, so falsy is the right test.
				NumericTypeCode: codeValue(domain.decimals ? "Decimal" : "Integer"),
				DecimalPositions: domain.decimals,
				// The term only (DDI's StringValue): a shared unit's label, or the words
				// written. Which vocabulary it comes from waits for a bank-level export.
				MeasurementUnit: maybe(domain.unit, (u) => codeValue(labelOf(u))),
			});
			return { items: [], responseDomain: numeric, value: numeric };
		}
		case "open": {
			const text = obj({ $type: "TextDomain", MaxLength: domain.maxLength });
			return { items: [], responseDomain: text, value: text };
		}
		default:
			return domain satisfies never;
	}
}

/**
 * A shared scale is one CodeList for the whole bank, identified by its name; an
 * inline list belongs to its question. Category and Code IDs use the option's
 * index, not the author's code: codes may hold characters a DDI ID cannot
 * (`1.5`, `-9`) and may repeat while being edited. The author's spelling is kept
 * in `Value`. Cardinality is how the question is answered, so it stays on the
 * question's domain and never reaches a variable.
 */
function elaborateResponses(
	domain: Extract<Domain, { kind: "responses" }>,
	ctx: Ctx,
	qid: string,
): ElaboratedDomain {
	// DDI IDs allow one dot, so every list hangs off a base: `<base>.codes`,
	// `<base>.cat-i`, `<base>.code-i`. A shared scale's base is `scale-<name>`,
	// and its items take its file's version.
	const { codeList, categories } =
		domain.scale === undefined
			? codeListItems(ctx, ctx.own, qid, domain.codes)
			: codeListItems(
					ctx,
					ctx.shared("scale", domain.scale),
					`scale-${domain.scale}`,
					domain.codes,
					{ principal: true },
				);
	const maximum =
		domain.select === "one"
			? 1
			: domain.codes.length > 0
				? domain.codes.length
				: undefined;
	const value = { $type: "CodeDomain", CodeListReference: ref(codeList) };
	return {
		items: [codeList, ...categories],
		value,
		responseDomain: obj({
			...value,
			ResponseCardinality: maybe(maximum, (m) => ({ MaximumResponses: m })),
		}),
	};
}

/**
 * A code list and its categories at one version. A Code is not versionable on its own
 * (the schema gives it its parent list's version), so it carries the number alone.
 */
function codeListItems(
	ctx: Ctx,
	version: Version,
	base: string,
	codes: readonly Code[],
	{
		isMissing = false,
		principal = false,
	}: {
		/** The bank's missing-value list: its categories are marked missing. */
		readonly isMissing?: boolean;
		/** The list is its file's principal item: a shared scale's. */
		readonly principal?: boolean;
	} = {},
): { codeList: Item; categories: Item[] } {
	const options = codes.map((c, i) => {
		const category = versioned(
			ctx,
			"Category",
			`${base}.cat-${i}`,
			version,
			obj({ Label: [structured(c.label)], IsMissing: isMissing || undefined }),
		);
		const code: JsonObject = {
			...identity(ctx.agency, `${base}.code-${i}`, version.number),
			Value: codeValue(c.code),
			CategoryReference: ref(category),
		};
		return { category, code };
	});
	const codeList = versioned(
		ctx,
		"CodeList",
		`${base}.codes`,
		version,
		{ Code: options.map((o) => o.code) },
		principal,
	);
	return { codeList, categories: options.map((o) => o.category) };
}

/** A variable before it is an item: its name, its label if the author wrote one, its values. */
interface VariableSpec {
	readonly name: string;
	readonly label?: string;
	readonly value: JsonObject;
}

/**
 * One variable named like the question; or, for select-many, one per option, each
 * a yes/no on the shared binary scale (how the Baltimore Area Survey publishes
 * such items), whose list comes with them as `items`. The two labels differ on
 * purpose: a question's variable is labelled by the author's title or nothing (the
 * previews fall back to other text, DDI does not invent one); an option's falls back
 * to the option's label, which is exactly what 1 means for that variable.
 */
function variableSpecs(
	defined: readonly DefinedVariable[],
	title: string | undefined,
	value: JsonObject | undefined,
	ctx: Ctx,
): { variables: readonly VariableSpec[]; items: readonly Item[] } {
	const [first] = defined;
	if (first === undefined || value === undefined)
		return { variables: [], items: [] };
	if (first.option === undefined)
		return {
			variables: [compact({ name: first.name, label: title, value })],
			items: [],
		};
	// The bank's own file for the binary scale gives its version (see BINARY_SCALE).
	const binary = codeListItems(
		ctx,
		ctx.shared("scale", BINARY_SCALE),
		`scale-${BINARY_SCALE}`,
		BINARY,
		{ principal: true },
	);
	const yesNo = {
		$type: "CodeDomain",
		CodeListReference: ref(binary.codeList),
	};
	return {
		variables: defined.map((d) =>
			compact({
				name: d.name,
				label: d.option?.title ?? d.option?.label,
				value: yesNo,
			}),
		),
		items: [binary.codeList, ...binary.categories],
	};
}

function variableItem(
	v: VariableSpec,
	ctx: Ctx,
	refs: {
		readonly question: Item;
		readonly universe: Item | undefined;
		readonly concept: Item | undefined;
		readonly missing: Item | undefined;
	},
): Item {
	return versioned(
		ctx,
		"Variable",
		`variable-${v.name}`,
		ctx.own,
		obj({
			VariableName: [intl(v.name)],
			Label: maybe(v.label, (l) => [structured(l)]),
			QuestionReference: [ref(refs.question)],
			UniverseReference: maybe(refs.universe, (u) => [ref(u)]),
			ConceptReference: maybe(refs.concept, (c) => [ref(c)]),
			VariableRepresentation: obj({
				ValueRepresentation: v.value,
				MissingValuesReference: maybe(refs.missing, ref),
			}),
		}),
	);
}

function numberRange(
	min: number | undefined,
	max: number | undefined,
): readonly JsonObject[] | undefined {
	if (min === undefined && max === undefined) return undefined;
	const bound = (n: number | undefined) =>
		maybe(n, (v) => ({ DecimalValue: v, IsInclusive: true }));
	return [obj({ Low: bound(min), High: bound(max) })];
}

/** Apply `f` when there is something to apply it to; otherwise nothing, which `obj` drops. */
const maybe = <A, B>(a: A | undefined, f: (a: A) => B): B | undefined =>
	a === undefined ? undefined : f(a);

export type { Identity };

/**
 * A bank's shared universe as the bank publishes it (`universe-<name>`), for an export
 * that names it without asking a question that does (an instrument's default universe).
 */
export function sharedUniverseItem(
	name: string,
	entry: TextEntry,
	agency: string,
	version: Version = UNVERSIONED,
): Item {
	return universeItem(
		{ kind: "ref", name, value: entry },
		{ agency, own: UNVERSIONED, shared: () => version },
		"",
	);
}
