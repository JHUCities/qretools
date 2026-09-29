/**
 * Scheme files: the bank's shared elements, one file each, named by file. Where
 * they live, how each is read, and the environment questions are read against.
 * Pure; the shell decides which text of a file counts (the saved bank version).
 */
import { parseDocument } from "yaml";
import { type Finding, inDocumentOrder, type Range } from "./findings.js";
import { missingCollisions } from "./lint.js";
import type { Code } from "./surface/draft.js";
import {
	EMPTY_ENV,
	type Env,
	type NamedScheme,
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

/** `missing` is a scheme file too, but one list for the bank, never named by a question. */
export type SchemeKind = NamedScheme | "missing";
export type Kind = "question" | SchemeKind;

export const SCHEME_KINDS: readonly SchemeKind[] = [
	"scale",
	"universe",
	"instruction",
	"missing",
];

const FOLDERS: Readonly<Record<NamedScheme, string>> = {
	scale: "scales",
	universe: "universes",
	instruction: "instructions",
};

export const MISSING_NAME = "missing";

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
	| { readonly kind: "text"; readonly text: string };

export interface SchemeEvaluation {
	readonly findings: readonly Finding[];
	readonly ranges: Readonly<Record<string, Range>>;
	/** What the editor colours by meaning: codes and holes (see marks.ts). */
	readonly marks: readonly Mark[];
	/** Absent while the file does not read as its kind. */
	readonly value?: SchemeValue;
}

/** A scheme file, read as its kind. Total: any text evaluates. */
export function evaluateScheme(
	kind: SchemeKind,
	source: string,
	env: Env,
): SchemeEvaluation {
	const doc = parseDocument(source, { prettyErrors: false });
	const { ranges, empties } = indexDocument(doc, source.length);
	if (kind === "universe" || kind === "instruction") {
		const { entry, findings } = parseTextEntry(source);
		const marks = holeChips(findings, empties);
		return entry === undefined
			? { findings, ranges, marks }
			: { findings, ranges, marks, value: { kind: "text", text: entry.text } };
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
	const scales: Record<string, Scale> = {};
	const universes: Record<string, TextEntry> = {};
	const instructions: Record<string, TextEntry> = {};
	let missing: readonly Code[] = EMPTY_ENV.missing;
	for (const f of files) {
		if (f.kind === "universe" || f.kind === "instruction") {
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
	return { scales, universes, instructions, missing };
}
