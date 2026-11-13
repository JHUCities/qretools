/**
 * Responses from any source, read into answers keyed by DDI Variable URN. A source (a
 * survey platform's export, a published data file) brings its rows and a map of its
 * columns; the DDI brings each variable's representation. The reader knows no source:
 * what a source writes in place of a DDI code (a platform's tick, a data file's reserved
 * code for "don't know") is translated by the map, then checked against the variable's
 * codes. Nothing is guessed: a blank cell is no answer, and a value the variable can't
 * hold is a finding, never written.
 */

import { z } from "zod";
import type { Severity } from "./findings.ts";
import type { Term } from "./provenance.ts";
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
	/**
	 * The columns that give when each interview started and ended, as a local date and time
	 * (`2026-11-12 23:15:41`), and the zone they are in (`Z` or an offset such as `-05:00`).
	 */
	readonly times?: {
		readonly start: number;
		readonly end: number;
		readonly zone: string;
	};
	/** The column that gives the date of each interview, as `form` writes it, and the year where the form has none. */
	readonly date?: {
		readonly column: number;
		readonly form: DateForm;
		readonly year?: number;
	};
}

/**
 * How a data file writes an interview's date: `YYYY-MM-DD`, or `MMDD`, the month and day
 * as one number (`315` is 15 March), with the year in a column of its own.
 */
export type DateForm = "YYYY-MM-DD" | "MMDD";

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

/** One respondent, and when their interview started and ended (`2026-11-12T23:15:41Z`). */
export interface Respondent {
	readonly id: string;
	readonly start?: string;
	readonly end?: string;
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
	| "responses-censored"
	/** An interview's start or end that isn't a date and time, or a zone that isn't `Z` or an offset. */
	| "responses-time"
	/** An interview's date that its form can't read (a reserved code, say): that interview has no time. */
	| "responses-date";

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
 * An interview's date as `YYYY-MM-DD`, from a cell in `form` and, for `MMDD`, a year
 * cell, or undefined where they aren't a date of the calendar: never a guess.
 */
export function dateOf(
	cell: string,
	form: DateForm,
	year?: string,
): string | undefined {
	const parts =
		form === "MMDD"
			? /^(\d{4})$/.test(year ?? "") && /^\d{3,4}$/.test(cell)
				? [Number(year), Math.floor(Number(cell) / 100), Number(cell) % 100]
				: undefined
			: /^(\d{4})-(\d\d)-(\d\d)$/.exec(cell)?.slice(1).map(Number);
	if (parts === undefined) return undefined;
	const [y = 0, m = 0, d = 0] = parts;
	const t = new Date(Date.UTC(y, m - 1, d));
	// Date.UTC rolls 31 April into May: a date that doesn't come back as written isn't one.
	return t.getUTCFullYear() === y &&
		t.getUTCMonth() === m - 1 &&
		t.getUTCDate() === d
		? t.toISOString().slice(0, 10)
		: undefined;
}

/** A local date and time, as a survey platform exports it: `2026-11-12 23:15:41`. */
const LOCAL_TIME = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)$/;

/**
 * Each row's respondent, with their interview's times where the map gives them, and their
 * answers, and findings for what can't be read. `header` names the columns in
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
	readonly respondents: readonly Respondent[];
	readonly answers: readonly Answer[];
	readonly findings: readonly ResponseFinding[];
} {
	const answers: Answer[] = [];
	const listed: Respondent[] = [];
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
		const time = (column: number, zone: string): string | undefined => {
			const t = LOCAL_TIME.exec(cells[column] ?? "");
			if (t !== null) return `${t[1]}T${t[2]}${zone}`;
			note(
				"responses-time",
				"error",
				"This cell isn't a date and time such as `2026-11-12 23:15:41`, so it isn't read.",
				line,
				column,
			);
			return undefined;
		};
		const { date: on } = map;
		const date =
			on === undefined
				? undefined
				: dateOf(
						cells[on.column] ?? "",
						on.form,
						on.year === undefined ? undefined : (cells[on.year] ?? ""),
					);
		if (on !== undefined && date === undefined)
			note(
				"responses-date",
				"warning",
				on.form === "MMDD"
					? "This cell and the year beside it aren't a date (`MMDD`, and a year such as `2010`), so this interview has no time."
					: "This cell isn't a date such as `2010-03-15`, so this interview has no time.",
				line,
				on.column,
			);
		const start = map.times ? time(map.times.start, map.times.zone) : date;
		const end = map.times ? time(map.times.end, map.times.zone) : date;
		listed.push({
			id: respondent,
			...(start !== undefined && { start }),
			...(end !== undefined && { end }),
		});
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
	return { respondents: listed, answers, findings: [...found.values()] };
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
			message: `The header isn't \`${ANSWERS_HEADER}\`, as \`dataset export --csv\` writes it.`,
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

const nonEmpty = z.string().min(1);
const termSchema = z.union([nonEmpty, z.strictObject({ other: nonEmpty })]);

/**
 * A column of a data file that no respondent is asked (the mode of each interview, a
 * sample phase, a weight). No DDI describes its variable, so the map does, and the
 * dataset owns it.
 */
