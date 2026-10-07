/**
 * Findings are the tool's typed holes and localized errors.
 *
 * Every draft, however incomplete, elaborates. Whatever is missing or wrong is
 * reported as a Finding with a dotted path into the YAML document, so the editor
 * can mark it in place. Severity `hole` means "required, not yet filled in".
 */

import type { NamedScheme } from "./surface/env.ts";

export type Severity = "hole" | "error" | "warning" | "info";

/** Reported by the tolerant parse: what is missing, malformed, or ignored. */
export type ParseCode =
	| "yaml-syntax"
	| "not-a-map"
	| "unknown-key"
	| "wrong-type"
	| "bad-range"
	| "ignored-key"
	| "hole"
	| "too-many-domains"
	| "missing-space"
	| "invalid-agency"
	/** Advice: a response code YAML reads as a number, not text (`1:` for `"1":`). */
	| "unquoted-code"
	/** One code written two ways YAML can't tell apart (`"1"` and `1`). */
	| "duplicate-code"
	| "fill-name"
	| "fill-type"
	/** Advice: a declared fill the text never uses. */
	| "fill-unused";

/** Survey-craft advice. Always `warning` or `info`, never a blocker. */
export type LintCode =
	| "duplicate-label"
	| "too-few-responses"
	| "no-none-option"
	| "double-barreled"
	| "thin-intent"
	| "legacy-fields"
	| "duplicate-option-variable"
	| "option-variable-prefix"
	| "matches-scale"
	| "matches-universe"
	| "matches-instruction"
	| "matches-concept"
	| "concept-prose"
	| "matches-unit"
	| "unit-prose"
	| "missing-code"
	/** Bank-level: another question defines the same variable. */
	| "duplicate-variable"
	/** Bank-level: the same content written in two files (see symbols.ts). */
	| "duplicate-text"
	| "duplicate-list"
	| "duplicate-scale"
	| "duplicate-universe"
	| "duplicate-instruction"
	| "duplicate-concept"
	| "duplicate-unit"
	| "similar-text"
	| "unknown-variant"
	/** Bank-level: another question has the same name, so the same DDI identity. */
	| "duplicate-name"
	/** The bank's `yesno01` scale doesn't say what select-all items are coded on. */
	| "binary-scale";

/** Reported by an instrument's parse and checks. */
export type InstrumentCode =
	/** A condition that isn't written as the condition language reads it. */
	| "condition"
	/** A condition or fill whose types don't fit. */
	| "type"
	/** A name that means nothing where it's written. */
	| "unknown-name"
	/** A bank question, variable or shared entry an instrument names that the bank lacks. */
	| "unknown-question"
	/** An alias `uses` names that no bank was given for. */
	| "unknown-bank"
	/** Two things in one instrument under one name. */
	| "name-clash"
	/** Written correctly, but not part of this version of the language yet. */
	| "not-yet"
	/** A step where the language doesn't allow it (`stop` inside a section). */
	| "misplaced"
	/** Computed values that each need the other. */
	| "cycle";

export type FindingCode = ParseCode | LintCode | InstrumentCode | "ddi-invalid";

/** Character offsets into the source text, `[from, to)`. */
export type Range = readonly [from: number, to: number];

export interface Finding {
	readonly code: FindingCode;
	readonly severity: Severity;
	/** Dotted path into the document, e.g. `responses.3`; `""` is the whole document. */
	readonly path: string;
	readonly message: string;
	readonly hint?: string;
	/** A library's own words (the YAML parser's, the DDI schema's), kept under the plain message. */
	readonly detail?: string;
	/** Present when the finding has its own position (syntax errors); otherwise look up `path`. */
	readonly range?: Range;
	/** What the finding offers to do about itself, when that is unambiguous and loses nothing. */
	readonly fix?: Fix;
}

/** Set the value at `path` (the whole `key: value` pair is rewritten; see surface/edit.ts). */
export interface Edit {
	readonly path: string;
	readonly value: string;
}

/**
 * What a finding offers to do: rewrite the text being edited (one click, one undo), or
 * create the shared entry a question names and point the question at it (the name
 * dialog, prefilled).
 */
