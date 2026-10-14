/**
 * The workspace's settings file, `workspace.yaml`: what the workspace says about itself,
 * so that whoever reads or imports it reads the same. The DDI agency everything in it
 * is published under (questions, shared files and instruments alike), and the fields it
 * requires of every question, or of those in one folder. `select_all.yaml` is read here too: moving its reader
 * beside `SelectAll` would close an import cycle (env.ts reads the usual coding).
 */
import { isMap, isScalar, parseDocument } from "yaml";
import type { Finding } from "../findings.ts";
import {
	DEFAULT_SELECT_ALL,
	type SelectAll,
	selectAllText,
} from "../selectAll.ts";
import { keyText } from "./codes.ts";
import type { Code } from "./draft.ts";
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

export interface ParsedSettingsFile {
	/** Absent until the file gives a valid one. */
	readonly agency?: string;
	/** The fields the workspace also requires of its questions. */
	readonly required: readonly RequirableKey[];
	/**
	 * The fields a folder of questions also requires (`required_in`), by the folder's path
	 * in the workspace, in author order. Only ever more than `required`: see `envAt`.
	 */
	readonly requiredIn: RequiredIn;
	readonly findings: readonly Finding[];
}

export type RequiredIn = Readonly<Record<string, readonly RequirableKey[]>>;

const FIELDS: readonly string[] = ["agency", "required", "required_in"];