export interface MetadataColumn {
	/** Its header, and its variable's name: letters, digits and `_`, since an ID is made from it. */
	readonly column: string;
	readonly label?: string;
	/** What the variable is for (DDI's VariableRole), in the map's own words. */
	readonly role?: string;
	/** Who gives its values: a term of the DDI vocabulary ResponseUnit. */
	readonly unit?: Term;
	/** Its own translations only: the map's shared ones are for the instrument's variables. */
	readonly values?: Values;
	/** Its codes, each with its label; or `number`. */
	readonly codes?: Readonly<Record<string, string>>;
	readonly number?: true;
	/** The column that records each respondent's mode: a ModeOfCollection term for each code that is a mode. */
	readonly modes?: Readonly<Record<string, Term>>;
	/** A weight the publisher gives; what the publisher advises of them all is the map's `weighting`. */
	readonly weight?: true;
	/** The access level its values stand at, of the DDI's one policy; without it, the most closed. */
	readonly access?: string;
}

/** A published work: a data release, or the document that advises on it (DDI's Citation). */
export interface Citation {
	readonly title: string;
	readonly publisher?: string | undefined;
	readonly url?: string | undefined;
}

/** What the publisher advises about its weights, in its own words, and where and when it was read. */
export interface WeightingAdvice {
	readonly advice: string;
	readonly source: Citation;
	/** The date it was read from the source (2026-11-12). */
	readonly read: string;
}

const citationSchema = z.strictObject({
	title: nonEmpty,
	publisher: nonEmpty.optional(),
	url: nonEmpty.optional(),
});

/** What the map adds to a data file's columns, all parsed at once. */
const extrasSchema = z.object({
	answered_by: termSchema,
	citation: citationSchema.optional(),
	metadata: z
		.array(
			z
				.strictObject({
					// No hyphen: it keeps the variable's sub-IDs (`var-<column>-codes`) apart from another column's.
					column: z.string().regex(/^[A-Za-z0-9_]+$/),
					label: nonEmpty.optional(),
					role: nonEmpty.optional(),
					unit: termSchema.optional(),
					values: z.record(z.string(), z.string().nullable()).optional(),
					codes: z.record(z.string(), nonEmpty).optional(),
					number: z.literal(true).optional(),
					modes: z.record(z.string(), termSchema).optional(),
					weight: z.literal(true).optional(),
					access: nonEmpty.optional(),
				})
				.refine((m) => (m.codes === undefined) !== (m.number === undefined))
				.refine(
					(m) =>
						m.modes === undefined ||
						// A code may be no mode ("not recorded"): only the modes are named.
						(Object.keys(m.modes).length > 0 &&
							Object.keys(m.modes).every(
								(k) => m.codes !== undefined && Object.hasOwn(m.codes, k),
							)),
				)
				.refine((m) => m.weight === undefined || m.number === true),
		)
		.optional(),
	weighting: z
		.strictObject({
			advice: nonEmpty,
			source: citationSchema,
			read: z.string().regex(/^\d{4}-\d\d-\d\d$/),
		})
		.optional(),
	interview_date: z
		.strictObject({
			column: nonEmpty,
			form: z.enum(["YYYY-MM-DD", "MMDD"]),
			year: nonEmpty.optional(),
		})
		// A year column exactly when the form has no year.
		.refine((d) => (d.form === "MMDD") === (d.year !== undefined))
		.optional(),
});

/**
 * A map of a data file with one header row (a published data release as CSV, say): each
 * column by its header, and the DDI variable it records, and what the data file says of
 * itself. It holds no data.
 */
