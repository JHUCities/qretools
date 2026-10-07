/**
 * The bank's own file, `bank.yaml`: what the bank says about itself, so that whoever
 * reads or imports it reads the same. Today one field, the DDI agency every item it
 * defines is published under.
 */
import { isMap, isScalar, parseDocument } from "yaml";
import type { Finding } from "../findings.ts";
import { error, hole, isPlainObject, yamlError, yamlErrors } from "./read.ts";

/**
 * A DDI agency: a registered code with optional sub-agencies after dots, as the DDI
 * schema describes it. Anchored here: the schema's own pattern is not, so validating
 * the DDI would accept anything containing one valid character.
 */
export const AGENCY_PATTERN = /^[a-zA-Z0-9-]{1,63}(\.[a-zA-Z0-9-]{1,63})*$/;

export const AGENCY_RULE_TEXT =
	"Letters, digits and hyphens, up to 63 at a time, in parts joined by dots, such as `org.example`.";

export interface ParsedBankFile {
	readonly agency?: string;
	readonly findings: readonly Finding[];
}

/** The bank file, read. Total: an empty or broken file is findings, never a throw. */
export function parseBankFile(source: string): ParsedBankFile {
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
				error("not-a-map", "", "This file is fields, such as `agency:`."),
			],
		};
	const unknown = Object.keys(js)
		.filter((k) => k !== "agency")
		.map((k) =>
			error(
				"unknown-key",
				k,
				`\`${k}\` isn't a field here.`,
				"The only field is `agency`.",
			),
		);
	// As written: a number-like agency (`2024`) keeps its spelling, as codes do.
	const node = doc.get("agency", true);
	const agency =
		isScalar(node) && typeof node.value === "number"
			? (node.source ?? String(node.value))
			: js.agency;
	if (agency === undefined)
		return {
			findings: [
				...syntax,
				...unknown,
				hole(
					"agency",
					"Add an `agency:` line: the DDI agency this bank's items are published under.",
				),
			],
		};
	if (agency === null || (typeof agency === "string" && agency.trim() === ""))
		return {
			findings: [...syntax, ...unknown, hole("agency", "`agency` is empty.")],
		};
	if (typeof agency !== "string" || !AGENCY_PATTERN.test(agency))
		return {
			findings: [
				...syntax,
				...unknown,
				error(
					"invalid-agency",
					"agency",
					`\`${String(agency)}\` isn't a DDI agency.`,
					AGENCY_RULE_TEXT,
				),
			],
		};
	return { agency, findings: [...syntax, ...unknown] };
}