/** `workspace.yaml`, read. Total: an empty or broken file is findings, never a throw. */
export function parseSettingsFile(source: string): ParsedSettingsFile {
	const doc = parseDocument(source, { prettyErrors: false });
	const syntax: Finding[] = yamlErrors(doc.errors, source.length);
	let js: unknown;
	try {
		js = doc.toJS() ?? {};
	} catch (e) {
		return {
			required: [],
			requiredIn: {},
			findings: [
				...syntax,
				yamlError(e instanceof Error ? e.message : String(e)),
			],
		};
	}
	if ((doc.contents !== null && !isMap(doc.contents)) || !isPlainObject(js))
		return {
			required: [],
			requiredIn: {},
			findings: [
				...syntax,
				error("not-a-map", "", "This file is fields, such as `agency:`."),
			],
		};
	const unknown = Object.keys(js)
		.filter((k) => !FIELDS.includes(k))
		.map((k) =>
			error(
				"unknown-key",
				k,
				`\`${k}\` isn't a field here.`,
				`The fields are ${FIELDS.map((f) => `\`${f}\``).join(", ")}.`,
			),
		);
	const required =
		"required" in js ? readRequired(js.required) : { value: [], findings: [] };
	const requiredIn =
		"required_in" in js
			? readRequiredIn(js.required_in, required.value)
			: { value: {}, findings: [] };
	const agency = readAgency(doc);
	return {
		...(agency.value !== undefined && { agency: agency.value }),
		required: required.value,
		requiredIn: requiredIn.value,
		findings: [
			...syntax,
			...unknown,
			...agency.findings,
			...required.findings,
			...requiredIn.findings,
		],
	};
}

const SELECT_ALL_EXAMPLE =
	'Write the two values a select-all-that-apply option is stored as, each with its label: `chosen: { "1": Yes }` and `not_chosen: { "0": No }`.';
/** Said with every problem: the bank is never left with half a coding. */
const UNTIL_IT_READS = `Until it reads, the usual coding is used: ${selectAllText(DEFAULT_SELECT_ALL)}.`;

/**
 * `select_all.yaml`, the two values a select-all option's variable holds: `chosen` and
 * `not_chosen`, each one `code: label`, the code kept as the bank spelled it. Read from
 * the YAML as written. Anything short of both, whole and different, is a finding at its
 * place and the usual coding stays in effect (`DEFAULT_SELECT_ALL`, by reference), never
 * half. Total: an empty or broken file is findings, never a throw.
 */
export function parseSelectAllFile(source: string): {
	readonly value: SelectAll;
	readonly findings: readonly Finding[];
} {
	const doc = parseDocument(source, { prettyErrors: false });
	const syntax = yamlErrors(doc.errors, source.length);
	const node: unknown = doc.contents;
	const usual = (...findings: Finding[]) => ({
		value: DEFAULT_SELECT_ALL,
		findings: [...syntax, ...findings].map((f) => ({
			...f,
			hint:
				f.hint === undefined ? UNTIL_IT_READS : `${f.hint} ${UNTIL_IT_READS}`,
		})),
	});
	if (
		node === null ||
		(isScalar(node) && (node.value === null || node.value === ""))
	)
		return usual(hole("", "This file is empty.", SELECT_ALL_EXAMPLE));
	if (!isMap(node) || node.flow)
		return usual(
			error(
				"not-a-map",
				"",
				"This file has two parts, `chosen` and `not_chosen`, each on its own line.",
				SELECT_ALL_EXAMPLE,
			),
		);
	const keys = node.items.flatMap((p) =>
		isScalar(p.key) ? [String(p.key.value)] : [],
	);
	const findings: Finding[] = keys
		.filter((k) => k !== "chosen" && k !== "not_chosen")
		.map((k) =>
			error(
				"unknown-key",
				k,
				`\`${k}\` isn't a field here.`,
				"The fields are `chosen` and `not_chosen`.",
			),
		);
	const part = (key: "chosen" | "not_chosen"): Code | undefined => {
		const value = node.get(key, true);
		if (value === undefined) {
			findings.push(hole(key, `\`${key}\` is missing.`, SELECT_ALL_EXAMPLE));
			return undefined;
		}
		if (isScalar(value) && (value.value === null || value.value === "")) {
			findings.push(hole(key, `\`${key}\` is empty.`, SELECT_ALL_EXAMPLE));
			return undefined;
		}
		const [pair] = isMap(value) ? value.items : [];
		const label =
			pair !== undefined && isScalar(pair.value) ? pair.value : null;
		if (
			!isMap(value) ||
			value.items.length !== 1 ||
			pair === undefined ||
			!isScalar(pair.key) ||
			label === null ||
			label.value === null ||
			String(label.value).trim() === ""
		) {
			findings.push(
				error(
					"wrong-type",
					key,
					`\`${key}\` is one value and its label.`,
					SELECT_ALL_EXAMPLE,
				),
			);
			return undefined;
		}
		return {
			code: keyText(pair.key),
			label:
				typeof label.value === "string"
					? label.value
					: (label.source ?? String(label.value)),
		};
	};
	const chosen = part("chosen");
	const notChosen = part("not_chosen");
	if (
		chosen !== undefined &&
		notChosen !== undefined &&
		chosen.code === notChosen.code
	)
		findings.push(
			error(
				"duplicate-code",
				"not_chosen",
				`\`chosen\` and \`not_chosen\` are both \`${chosen.code}\`.`,
				"Give each its own value, or the data can't tell them apart.",
			),
		);
	if (
		syntax.length > 0 ||
		findings.length > 0 ||
		chosen === undefined ||
		notChosen === undefined
	)
		return usual(...findings);
	return {
		value: {
			chosen,
			notChosen,
			first:
				keys.indexOf("chosen") < keys.indexOf("not_chosen")
					? "chosen"
					: "not_chosen",
		},
		findings: [],
	};
}

/**
 * The agency `workspace.yaml` writes, valid or not; absent when it writes none. What an
 * instrument is given, so its own findings say `invalid-agency` where the file's is
 * wrong (as the CLI's `--agency`), rather than that none was given.
 */
export function agencyWritten(source: string): string | undefined {
	const written = agencyAsWritten(
		parseDocument(source, { prettyErrors: false }),
	);
	return typeof written === "string" && written.trim() !== ""
		? written
		: undefined;
}

/** As written: a number-like agency (`2024`) keeps its spelling, as codes do. */
function agencyAsWritten(doc: ReturnType<typeof parseDocument>): unknown {
	const node = doc.get("agency", true);
	return isScalar(node) && typeof node.value === "number"
		? (node.source ?? String(node.value))
		: doc.get("agency");
}

