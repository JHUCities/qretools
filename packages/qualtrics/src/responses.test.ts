import {
	bankOf,
	instrumentOf,
	type Representation,
	readResponses,
} from "@qretools/core";
import { describe, expect, it } from "vitest";
import type { ColumnMap } from "./columns.ts";
import { qsfOf } from "./qsf.ts";
import { columnMapOf, exportMap, parseCsv } from "./responses.ts";

describe("parseCsv", () => {
	it("reads quoted fields, doubled quotes, line breaks in quotes, CRLF and a byte-order mark", () => {
		const { rows, unclosed } = parseCsv(
			'﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\nlast,,\n',
		);
		expect(unclosed).toBeUndefined();
		expect(rows).toEqual([
			{ line: 1, cells: ["a", "b", "c"] },
			{ line: 2, cells: ["x, y", 'say "hi"', "two\nlines"] },
			// A record that starts after a line break inside quotes is placed on its own line.
			{ line: 5, cells: ["last", "", ""] },
		]);
	});

	it("says where a quote that never closes opened", () => {
		expect(parseCsv('a,b\nc,"d\ne,f\n').unclosed).toBe(2);
	});
});

const q = (name: string, rest: string) =>
	`name: ${name}\ntext: ${name}?\nintent: i\n${rest}`;
const BANK = bankOf({
	"workspace.yaml": "agency: org.bank\n",
	"missing.yaml": 'labels:\n  "D": Don\'t know\n',
	"scales/yesno01.yaml": 'labels:\n  "0": No\n  "1": Yes\n',
	"questions/a/tenure.yaml": q(
		"tenure",
		'responses:\n  "1": Own\n  "2": Rent\n',
	),
	// Codes Qualtrics names a column by in four ways (see `choiceSuffixes`).
	"questions/a/modes.yaml": q(
		"modes",
		'select: many\nresponses:\n  "010": Bus\n  "-1": Walk\n  "1.5": Car\n  "b": Bike\n',
	),
	"questions/a/size.yaml": q("size", "number: { max: 2 }\n"),
	"questions/a/age.yaml": q("age", "number: {}\n"),
	"questions/a/why.yaml": q("why", "open: {}\n"),
});
const SOURCE = `name: t
uses:
  b: here
flow:
  - ask: b.tenure
  - ask: b.modes
  - ask: b.size
  - roster: people
    count: b.size
    flow:
      - ask: b.age
  - ask: b.why
`;
const made = qsfOf(
	instrumentOf(SOURCE, { banks: { b: BANK }, agency: "org.example" }).ddi,
	{
		name: "t",
		created: "2026-11-12 00:00:00",
		digest: "sha256:abc",
		version: "9",
	},
);
if (made.kind !== "made") throw new Error("the test survey isn't made");
/** The map as `build` writes it, from the real `columnsOf`. */
const MAP: ColumnMap = made.columns;
const v = (name: string) => `urn:ddi:org.example:instrument-t.var-${name}:1`;

const CODES = ["0", "1", "D"];
const REPRESENTATIONS = new Map<string, Representation>([
	[v("tenure"), { kind: "codes", codes: ["1", "2", "D"] }],
	...["010", "-1", "1.5", "b"].map(
		(c) =>
			[v(`modes_${c}`), { kind: "codes", codes: CODES }] as [
				string,
				Representation,
			],
	),
	[v("size"), { kind: "number", missing: ["D"] }],
	[v("age"), { kind: "number", missing: ["D"] }],
	[v("why"), { kind: "text" }],
]);
const TICKED = new Map(
	["010", "-1", "1.5", "b"].map((c) => [v(`modes_${c}`), "1"]),
);

/** A row-3 cell as Qualtrics writes it: JSON, quoted, its quotes doubled. */
const id = (o: object) => `"${JSON.stringify(o).replaceAll('"', '""')}"`;

/** An export in Qualtrics' shape: three header rows, then one response per row. */
const exportOf = (...responses: string[]) =>
	[
		"ResponseId,qretools_instrument,qretools_ddi,qretools_version,tenure,modes_10,modes_-1,modes_1.5,modes_4,size,1_age,2_age,Q5,QID9_DO",
		"Response ID,qretools_instrument,qretools_ddi,qretools_version,tenure?,modes? - Bus,modes? - Walk,modes? - Car,modes? - Bike,size?,1 - age?,2 - age?,why?,Display order",
		[
			id({ ImportId: "_recordId" }),
			id({ ImportId: "qretools_instrument" }),
			id({ ImportId: "qretools_ddi" }),
			id({ ImportId: "qretools_version" }),
			id({ ImportId: "QID1" }),
			// The suffix Qualtrics gives each option: 010 is 10, letters are their position.
			id({ ImportId: "QID2", choiceId: "10" }),
			id({ ImportId: "QID2", choiceId: "-1" }),
			id({ ImportId: "QID2", choiceId: "1.5" }),
			id({ ImportId: "QID2", choiceId: "4" }),
			id({ ImportId: "QID3_TEXT" }),
			id({ ImportId: "1_QID4_TEXT" }),
			id({ ImportId: "2_QID4_TEXT" }),
			// Renamed by the author: read by its ImportId, never its name.
			id({ ImportId: "QID5_TEXT" }),
			id({ ImportId: "QID9_DO" }),
		].join(","),
		...responses,
	].join("\r\n");
