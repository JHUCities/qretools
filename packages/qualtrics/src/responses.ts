/**
 * A Qualtrics response export read with the QSF column map: the CSV (Export values,
 * multi-value fields split into columns) parsed, and its columns matched to the map's by
 * the ImportId in its third header row, never by a column's name, which an author can
 * change. The result is the core's source-neutral `ResponseMap`, which `readResponses`
 * reads into answers keyed by DDI Variable URN. Pure: text in, values out.
 */

import type { ResponseFinding, ResponseMap, ResponseRow } from "@qretools/core";
import type { Column, ColumnMap } from "./columns.ts";
import { PROVENANCE } from "./skeleton.ts";

export type ExportCode =
	/** The file isn't an export the map can be read with: too few rows, no respondent column, a quote never closed. */
	| "responses-unreadable"
	/** A header cell in row 3 that isn't `{"ImportId":…}` JSON, or repeats an earlier one. */
	| "responses-import-id"
	/** A question's column the map doesn't name. */
	| "responses-unmapped-column"
	/** A column the map names that the export doesn't have. */
	| "responses-missing-column"
	/** A select-all option whose tick the DDI doesn't say. */
	| "responses-unknown-variable"
	/** The export's `qretools_*` fields don't say what the map says. */
	| "responses-provenance";

export type ExportFinding = ResponseFinding<ExportCode>;

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

/** A column's key: its ImportId and, for a select-all option, its choiceId. */
const keyOf = (importId: string, choice: string | undefined): string =>
	`${importId}\u0000${choice ?? ""}`;

/** A row-3 cell's ImportId and choiceId, or undefined where it isn't that JSON. */
function importIdOf(
	cell: string,
): { readonly importId: string; readonly choice?: string } | undefined {
	let json: unknown;
	try {
		json = JSON.parse(cell);
	} catch {
		return undefined;
	}
	if (typeof json !== "object" || json === null) return undefined;
	const { ImportId, choiceId } = json as Record<string, unknown>;
	if (typeof ImportId !== "string") return undefined;
	// Qualtrics writes choiceId as a string; a number is read as it would print.
	const choice =
		typeof choiceId === "string"
			? choiceId
			: typeof choiceId === "number"
				? String(choiceId)
				: undefined;
	return { importId: ImportId, ...(choice !== undefined && { choice }) };
}

/**
 * The ImportIds one map entry stands for: its own, or one per round of a loop, prefixed
 * with the round (`1_QID6_TEXT`), each at its row.
 */
// shortcut: the looped ImportId form `<round>_<importId>` follows the columns' names; it is unmeasured in a real Loop & Merge export. Check it against one.
const expand = (
	c: Column,
): readonly { readonly importId: string; readonly row?: number }[] =>
	c.rounds === undefined
		? [{ importId: c.importId, ...(c.row !== undefined && { row: c.row }) }]
		: Array.from({ length: c.rounds }, (_, i) => ({
				importId: `${i + 1}_${c.importId}`,
				row: i + 1,
			}));

/** A question's column, by its ImportId: in a loop or not. */
const QUESTION = /^(\d+_)?QID\d+/;

/** What a respondent's column is called in every export. */
const RESPONDENT = "_recordId";

/** What Qualtrics writes in a ticked select-all option's column ("Export values"). */
const TICK = "1";

/**
 * An export's header, its responses, and the map of its columns to DDI variables,
 * with findings for what doesn't match. `ticked` gives each select-all option's variable
 * (by URN) the code that is a tick, from the DDI. Undefined `map` when the export can't
 * be read at all.
 */
