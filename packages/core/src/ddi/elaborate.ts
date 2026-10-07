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

import { compact } from "../compact.js";
import {
	type Code,
	type DefinedVariable,
	type Domain,
	type Draft,
	definedVariables,
	labelOf,
	type Named,
} from "../surface/draft.js";
import type { LabelledEntry, TextEntry } from "../surface/env.js";
import {
	codeValue,
	type DdiDocument,
	documentOf,
	type Identity,
	type Item,
	identity,
	intl,
	item,
	type JsonObject,
	literalText,
	obj,
	ref,
	structured,
} from "./document.js";

/** ID used while `name` is still a hole. Never leaks into QuestionItemName. */
const UNTITLED = "untitled";

/** Every select-many option is a yes/no variable on this one shared scale. */
const BINARY_SCALE = "yesno01";
const BINARY: readonly Code[] = [
	{ code: "0", label: "No" },
	{ code: "1", label: "Yes" },
];

/** The bank's missing-value list: one managed representation, referenced by every Variable. */
const MISSING_ID = "missing";

/** A question as one DDI document: its items, keyed once (see `documentOf`). */
export const elaborate = (
	draft: Draft,
	agency: string,
	missing: readonly Code[],
): DdiDocument => documentOf(elaborateItems(draft, agency, missing));

/**
 * A question's DDI items, unkeyed: an export of many questions (an instrument, a
 * bank) concatenates their lists and calls `documentOf` once, at its edge.
 */
export function elaborateItems(
	draft: Draft,
	agency: string,
	missing: readonly Code[],
): readonly Item[] {
	const qid = draft.name ?? UNTITLED;
	const questionId = identity(agency, qid);
	const named = (suffix: string) => identity(agency, `${qid}.${suffix}`);

	const concept = maybe(draft.concept, (c) =>
		conceptItem(c, agency, named("concept")),
	);
	const universe = maybe(draft.universe, (u) =>
		universeItem(u, agency, named("universe")),
	);
	const instruction = maybe(draft.instruction, (i) =>
		instructionItem(i, agency, named("instruction")),
	);
	const domain = maybe(draft.domain, (d) => elaborateDomain(d, agency, qid));

	const question = item(
		"QuestionItem",
		questionId,
		obj({
			QuestionItemName: maybe(draft.name, (n) => [intl(n)]),
			Label: maybe(draft.title, (t) => [structured(t)]),
			Description: maybe(draft.note, structured),
			QuestionText: maybe(draft.text, (t) => [literalText(t)]),
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
	);

	// No name or no domain, no variable: it would have no name or no values.
	const specs = variableSpecs(
		definedVariables(draft),
		draft.title,
		domain?.value,
		agency,
	);
	const missingItems =
		missing.length > 0 && specs.variables.length > 0
			? missingValueItems(agency, missing)
			: undefined;
	const variables = specs.variables.map((v) =>
		variableItem(v, agency, {
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
 * A shared concept is the bank's one Concept (ISO/IEC 11179, as DDI has it): its name,
 * its label, and its definition as the Description. Prose, advice to share it, stays
 * this question's own, as before.
 */
function conceptItem(
	c: Named<LabelledEntry>,
	agency: string,
	own: Identity,
): Item {
	return c.kind === "text"
		? item("Concept", own, { ConceptName: [intl(c.text)] })
		: item("Concept", identity(agency, `concept-${c.name}`), {
				ConceptName: [intl(c.name)],
				Label: [structured(c.value.label)],
				...(c.value.definition !== undefined && {
					Description: structured(c.value.definition),
				}),
			});
}

/** Prose is this question's own universe; a reference is the bank's, named as the bank names it. */
function universeItem(
	u: Named<TextEntry>,
	agency: string,
	own: Identity,
): Item {
	return u.kind === "text"
		? item("Universe", own, {
				UniverseName: [intl(u.text)],
				Description: structured(u.text),
			})
		: item("Universe", identity(agency, `universe-${u.name}`), {
				UniverseName: [intl(u.name)],
				Label: [structured(u.value.text)],
				Description: structured(u.value.text),
			});
}

function instructionItem(
	i: Named<TextEntry>,
	agency: string,
	own: Identity,
): Item {
	return i.kind === "text"
		? item("Instruction", own, { InstructionText: [literalText(i.text)] })
		: item("Instruction", identity(agency, `instruction-${i.name}`), {
				InstructionName: [intl(i.name)],
				InstructionText: [literalText(i.value.text)],
			});
}

/**
 * DDI attaches missing values to variables, not questions: `MissingValuesReference`
 * lives on the variable's representation. So the bank's list becomes one
 * ManagedMissingValuesRepresentation over a CodeList whose categories are marked
 * missing, referenced from every Variable.
 */
function missingValueItems(
	agency: string,
	missing: readonly Code[],
): { representation: Item; items: readonly Item[] } {
	const { codeList, categories } = codeListItems(
		agency,
		MISSING_ID,
		missing,
		true,
	);
	const representation = item(
		"ManagedMissingValuesRepresentation",
		identity(agency, MISSING_ID),
		{
			MissingCodeRepresentation: [{ CodeListReference: ref(codeList) }],
		},
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
	agency: string,
	qid: string,
): ElaboratedDomain {
	switch (domain.kind) {
		case "responses":
			return elaborateResponses(domain, agency, qid);
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
	agency: string,
	qid: string,
): ElaboratedDomain {
	// DDI IDs allow one dot, so every list hangs off a base: `<base>.codes`,
	// `<base>.cat-i`, `<base>.code-i`. A shared scale's base is `scale-<name>`.
	const base = domain.scale === undefined ? qid : `scale-${domain.scale}`;
	const { codeList, categories } = codeListItems(agency, base, domain.codes);
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

function codeListItems(
	agency: string,
	base: string,
	codes: readonly Code[],
	isMissing = false,
): { codeList: Item; categories: Item[] } {
	const options = codes.map((c, i) => {
		const category = item(
			"Category",
			identity(agency, `${base}.cat-${i}`),
			obj({ Label: [structured(c.label)], IsMissing: isMissing || undefined }),
		);
		const code: JsonObject = {
			...identity(agency, `${base}.code-${i}`),
			Value: codeValue(c.code),
			CategoryReference: ref(category),
		};
		return { category, code };
	});
	const codeList = item("CodeList", identity(agency, `${base}.codes`), {
		Code: options.map((o) => o.code),
	});
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
	agency: string,
): { variables: readonly VariableSpec[]; items: readonly Item[] } {
	const [first] = defined;
	if (first === undefined || value === undefined)
		return { variables: [], items: [] };
	if (first.option === undefined)
		return {
			variables: [compact({ name: first.name, label: title, value })],
			items: [],
		};
	const binary = codeListItems(agency, `scale-${BINARY_SCALE}`, BINARY);
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
	agency: string,
	refs: {
		readonly question: Item;
		readonly universe: Item | undefined;
		readonly concept: Item | undefined;
		readonly missing: Item | undefined;
	},
): Item {
	return item(
		"Variable",
		identity(agency, `variable-${v.name}`),
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
