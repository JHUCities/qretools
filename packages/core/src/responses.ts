/**
 * Responses from any source, read into answers keyed by DDI Variable URN. A source (a
 * survey platform's export, a published data file) brings its rows and a map of its
 * columns; the DDI brings each variable's representation. The reader knows no source:
 * what a source writes in place of a DDI code (a platform's tick, a data file's reserved
 * code for "don't know") is translated by the map, then checked against the variable's
 * codes. Nothing is guessed: a blank cell is no answer, and a value the variable can't
 * hold is a finding, never written.
 */

import type { Severity } from "./findings.ts";

/** One column of a source, and the variable it records. */
export interface ResponseColumn {
	/** Its position in each row, from 0. */
	readonly column: number;
	/** The URN of the DDI Variable it records. */
	readonly variable: string;
	/** The row of the variable it records, in a roster or a loop, from 1. */
	readonly row?: number;
	/** What the source writes in place of a DDI code: source value to code. */
	readonly values?: Readonly<Record<string, string>>;
	/** Only the values in `values` are read; any other is a finding (a tick, say). */
	readonly only?: true;
}

/** How a source's columns record DDI variables. */
export interface ResponseMap {
	/** The column that names each respondent. */
	readonly respondent: number;
	readonly columns: readonly ResponseColumn[];
}

/** What a variable can hold, as its DDI represents it. */
export type Representation =
	/** Its codes, missing ones included. */
	| { readonly kind: "codes"; readonly codes: readonly string[] }
	/** A number, or one of its missing codes. */
	| { readonly kind: "number"; readonly missing: readonly string[] }
	| { readonly kind: "text" };

/** One value a respondent gave, as a DDI code, a number or text. */
export interface Answer {
	readonly respondent: string;
	readonly variable: string;
	readonly row?: number;
	readonly value: string;
}

/** A row of a source: its cells, and the line of the file it starts on (from 1). */
export interface ResponseRow {
	readonly line: number;
	readonly cells: readonly string[];
}

export type ResponseCode =
	/** A value the variable can't hold: not one of its codes, or not a number. */
	| "responses-not-a-code"
	/** A cell that isn't one of the forms its map reads (a tick, or blank). */
	| "responses-not-a-tick"
	/** A variable the map names that the DDI doesn't describe. */
	| "responses-unknown-variable"
	/** A row without a respondent, or a respondent named twice. */
	| "responses-respondent"
	/** A row with more or fewer cells than the header: its cells can't be placed. */
	| "responses-row"
	/** Two values for one variable, row and respondent. */
	| "responses-duplicate";

/**
 * Where a finding is: the first line it's on and how many rows share it, and the column by
 * its header. It never holds a response's value: data stays where it was read.
 */
export interface ResponseFinding<Code extends string = ResponseCode> {
	readonly code: Code;
	readonly severity: Severity;
	readonly message: string;
	readonly line?: number;
	readonly column?: string;
	/** Rows with this finding in this column; the first is at `line`. */
	readonly count: number;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Each row's answers, and findings for what can't be read. `header` names the columns in
 * findings. One finding per column and code, at its first row, with a count: a column
 * read the wrong way is one mistake, not one per respondent.
 */
// shortcut: a number isn't checked against its range or decimals; add them when a comparison needs them.
export function readResponses(
	header: readonly string[],
	rows: readonly ResponseRow[],
	map: ResponseMap,
	representations: ReadonlyMap<string, Representation>,
): {
	readonly answers: readonly Answer[];
	readonly findings: readonly ResponseFinding[];
} {
	const answers: Answer[] = [];
	const found = new Map<string, ResponseFinding>();
	const note = (
		code: ResponseCode,
		severity: Severity,
		message: string,
		line: number | undefined,
		column: number | undefined,
	) => {
		const key = `${code}\u0000${column ?? ""}`;
		const seen = found.get(key);
		if (seen !== undefined)
			return found.set(key, { ...seen, count: seen.count + 1 });
		const name = column === undefined ? undefined : header[column];
		found.set(key, {
			code,
			severity,
			message,
			...(line !== undefined && { line }),
			...(name !== undefined && { column: name }),
			count: 1,
		});
	};

	const readable = map.columns.filter((c) => {
		if (representations.has(c.variable)) return true;
		note(
			"responses-unknown-variable",
			"error",
			`The DDI has no variable \`${c.variable}\`, so this column isn't read.`,
			undefined,
			c.column,
		);
		return false;
	});
	const respondents = new Set<string>();
	for (const { line, cells } of rows) {
		if (cells.length !== header.length) {
			note(
				"responses-row",
				"error",
				`This row has ${cells.length} cells where the header has ${header.length}, so it isn't read.`,
				line,
				undefined,
			);
			continue;
		}
		const respondent = cells[map.respondent] ?? "";
		if (respondent === "" || respondents.has(respondent)) {
			note(
				"responses-respondent",
				"error",
				respondent === ""
					? "This row names no respondent, so it isn't read."
					: "This respondent is named on an earlier row too, so this row isn't read.",
				line,
				map.respondent,
			);
			continue;
		}
		respondents.add(respondent);
		const given = new Set<string>();
		for (const c of readable) {
			const cell = cells[c.column] ?? "";
			if (cell === "") continue;
			const value =
				c.values !== undefined && Object.hasOwn(c.values, cell)
					? c.values[cell]
					: c.only
						? undefined
						: cell;
			if (value === undefined) {
				note(
					"responses-not-a-tick",
					"error",
					"This cell isn't a form this column is read in, so it isn't read.",
					line,
					c.column,
				);
				continue;
			}
			if (!holds(representations.get(c.variable), value)) {
				note(
					"responses-not-a-code",
					"error",
					`This value isn't one \`${c.variable}\` can hold, so it isn't read.`,
					line,
					c.column,
				);
				continue;
			}
			const key = `${c.variable}\u0000${c.row ?? ""}`;
			if (given.has(key)) {
				note(
					"responses-duplicate",
					"error",
					`Another column already gave \`${c.variable}\`${c.row === undefined ? "" : ` at row ${c.row}`} for this respondent, so this one isn't read.`,
					line,
					c.column,
				);
				continue;
			}
			given.add(key);
			answers.push({
				respondent,
				variable: c.variable,
				...(c.row !== undefined && { row: c.row }),
				value,
			});
		}
	}
	return { answers, findings: [...found.values()] };
}

/** Whether a variable can hold a value. */
const holds = (r: Representation | undefined, value: string): boolean =>
	r === undefined
		? false
		: r.kind === "codes"
			? r.codes.includes(value)
			: r.kind === "number"
				? NUMBER.test(value) || r.missing.includes(value)
				: true;

/** A field as CSV writes it (RFC 4180): quoted when it holds a comma, a quote or a line break. */
const field = (s: string): string =>
	/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;

/**
 * Answers as long CSV: one line per value, `respondent,variable,row,value`, `row` empty
 * outside a roster or loop. A value never given has no line.
 */
export const answersCsv = (answers: readonly Answer[]): string =>
	[
		"respondent,variable,row,value",
		...answers.map((a) =>
			[
				a.respondent,
				a.variable,
				a.row === undefined ? "" : String(a.row),
				a.value,
			]
				.map(field)
				.join(","),
		),
	]
		.map((l) => `${l}\n`)
		.join("");
