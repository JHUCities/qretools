/**
 * Live evaluation: everything the page shows is one pure function of the text.
 * Total, like its parts: any text evaluates. A whole bank evaluates the same way,
 * from its files by path (`bankOf`).
 */

import { compact } from "./compact.ts";
import { type DdiDocument, documentOf, type Item } from "./ddi/document.ts";
import { elaborateItems, type Versioning } from "./ddi/elaborate.ts";
import type { Versions } from "./ddi/version.ts";
import { type Finding, inDocumentOrder, type Range } from "./findings.ts";
import { ROOT } from "./kinds.ts";
import { lint } from "./lint.ts";
import {
	type CodebookView,
	codebookView,
	type RespondentView,
	respondentView,
} from "./render.ts";
import {
	absentRoot,
	bankEnv,
	evaluateScheme,
	kindAt,
	REQUIRED_ROOTS,
	type SchemeEvaluation,
	type SchemeKind,
	UNDECLARED_AGENCY,
} from "./schemes.ts";
import type { Draft } from "./surface/draft.ts";
import type { Env } from "./surface/env.ts";
import type { Mark } from "./surface/marks.ts";
import { parseSurface } from "./surface/parse.ts";
import {
	fileFindings,
	type Index,
	indexOf,
	type Symbols,
	symbolsOf,
} from "./symbols.ts";

export interface Evaluation {
	readonly draft: Draft;
	/** Parse findings and lint advice, in document order. */
	readonly findings: readonly Finding[];
	readonly ranges: Readonly<Record<string, Range>>;
	/** What the editor colours by meaning (see marks.ts). */
	readonly marks: readonly Mark[];
	/** The question's DDI items, unkeyed, for an export of many questions to gather. */
	readonly items: readonly Item[];
	readonly ddi: DdiDocument;
	readonly respondent: RespondentView;
	readonly codebook: CodebookView;
	/** What the question defines and names, for the bank index. */
	readonly symbols: Symbols;
}

export { UNDECLARED_AGENCY };

/**
 * A question's evaluation. `versioning` gives its items' DDI versions when history is
 * known (see `Versioning`); without it every item is version 1.
 */
export function evaluate(
	source: string,
	env: Env,
	versioning: Versioning = {},
): Evaluation {
	const parsed = parseSurface(source, env);
	const items = elaborateItems(
		parsed.draft,
		env.agency ?? UNDECLARED_AGENCY,
		env.missing,
		versioning,
	);
	const { draft, findings, ranges } = parsed;
	return {
		draft,
		findings: inDocumentOrder(
			[...findings, ...lint(draft, env, findings)],
			ranges,
		),
		ranges,
		marks: parsed.marks,
		items,
		ddi: documentOf(items),
		respondent: respondentView(draft),
		codebook: codebookView(draft, env),
		symbols: symbolsOf(parsed),
	};
}

/** A shared file's evaluation, with the kind and name its path gives it. */
export interface SchemeFileEvaluation extends SchemeEvaluation {
	readonly kind: SchemeKind;
	readonly name: string;
}

/**
 * What an instrument reads of a bank: the environment its questions were read against,
 * the questions, and the symbol table that finds them by name. A whole evaluated bank
 * is one (`Bank`); so is a bank put together from evaluations kept elsewhere
 * (`bankFrom`), as an editor keeps them while one question is typed.
 */
export interface BankScope {
	/** The shared files' environment the questions were read against. */
	readonly env: Env;
	readonly questions: Readonly<Record<string, Evaluation>>;
	/** The bank's symbol table, keyed by path. */
	readonly index: Index<string>;
	/** The DDI agency the bank declares; absent while it declares none (see `evaluate`). */
	readonly agency?: string;
	/** The versions the bank was evaluated at, by path, when they were given. */
	readonly versions?: Versions;
}

/** A whole bank, evaluated: each file by its path. */
export interface Bank extends BankScope {
	readonly schemes: Readonly<Record<string, SchemeFileEvaluation>>;
	/** Every file's findings, its own and the bank's about it (`fileFindings`). */
	readonly findings: Readonly<Record<string, readonly Finding[]>>;
	/** Paths given that aren't bank files (`kindAt`): a wrong folder shows here. */
	readonly ignored: readonly string[];
}

