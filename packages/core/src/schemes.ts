/**
 * Scheme files: the bank's shared elements, one file each, named by file. Where
 * they live, how each is read, and the environment questions are read against.
 * Pure; the shell decides which text of a file counts (the saved bank version).
 */
import { parseDocument, stringify } from "yaml";
import { SCHEME_SINGULAR } from "./copy.ts";
import { type Finding, inDocumentOrder, type Range } from "./findings.ts";
import { FOLDERS, isRoot, ROOT, type RootKind, schemePath } from "./kinds.ts";
import { missingCollisions, usualCodingCollisions } from "./lint.ts";
import { DEFAULT_SELECT_ALL, type SelectAll } from "./selectAll.ts";
import { parseSelectAllFile, parseSettingsFile } from "./surface/bankfile.ts";
import type { Code } from "./surface/draft.ts";
import {
	EMPTY_ENV,
	type Env,
	type LabelledEntry,
	type NamedScheme,
	parseLabelled,
	parseTextEntry,
	type TextEntry,
} from "./surface/env.ts";
import { type Livelit, settingsLivelits } from "./surface/livelits.ts";
import { labelMarksOf, type Mark } from "./surface/marks.ts";
import { indexDocument, pointAt } from "./surface/parse.ts";
import { hole } from "./surface/read.ts";
import { parseScale, type Scale } from "./surface/scales.ts";
import type { RequirableKey } from "./surface/schema.ts";
import { withSpacing } from "./surface/spacing.ts";
import { type Symbols, schemeSymbols } from "./symbols.ts";

export { FOLDERS, isRoot, ROOT, type RootKind, schemePath };

/**
 * A shared file is named, in its kind's folder, or one per bank at its root
 * (`kinds.ts`), never named by a question.
 */
export type SchemeKind = NamedScheme | RootKind;
export type Kind = "question" | SchemeKind;

/** In the tree's order: what is measured, then how it is asked, then missing data, then the workspace's details. */
export const SCHEME_KINDS: readonly SchemeKind[] = [
	"concept",
	"scale",
	"unit",
	"universe",
	"instruction",
	"missing",
	"select_all",
	"workspace",
];

/**
 * What a kind's file holds, which decides how it is read, previewed and started: a
 * `labels:` map, one `text:` line, a concept's `label:` and `definition:`, the two
 * values a select-all option is stored as, or the workspace's settings.
 */
export type Shape = "labels" | "text" | "labelled" | "coding" | "settings";

export const SHAPE: Readonly<Record<SchemeKind, Shape>> = {
	concept: "labelled",
	scale: "labels",
	unit: "labelled",
	universe: "text",
	instruction: "text",
	missing: "labels",
	select_all: "coding",
	workspace: "settings",
};

/** What a bank path holds, or undefined for a file the tool does not read. */
/** What a bank reads a file as: a question, or a shared file of a kind, named by its filename. */
export type BankFile =
	| { readonly kind: "question" }
	| { readonly kind: SchemeKind; readonly name: string };

export function kindAt(path: string): BankFile | undefined {
	if (!path.endsWith(".yaml")) return undefined;
	const root = (Object.keys(ROOT) as RootKind[]).find((k) => ROOT[k] === path);
	if (root !== undefined) return { kind: root, name: root };
	const parts = path.slice(0, -".yaml".length).split("/");
	if (parts.length === 3 && parts[0] === "questions")
		return { kind: "question" };
	if (parts.length !== 2) return undefined;
	const [folder, name] = parts;
	const kind = (Object.keys(FOLDERS) as NamedScheme[]).find(
		(k) => FOLDERS[k] === folder,
	);
	return kind === undefined || name === undefined ? undefined : { kind, name };
}

/** What a scheme file says, for its preview. */
export type SchemeValue =
	| { readonly kind: "labels"; readonly codes: readonly Code[] }
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "labelled"; readonly entry: LabelledEntry }
	| { readonly kind: "coding"; readonly selectAll: SelectAll }
	| { readonly kind: "settings"; readonly agency: string };

export interface SchemeEvaluation {
	readonly findings: readonly Finding[];
	readonly ranges: Readonly<Record<string, Range>>;
	/** What the editor colours by meaning: codes and holes (see marks.ts). */
	readonly marks: readonly Mark[];
	/** Absent while the file does not read as its kind. */
	readonly value?: SchemeValue;
	/** What it writes that another shared file may repeat, for the bank index. */
	readonly symbols: Symbols;
	/** Its pickers: the workspace's details have one, for the fields every question must have. */
	readonly livelits: readonly Livelit[];
}

