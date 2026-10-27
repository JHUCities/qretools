/**
 * The workspace details, `workspace.yaml`: what the workspace says about itself, so
 * everyone who reads or imports it reads the same. It holds the DDI agency for
 * everything in the workspace, and the fields every question (or every question in
 * one folder) must have. `select_all.yaml` is read here too: moving its reader beside
 * `SelectAll` would make an import cycle (env.ts reads the usual coding).
 */
import { isMap, isScalar, parseDocument } from "yaml";
import { addressOf } from "../address.ts";
import type { Finding } from "../findings.ts";
import { COMMIT_PATTERN, type Locks } from "../lock.ts";
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
 * A DDI agency: a registered code, with optional sub-agencies after dots, as the DDI
 * schema describes it. Anchored here because the schema's own pattern isn't: checking
 * the DDI would accept anything with one valid character in it.
 */
export const AGENCY_PATTERN = /^[a-zA-Z0-9-]{1,63}(\.[a-zA-Z0-9-]{1,63})*$/;

export const AGENCY_RULE_TEXT =
	"Letters, digits and hyphens, up to 63 at a time, in parts joined by dots, such as `org.example`.";

export interface ParsedSettingsFile {
	/** Absent until the file has a valid one. */
	readonly agency?: string;
	/** The fields the workspace also requires of its questions. */
	readonly required: readonly RequirableKey[];
	/**
	 * The fields a folder's questions must also have (`required_in`), by folder, in the
	 * author's order. Only ever adds to `required`: see `envAt`.
	 */
	readonly requiredIn: RequiredIn;
	/** The commit each tag its instruments use was locked at (`locked`), valid entries only. */
	readonly locked: Locks;
	readonly findings: readonly Finding[];
}

export type RequiredIn = Readonly<Record<string, readonly RequirableKey[]>>;

const FIELDS: readonly string[] = [
	"agency",
	"required",
	"required_in",
	"locked",
];

/** Reads `workspace.yaml`. An empty or broken file gives findings, never a throw. */
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
			locked: {},
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
			locked: {},
			findings: [
				...syntax,
				error(
					"not-a-map",
					"",
					"Workspace details are `field: value` lines, such as `agency: org.example`.",
				),
			],
		};
	const unknown = Object.keys(js)
		.filter((k) => !FIELDS.includes(k))
		.map((k) =>
			error(
				"unknown-key",
				k,
				`\`${k}\` isn't a field here.`,
				`Only ${FIELDS.map((f) => `\`${f}\``).join(", ")} are used here.`,
			),
		);
	const required =
		"required" in js ? readRequired(js.required) : { value: [], findings: [] };
	const requiredIn =
		"required_in" in js
			? readRequiredIn(js.required_in, required.value)
			: { value: {}, findings: [] };
	const locked =
		"locked" in js ? readLocked(js.locked) : { value: {}, findings: [] };
	const agency = readAgency(doc);
	return {
		...(agency.value !== undefined && { agency: agency.value }),
		required: required.value,
		requiredIn: requiredIn.value,
		locked: locked.value,
		findings: [
			...syntax,
			...unknown,
			...agency.findings,
			...required.findings,
			...requiredIn.findings,
			...locked.findings,
		],
	};
}

const SELECT_ALL_EXAMPLE =
	'Write the two values an option is stored as, each with its label: `chosen: { "1": Yes }` and `not_chosen: { "0": No }`.';
/** Said with every problem: the bank never uses half a coding. */
const UNTIL_IT_READS = `Until this is fixed, options are stored as ${selectAllText(DEFAULT_SELECT_ALL)}.`;

/**
 * `select_all.yaml`: the two values a select-all-that-apply option's variable holds,
 * `chosen` and `not_chosen`, each one `code: label`, the code spelled as written.
 * Unless both are there, whole and different, each problem is a finding and the usual
 * coding stays (`DEFAULT_SELECT_ALL`, by reference), never half. An empty or broken
 * file gives findings, never a throw.
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
		return usual(
			hole(
				"",
				"The select all that apply values are empty.",
				SELECT_ALL_EXAMPLE,
			),
		);
	if (!isMap(node) || node.flow)
		return usual(
			error(
				"not-a-map",
				"",
				"The select all that apply values are two lines, `chosen` and `not_chosen`.",
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
				"Only `chosen` and `not_chosen` are used here.",
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
					`\`${key}\` must be one value with its label.`,
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
				"Give each its own value, or the data can't tell chosen from not chosen.",
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
 * The agency `workspace.yaml` writes, valid or not; absent when there's none. An
 * instrument is given this, so a wrong agency shows as `invalid-agency` (as with the
 * CLI's `--agency`), not as a missing one.
 */
export function agencyWritten(source: string): string | undefined {
	const written = agencyAsWritten(
		parseDocument(source, { prettyErrors: false }),
	);
	return typeof written === "string" && written.trim() !== ""
		? written
		: undefined;
}

/** As written: an agency that looks like a number (`2024`) keeps its spelling, as codes do. */
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
					"Add an `agency:` line: the DDI agency for everything in this workspace.",
					AGENCY_RULE_TEXT,
				),
			],
		};
	if (agency === null || (typeof agency === "string" && agency.trim() === ""))
		return {
			findings: [hole("agency", "`agency` is empty.", AGENCY_RULE_TEXT)],
		};
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
 * A list of question fields at `at` (`required`, or a folder's under `required_in`).
 * Each must be a field a workspace can require. One already required (always, or by
 * `everywhere`, the workspace's own `required`), or listed twice, is advice; anything
 * else is an error at its place.
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
					`List fields from ${REQUIRABLE_TEXT}, one per line as \`- title\`. Or remove the line.`,
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
					`\`${at}\` must be a list of fields.`,
					`Write each on its own line as \`- title\`. A workspace can require ${REQUIRABLE_TEXT}.`,
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
				"Every question needs `name`, `text` and `intent` anyway. Remove the line.",
			);
		else if (!(REQUIRABLE_KEYS as readonly unknown[]).includes(item))
			findings.push(
				error(
					"wrong-type",
					path,
					typeof item === "string"
						? `\`${item}\` isn't a field a workspace can require.`
						: "Write a field's name here, such as `- title`.",
					`A workspace can require ${REQUIRABLE_TEXT}.`,
				),
			);
		else if (keys.includes(item as RequirableKey))
			ignored(
				path,
				`\`${item}\` is listed twice.`,
				`Remove one \`${item}\` line.`,
			);
		else if (everywhere.includes(item as RequirableKey))
			ignored(
				path,
				`\`${item}\` is already required of every question.`,
				`\`required\` already lists \`${item}\`. Remove this line.`,
			);
		else keys.push(item as RequirableKey);
	});
	return { value: keys, findings };
}

