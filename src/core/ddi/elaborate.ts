/**
 * Elaboration: a Draft becomes a DDI-Lifecycle 4.0 document. Total: any Draft,
 * holes included, elaborates. What is present is emitted; a hole emits nothing.
 * Parse already reported the holes, so elaboration reports none of its own.
 */
import type { Code, Domain, Draft } from "../surface/draft.js";
import {
	codeValue,
	type DdiDocument,
	documentOf,
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

export function elaborate(draft: Draft, agency: string): DdiDocument {
	const qid = draft.name ?? UNTITLED;
	const named = (suffix: string) => identity(agency, `${qid}.${suffix}`);

	const concept =
		draft.concept &&
		item("Concept", named("concept"), { ConceptName: [intl(draft.concept)] });
	const universe =
		draft.universe &&
		item("Universe", named("universe"), {
			UniverseName: [intl(draft.universe)],
			Description: structured(draft.universe),
		});
	const instruction =
		draft.instruction &&
		item("Instruction", named("instruction"), {
			InstructionText: [literalText(draft.instruction)],
		});
	const domain = draft.domain
		? elaborateDomain(draft.domain, agency, qid)
		: undefined;

	const question = item(
		"QuestionItem",
		identity(agency, qid),
		obj({
			QuestionItemName: draft.name ? [intl(draft.name)] : undefined,
			QuestionText: draft.text ? [literalText(draft.text)] : undefined,
			QuestionIntent: draft.intent ? structured(draft.intent) : undefined,
			ResponseDomain: domain?.responseDomain,
			ConceptReference: concept ? [ref(concept)] : undefined,
			InterviewerInstructionAttachment: instruction
				? [{ InterviewerInstructionReference: ref(instruction) }]
				: undefined,
			BasedOnObject: draft.source
				? { BasedOnRationaleDescription: intl(draft.source) }
				: undefined,
		}),
	);

	const items = [
		question,
		...(domain?.items ?? []),
		concept,
		instruction,
		universe,
	].filter((it): it is Item => typeof it === "object");
	return documentOf(items);
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
): ElaboratedDomain {
	switch (domain.kind) {
		case "responses":
			return elaborateResponses(domain.codes, domain.select, agency, qid);
		case "number":
			return {
				items: [],
				responseDomain: obj({
					$type: "NumericDomain",
					NumberRange: numberRange(domain.min, domain.max),
					// `decimals: 0` and no `decimals` both mean whole numbers, so falsy is the right test.
					NumericTypeCode: codeValue(domain.decimals ? "Decimal" : "Integer"),
					DecimalPositions: domain.decimals,
					MeasurementUnit:
						domain.unit === undefined ? undefined : codeValue(domain.unit),
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
 * Category and Code IDs use the option's index, not the author's code: codes may
 * hold characters a DDI ID cannot (`1.5`, `-9`) and may repeat while being edited.
 * The author's spelling is kept in `Value`.
 */
function elaborateResponses(
	codes: readonly Code[],
	select: "one" | "many",
	agency: string,
	qid: string,
): ElaboratedDomain {
	const options = codes.map((c, i) => {
		const category = item("Category", identity(agency, `${qid}.cat-${i}`), {
			Label: [structured(c.label)],
		});
		const code: JsonObject = {
			...identity(agency, `${qid}.code-${i}`),
			Value: codeValue(c.code),
			CategoryReference: ref(category),
		};
		return { category, code };
	});
	const categories = options.map((o) => o.category);
	const codeList = item("CodeList", identity(agency, `${qid}.codes`), {
		Code: options.map((o) => o.code),
	});
	const many = codes.length > 0 ? codes.length : undefined;
	const maximum = select === "one" ? 1 : many;
	return {
		items: [codeList, ...categories],
		responseDomain: obj({
			$type: "CodeDomain",
			CodeListReference: ref(codeList),
			ResponseCardinality:
				maximum === undefined ? undefined : { MaximumResponses: maximum },
		}),
	};
}

function numberRange(
	min: number | undefined,
	max: number | undefined,
): readonly JsonObject[] | undefined {
	if (min === undefined && max === undefined) return undefined;
	const bound = (n: number | undefined) =>
		n === undefined ? undefined : { DecimalValue: n, IsInclusive: true };
	return [obj({ Low: bound(min), High: bound(max) })];
}
