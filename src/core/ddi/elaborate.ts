/**
 * Elaboration: a Draft becomes a DDI-Lifecycle 4.0 document. Total: any Draft,
 * holes included, elaborates. What is present is emitted; a hole emits nothing.
 * Parse already reported the holes, so elaboration reports none of its own.
 */
import {
	type Code,
	type Domain,
	type Draft,
	optionVariable,
} from "../surface/draft.js";
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

export function elaborate(draft: Draft, agency: string): DdiDocument {
	const qid = draft.name ?? UNTITLED;
	const questionId = identity(agency, qid);
	const questionRef = { type: "QuestionItem" as const, identity: questionId };
	const named = (suffix: string) => identity(agency, `${qid}.${suffix}`);

	const concept = maybe(draft.concept, (c) =>
		item("Concept", named("concept"), { ConceptName: [intl(c)] }),
	);
	const universe = maybe(draft.universe, (u) =>
		item("Universe", named("universe"), {
			UniverseName: [intl(u)],
			Description: structured(u),
		}),
	);
	const instruction = maybe(draft.instruction, (i) =>
		item("Instruction", named("instruction"), {
			InstructionText: [literalText(i)],
		}),
	);
	const domain = maybe(draft.domain, (d) =>
		elaborateDomain(d, agency, qid, draft.name, questionRef),
	);

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

	return documentOf(
		[question, ...(domain?.items ?? []), concept, instruction, universe].filter(
			(it) => it !== undefined,
		),
	);
}

interface ElaboratedDomain {
	readonly responseDomain: JsonObject;
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
	name: string | undefined,
	questionRef: Pick<Item, "type" | "identity">,
): ElaboratedDomain {
	switch (domain.kind) {
		case "responses":
			return elaborateResponses(domain, agency, qid, name, questionRef);
		case "number":
			return {
				items: [],
				responseDomain: obj({
					$type: "NumericDomain",
					NumberRange: numberRange(domain.min, domain.max),
					// `decimals: 0` and no `decimals` both mean whole numbers, so falsy is the right test.
					NumericTypeCode: codeValue(domain.decimals ? "Decimal" : "Integer"),
					DecimalPositions: domain.decimals,
					MeasurementUnit: maybe(domain.unit, codeValue),
				}),
			};
		case "open":
			return {
				items: [],
				responseDomain: obj({
					$type: "TextDomain",
					MaxLength: domain.maxLength,
				}),
			};
		default:
			return domain satisfies never;
	}
}

/**
 * A shared scale is one CodeList for the whole bank, identified by its name; an
 * inline list belongs to its question. Category and Code IDs use the option's
 * index, not the author's code: codes may hold characters a DDI ID cannot
 * (`1.5`, `-9`) and may repeat while being edited. The author's spelling is kept
 * in `Value`. A select-many question also yields one Variable per option, each a
 * yes/no on the binary scale: DDI's question-versus-variable split, and how the
 * Baltimore Area Survey publishes such items.
 */
function elaborateResponses(
	domain: Extract<Domain, { kind: "responses" }>,
	agency: string,
	qid: string,
	name: string | undefined,
	questionRef: Pick<Item, "type" | "identity">,
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
	const variables =
		domain.select === "many"
			? variableItems(domain.codes, agency, name, questionRef)
			: { items: [] };
	return {
		items: [codeList, ...categories, ...variables.items],
		responseDomain: obj({
			$type: "CodeDomain",
			CodeListReference: ref(codeList),
			ResponseCardinality: maybe(maximum, (m) => ({ MaximumResponses: m })),
		}),
	};
}

function codeListItems(
	agency: string,
	base: string,
	codes: readonly Code[],
): { codeList: Item; categories: Item[] } {
	const options = codes.map((c, i) => {
		const category = item("Category", identity(agency, `${base}.cat-${i}`), {
			Label: [structured(c.label)],
		});
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

function variableItems(
	codes: readonly Code[],
	agency: string,
	name: string | undefined,
	questionRef: Pick<Item, "type" | "identity">,
): { items: readonly Item[] } {
	const named = codes.flatMap((c) => {
		const variable = optionVariable(name, c);
		return variable === undefined ? [] : [{ code: c, variable }];
	});
	if (named.length === 0) return { items: [] };
	const binary = codeListItems(agency, `scale-${BINARY_SCALE}`, BINARY);
	const variables = named.map(({ code, variable }) =>
		item("Variable", identity(agency, variable), {
			VariableName: [intl(variable)],
			Label: [structured(code.title ?? code.label)],
			QuestionReference: [ref(questionRef)],
			VariableRepresentation: {
				ValueRepresentation: {
					$type: "CodeDomain",
					CodeListReference: ref(binary.codeList),
				},
			},
		}),
	);
	return { items: [...variables, binary.codeList, ...binary.categories] };
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
