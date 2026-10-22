/**
 * Render models: what the previews show, as plain data. The shell turns these
 * into DOM and decides nothing; what a hole says is decided here. (The codebook's
 * view is of the question's DDI: @qretools/codebook.) Previews evaluate around holes:
 * a required field that is missing becomes a visible `hole` slot, never a crash
 * and never an empty space. A reference is shown resolved, with its name kept
 * so the shell can offer "go to definition".
 */

import { compact } from "./compact.ts";
import {
	type Code,
	type Domain,
	type Draft,
	labelOf,
	type Named,
	textOf,
} from "./surface/draft.ts";
import { hasFill, type Piece, piecesOf } from "./surface/fills.ts";

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

/** Short prompts of render's own: the schema descriptions are hover prose, too long for a placeholder. */
const PROMPT = {
	text: "question text",
} as const;

/** Neutral on purpose: the author may have typed a domain that parse rejected. */
const DOMAIN_PROMPT = "No way to answer yet: responses, number, or open";

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
