/**
 * An instrument, whole: read against its banks, checked, and elaborated to DDI, as
 * `evaluate` does for a question. Total: any text gives a draft with holes, findings in
 * document order, and a DDI document.
 */
import { isMap, isScalar, parseDocument } from "yaml";
import type { Collision, DdiDocument } from "../ddi/document.ts";
import type { BankScope } from "../evaluate.ts";
import { type Finding, inDocumentOrder, type Range } from "../findings.ts";
import { UNDECLARED_AGENCY } from "../schemes.ts";
import { AGENCY_PATTERN, AGENCY_RULE_TEXT } from "../surface/bankfile.ts";
import { checkInstrument } from "./check.ts";
import type { InstrumentDraft, Use } from "./draft.ts";
import { elaborateInstrument, instrumentDocument } from "./elaborate.ts";
import { parseInstrument } from "./parse.ts";

export interface InstrumentContext {
	/** The banks it uses, each already evaluated (`bankOf`), by the alias `uses` gives it. */
	readonly banks: Readonly<Record<string, BankScope>>;
	/**
	 * The DDI agency the instrument is published under: its maker's, not necessarily its
	 * banks'. Absent, it is published under `invalid`, and a finding says so.
	 */
	readonly agency?: string;
	/** Its DDI version; "1" when nothing is known of its history. */
	readonly version?: string;
}

export interface Instrument {
	readonly draft: InstrumentDraft;
	/** The agency it was given, valid or not; absent when none was. */
	readonly agency?: string;
	/** The parse's and the checks' findings, in document order. */
	readonly findings: readonly Finding[];
	readonly ranges: Readonly<Record<string, Range>>;
	readonly ddi: DdiDocument;
	/** Identities two different items would share: an export must refuse while any exist. */
	readonly collisions: readonly Collision<string>[];
}

export function instrumentOf(
	source: string,
	context: InstrumentContext,
): Instrument {
	const parsed = parseInstrument(source, context.banks);
	const { document, collisions } = instrumentDocument(
		elaborateInstrument(parsed, {
			agency: context.agency ?? UNDECLARED_AGENCY,
			...(context.version !== undefined && { version: context.version }),
		}),
	);
	const agency: Finding[] =
		context.agency !== undefined && !AGENCY_PATTERN.test(context.agency)
			? [
					{
						code: "invalid-agency",
						severity: "error",
						path: "",
						message: `\`${context.agency}\` isn't a DDI agency.`,
						hint: AGENCY_RULE_TEXT,
					},
				]
			: context.agency === undefined
				? [
						{
							code: "hole",
							severity: "hole",
							path: "",
							message: "No DDI agency is given for this instrument.",
							hint: `Until one is, its DDI is published under \`${UNDECLARED_AGENCY}\`.`,
						},
					]
				: [];
	const clashes: Finding[] = collisions.map((c) => ({
		code: "name-clash",
		severity: "error",
		path: "",
		message: `\`${c.urn}\` would name two different items, from ${c.keys.join(", ")}.`,
	}));
	// A bank with no agency would publish its questions under `invalid`: say so where it's used.
	const banksWithout: Finding[] = parsed.draft.uses.flatMap((u): Finding[] =>
		context.banks[u.alias] !== undefined &&
		context.banks[u.alias]?.agency === undefined
			? [
					{
						code: "invalid-agency",
						severity: "error",
						path: `uses.${u.alias}`,
						message: `\`${u.alias}\` declares no DDI agency, so its questions would be published under \`${UNDECLARED_AGENCY}\`.`,
						hint: "The bank gives its agency in its `bank.yaml`.",
					},
				]
			: [],
	);
	return {
		draft: parsed.draft,
		...(context.agency !== undefined && { agency: context.agency }),
		findings: inDocumentOrder(
			[
				...parsed.findings,
				...checkInstrument(parsed),
				...clashes,
				...agency,
				...banksWithout,
			],
			parsed.ranges,
		),
		ranges: parsed.ranges,
		ddi: document,
		collisions,
	};
}

/**
 * The banks an instrument uses, read without anything else: what a resolver fetches
 * before `instrumentOf` can run. Pure; an address is never interpreted here.
 */
export function importsOf(source: string): readonly Use[] {
	const uses = parseDocument(source, { prettyErrors: false }).get("uses", true);
	if (!isMap(uses)) return [];
	return uses.items.flatMap((pair) => {
		if (!isScalar(pair.key)) return [];
		const alias = String(pair.key.value);
		const address =
			isScalar(pair.value) && typeof pair.value.value === "string"
				? pair.value.value
				: undefined;
		return [{ alias, ...(address !== undefined && { address }) }];
	});
}
