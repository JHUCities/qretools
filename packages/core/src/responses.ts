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
import { err, ok, type Result } from "./result.ts";

/** One column of a source, and the variable it records. */
export interface ResponseColumn {
	/** Its position in each row, from 0. */
	readonly column: number;
	/** The URN of the DDI Variable it records. */
	readonly variable: string;
	/** The row of the variable it records, in a roster or a loop, from 1. */
	readonly row?: number;
	/**
	 * What the source writes in place of a DDI code: source value to code, or to `null`
	 * where the value is no answer (a data file's code for "not asked"), as a blank cell is.
	 */
	readonly values?: Readonly<Record<string, string | null>>;
	/** Only the values in `values` are read; any other is a finding (a tick, say). */
	readonly only?: true;
	/**
	 * Values that stand for a range, not themselves (a top code: 6 for "6 or more"), each
	 * with what it means. They give no answer, and a note.
	 */
	readonly censored?: Readonly<Record<string, string>>;
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
	/** A number, within its range where the DDI gives one, or one of its missing codes. */
	| {
			readonly kind: "number";
			readonly missing: readonly string[];
			readonly min?: number;
			readonly max?: number;
	  }
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
	/** A value the variable can't hold: not one of its codes, or not a number in its range. */
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
	| "responses-duplicate"
	/** A data file that can't be read with its map: no header, no respondent column, a quote never closed. */
	| "responses-unreadable"
	/** A column the map names that the data file doesn't have. */
	| "responses-missing-column"
	/** Columns of the data file that the map doesn't name. */
	| "responses-unmapped-column"
	/** A header the map names that the data file has more than once. */
	| "responses-header"
	/** A column whose values the source doesn't hold: none is read. */
	| "responses-filtered"
	/** A value that stands for a range (a top or bottom code): it gives no answer. */
	| "responses-censored";

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
// shortcut: a number isn't checked against its decimals; add them when a comparison needs them.
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
			if (c.censored !== undefined && Object.hasOwn(c.censored, cell)) {
				note(
					"responses-censored",
					"info",
					censoredMessage(c.censored),
					line,
					c.column,
				);
				continue;
			}
			// Own keys only: a cell such as `toString` isn't a translation.
			const translated =
				c.values !== undefined && Object.hasOwn(c.values, cell)
					? c.values[cell]
					: undefined;
			if (translated === null) continue;
			const value = translated ?? (c.only ? undefined : cell);
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

/** What a column's censored values mean, as one note: the values are the map's, not a response's. */
function censoredMessage(censored: Readonly<Record<string, string>>): string {
	const entries = Object.entries(censored);
	const and = (xs: readonly string[]) =>
		xs.length < 2
			? xs.join("")
			: `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
	const values = and(entries.map(([v]) => v));
	const meanings = and(entries.map(([, m]) => `"${m}"`));
	return entries.length === 1
		? `Its value ${values} means ${meanings}, so it isn't read as a number.`
		: `Its values ${values} mean ${meanings}, so they aren't read as numbers.`;
}

/** Whether a variable can hold a value. */
const holds = (r: Representation | undefined, value: string): boolean =>
	r === undefined
		? false
		: r.kind === "codes"
			? r.codes.includes(value)
			: r.kind === "number"
				? r.missing.includes(value) ||
					(NUMBER.test(value) &&
						(r.min === undefined || Number(value) >= r.min) &&
						(r.max === undefined || Number(value) <= r.max))
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

const ANSWERS_HEADER = "respondent,variable,row,value";

/**
 * Answers read back from long CSV as `answersCsv` writes them, all or none: a file with
 * another header, a row of another width, a row that isn't a number from 1, or a blank
 * respondent or variable is refused, by its line, never by a value.
 */
export function answersOf(
	text: string,
): Result<
	readonly Answer[],
	{ readonly line?: number; readonly message: string }
> {
	const { rows, unclosed } = parseCsv(text);
	if (unclosed !== undefined)
		return err({
			line: unclosed,
			message: "A quote opened here is never closed.",
		});
	const [header, ...records] = rows;
	if (header?.cells.join(",") !== ANSWERS_HEADER)
		return err({
			line: 1,
			message: `The header isn't \`${ANSWERS_HEADER}\`, as \`responses\` writes it.`,
		});
	const answers: Answer[] = [];
	for (const { line, cells } of records) {
		const [respondent = "", variable = "", row = "", value = ""] = cells;
		if (
			cells.length !== 4 ||
			respondent === "" ||
			variable === "" ||
			(row !== "" && !/^[1-9]\d*$/.test(row))
		)
			return err({
				line,
				message:
					"This line isn't an answer: four cells, a respondent, a variable, and a row that is empty or a number from 1.",
			});
		answers.push({
			respondent,
			variable,
			...(row !== "" && { row: Number(row) }),
			value,
		});
	}
	return ok(answers);
}

/**
 * A CSV's records (RFC 4180: quoted fields, doubled quotes, line breaks in quotes, CRLF,
 * a byte-order mark), each with the line it starts on. Blank lines are skipped. Total: an
 * unclosed quote runs to the end of the text, and `unclosed` is the line it opened on.
 */
export function parseCsv(text: string): {
	readonly rows: readonly ResponseRow[];
	readonly unclosed?: number;
} {
	const rows: ResponseRow[] = [];
	const s = text.startsWith("﻿") ? text.slice(1) : text;
	let line = 1;
	let start = 1;
	let cells: string[] = [];
	let cell = "";
	let quoted = false;
	let opened = 0;
	const end = () => {
		cells.push(cell);
		if (cells.length > 1 || cell !== "") rows.push({ line: start, cells });
		cells = [];
		cell = "";
	};
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (quoted) {
			if (ch === '"' && s[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else {
				if (ch === "\n") line++;
				cell += ch;
			}
		} else if (ch === '"') {
			quoted = true;
			opened = line;
		} else if (ch === ",") {
			cells.push(cell);
			cell = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && s[i + 1] === "\n") i++;
			end();
			line++;
			start = line;
		} else cell += ch;
	}
	if (cell !== "" || cells.length > 0) end();
	return quoted ? { rows, unclosed: opened } : { rows };
}

/** What a data file's map says a value stands for: source value to DDI code, or `null` for no answer. */
export type Values = Readonly<Record<string, string | null>>;

/**
 * A map of a data file with one header row (a published data release as CSV, say): each
 * column by its header, and the DDI variable it records. It holds no data.
 */
export interface DataMap {
	/** The source's short name (`gss`), as the map's file name ends (`-ddi-gss.columns.json`). */
	readonly source: string;
	/** The digest of the DDI it was made from, `sha256:<hex>`. */
	readonly ddi?: string;
	/** The header of the column that names each respondent. */
	readonly respondent: string;
	/** Translations for every column; a column's own win. */
	readonly values?: Values;
	readonly columns: readonly {
		readonly column: string;
		readonly variable: string;
		readonly values?: Values;
		/** The source doesn't hold this variable's values: none is read. */
		readonly filtered?: true;
		/** Values that stand for a range, with what each means: no answer, and a note. */
		readonly censored?: Readonly<Record<string, string>>;
	}[];
}

/** A `values` object read from JSON, or undefined where a target isn't a string or null. */
function valuesOf(v: unknown): Values | undefined {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
	const entries = Object.entries(v);
	if (entries.some(([, to]) => to !== null && typeof to !== "string"))
		return undefined;
	// fromEntries keeps a key such as `__proto__` as data.
	return Object.fromEntries(entries);
}

/** A data file's map read from its JSON, once, or undefined where it isn't one. */
export function dataMapOf(json: unknown): DataMap | undefined {
	if (typeof json !== "object" || json === null) return undefined;
	const { source, ddi, respondent, values, columns } = json as Record<
		string,
		unknown
	>;
	if (typeof source !== "string") return undefined;
	if (ddi !== undefined && typeof ddi !== "string") return undefined;
	if (typeof respondent !== "string" || !Array.isArray(columns))
		return undefined;
	const shared = values === undefined ? undefined : valuesOf(values);
	if (values !== undefined && shared === undefined) return undefined;
	const read: DataMap["columns"][number][] = [];
	const named = new Set<string>();
	for (const c of columns as unknown[]) {
		if (typeof c !== "object" || c === null) return undefined;
		const {
			column,
			variable,
			values: own,
			filtered,
			censored,
		} = c as Record<string, unknown>;
		if (typeof column !== "string" || typeof variable !== "string")
			return undefined;
		// A header named twice would be a guess at which entry is meant.
		if (named.has(column)) return undefined;
		named.add(column);
		const v = own === undefined ? undefined : valuesOf(own);
		if (own !== undefined && v === undefined) return undefined;
		if (filtered !== undefined && filtered !== true) return undefined;
		const ranges = censored === undefined ? undefined : valuesOf(censored);
		if (
			censored !== undefined &&
			(ranges === undefined || Object.values(ranges).some((m) => m === null))
		)
			return undefined;
		read.push({
			column,
			variable,
			...(v !== undefined && { values: v }),
			...(filtered === true && { filtered }),
			...(ranges !== undefined && {
				censored: ranges as Readonly<Record<string, string>>,
			}),
		});
	}
	return {
		source,
		...(typeof ddi === "string" && { ddi }),
		respondent,
		...(shared !== undefined && { values: shared }),
		columns: read,
	};
}

/**
 * A data file's header, its rows, and the core's `ResponseMap` for it, matched to the
 * map by header name, exactly as spelt. Every row is read: choosing a survey's rows is the
 * converter's job. Undefined `map` when the file can't be read at all.
 */
export function dataFileMap(
	text: string,
	map: DataMap,
): {
	readonly header: readonly string[];
	readonly rows: readonly ResponseRow[];
	readonly map?: ResponseMap;
	readonly findings: readonly ResponseFinding[];
} {
	const findings: ResponseFinding[] = [];
	const note = (
		code: ResponseCode,
		severity: Severity,
		message: string,
		at: { line?: number; column?: string } = {},
	) => findings.push({ code, severity, message, ...at, count: 1 });
	const { rows: records, unclosed } = parseCsv(text);
	if (unclosed !== undefined)
		note(
			"responses-unreadable",
			"error",
			"A quote opened here is never closed, so the rest of the file is read as one cell.",
			{ line: unclosed },
		);
	const [names, ...rows] = records;
	if (names === undefined) {
		note("responses-unreadable", "error", "This file has no header row.");
		return { header: [], rows: [], findings };
	}
	const header = names.cells;
	const at = new Map<string, number[]>();
	header.forEach((h, i) => {
		at.set(h, [...(at.get(h) ?? []), i]);
	});
	const [respondent, ...others] = at.get(map.respondent) ?? [];
	if (respondent === undefined || others.length > 0) {
		note(
			"responses-unreadable",
			"error",
			respondent === undefined
				? `This file has no column \`${map.respondent}\`, which the map says names each respondent.`
				: `This file has more than one column \`${map.respondent}\`, so no respondent can be told apart.`,
		);
		return { header, rows, findings };
	}
	const columns: ResponseColumn[] = [];
	const absent: string[] = [];
	for (const c of map.columns) {
		// Said whether or not the file has the column: there's nothing in it to read.
		if (c.filtered) {
			note(
				"responses-filtered",
				"info",
				"Filtered from this source, so its values aren't read.",
				{ column: c.column },
			);
			continue;
		}
		const found = at.get(c.column) ?? [];
		const [i] = found;
		if (i === undefined) {
			absent.push(c.column);
			continue;
		}
		if (found.length > 1) {
			note(
				"responses-header",
				"error",
				`The file has ${found.length} columns with this header, so none is read.`,
				{ column: c.column },
			);
			continue;
		}
		const values =
			map.values === undefined && c.values === undefined
				? undefined
				: { ...map.values, ...c.values };
		columns.push({
			column: i,
			variable: c.variable,
			...(values !== undefined && { values }),
			...(c.censored !== undefined && { censored: c.censored }),
		});
	}
	// One finding for them all: a map written in another case misses every column.
	if (absent.length > 0)
		note(
			"responses-missing-column",
			"warning",
			`The file has no column \`${absent[0]}\`${absent.length > 1 ? ` (nor ${absent.length - 1} more of the map's columns)` : ""}, which the map names.`,
		);
	const named = new Set(map.columns.map((c) => c.column));
	const unmapped = header.filter((h) => h !== map.respondent && !named.has(h));
	const [first] = unmapped;
	// One finding for them all: a data release has hundreds of columns no map names.
	if (first !== undefined)
		note(
			"responses-unmapped-column",
			"info",
			`The map names no variable for this column${unmapped.length > 1 ? ` nor for ${unmapped.length - 1} more` : ""}, so ${unmapped.length > 1 ? "they aren't" : "it isn't"} read.`,
			{ column: first },
		);
	return { header, rows, map: { respondent, columns }, findings };
}