/**
 * A folder of questions, as `required_in` names one: its path in the workspace. Deeper
 * folders read too (the tree may go deeper later). Whether the folder exists is for the
 * workspace to say (`unknownFolders`), not this parse.
 */
const QUESTION_FOLDER = /^questions(\/[^/\s]+)+$/;

const REQUIRED_IN_EXAMPLE =
	"Write a folder, then the fields its questions must have: `questions/health:` and, under it, `- universe`.";

/**
 * `required_in:`: each folder of questions with the fields its questions must also
 * have. A key that isn't a folder is an error there and counts for nothing; each list
 * is read as `required` is.
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
					"`required_in` must be folders, each with a list of fields.",
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
					"Write the folder as `questions/health`, with no `/` at the end.",
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

const LOCKED_EXAMPLE =
	"Saving or exporting an instrument fills in `locked`: each tag it uses, with its commit, such as `owner/repo@v1: <the commit's full sha>`.";

/**
 * `locked:`: each tag an instrument uses (`owner/repo@v1`) with the commit it was
 * locked at. A bad entry is an error at its key and locks nothing. Keys are read as
 * addresses, so one bank has one entry whatever its capitals.
 */
function readLocked(value: unknown): {
	value: Locks;
	findings: readonly Finding[];
} {
	if (value === null)
		return {
			value: {},
			findings: [
				hole(
					"locked",
					"`locked` is empty.",
					`${LOCKED_EXAMPLE} Or remove the line.`,
				),
			],
		};
	if (!isPlainObject(value))
		return {
			value: {},
			findings: [
				error(
					"wrong-type",
					"locked",
					"`locked` must be tags, each with the commit it was locked at.",
					LOCKED_EXAMPLE,
				),
			],
		};
	const locks: Record<string, string> = {};
	const findings: Finding[] = [];
	for (const [written, commit] of Object.entries(value)) {
		const at = `locked.${written}`;
		const address = addressOf(written);
		if (address.kind !== "remote")
			findings.push(
				error(
					"wrong-type",
					at,
					`\`${written}\` isn't a tag in another repository.`,
					"Write it as in the instrument's `uses`, such as `owner/repo@v1`.",
				),
			);
		else if (typeof commit !== "string" || !COMMIT_PATTERN.test(commit))
			findings.push(
				error(
					"wrong-type",
					at,
					`\`${String(commit)}\` isn't a commit's full sha.`,
					LOCKED_EXAMPLE,
				),
			);
		else locks[address.key] = commit;
	}
	return { value: locks, findings };
}

/** The locks `workspace.yaml` writes: its valid entries, by key. */
export const locksWritten = (source: string): Locks =>
	parseSettingsFile(source).locked;

/**
 * `workspace.yaml` with these tags locked (`locksFor`), as saving or exporting an
 * instrument does. Every other entry, valid or not, and the comments stay as written;
 * `locked:` becomes a block map (the template's `locked: {}` too). Never drops an entry.
 * Undefined when the file isn't fields, or `locked` isn't a map, so there's nowhere to write.
 */
export function withLocks(source: string, locks: Locks): string | undefined {
	const doc = parseDocument(source);
	if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents)))
		return undefined;
	if (Object.keys(locks).length === 0) return source;
	const locked = doc.get("locked", true);
	if (locked === undefined || (isScalar(locked) && locked.value === null)) {
		doc.set("locked", doc.createNode({ ...locks }));
		return doc.toString({ lineWidth: 0 });
	}
	if (!isMap(locked)) return undefined;
	for (const [key, commit] of Object.entries(locks)) {
		// One bank, one entry: a key with other capitals is the same tag.
		const written = locked.items.find((pair) => {
			const k = isScalar(pair.key) ? String(pair.key.value) : undefined;
			const a = k === undefined ? undefined : addressOf(k);
			return a?.kind === "remote" && a.key === key;
		});
		if (written !== undefined) written.value = doc.createNode(commit);
		else locked.set(key, commit);
	}
	locked.flow = false;
	// No line width: YAML would otherwise fold every long line at 80 characters.
	return doc.toString({ lineWidth: 0 });
}
