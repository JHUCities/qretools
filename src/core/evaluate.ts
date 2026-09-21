/**
 * Live evaluation: everything the page shows is one pure function of the text.
 * Total, like its parts: any text evaluates.
 */
import type { DdiDocument } from "./ddi/document.js";
import { elaborate } from "./ddi/elaborate.js";
import type { Finding, Range } from "./findings.js";
import { lint } from "./lint.js";
import {
	type CodebookView,
	codebookView,
	type RespondentView,
	respondentView,
} from "./render.js";
import type { Draft } from "./surface/draft.js";
import { parseSurface } from "./surface/parse.js";

export interface Evaluation {
	readonly draft: Draft;
	/** Parse findings, then lint advice. */
	readonly findings: readonly Finding[];
	readonly ranges: Readonly<Record<string, Range>>;
	readonly ddi: DdiDocument;
	readonly respondent: RespondentView;
	readonly codebook: CodebookView;
}

export function evaluate(source: string, agency: string): Evaluation {
	const { draft, findings, ranges } = parseSurface(source);
	return {
		draft,
		findings: [...findings, ...lint(draft)],
		ranges,
		ddi: elaborate(draft, agency),
		respondent: respondentView(draft),
		codebook: codebookView(draft),
	};
}