function readAgency(doc: ReturnType<typeof parseDocument>): {
	value?: string;
	findings: readonly Finding[];
} {
	const agency = agencyAsWritten(doc);
	if (agency === undefined)
		return {
			findings: [
				hole(
					"agency",
					"Add an `agency:` line: the DDI agency this workspace's questions, shared files and instruments are published under.",
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
 * A list of question fields, at `at` (`required`, or a folder's under `required_in`).
 * Each a field a workspace may require; one already required (always, or by `everywhere`,
 * the workspace's own `required`), or listed twice, is advice; anything else is an error
 * at its place.
 */
function readRequired(
	value: unknown,
	at = "required",
	everywhere: readonly RequirableKey[] = [],
): {
	value: readonly RequirableKey[];
	findings: readonly Finding[];
} {
	if (value === null)
		return {
			value: [],
			findings: [
				hole(
					at,
					at === "required"
						? "`required` is empty."
						: `\`${at.slice(at.indexOf(".") + 1)}\` lists no fields.`,
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
					at,
					`\`${at}\` is a list of fields.`,
					`Write each on its own line as \`- title\`, from ${REQUIRABLE_TEXT}.`,
				),
			],
		};
	const keys: RequirableKey[] = [];
	const findings: Finding[] = [];
	const ignored = (path: string, message: string, hint: string) =>
		findings.push({
			code: "ignored-key",
			severity: "warning",
			path,
			message,
			hint,
		});
	value.forEach((item, i) => {
		const path = `${at}.${i}`;
		if ((REQUIRED_KEYS as readonly unknown[]).includes(item))
			ignored(
				path,
				`\`${String(item)}\` is always required.`,
				"Every question has `name`, `text` and `intent`; remove the line.",
			);
		else if (!(REQUIRABLE_KEYS as readonly unknown[]).includes(item))
			findings.push(
				error(
					"wrong-type",
					path,
					typeof item === "string"
						? `\`${item}\` isn't a field a workspace can require.`
						: "Each entry is a field's name.",
					`A workspace can require ${REQUIRABLE_TEXT}.`,
				),
			);
		else if (keys.includes(item as RequirableKey))
			ignored(path, `\`${item}\` is listed twice.`, "Remove one.");
		else if (everywhere.includes(item as RequirableKey))
			ignored(
				path,
				`\`${item}\` is already required of every question.`,
				"`required` lists it; remove the line.",
			);
		else keys.push(item as RequirableKey);
	});
	return { value: keys, findings };
}

/**
 * A folder of questions, as `required_in` names one: its path in the workspace. Deeper
 * than one folder reads too (the file tree may go deeper later); whether a folder is
 * there is the workspace's to say (`unknownFolders`), never this file's own parse.
 */
const QUESTION_FOLDER = /^questions(\/[^/\s]+)+$/;

const REQUIRED_IN_EXAMPLE =
	"Write a folder of questions and the fields its questions must have: `questions/health:` and, under it, `- universe`.";

/**
 * `required_in:`, a map from a folder of questions to the fields its questions must
 * also have. A key that isn't a folder's path is an error at the key and counts for
 * nothing; each list is read as `required` is.
 */
function readRequiredIn(
	value: unknown,
	everywhere: readonly RequirableKey[],
): { value: RequiredIn; findings: readonly Finding[] } {
	if (value === null)
		return {
			value: {},
			findings: [
				hole(
					"required_in",
					"`required_in` is empty.",
					`${REQUIRED_IN_EXAMPLE} Or remove the line.`,
				),
			],
		};
	if (!isPlainObject(value))
		return {
			value: {},
			findings: [
				error(
					"wrong-type",
					"required_in",
					"`required_in` is folders, each with a list of fields.",
					REQUIRED_IN_EXAMPLE,
				),
			],
		};
	const folders: Record<string, readonly RequirableKey[]> = {};
	const findings: Finding[] = [];
	for (const [folder, fields] of Object.entries(value)) {
		const at = `required_in.${folder}`;
		if (!QUESTION_FOLDER.test(folder)) {
			findings.push(
				error(
					"wrong-type",
					at,
					`\`${folder}\` isn't a folder of questions.`,
					"Write the folder's path in the workspace, with no `/` at the end, such as `questions/health`.",
				),
			);
			continue;
		}
		const read = readRequired(fields, at, everywhere);
		folders[folder] = read.value;
		findings.push(...read.findings);
	}
	return { value: folders, findings };
}
