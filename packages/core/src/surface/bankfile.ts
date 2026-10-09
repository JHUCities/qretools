/**
 * The bank's own file, `bank.yaml`: what the bank says about itself, so that whoever
 * reads or imports it reads the same. Today one field, the DDI agency every item it
 * defines is published under. A workspace's `workspace.yaml` is read by the same rule.
 */
import { isMap, isScalar, parseDocument } from "yaml";
import type { Finding } from "../findings.ts";
import { error, hole, isPlainObject, yamlError, yamlErrors } from "./read.ts";
import {
	REQUIRABLE_KEYS,
	REQUIRED_KEYS,
	type RequirableKey,
} from "./schema.ts";

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
	/** The fields the bank also requires of its questions; empty for a workspace. */
	readonly required: readonly RequirableKey[];
	readonly findings: readonly Finding[];
}

/** What each kind of file publishes under its agency, as the hole for a missing one says it. */
const PUBLISHES: Readonly<Record<"bank" | "workspace", string>> = {
	bank: "this bank's items are",
	workspace: "this workspace's instruments are",
};

/** The bank file, read. Total: an empty or broken file is findings, never a throw. */
export const parseBankFile = (source: string): ParsedBankFile =>
	parseSettingsFile(source, "bank");

/** The fields each kind of settings file has. */
const FIELDS: Readonly<Record<"bank" | "workspace", readonly string[]>> = {
	bank: ["agency", "required"],
	workspace: ["agency"],
};

/**
 * A settings file: a bank's `bank.yaml` (its agency, and the fields it requires of its
 * questions) or a workspace's `workspace.yaml` (its agency).
 */
export function parseSettingsFile(
	source: string,
	owner: "bank" | "workspace",
): ParsedBankFile {
	const doc = parseDocument(source, { prettyErrors: false });
	const syntax: Finding[] = yamlErrors(doc.errors, source.length);
	let js: unknown;
	try {
		js = doc.toJS() ?? {};
	} catch (e) {
		return {
			required: [],
			findings: [
				...syntax,
				yamlError(e instanceof Error ? e.message : String(e)),
			],
		};
	}
	if ((doc.contents !== null && !isMap(doc.contents)) || !isPlainObject(js))
		return {
			required: [],
			findings: [
				...syntax,
				error("not-a-map", "", "This file is fields, such as `agency:`."),
			],
		};
	const fields = FIELDS[owner];
	const unknown = Object.keys(js)
		.filter((k) => !fields.includes(k))
		.map((k) =>
			error(
				"unknown-key",
				k,
				`\`${k}\` isn't a field here.`,
				fields.length === 1
					? `The only field is \`${fields[0]}\`.`
					: `The fields are ${fields.map((f) => `\`${f}\``).join(" and ")}.`,
			),
		);
	const required =
		owner === "bank" && "required" in js
			? readRequired(js.required)
			: { value: [], findings: [] };
	const agency = readAgency(doc, js, owner);
	return {
		...(agency.value !== undefined && { agency: agency.value }),
		required: required.value,
		findings: [...syntax, ...unknown, ...agency.findings, ...required.findings],
	};
}

function readAgency(
	doc: ReturnType<typeof parseDocument>,
	js: Record<string, unknown>,
	owner: "bank" | "workspace",
): { value?: string; findings: readonly Finding[] } {
	// As written: a number-like agency (`2024`) keeps its spelling, as codes do.
	const node = doc.get("agency", true);
	const agency =
		isScalar(node) && typeof node.value === "number"
			? (node.source ?? String(node.value))
			: js.agency;
	if (agency === undefined)
		return {
			findings: [
				hole(
					"agency",
					`Add an \`agency:\` line: the DDI agency ${PUBLISHES[owner]} published under.`,
				),
			],
		};
	if (agency === null || (typeof agency === "string" && agency.trim() === ""))
		return { findings: [hole("agency", "`agency` is empty.")] };
	if (typeof agency !== "string" || !AGENCY_PATTERN.test(agency))
		return {
			findings: [
				error(
					"invalid-agency",
					"agency",
					`\`${String(agency)}\` isn't a DDI agency.`,
					AGENCY_RULE_TEXT,
				),
			],
		};
	return { value: agency, findings: [] };
}

const REQUIRABLE_TEXT = REQUIRABLE_KEYS.map((k) => `\`${k}\``).join(", ");

/**
 * `required:`, a list of question fields. Each a field a bank may require; one already
 * required, or listed twice, is advice; anything else is an error at its place.
 */
function readRequired(value: unknown): {
	value: readonly RequirableKey[];
	findings: readonly Finding[];
} {
	if (value === null)
		return {
			value: [],
			findings: [
				hole(
					"required",
					"`required` is empty.",
					`List fields, one per line as \`- title\`, from ${REQUIRABLE_TEXT}; or remove the line.`,
				),
			],
		};
	if (!Array.isArray(value))
		return {
			value: [],
			findings: [
				error(
					"wrong-type",
					"required",
					"`required` is a list of fields.",
					`Write each on its own line as \`- title\`, from ${REQUIRABLE_TEXT}.`,
				),
			],
		};
	const keys: RequirableKey[] = [];
	const findings: Finding[] = [];
	value.forEach((item, i) => {
		const at = `required.${i}`;
		if ((REQUIRED_KEYS as readonly unknown[]).includes(item))
			findings.push({
				code: "ignored-key",
				severity: "warning",
				path: at,
				message: `\`${String(item)}\` is always required.`,
				hint: "Every question has `name`, `text` and `intent`; remove the line.",
			});
		else if (!(REQUIRABLE_KEYS as readonly unknown[]).includes(item))
			findings.push(
				error(
					"wrong-type",
					at,
					typeof item === "string"
						? `\`${item}\` isn't a field a bank can require.`
						: "Each entry is a field's name.",
					`A bank can require ${REQUIRABLE_TEXT}.`,
				),
			);
		else if (keys.includes(item as RequirableKey))
			findings.push({
				code: "ignored-key",
				severity: "warning",
				path: at,
				message: `\`${item}\` is listed twice.`,
				hint: "Remove one.",
			});
		else keys.push(item as RequirableKey);
	});
	return { value: keys, findings };
}
