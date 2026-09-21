/**
 * Render models: what the previews show, as plain data. The shell turns these
 * into DOM and decides nothing. Survey policy lives here: field order, how a
 * codebook formats values, what a hole says. Previews evaluate around holes:
 * a required field that is missing becomes a visible `hole` slot, never a crash
 * and never an empty space.
 */
import { compact } from "./compact.js";
import type { Code, Domain, Draft } from "./surface/draft.js";

export interface Hole {
	readonly kind: "hole";
	/** Path into the YAML document, so a click can take the author there. */
	readonly path: string;
	readonly prompt: string;
}

export type Slot = { readonly kind: "filled"; readonly text: string } | Hole;

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
	readonly text: Slot;
	readonly instruction?: string;
	readonly input: Input;
}

/** The codebook entry, in the style of the Baltimore Area Survey codebook. */
export interface CodebookView {
	readonly title: Slot;
	readonly variable: Slot;
	readonly text: Slot;
	readonly values:
		| { readonly kind: "lines"; readonly lines: readonly string[] }
		| Hole;
	readonly universe?: string;
	readonly source?: string;
	readonly notes: readonly string[];
}

/** Neutral on purpose: the author may have typed a domain that parse rejected. */
const DOMAIN_PROMPT =
	"No usable response domain yet: responses, number, or open";

/** Short prompts of render's own: the schema descriptions are hover prose, too long for a placeholder. */
const PROMPT = {
	name: "variable name",
	text: "question text",
	title: "title: concept, or name",
} as const;

const slot = (value: string | undefined, path: "name" | "text"): Slot =>
	value === undefined
		? { kind: "hole", path, prompt: PROMPT[path] }
		: { kind: "filled", text: value };

const domainHole: Hole = { kind: "hole", path: "", prompt: DOMAIN_PROMPT };

export function respondentView(draft: Draft): RespondentView {
	return compact({
		text: slot(draft.text, "text"),
		instruction: draft.instruction,
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
				unit: domain.unit,
			});
		case "open":
			return compact({ kind: "text", maxLength: domain.maxLength });
		default:
			return domain satisfies never;
	}
}

export function codebookView(draft: Draft): CodebookView {
	const values: CodebookView["values"] = draft.domain
		? { kind: "lines", lines: valueLines(draft.domain) }
		: domainHole;
	return compact({
		title: title(draft),
		variable: slot(draft.name, "name"),
		text: slot(draft.text, "text"),
		values,
		universe: draft.universe,
		source: draft.source,
		notes: notes(draft),
	});
}

/**
 * BAS entries have a short human title. The surface language has no field for
 * one yet, so the concept stands in, then the name. Upper-casing is presentation
 * and belongs to the shell's stylesheet.
 */
function title(draft: Draft): Slot {
	const source = draft.concept ?? draft.name;
	return source === undefined
		? { kind: "hole", path: "name", prompt: PROMPT.title }
		: { kind: "filled", text: source };
}

function valueLines(domain: Domain): readonly string[] {
	switch (domain.kind) {
		case "responses":
			return domain.codes.map((c) => `${c.code} = ${c.label}`);
		case "number":
			return [numberLine(domain.min, domain.max, domain.unit)];
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
	return draft.domain?.kind === "responses" && draft.domain.select === "many"
		? ["Select all that apply: respondents may choose more than one response."]
		: [];
}