export interface DataMap {
	/** The digest of the DDI it was made from, `sha256:<hex>`. */
	readonly ddi?: string;
	/** Who answered: a term of the DDI vocabulary DataSourceType. A fact of the source, so its map says it. */
	readonly answered_by: Term;
	/** The published data file it reads. */
	readonly citation?: Citation;
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
	/** The columns no respondent is asked. */
	readonly metadata?: readonly MetadataColumn[];
	/** What the publisher advises of the weights: given exactly when a column is a weight. */
	readonly weighting?: WeightingAdvice;
	/** The column with each interview's date, how it is written, and the year's column where the form has none. */
	readonly interview_date?: {
		readonly column: string;
		readonly form: DateForm;
		readonly year?: string | undefined;
	};
}

/** What a metadata column's variable can hold, as the map says. */
export const metadataRepresentation = (m: MetadataColumn): Representation =>
	m.codes === undefined
		? { kind: "number", missing: [] }
		: { kind: "codes", codes: Object.keys(m.codes) };

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
	const { ddi, respondent, values, columns } = json as Record<string, unknown>;
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
	const extras = extrasSchema.safeParse(json);
	if (!extras.success) return undefined;
	const { answered_by, citation, metadata, weighting, interview_date } =
		extras.data;
	for (const m of metadata ?? []) {
		// One entry per header: a metadata column is no answer, and never the respondent.
		if (named.has(m.column) || m.column === respondent) return undefined;
		named.add(m.column);
	}
	if ((metadata ?? []).filter((m) => m.modes !== undefined).length > 1)
		return undefined;
	// A weight points at the publisher's advice, and advice is about weights.
	if ((metadata ?? []).some((m) => m.weight) !== (weighting !== undefined))
		return undefined;
	return {
		...(typeof ddi === "string" && { ddi }),
		answered_by,
		...(citation !== undefined && { citation }),
		respondent,
		...(shared !== undefined && { values: shared }),
		columns: read,
		...(metadata !== undefined && {
			metadata: metadata as readonly MetadataColumn[],
		}),
		...(weighting !== undefined && { weighting }),
		...(interview_date !== undefined && { interview_date }),
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
	/** The URN of the dataset's own variable for a metadata column. */
	metadataUrn: (column: string) => string,
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
	const entries = [
		...map.columns.map((c) => ({
			...c,
			values:
				map.values === undefined && c.values === undefined
					? undefined
					: { ...map.values, ...c.values },
		})),
		// Its own translations only: the shared ones give the instrument's missing codes.
		...(map.metadata ?? []).map((m) => ({
			column: m.column,
			variable: metadataUrn(m.column),
			values: m.values,
			filtered: undefined,
			censored: undefined,
		})),
	];
	for (const c of entries) {
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
		columns.push({
			column: i,
			variable: c.variable,
			...(c.values !== undefined && { values: c.values }),
			...(c.censored !== undefined && { censored: c.censored }),
		});
	}
	// The date's columns: one each, as the respondent's.
	const one = (header: string) => {
		const found = at.get(header) ?? [];
		if (found.length === 0) absent.push(header);
		if (found.length > 1)
			note(
				"responses-header",
				"error",
				`The file has ${found.length} columns with this header, so none is read.`,
				{ column: header },
			);
		return found.length === 1 ? found[0] : undefined;
	};
	const on = map.interview_date;
	const dateColumn = on && one(on.column);
	const yearColumn = on?.year === undefined ? undefined : one(on.year);
	const date =
		on === undefined ||
		dateColumn === undefined ||
		(on.year !== undefined && yearColumn === undefined)
			? undefined
			: {
					column: dateColumn,
					form: on.form,
					...(yearColumn !== undefined && { year: yearColumn }),
				};
	// One finding for them all: a map written in another case misses every column.
	if (absent.length > 0)
		note(
			"responses-missing-column",
			"warning",
			`The file has no column \`${absent[0]}\`${absent.length > 1 ? ` (nor ${absent.length - 1} more of the map's columns)` : ""}, which the map names.`,
		);
	const named = new Set([
		...entries.map((c) => c.column),
		...(on === undefined ? [] : [on.column, ...(on.year ? [on.year] : [])]),
	]);
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
	return {
		header,
		rows,
		map: { respondent, columns, ...(date !== undefined && { date }) },
		findings,
	};
}
