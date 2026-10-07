/**
 * Live evaluation: everything the page shows is one pure function of the text.
 * Total, like its parts: any text evaluates.
 */
import type { DdiDocument } from "./ddi/document.js";
import { elaborate } from "./ddi/elaborate.js";
import { type Finding, inDocumentOrder, type Range } from "./findings.js";
import { lint } from "./lint.js";
import {
	type CodebookView,
	codebookView,
	type RespondentView,
	respondentView,
} from "./render.js";
import type { Draft } from "./surface/draft.js";
import type { Env } from "./surface/env.js";
import type { Mark } from "./surface/marks.js";
import { parseSurface } from "./surface/parse.js";
import { type Symbols, symbolsOf } from "./symbols.js";

export interface Evaluation {
	readonly draft: Draft;
	/** Parse findings and lint advice, in document order. */
	readonly findings: readonly Finding[];
	readonly ranges: Readonly<Record<string, Range>>;
	/** What the editor colours by meaning (see marks.ts). */
	readonly marks: readonly Mark[];
	readonly ddi: DdiDocument;
	readonly respondent: RespondentView;
	readonly codebook: CodebookView;
	/** What the question defines and names, for the bank index. */
	readonly symbols: Symbols;
}

export function evaluate(source: string, agency: string, env: Env): Evaluation {
	const parsed = parseSurface(source, env);
	const { draft, findings, ranges } = parsed;
	return {
		draft,
		findings: inDocumentOrder([...findings, ...lint(draft, env)], ranges),
		ranges,
		marks: parsed.marks,
		ddi: elaborate(draft, agency, env.missing),
		respondent: respondentView(draft),
		codebook: codebookView(draft, env),
		symbols: symbolsOf(parsed),
	};
}