export type Fix =
	| {
			readonly kind: "edit";
			readonly label: string;
			readonly edits: readonly Edit[];
	  }
	| {
			readonly kind: "create";
			readonly label: string;
			readonly create: {
				readonly scheme: NamedScheme;
				readonly name: string;
				/** The wording or label to start from; may be empty. */
				readonly text: string;
				/** Where the question names it, to be pointed at the name chosen. */
				readonly path: string;
			};
	  }
	| {
			/** A space after `word:` within what `path` names (a key written `open:{}`). */
			readonly kind: "space";
			readonly label: string;
			readonly path: string;
			readonly word: string;
	  }
	| {
			/** Quotes around the response code `code`, at the key `path` names, as spelled. */
			readonly kind: "quote";
			readonly label: string;
			readonly path: string;
			readonly code: string;
	  };

export const holes = (findings: readonly Finding[]): readonly Finding[] =>
	findings.filter((f) => f.severity === "hole");

export const errors = (findings: readonly Finding[]): readonly Finding[] =>
	findings.filter((f) => f.severity === "error");

/**
 * Where a finding lives in the source. Its own range wins; then the range of its
 * path; then the range of its top-level key. A hole for something not yet typed
 * has nowhere to point, so it resolves to a zero-width range at the end of the
 * text, which is where the author will type it.
 *
 * Paths are looked up whole: a response code may itself contain a dot.
 */
export function locate(
	finding: Target,
	ranges: Readonly<Record<string, Range>>,
): Range {
	const whole = ranges[""] ?? [0, 0];
	if (finding.range) return finding.range;
	if (finding.path !== "") {
		const dot = finding.path.indexOf(".");
		const found =
			ranges[finding.path] ??
			(dot === -1 ? undefined : ranges[finding.path.slice(0, dot)]);
		if (found) return found;
	}
	return finding.severity === "hole" ? [whole[1], whole[1]] : whole;
}

/**
 * `locate`'s inverse: the path of the smallest range holding an offset, or `""` for
 * the document itself. Smallest range, never most dots: a response code may contain one.
 */
export function pathAt(
	ranges: Readonly<Record<string, Range>>,
	offset: number,
): string {
	let best = "";
	let width = Number.POSITIVE_INFINITY;
	for (const [path, [from, to]] of Object.entries(ranges)) {
		if (path === "" || offset < from || offset > to) continue;
		if (to - from < width) {
			best = path;
			width = to - from;
		}
	}
	return best;
}

/**
 * Findings in the order the author reads the source: by where each lives (`locate`),
 * so the list reads top to bottom with the text and a finding keeps its place while
 * others come and go. Holes for fields not yet written live at the end, where they
 * will be typed. Stable: findings at one place keep the order they were reported in.
 */
export function inDocumentOrder(
	findings: readonly Finding[],
	ranges: Readonly<Record<string, Range>>,
): readonly Finding[] {
	return findings
		.map((f) => ({ f, from: locate(f, ranges)[0] }))
		.sort((a, b) => a.from - b.from)
		.map(({ f }) => f);
}

/** What a click points at, in the document's own terms; resolved to a range only when acted on. */
export type Target = Pick<Finding, "path" | "severity"> & {
	readonly range?: Range;
};

/** The verdict on a draft. Policy lives here; the shell only styles it. */
export type Status =
	| { readonly kind: "complete" }
	| {
			readonly kind: "advice";
			readonly count: number;
			/** The most severe advice, so a warning never reads as info. */
			readonly worst: "warning" | "info";
	  }
	| {
			readonly kind: "incomplete";
			readonly holes: number;
			readonly errors: number;
	  };

export function status(findings: readonly Finding[]): Status {
	const holeCount = holes(findings).length;
	const errorCount = errors(findings).length;
	if (holeCount > 0 || errorCount > 0)
		return { kind: "incomplete", holes: holeCount, errors: errorCount };
	return findings.length === 0
		? { kind: "complete" }
		: {
				kind: "advice",
				count: findings.length,
				worst: findings.some((f) => f.severity === "warning")
					? "warning"
					: "info",
			};
}
