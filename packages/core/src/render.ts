/**
 * Render models: what the previews show, as plain data. The shell turns these
 * into DOM and decides nothing. Survey policy lives here: field order, how a
 * codebook formats values, what a hole says. Previews evaluate around holes:
 * a required field that is missing becomes a visible `hole` slot, never a crash
 * and never an empty space. A reference is shown resolved, with its name kept
 * so the shell can offer "go to definition".
 */

import { compact } from "./compact.js";
import { UNNAMED } from "./copy.js";
import {
	type Code,
	type Domain,
	type Draft,
	labelOf,
	type Named,
	optionVariable,
	textOf,
} from "./surface/draft.js";
import type { Env } from "./surface/env.js";
import { hasFill, type Piece, piecesOf } from "./surface/fills.js";

export interface Hole {
	readonly kind: "hole";
	/** Path into the YAML document, so a click can take the author there. */
	readonly path: string;
	readonly prompt: string;
}

export type Slot = { readonly kind: "filled"; readonly text: string } | Hole;

/**
 * Question text: like a slot, and in pieces when it has a fill, so a view can show
 * each fill as the gap it is (`[rent]`).
 */
export type TextSlot =
	| {
			readonly kind: "filled";
			readonly text: string;
			readonly pieces?: readonly Piece[];
	  }
	| Hole;

/** Prose or a resolved reference: the text to show, and the name when it came from a scheme. */
export interface Resolved {
	readonly text: string;
	readonly ref?: string;
}

export type Input =
	| {
			readonly kind: "choice";
			readonly select: "one" | "many";
			readonly options: readonly Code[];
	  }
	| {
			readonly kind: "number";
			readonly min?: number;
			readonly max?: number;
			readonly step?: number;
			readonly unit?: string;
	  }
	| { readonly kind: "text"; readonly maxLength?: number }
	| Hole;

/** The question as the respondent sees it. */
export interface RespondentView {
	readonly text: TextSlot;
	readonly instruction?: Resolved;
	readonly input: Input;
}

/**
 * The codebook entry, in the style of the Baltimore Area Survey codebook; the Concept
 * line is ours (BAS's codebook has none), shown since concepts became shared.
 */
export interface CodebookView {
	readonly title: Slot;
	readonly variable: Slot;
	readonly text: TextSlot;
	readonly values:
		| { readonly kind: "lines"; readonly lines: readonly string[] }
		| Hole;
	/** The bank's missing-value codes, as the codebook prints them, when the bank declares any. */
	readonly missing?: string;
	/** What the question measures: the shared concept's label (its definition is its own file's). */
	readonly concept?: Resolved;
	readonly universe?: Resolved;
	readonly source?: string;
	readonly notes: readonly string[];
}

/** Short prompts of render's own: the schema descriptions are hover prose, too long for a placeholder. */
const PROMPT = {
	name: "variable name",
	text: "question text",
	title: "title",
} as const;

/** Neutral on purpose: the author may have typed a domain that parse rejected. */
const DOMAIN_PROMPT = "No way to answer yet: responses, number, or open";

const slot = (value: string | undefined, path: "name" | "text"): Slot =>
	value === undefined
		? { kind: "hole", path, prompt: PROMPT[path] }
		: { kind: "filled", text: value };

const domainHole: Hole = { kind: "hole", path: "", prompt: DOMAIN_PROMPT };

/** The question's text, in pieces when it has a declared fill. */
function textSlot(draft: Draft): TextSlot {
	const text = draft.text;
	if (text === undefined)
		return { kind: "hole", path: "text", prompt: PROMPT.text };
	const pieces = piecesOf(text, draft.fills ?? []);
	return hasFill(pieces)
		? { kind: "filled", text, pieces }
		: { kind: "filled", text };
}

/** A field that may name a shared entry: its words (by `wordsOf`), and its name when shared. */
const resolved = <T>(
	n: Named<T> | undefined,
	wordsOf: (n: Named<T>) => string,
): Resolved | undefined =>
	n === undefined
		? undefined
		: compact({ text: wordsOf(n), ref: n.kind === "ref" ? n.name : undefined });