const STAMP = "urn:ddi:org.example:instrument-t:1,sha256:abc,9";

const read = (text: string) => {
	const e = exportMap(text, MAP, TICKED);
	if (e.map === undefined) return { ...e, answers: [] };
	const r = readResponses(e.header, e.rows, e.map, REPRESENTATIONS);
	return {
		answers: r.answers,
		findings: [...e.findings, ...r.findings],
	};
};

describe("a Qualtrics response export", () => {
	it("is read by ImportId into answers keyed by Variable URN, ticks as the DDI's tick code", () => {
		const r = read(
			exportOf(`R_1,${STAMP},2,1,,,1,2,40,D,"Close to work, ""mostly""",`),
		);
		expect(r.answers).toEqual([
			{ respondent: "R_1", variable: v("tenure"), value: "2" },
			{ respondent: "R_1", variable: v("modes_010"), value: "1" },
			{ respondent: "R_1", variable: v("modes_b"), value: "1" },
			{ respondent: "R_1", variable: v("size"), value: "2" },
			{ respondent: "R_1", variable: v("age"), row: 1, value: "40" },
			{ respondent: "R_1", variable: v("age"), row: 2, value: "D" },
			{
				respondent: "R_1",
				variable: v("why"),
				value: 'Close to work, "mostly"',
			},
		]);
		// Only a question's column the map doesn't name is said; metadata isn't.
		expect(r.findings).toEqual([
			{
				code: "responses-unmapped-column",
				severity: "warning",
				message: "The map names no variable for this column, so it isn't read.",
				column: "QID9_DO",
				count: 1,
			},
		]);
	});

	it("says what can't be read, at its line and column, once per column, never with the value", () => {
		const SENTINEL = "zq7";
		const r = read(
			exportOf(
				`R_1,${STAMP},${SENTINEL},0,,,,1,,,,`,
				`R_2,${STAMP},${SENTINEL},,,,,${SENTINEL},,,,`,
				`R_1,${STAMP},1,,,,,,,,,`,
				`R_3,urn:other,sha256:abc,8,,,,,,,,,,`,
			),
		);
		const shown = r.findings.map(
			(f) => `${f.code} ${f.line ?? ""} ${f.column ?? ""} x${f.count}`,
		);
		expect(shown).toEqual([
			"responses-unmapped-column  QID9_DO x1",
			"responses-provenance 7 qretools_instrument x1",
			"responses-provenance 7 qretools_version x1",
			"responses-not-a-code 4 tenure x2",
			"responses-not-a-tick 4 modes_10 x1",
			"responses-not-a-code 5 size x1",
			"responses-respondent 6 ResponseId x1",
		]);
		expect(
			r.findings.find((f) => f.code === "responses-provenance"),
		).toMatchObject({
			severity: "error",
		});
		expect(JSON.stringify(r.findings)).not.toContain(SENTINEL);
		// What could be read is: the first response's size.
		expect(r.answers.map((a) => a.variable)).toEqual([v("size")]);
	});

	it("says which of the map's columns the export lacks, and refuses one with no respondent", () => {
		const text = exportOf(`R_1,${STAMP},1,,,,,,,,,,`)
			.replace(
				`${id({ ImportId: "2_QID4_TEXT" })},`,
				`${id({ ImportId: "QID8" })},`,
			)
			.replace(id({ ImportId: "_recordId" }), id({ ImportId: "rid" }));
		expect(exportMap(text, MAP, TICKED).findings.map((f) => f.message)).toEqual(
			[
				"This export has no ResponseId column (ImportId `_recordId`), so no response can be told apart.",
			],
		);
		const lacking = exportMap(
			exportOf().replace(`,${id({ ImportId: "2_QID4_TEXT" })}`, ""),
			MAP,
			TICKED,
		);
		expect(lacking.findings[0]?.message).toBe(
			`The export has no column with ImportId \`2_QID4_TEXT\`, which the map says records \`${v("age")}\`.`,
		);
	});

	it("reads the first of two columns with one ImportId, and says so of the second", () => {
		const e = exportMap(
			exportOf().replace(id({ ImportId: "QID9_DO" }), id({ ImportId: "QID1" })),
			MAP,
			TICKED,
		);
		expect(e.findings.map((f) => [f.code, f.column])).toEqual([
			["responses-import-id", "QID9_DO"],
		]);
		expect(e.map?.columns[0]).toEqual({ column: 4, variable: v("tenure") });
	});

	it("reads a select-all column only where the DDI says what a tick is", () => {
		const e = exportMap(exportOf(), MAP, new Map());
		expect(
			e.findings.filter((f) => f.code === "responses-unknown-variable").length,
		).toBe(4);
	});
});

describe("columnMapOf", () => {
	it("reads the map `build` writes, and nothing else", () => {
		expect(columnMapOf(JSON.parse(JSON.stringify(MAP)))).toEqual(MAP);
		expect(columnMapOf({ columns: [{ importId: "QID1" }] })).toBeUndefined();
		expect(
			columnMapOf({
				columns: [{ importId: "QID1", variable: "v", rounds: 0 }],
			}),
		).toBeUndefined();
	});
});
