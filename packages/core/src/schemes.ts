/**
 * Scheme files: the bank's shared elements, one file each, named by file. Where
 * they live, how each is read, and the environment questions are read against.
 * Pure; the shell decides which text of a file counts (the saved bank version).
 */
import { parseDocument, stringify } from "yaml";
import { BINARY, BINARY_SCALE } from "./binary.ts";
import { SCHEME_SINGULAR } from "./copy.ts";
import { type Finding, inDocumentOrder, type Range } from "./findings.ts";
import { FOLDERS, isRoot, ROOT, type RootKind, schemePath } from "./kinds.ts";
import { missingCollisions } from "./lint.ts";
import { parseBankFile } from "./surface/bankfile.ts";
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

/** In the tree's order: what is measured, then how it is asked, then missing data, then the bank itself. */
export const SCHEME_KINDS: readonly SchemeKind[] = [
	"concept",
	"scale",
	"unit",
	"universe",
	"instruction",
	"missing",
	"bank",
];

/**
 * What a kind's file holds, which decides how it is read, previewed and started: a
 * `labels:` map, one `text:` line, or a concept's `label:` and `definition:`.
 */
export type Shape = "labels" | "text" | "labelled" | "bank";

export const SHAPE: Readonly<Record<SchemeKind, Shape>> = {
	concept: "labelled",
	scale: "labels",
	unit: "labelled",
	universe: "text",
	instruction: "text",
	missing: "labels",
	bank: "bank",
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
	| { readonly kind: "bank"; readonly agency: string };

export interface SchemeEvaluation {
	readonly findings: readonly Finding[];
	readonly ranges: Readonly<Record<string, Range>>;
	/** What the editor colours by meaning: codes and holes (see marks.ts). */
	readonly marks: readonly Mark[];
	/** Absent while the file does not read as its kind. */
	readonly value?: SchemeValue;
	/** What it writes that another shared file may repeat, for the bank index. */
	readonly symbols: Symbols;
}

/** A scheme file, read as its kind. Total: any text evaluates. */
export function evaluateScheme(
	kind: SchemeKind,
	source: string,
	env: Env,
	/** The file's name: one means something to the tool (`yesno01`). */
	name: string,
): SchemeEvaluation {
	const read = readScheme(kind, source, env, name);
	return { ...read, symbols: schemeSymbols(kind, read.value) };
}

/**
 * The bank's `yesno01` scale and the one select-all items are coded on are published
 * under one identity, so they must say the same; a difference would make two items
 * with one ID. Said on the scale's file.
 */
function binaryFindings(codes: readonly Code[]): readonly Finding[] {
	const same =
		codes.length === BINARY.length &&
		codes.every(
			(c, i) => c.code === BINARY[i]?.code && c.label === BINARY[i]?.label,
		);
	return same
		? []
		: [
				{
					code: "binary-scale",
					severity: "warning",
					path: "labels",
					message: `\`${BINARY_SCALE}\` is the scale select-all items are coded on, so it must be exactly ${BINARY.map((c) => `\`"${c.code}": ${c.label}\``).join(", ")}.`,
					hint: "Make it say exactly that, or give this scale another name.",
				},
			];
}

function readScheme(
	kind: SchemeKind,
	source: string,
	env: Env,
	name: string,
): Omit<SchemeEvaluation, "symbols"> {
	const doc = parseDocument(source, { prettyErrors: false });
	const { ranges, empties } = indexDocument(doc, source.length);
	if (SHAPE[kind] === "bank") {
		const { agency, findings: read } = parseBankFile(source);
		const findings = withSpacing(doc, source, read.map(pointAt(empties)));
		const marks: readonly Mark[] = [];
		return agency === undefined
			? { findings, ranges, marks }
			: { findings, ranges, marks, value: { kind: "bank", agency } };
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
		// The missing list is compared with itself only if it were a scale; it is not.
		findings:
			kind === "scale"
				? inDocumentOrder(
						[
							...findings,
							...missingCollisions(scale.codes, env.missing, "labels"),
							// Only once the scale reads cleanly: a hole is said by itself.
							...(name === BINARY_SCALE &&
							!findings.some(
								(f) => f.severity === "hole" || f.severity === "error",
							)
								? binaryFindings(scale.codes)
								: []),
						],
						ranges,
					)
				: findings,
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
	let agency: string | undefined;
	let required: readonly RequirableKey[] = EMPTY_ENV.required;
	for (const f of files) {
		if (f.kind === "bank") {
			({ agency, required } = parseBankFile(f.text));
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
		...(agency !== undefined && { agency }),
	};
}

/**
 * The environment of a bank given as files by path: every path that holds a shared
 * file, read as its kind; questions and paths the tool doesn't read are skipped.
 */
export const bankEnv = (files: Readonly<Record<string, string>>): Env =>
	schemeEnv(
		Object.keys(files)
			.sort()
			.flatMap((path) => {
				const at = kindAt(path);
				const text = files[path];
				return at === undefined || at.kind === "question" || text === undefined
					? []
					: [{ kind: at.kind, name: at.name, text }];
			}),
	);

/**
 * The agency items are published under while the bank declares none: `.invalid` is
 * reserved (RFC 6761) and never a real name, so the DDI stays valid and anyone reading
 * it sees at once that the agency is missing.
 */
export const UNDECLARED_AGENCY = "invalid";

/** Root files a bank must have: the agency its items are published under. */
export const REQUIRED_ROOTS: readonly RootKind[] = ["bank"];

/**
 * What a bank without its `kind` root file is told, about the bank, never on each
 * question: a hole for a required one, nothing for an optional one (missing values).
 */
export const absentRoot = (kind: RootKind): readonly Finding[] =>
	REQUIRED_ROOTS.includes(kind)
		? [
				hole(
					"agency",
					"This bank declares no DDI agency: add `bank.yaml` with an `agency:` line.",
					`Until then its items are published under \`${UNDECLARED_AGENCY}\`.`,
				),
			]
		: [];

/** A concept or unit file with its label; the definition is written in the file afterwards. */
export const labelledSource = (label: string): string =>
	stringify({ label: label.trim() }, { lineWidth: 0 });

/** A universe or instruction file saying `text`, quoted only where YAML needs it. */
export const textEntrySource = (text: string): string =>
	stringify({ text: text.trim() }, { lineWidth: 0 });
