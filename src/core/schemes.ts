/**
 * Scheme files: the bank's shared elements, one file each, named by file. Where
 * they live, how each is read, and the environment questions are read against.
 * Pure; the shell decides which text of a file counts (the saved bank version).
 */
import { parseDocument, stringify } from "yaml";
import { type Finding, inDocumentOrder, type Range } from "./findings.js";
import { missingCollisions } from "./lint.js";
import type { Code } from "./surface/draft.js";
import {
	type ConceptEntry,
	EMPTY_ENV,
	type Env,
	type NamedScheme,
	parseConcept,
	parseTextEntry,
	type TextEntry,
} from "./surface/env.js";
import {
	holeChips,
	labelMarksOf,
	type Mark,
	ordered,
} from "./surface/marks.js";
import { indexDocument } from "./surface/parse.js";
import { parseScale, type Scale } from "./surface/scales.js";
import { type Symbols, schemeSymbols } from "./symbols.js";

/** `missing` is a scheme file too, but one list for the bank, never named by a question. */
export type SchemeKind = NamedScheme | "missing";
export type Kind = "question" | SchemeKind;

/** In the tree's order: what is measured, then how it is asked, then missing data. */
export const SCHEME_KINDS: readonly SchemeKind[] = [
	"concept",
	"scale",
	"universe",
	"instruction",
	"missing",
];

/** Where each named kind lives in the bank. The loader reads these folders. */
export const FOLDERS: Readonly<Record<NamedScheme, string>> = {
	concept: "concepts",
	scale: "scales",
	universe: "universes",
	instruction: "instructions",
};

export const MISSING_NAME = "missing";

/**
 * What a kind's file holds, which decides how it is read, previewed and started: a
 * `labels:` map, one `text:` line, or a concept's `label:` and `definition:`.
 */
export type Shape = "labels" | "text" | "concept";

export const SHAPE: Readonly<Record<SchemeKind, Shape>> = {
	concept: "concept",
	scale: "labels",
	universe: "text",
	instruction: "text",
	missing: "labels",
};

/** The path a scheme file lives at. The name is the filename; nothing inside repeats it. */
export const schemePath = (kind: SchemeKind, name: string): string =>
	kind === "missing" ? `${MISSING_NAME}.yaml` : `${FOLDERS[kind]}/${name}.yaml`;

/** What a bank path holds, or undefined for a file the tool does not read. */
export function kindAt(
	path: string,
):
	| { readonly kind: "question" }
	| { readonly kind: SchemeKind; readonly name: string }
	| undefined {
	if (!path.endsWith(".yaml")) return undefined;
	if (path === schemePath("missing", MISSING_NAME))
		return { kind: "missing", name: MISSING_NAME };
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
	| { readonly kind: "concept"; readonly concept: ConceptEntry };

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
): SchemeEvaluation {
	const read = readScheme(kind, source, env);
	return { ...read, symbols: schemeSymbols(kind, read.value) };
}

function readScheme(
	kind: SchemeKind,
	source: string,
	env: Env,
): Omit<SchemeEvaluation, "symbols"> {
	const doc = parseDocument(source, { prettyErrors: false });
	const { ranges, empties } = indexDocument(doc, source.length);
	if (SHAPE[kind] === "text") {
		const { entry, findings } = parseTextEntry(source);
		const marks = holeChips(findings, empties);
		return entry === undefined
			? { findings, ranges, marks }
			: { findings, ranges, marks, value: { kind: "text", text: entry.text } };
	}
	if (SHAPE[kind] === "concept") {
		const { entry, findings } = parseConcept(source);
		const marks = holeChips(findings, empties);
		return entry === undefined
			? { findings, ranges, marks }
			: { findings, ranges, marks, value: { kind: "concept", concept: entry } };
	}
	const { scale, findings } = parseScale(source);
	const marks = ordered([
		...labelMarksOf(doc, source.length),
		...holeChips(findings, empties),
	]);
	if (scale === undefined) return { findings, ranges, marks };
	return {
		// The missing list is compared with itself only if it were a scale; it is not.
		findings:
			kind === "scale"
				? inDocumentOrder(
						[
							...findings,
							...missingCollisions(scale.codes, env.missing, "labels"),
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
	const concepts: Record<string, ConceptEntry> = {};
	const scales: Record<string, Scale> = {};
	const universes: Record<string, TextEntry> = {};
	const instructions: Record<string, TextEntry> = {};
	let missing: readonly Code[] = EMPTY_ENV.missing;
	for (const f of files) {
		if (f.kind === "concept") {
			const { entry } = parseConcept(f.text);
			if (entry !== undefined) concepts[f.name] = entry;
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
	return { concepts, scales, universes, instructions, missing };
}

/** A concept file with its label; the definition is written in the file afterwards. */
export const conceptSource = (label: string): string =>
	stringify({ label: label.trim() }, { lineWidth: 0 });

/** A universe or instruction file saying `text`, quoted only where YAML needs it. */
export const textEntrySource = (text: string): string =>
	stringify({ text: text.trim() }, { lineWidth: 0 });
