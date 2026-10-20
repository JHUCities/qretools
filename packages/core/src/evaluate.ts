/**
 * Live evaluation: everything the page shows is one pure function of the text.
 * Total, like its parts: any text evaluates. A whole bank evaluates the same way,
 * from its files by path (`bankOf`).
 */

import { compact } from "./compact.ts";
import type { Item } from "./ddi/document.ts";
import { elaborateItems } from "./ddi/elaborate.ts";
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
	bankAgency,
	evaluateScheme,
	kindAt,
	REQUIRED_ROOTS,
	type SchemeEvaluation,
	type SchemeKind,
	schemeEnv,
	schemeFilesIn,
	UNDECLARED_AGENCY,
	unknownFolders,
} from "./schemes.ts";
import type { Draft } from "./surface/draft.ts";
import { type Env, envAt } from "./surface/env.ts";
import { type Livelit, livelitsOf } from "./surface/livelits.ts";
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
	/** The fields a picker of shared entries can fill (see livelits.ts). */
	readonly livelits: readonly Livelit[];
	readonly respondent: RespondentView;
	readonly codebook: CodebookView;
	/** What the question defines and names, for the bank index. */
	readonly symbols: Symbols;
}

export { UNDECLARED_AGENCY };

/**
 * A question's evaluation: what an editor shows of it as it's typed. Its DDI is one
 * output among others, made only when asked for (`questionItems`).
 */
export function evaluate(source: string, env: Env): Evaluation {
	const parsed = parseSurface(source, env);
	const { draft, findings, ranges } = parsed;
	return {
		draft,
		findings: inDocumentOrder(
			[...findings, ...lint(draft, env, findings)],
			ranges,
		),
		ranges,
		marks: parsed.marks,
		livelits: livelitsOf(source, parsed, env),
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
	/** The DDI agency the bank declares; absent while it declares none (see `questionItems`). */
	readonly agency?: string;
	/** Each file's DDI version, by path, when history is known. */
	readonly versions?: Versions;
	/** A release's manifest that couldn't be used, read at a tag: its versions are 1. */
	readonly manifest?: {
		readonly kind: "stale" | "unreadable";
		readonly reason: string;
	};
}

/** What a bank question's DDI is published with: a `BankScope` is one. */
export interface Publishing {
	readonly env: Env;
	/** Absent while the bank declares none: items go under `UNDECLARED_AGENCY`. */
	readonly agency?: string | undefined;
	/** Absent when history isn't known: every item is version 1. */
	readonly versions?: Versions | undefined;
}

/**
 * A question's DDI items, unkeyed, for an export of many questions to gather (a bank, an
 * instrument) and key once with `documentOf`. The one way a bank question becomes DDI,
 * so every export of it makes the same items. `path` is its file in the bank, which
 * gives its own version; a draft has none.
 */
export const questionItems = (
	draft: Draft,
	p: Publishing,
	path?: string,
): readonly Item[] =>
	elaborateItems(
		draft,
		p.agency ?? UNDECLARED_AGENCY,
		p.env.missing,
		p.env.selectAll,
		p.versions === undefined
			? {}
			: compact({
					own: path === undefined ? undefined : p.versions[path],
					shared: p.versions,
				}),
	);

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
 * A bank from its files' evaluations, by path, and the agency it declares: the index
 * built from their symbols. `agency` is a required key, absent or not, so no caller
 * drops it by leaving it out. A new object every call: memoise on the inputs.
 * Every evaluation given must have been made against `env`, a question's against `env`
 * as its folder has it (`envAt`): a cache of
 * evaluations is keyed on the environment, or names resolve against one and codes read
 * from another, with no finding anywhere.
 */
export function bankFrom({
	env,
	agency,
	questions,
	schemes,
	versions,
}: {
	readonly env: Env;
	readonly agency: string | undefined;
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
		...(agency !== undefined && { agency }),
		...(versions !== undefined && { versions }),
	};
}

/**
 * Each file of a bank evaluated against the bank's environment, a question against it as
 * its folder has it (`envAt`): the one place, so a bank checked whole, one only read and
 * the command line agree. And the files no kind reads.
 */
function evaluateFiles(files: Readonly<Record<string, string>>) {
	const shared = schemeFilesIn(files);
	const env = schemeEnv(shared);
	const agency = bankAgency(shared);
	const questions: Record<string, Evaluation> = {};
	const schemes: Record<string, SchemeFileEvaluation> = {};
	const ignored: string[] = [];
	for (const path of Object.keys(files).sort()) {
		const text = files[path] ?? "";
		const at = kindAt(path);
		if (at === undefined) ignored.push(path);
		else if (at.kind === "question")
			questions[path] = evaluate(text, envAt(env, path));
		else
			schemes[path] = {
				...evaluateScheme(at.kind, text, env),
				kind: at.kind,
				name: at.name,
			};
	}
	return { env, agency, questions, schemes, ignored };
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
	const { env, agency, questions, schemes } = evaluateFiles(files);
	return bankFrom({ env, agency, questions, schemes, versions });
}

/**
 * A bank from its files: path (in its workspace, whose root it is, `/`-separated) to text.
 * The agency comes from `workspace.yaml`. Total, and independent of the order the
 * files are given in. It compares every question's wording with every other's, so
 * it's for checking a bank whole, not for every keystroke.
 */
export function bankOf(
	files: Readonly<Record<string, string>>,
	/** Each file's DDI version, by path, when history is known. */
	versions?: Versions,
): Bank {
	const { env, agency, questions, schemes, ignored } = evaluateFiles(files);
	const scope = bankFrom({ env, agency, questions, schemes, versions });
	// Another file, as a bank finding cites it: its name, else its path.
	const label = (path: string): string =>
		questions[path]?.draft.name ?? schemes[path]?.name ?? path;
	const findings: Record<string, readonly Finding[]> = {};
	// The settings file is also told of the folders it names that aren't there, each in
	// its place among the file's own findings (`fileFindings` orders them).
	const folders = unknownFolders(env.requiredIn, Object.keys(questions));
	for (const [path, ev] of byPath(questions, schemes))
		findings[path] = fileFindings(
			path,
			path === ROOT.workspace
				? { ...ev, findings: [...ev.findings, ...folders] }
				: ev,
			scope.index,
			label,
		);
	// A required root file that's absent is said once, about the workspace (`absentRoot`).
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