export function exportMap(
	text: string,
	columns: ColumnMap,
	ticked: ReadonlyMap<string, string>,
): {
	readonly header: readonly string[];
	readonly rows: readonly ResponseRow[];
	readonly map?: ResponseMap;
	readonly findings: readonly ExportFinding[];
} {
	const findings: ExportFinding[] = [];
	const note = (
		code: ExportCode,
		severity: ExportFinding["severity"],
		message: string,
		at: { line?: number; column?: string; count?: number } = {},
	) =>
		findings.push({
			code,
			severity,
			message,
			...(at.line !== undefined && { line: at.line }),
			...(at.column !== undefined && { column: at.column }),
			count: at.count ?? 1,
		});
	const { rows: records, unclosed } = parseCsv(text);
	if (unclosed !== undefined)
		note(
			"responses-unreadable",
			"error",
			"A quote opened here is never closed, so the rest of the file is read as one cell.",
			{ line: unclosed },
		);
	const [names, , ids, ...rows] = records;
	if (names === undefined || ids === undefined) {
		note(
			"responses-unreadable",
			"error",
			"This isn't a Qualtrics response export: it has fewer than three header rows.",
		);
		return { header: names?.cells ?? [], rows: [], findings };
	}
	const header = names.cells;
	const byKey = new Map<string, number>();
	const byImportId = new Map<string, number>();
	const parsed = ids.cells.map(importIdOf);
	parsed.forEach((id, i) => {
		if (id === undefined) {
			note(
				"responses-import-id",
				"warning",
				'This column has no `{"ImportId":…}` in the third header row, so it isn\'t read.',
				{
					line: ids.line,
					...(header[i] !== undefined && { column: header[i] }),
				},
			);
			return;
		}
		const key = keyOf(id.importId, id.choice);
		if (byKey.has(key)) {
			note(
				"responses-import-id",
				"warning",
				"An earlier column has this column's ImportId, so this one isn't read.",
				{
					line: ids.line,
					...(header[i] !== undefined && { column: header[i] }),
				},
			);
			return;
		}
		byKey.set(key, i);
		if (id.choice === undefined) byImportId.set(id.importId, i);
	});
	const respondent = byImportId.get(RESPONDENT);
	if (respondent === undefined) {
		note(
			"responses-unreadable",
			"error",
			`This export has no ResponseId column (ImportId \`${RESPONDENT}\`), so no response can be told apart.`,
		);
		return { header, rows, findings };
	}

	const mapped: ResponseMap["columns"][number][] = [];
	for (const c of columns.columns) {
		const tick = ticked.get(c.variable);
		const absent: string[] = [];
		for (const { importId, row } of expand(c)) {
			const at = byKey.get(keyOf(importId, c.choice));
			if (at === undefined) {
				absent.push(importId);
				continue;
			}
			if (c.choice !== undefined && tick === undefined) {
				note(
					"responses-unknown-variable",
					"error",
					`The DDI doesn't say which code of \`${c.variable}\` is a tick, so this column isn't read.`,
					{ ...(header[at] !== undefined && { column: header[at] }) },
				);
				continue;
			}
			mapped.push({
				column: at,
				variable: c.variable,
				...(row !== undefined && { row }),
				...(c.choice !== undefined &&
					tick !== undefined && { values: { [TICK]: tick }, only: true }),
			});
		}
		const [first] = absent;
		if (first !== undefined)
			note(
				"responses-missing-column",
				"warning",
				`The export has no column with ImportId \`${first}\`${c.choice === undefined ? "" : ` and choiceId \`${c.choice}\``}${absent.length > 1 ? ` (nor ${absent.length - 1} more of its rounds)` : ""}, which the map says records \`${c.variable}\`.`,
			);
	}
	const used = new Set(mapped.map((m) => m.column));
	parsed.forEach((id, i) => {
		// A repeated ImportId was said once already, where it was found.
		if (
			id !== undefined &&
			byKey.get(keyOf(id.importId, id.choice)) === i &&
			QUESTION.test(id.importId) &&
			!used.has(i)
		)
			note(
				"responses-unmapped-column",
				"warning",
				"The map names no variable for this column, so it isn't read.",
				{ ...(header[i] !== undefined && { column: header[i] }) },
			);
	});

	// The survey's own fields, in every response: each must say what the map says.
	const stamp = (
		field: string,
		expected: string | undefined,
		severity: ExportFinding["severity"],
		what: string,
	) => {
		if (expected === undefined) return;
		const at = byImportId.get(field);
		if (at === undefined)
			return note(
				"responses-provenance",
				severity,
				`The export has no \`${field}\` field, so it can't be matched to the map's ${what}.`,
			);
		const differ = rows.filter((r) => (r.cells[at] ?? "") !== expected);
		const first = differ[0];
		if (first !== undefined)
			note(
				"responses-provenance",
				severity,
				`This response's \`${field}\` isn't the map's ${what}: the map may not describe its survey.`,
				{
					line: first.line,
					...(header[at] !== undefined && { column: header[at] }),
					count: differ.length,
				},
			);
	};
	stamp(PROVENANCE.instrument, columns.instrument, "error", "instrument");
	stamp(PROVENANCE.ddi, columns.ddi, "error", "DDI");
	// Another version of QREtools may write the same survey: worth knowing, not wrong.
	stamp(PROVENANCE.version, columns.qretools, "info", "QREtools version");

	return { header, rows, map: { respondent, columns: mapped }, findings };
}

/** A QSF column map read from its JSON, once, or undefined where it isn't one. */
export function columnMapOf(json: unknown): ColumnMap | undefined {
	if (typeof json !== "object" || json === null) return undefined;
	const { qretools, instrument, ddi, columns } = json as Record<
		string,
		unknown
	>;
	const optional = (v: unknown) => v === undefined || typeof v === "string";
	if (!optional(qretools) || !optional(instrument) || !optional(ddi))
		return undefined;
	if (!Array.isArray(columns)) return undefined;
	const read: Column[] = [];
	for (const c of columns as unknown[]) {
		if (typeof c !== "object" || c === null) return undefined;
		const { importId, choice, rounds, row, variable } = c as Record<
			string,
			unknown
		>;
		const count = (v: unknown) =>
			v === undefined || (Number.isInteger(v) && (v as number) > 0);
		if (
			typeof importId !== "string" ||
			typeof variable !== "string" ||
			!optional(choice) ||
			!count(rounds) ||
			!count(row)
		)
			return undefined;
		read.push({
			importId,
			variable,
			...(typeof choice === "string" && { choice }),
			...(typeof rounds === "number" && { rounds }),
			...(typeof row === "number" && { row }),
		});
	}
	return {
		...(typeof qretools === "string" && { qretools }),
		...(typeof instrument === "string" && { instrument }),
		...(typeof ddi === "string" && { ddi }),
		columns: read,
	};
}