/** A scheme file, read as its kind. Total: any text evaluates. */
export function evaluateScheme(
	kind: SchemeKind,
	source: string,
	env: Env,
): SchemeEvaluation {
	const read = readScheme(kind, source, env);
	const livelits =
		SHAPE[kind] === "settings"
			? settingsLivelits(
					source,
					indexDocument(
						parseDocument(source, { prettyErrors: false }),
						source.length,
					),
					parseSettingsFile(source).required,
				)
			: [];
	return { ...read, symbols: schemeSymbols(kind, read.value), livelits };
}

function readScheme(
	kind: SchemeKind,
	source: string,
	env: Env,
): Omit<SchemeEvaluation, "symbols" | "livelits"> {
	const doc = parseDocument(source, { prettyErrors: false });
	const { ranges, empties } = indexDocument(doc, source.length);
	if (SHAPE[kind] === "settings") {
		const { agency, findings: read } = parseSettingsFile(source);
		const findings = withSpacing(doc, source, read.map(pointAt(empties)));
		const marks: readonly Mark[] = [];
		return agency === undefined
			? { findings, ranges, marks }
			: { findings, ranges, marks, value: { kind: "settings", agency } };
	}
	if (SHAPE[kind] === "coding") {
		const { value, findings: read } = parseSelectAllFile(source);
		// A value a select-all option is stored as can't also be one of the bank's
		// missing-value codes, as no code of any list can: the data couldn't tell them
		// apart. Said here for a coding written here; for the usual one, on the missing list.
		const collisions =
			value === DEFAULT_SELECT_ALL
				? []
				: [
						...missingCollisions([value.chosen], env.missing, "chosen"),
						...missingCollisions([value.notChosen], env.missing, "not_chosen"),
					];
		const findings = withSpacing(
			doc,
			source,
			inDocumentOrder([...read, ...collisions], ranges).map(pointAt(empties)),
		);
		const marks: readonly Mark[] = [];
		return value === DEFAULT_SELECT_ALL
			? { findings, ranges, marks }
			: {
					findings,
					ranges,
					marks,
					value: { kind: "coding", selectAll: value },
				};
	}
	if (SHAPE[kind] === "text") {
		const { entry, findings: read } = parseTextEntry(source);
		const findings = withSpacing(doc, source, read.map(pointAt(empties)));
		const marks: readonly Mark[] = [];
		return entry === undefined
			? { findings, ranges, marks }
			: { findings, ranges, marks, value: { kind: "text", text: entry.text } };
	}
	if (SHAPE[kind] === "labelled") {
		const { entry, findings: read } = parseLabelled(
			source,
			SCHEME_SINGULAR[kind],
		);
		const findings = withSpacing(doc, source, read.map(pointAt(empties)));
		const marks: readonly Mark[] = [];
		return entry === undefined
			? { findings, ranges, marks }
			: { findings, ranges, marks, value: { kind: "labelled", entry } };
	}
	const { scale, findings: read } = parseScale(source);
	const findings = withSpacing(doc, source, read.map(pointAt(empties)));
	const marks = labelMarksOf(doc, source.length);
	if (scale === undefined) return { findings, ranges, marks };
	return {
		// A scale's codes are compared with the missing list; the missing list's with the
		// usual select-all coding, which has no file of its own to say it in.
		findings: inDocumentOrder(
			[
				...findings,
				...(kind === "scale"
					? missingCollisions(scale.codes, env.missing, "labels")
					: usualCodingCollisions(scale.codes, env.selectAll)),
			],
			ranges,
		),
		ranges,
		marks,
		value: { kind: "labels", codes: scale.codes },
	};
}

export interface SchemeFile {
	readonly kind: SchemeKind;
	readonly name: string;
	readonly text: string;
}

/**
 * The environment built from scheme files. A file that does not read as its kind
 * contributes nothing, so the questions naming it show holes; its own findings say
 * why. A second missing list cannot exist (one path), so the last one read wins.
 */