/** Every evaluated file, questions and shared files together, in path order. */
function byPath(
	questions: Readonly<Record<string, Evaluation>>,
	schemes: Readonly<Record<string, SchemeFileEvaluation>>,
): readonly (readonly [string, Evaluation | SchemeFileEvaluation])[] {
	return [...Object.entries(questions), ...Object.entries(schemes)].sort(
		([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
	);
}

/**
 * A bank from its files' evaluations, by path: the index built from their symbols and
 * the agency from the environment. A new object every call: memoise on the inputs.
 * Every evaluation given must have been made against `env` (and `versions`): a cache of
 * evaluations is keyed on the environment, or names resolve against one and codes read
 * from another, with no finding anywhere.
 */
export function bankFrom({
	env,
	questions,
	schemes,
	versions,
}: {
	readonly env: Env;
	readonly questions: Readonly<Record<string, Evaluation>>;
	readonly schemes: Readonly<Record<string, SchemeFileEvaluation>>;
	readonly versions?: Versions | undefined;
}): BankScope {
	const index = indexOf(
		byPath(questions, schemes).map(([key, ev]) => ({
			key,
			symbols: ev.symbols,
		})),
	);
	return {
		env,
		questions,
		index,
		...(env.agency !== undefined && { agency: env.agency }),
		...(versions !== undefined && { versions }),
	};
}

/** Each file of a bank evaluated against the bank's environment, and those no kind reads. */
function evaluateFiles(
	files: Readonly<Record<string, string>>,
	versions: Versions | undefined,
) {
	const env = bankEnv(files);
	const questions: Record<string, Evaluation> = {};
	const schemes: Record<string, SchemeFileEvaluation> = {};
	const ignored: string[] = [];
	for (const path of Object.keys(files).sort()) {
		const text = files[path] ?? "";
		const at = kindAt(path);
		if (at === undefined) ignored.push(path);
		else if (at.kind === "question")
			questions[path] = evaluate(
				text,
				env,
				versions === undefined
					? {}
					: compact({ own: versions[path], shared: versions }),
			);
		else
			schemes[path] = {
				...evaluateScheme(at.kind, text, env, at.name),
				kind: at.kind,
				name: at.name,
			};
	}
	return { env, questions, schemes, ignored };
}

/**
 * What an instrument reads of a bank, from its files: each file evaluated and the index
 * built, without the findings a whole bank's check adds (similar wording across every
 * question). For a bank only read, as one in another repository is.
 */
export function scopeOf(
	files: Readonly<Record<string, string>>,
	versions?: Versions,
): BankScope {
	const { env, questions, schemes } = evaluateFiles(files, versions);
	return bankFrom({ env, questions, schemes, versions });
}

/**
 * A bank from its files: path (relative to the bank's root, `/`-separated) to text.
 * The agency comes from the bank's own file. Total, and independent of the order the
 * files are given in. It compares every question's wording with every other's, so
 * it's for checking a bank whole, not for every keystroke.
 */
export function bankOf(
	files: Readonly<Record<string, string>>,
	/** Each file's DDI version, by path, when history is known. */
	versions?: Versions,
): Bank {
	const { env, questions, schemes, ignored } = evaluateFiles(files, versions);
	const scope = bankFrom({ env, questions, schemes, versions });
	// Another file, as a bank finding cites it: its name, else its path.
	const label = (path: string): string =>
		questions[path]?.draft.name ?? schemes[path]?.name ?? path;
	const findings: Record<string, readonly Finding[]> = {};
	for (const [path, ev] of byPath(questions, schemes))
		findings[path] = fileFindings(path, ev, scope.index, label);
	// A required root file that's absent is said once, about the bank (`absentRoot`).
	for (const kind of REQUIRED_ROOTS)
		if (findings[ROOT[kind]] === undefined)
			findings[ROOT[kind]] = absentRoot(kind);
	return {
		env,
		questions,
		schemes,
		findings,
		index: scope.index,
		ignored,
		...(scope.agency !== undefined && { agency: scope.agency }),
		...(versions !== undefined && { versions }),
	};
}