export function respondentView(draft: Draft): RespondentView {
	return compact({
		text: textSlot(draft),
		instruction: resolved(draft.instruction, textOf),
		input: draft.domain ? input(draft.domain) : domainHole,
	});
}

function input(domain: Domain): Input {
	switch (domain.kind) {
		case "responses":
			return { kind: "choice", select: domain.select, options: domain.codes };
		case "number":
			return compact({
				kind: "number",
				min: domain.min,
				max: domain.max,
				// 0 and absent both mean whole numbers: the HTML default step is 1.
				step: domain.decimals ? 10 ** -domain.decimals : undefined,
				unit: domain.unit === undefined ? undefined : labelOf(domain.unit),
			});
		case "open":
			return compact({ kind: "text", maxLength: domain.maxLength });
		default:
			return domain satisfies never;
	}
}

export function codebookView(draft: Draft, env: Env): CodebookView {
	const values: CodebookView["values"] = draft.domain
		? { kind: "lines", lines: valueLines(draft.domain, draft.name) }
		: domainHole;
	return compact({
		title: title(draft),
		variable: slot(draft.name, "name"),
		text: textSlot(draft),
		values,
		missing:
			env.missing.length === 0
				? undefined
				: env.missing.map((c) => `${c.code} (${c.label})`).join(", "),
		concept: resolved(draft.concept, labelOf),
		universe: resolved(draft.universe, textOf),
		source: draft.source,
		notes: notes(draft),
	});
}

/** The codebook title: `title`, else the concept, else the name. Upper-casing is the shell's. */
function title(draft: Draft): Slot {
	const source =
		draft.title ??
		(draft.concept === undefined ? undefined : labelOf(draft.concept)) ??
		draft.name;
	return source === undefined
		? { kind: "hole", path: "name", prompt: PROMPT.title }
		: { kind: "filled", text: source };
}

function valueLines(
	domain: Domain,
	name: string | undefined,
): readonly string[] {
	switch (domain.kind) {
		case "responses":
			// A select-many option is its own variable in the dataset, listed the way the
			// codebook publishes it: the variable, then the option's title.
			return domain.select === "many"
				? domain.codes.map(
						(c) =>
							`${optionVariable(name, c) ?? UNNAMED}: ${c.title ?? c.label}`,
					)
				: domain.codes.map((c) => `${c.code} = ${c.label}`);
		case "number":
			return [
				numberLine(
					domain.min,
					domain.max,
					domain.unit === undefined ? undefined : labelOf(domain.unit),
				),
			];
		case "open":
			return [
				domain.maxLength === undefined
					? "Free text"
					: `Free text, up to ${domain.maxLength} characters`,
			];
		default:
			return domain satisfies never;
	}
}

function numberLine(
	min: number | undefined,
	max: number | undefined,
	unit: string | undefined,
): string {
	const range =
		min !== undefined && max !== undefined
			? `Range: ${min}–${max}`
			: min !== undefined
				? `Minimum: ${min}`
				: max !== undefined
					? `Maximum: ${max}`
					: "Numeric";
	return unit === undefined ? range : `${range} ${unit}`;
}

function notes(draft: Draft): readonly string[] {
	const out: string[] = [];
	const d = draft.domain;
	if (d?.kind === "responses" && d.scale !== undefined)
		out.push(`Uses the shared scale ${d.scale}.`);
	if (d?.kind === "responses" && d.select === "many") {
		out.push(
			"Select all that apply: each option is its own variable, coded 0 = No, 1 = Yes.",
		);
	}
	// An option's note is documentation whatever the select mode; it must never vanish.
	if (d?.kind === "responses")
		for (const c of d.codes)
			if (c.note !== undefined) out.push(`${c.code}: ${c.note}`);
	if (draft.note !== undefined) out.push(draft.note);
	return out;
}