export function schemeEnv(files: readonly SchemeFile[]): Env {
	const concepts: Record<string, LabelledEntry> = {};
	const units: Record<string, LabelledEntry> = {};
	const scales: Record<string, Scale> = {};
	const universes: Record<string, TextEntry> = {};
	const instructions: Record<string, TextEntry> = {};
	let missing: readonly Code[] = EMPTY_ENV.missing;
	let required: readonly RequirableKey[] = EMPTY_ENV.required;
	let requiredIn: Env["requiredIn"] = EMPTY_ENV.requiredIn;
	let selectAll: SelectAll = EMPTY_ENV.selectAll;
	for (const f of files) {
		if (f.kind === "workspace") {
			({ required, requiredIn } = parseSettingsFile(f.text));
			continue;
		}
		if (f.kind === "select_all") {
			selectAll = parseSelectAllFile(f.text).value;
			continue;
		}
		if (f.kind === "concept" || f.kind === "unit") {
			const { entry } = parseLabelled(f.text, SCHEME_SINGULAR[f.kind]);
			if (entry !== undefined)
				(f.kind === "concept" ? concepts : units)[f.name] = entry;
			continue;
		}
		if (f.kind === "universe" || f.kind === "instruction") {
			// SHAPE "text": a universe or an instruction, each its own namespace.
			const { entry } = parseTextEntry(f.text);
			if (entry !== undefined)
				(f.kind === "universe" ? universes : instructions)[f.name] = entry;
			continue;
		}
		const { scale } = parseScale(f.text);
		if (scale === undefined) continue;
		if (f.kind === "scale") scales[f.name] = scale;
		else missing = scale.codes;
	}
	return {
		concepts,
		units,
		scales,
		universes,
		instructions,
		missing,
		required,
		requiredIn,
		selectAll,
	};
}

/**
 * The DDI agency a workspace's `workspace.yaml` declares, among its shared files; absent
 * while it declares none. Not part of the `Env`: names resolve without it, and only DDI
 * needs it.
 */
export function bankAgency(files: readonly SchemeFile[]): string | undefined {
	const file = files.findLast((f) => f.kind === "workspace");
	return file === undefined ? undefined : parseSettingsFile(file.text).agency;
}

/**
 * The shared files of a bank given as files by path: every path that holds one, read as
 * its kind; questions and paths the tool doesn't read are skipped.
 */
export const schemeFilesIn = (
	files: Readonly<Record<string, string>>,
): readonly SchemeFile[] =>
	Object.keys(files)
		.sort()
		.flatMap((path) => {
			const at = kindAt(path);
			const text = files[path];
			return at === undefined || at.kind === "question" || text === undefined
				? []
				: [{ kind: at.kind, name: at.name, text }];
		});

/** The environment of a bank given as files by path (`schemeFilesIn`). */
export const bankEnv = (files: Readonly<Record<string, string>>): Env =>
	schemeEnv(schemeFilesIn(files));

/**
 * The agency the DDI shows while the bank declares none (a preview, never an export): `.invalid` is
 * reserved (RFC 6761) and never a real name, so the DDI stays valid and anyone reading
 * it sees at once that the agency is missing.
 */
export const UNDECLARED_AGENCY = "invalid";

/** Root files a workspace must have: the agency everything in it is published under. */
export const REQUIRED_ROOTS: readonly RootKind[] = ["workspace"];

/**
 * What a bank without its `kind` root file is told, about the bank, never on each
 * question: a hole for a required one, nothing for an optional one (missing values).
 */
export const absentRoot = (kind: RootKind): readonly Finding[] =>
	REQUIRED_ROOTS.includes(kind)
		? [
				hole(
					"agency",
					"This workspace has no DDI agency yet: add an `agency:` line to its `workspace.yaml`.",
					`Until then its DDI can't be exported, and the preview shows \`${UNDECLARED_AGENCY}\` in its place.`,
				),
			]
		: [];

/**
 * What `workspace.yaml` is told of the folders its `required_in` names that hold no
 * question, among the workspace's question `paths`: a warning at each key, since a typo
 * there would otherwise require nothing, silently. The workspace's to say, never the
 * file's own parse, which can't know what folders there are.
 */
export function unknownFolders(
	requiredIn: Env["requiredIn"],
	paths: Iterable<string>,
): readonly Finding[] {
	const folders = new Set<string>();
	for (const path of paths) {
		const parts = path.split("/");
		if (parts[0] === "questions" && parts.length > 2)
			folders.add(parts.slice(0, -1).join("/"));
	}
	const there = [...folders].sort();
	return Object.keys(requiredIn)
		.filter((folder) => !folders.has(folder))
		.map((folder) => ({
			code: "unknown-folder" as const,
			severity: "warning" as const,
			path: `required_in.${folder}`,
			message: `No questions are saved in \`${folder}\`.`,
			hint:
				there.length === 0
					? "No folder holds a saved question yet. Until one does, this requires nothing."
					: `The folders with saved questions are ${there.map((f) => `\`${f}\``).join(", ")}. Until this is one of them, it requires nothing.`,
		}));
}

/** A concept or unit file with its label; the definition is written in the file afterwards. */
export const labelledSource = (label: string): string =>
	stringify({ label: label.trim() }, { lineWidth: 0 });

/** A universe or instruction file saying `text`, quoted only where YAML needs it. */
export const textEntrySource = (text: string): string =>
	stringify({ text: text.trim() }, { lineWidth: 0 });
