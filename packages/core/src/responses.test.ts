import { describe, expect, it } from "vitest";
import {
	answersCsv,
	type DataMap,
	dataFileMap,
	dataMapOf,
	dateOf,
	metadataRepresentation,
	parseCsv,
	type Representation,
	type ResponseMap,
	readResponses,
} from "./responses.ts";

const REPRESENTATIONS = new Map<string, Representation>([
	["urn:happy", { kind: "codes", codes: ["1", "2", "D"] }],
	["urn:age", { kind: "number", missing: ["D"] }],
	["urn:note", { kind: "text" }],
	["urn:tick", { kind: "codes", codes: ["0", "1"] }],
]);
const HEADER = ["id", "happy", "age", "note", "tick"];
// A data file's own codes: -98 is its "don't know", which the workspace writes `D`.
const MAP: ResponseMap = {
	respondent: 0,
	columns: [
		{ column: 1, variable: "urn:happy", values: { "-98": "D" } },
		{ column: 2, variable: "urn:age", values: { "-98": "D" } },
		{ column: 3, variable: "urn:note" },
		{ column: 4, variable: "urn:tick", values: { x: "1" }, only: true },
	],
};
const meta = (column: string) => `urn:meta:${column}`;
const rows = (...r: string[][]) =>
	r.map((cells, i) => ({ line: i + 2, cells }));

describe("readResponses", () => {
	it("translates what the map says, keeps the rest as written, and leaves a blank cell unanswered", () => {
		const r = readResponses(
			HEADER,
			rows(["a", "-98", "41.5", "hi, there", "x"], ["b", "2", "-98", "", ""]),
			MAP,
			REPRESENTATIONS,
		);
		expect(r.findings).toEqual([]);
		expect(r.answers).toEqual([
			{ respondent: "a", variable: "urn:happy", value: "D" },
			{ respondent: "a", variable: "urn:age", value: "41.5" },
			{ respondent: "a", variable: "urn:note", value: "hi, there" },
			{ respondent: "a", variable: "urn:tick", value: "1" },
			{ respondent: "b", variable: "urn:happy", value: "2" },
			{ respondent: "b", variable: "urn:age", value: "D" },
		]);
		expect(answersCsv(r.answers).split("\n").slice(0, 4)).toEqual([
			"respondent,variable,row,value",
			"a,urn:happy,,D",
			"a,urn:age,,41.5",
			'a,urn:note,,"hi, there"',
		]);
	});

	it("writes no value it can't hold, and says so once per column with a count, never with the value", () => {
		const r = readResponses(
			HEADER,
			rows(
				["a", "7", "old", "", "1"],
				["b", "8", "", "", ""],
				["a", "1", "", "", ""],
				["", "1", "", "", ""],
			),
			{
				...MAP,
				columns: [
					...MAP.columns,
					{ column: 1, variable: "urn:gone" },
					{ column: 3, variable: "urn:happy" },
				],
			},
			REPRESENTATIONS,
		);
		expect(r.answers).toEqual([]);
		expect(r.findings.map((f) => [f.code, f.line, f.column, f.count])).toEqual([
			["responses-unknown-variable", undefined, "happy", 1],
			["responses-not-a-code", 2, "happy", 2],
			["responses-not-a-code", 2, "age", 1],
			["responses-not-a-tick", 2, "tick", 1],
			["responses-respondent", 4, "id", 2],
		]);
		for (const value of ["7", "8", "old"])
			expect(r.findings.map((f) => f.message).join(" ")).not.toContain(
				`\`${value}\``,
			);
	});

	it("keeps rows apart, and reads one variable once per respondent and row", () => {
		const r = readResponses(
			["id", "a1", "a2", "again"],
			rows(["a", "3", "4", "5"]),
			{
				respondent: 0,
				columns: [
					{ column: 1, variable: "urn:age", row: 1 },
					{ column: 2, variable: "urn:age", row: 2 },
					{ column: 3, variable: "urn:age", row: 2 },
				],
			},
			REPRESENTATIONS,
		);
		expect(r.answers.map((a) => `${a.row}=${a.value}`)).toEqual(["1=3", "2=4"]);
		expect(r.findings.map((f) => f.code)).toEqual(["responses-duplicate"]);
	});

	it("reads no row whose cells don't line up with the header", () => {
		const r = readResponses(HEADER, rows(["a", "1"]), MAP, REPRESENTATIONS);
		expect(r.answers).toEqual([]);
		expect(r.findings.map((f) => [f.code, f.line])).toEqual([
			["responses-row", 2],
		]);
	});

	it("reads a translation to null as no answer, and only the map's own keys as translations", () => {
		const r = readResponses(
			HEADER,
			rows(["a", "-100", "toString", "constructor", ""]),
			{
				respondent: 0,
				columns: [
					{ column: 1, variable: "urn:happy", values: { "-100": null } },
					{ column: 2, variable: "urn:age", values: {} },
					{ column: 3, variable: "urn:note", values: {} },
				],
			},
			REPRESENTATIONS,
		);
		expect(r.answers).toEqual([
			{ respondent: "a", variable: "urn:note", value: "constructor" },
		]);
		expect(r.findings.map((f) => [f.code, f.column])).toEqual([
			["responses-not-a-code", "age"],
		]);
	});

	it("reads a number only within the range the DDI gives", () => {
		const range = new Map<string, Representation>([
			["urn:age", { kind: "number", missing: ["D"], min: 0, max: 120 }],
		]);
		const r = readResponses(
			["id", "age"],
			rows(["a", "0"], ["b", "120"], ["c", "-98"], ["d", "121"], ["e", "D"]),
			{ respondent: 0, columns: [{ column: 1, variable: "urn:age" }] },
			range,
		);
		expect(r.answers.map((a) => a.value)).toEqual(["0", "120", "D"]);
		expect(r.findings.map((f) => [f.code, f.line, f.count])).toEqual([
			["responses-not-a-code", 4, 2],
		]);
	});
});

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

describe("dataMapOf", () => {
	it("reads a map, and refuses one that isn't", () => {
		const json = {
			ddi: "sha256:0",
			source: "survey",
			answered_by: "ResearchData.Published",
			respondent: "id",
			values: { "-98": "D", "-100": null },
			columns: [{ column: "happy", variable: "urn:happy", values: { x: "1" } }],
		};
		expect(dataMapOf(json)).toEqual(json);
		// A key JSON can hold is kept as data, never as the object's prototype.
		const proto = dataMapOf(
			JSON.parse(
				'{"source":"s","answered_by":"Other","respondent":"id","columns":[],"values":{"__proto__":"D"}}',
			),
		);
		expect(proto?.values && Object.hasOwn(proto.values, "__proto__")).toBe(
			true,
		);
		for (const bad of [
			null,
			[],
			{ ...json, respondent: 1 },
			{ ...json, source: undefined },
			{ ...json, columns: {} },
			{ ...json, values: { "-98": 1 } },
			{ ...json, columns: [{ column: "happy" }] },
			{ ...json, columns: [...json.columns, ...json.columns] },
			// Who answered is a fact of the source: its map says it.
			{ ...json, answered_by: undefined },
			{ ...json, answered_by: { other: "" } },
			{ ...json, citation: { publisher: "P" } },
		])
			expect(dataMapOf(bad)).toBeUndefined();
	});
});

describe("dataFileMap", () => {
	const MAP: DataMap = {
		source: "survey",
		answered_by: "ResearchData.Published",
		respondent: "id",
		values: { "-98": "D", "-100": null },
		columns: [
			{ column: "happy", variable: "urn:happy", values: { "-98": "1" } },
			{ column: "age", variable: "urn:age" },
			{ column: "gone", variable: "urn:note" },
			{ column: "twice", variable: "urn:note" },
		],
	};

	it("matches columns by header, puts a column's own translations over the map's, and says what it can't place", () => {
		const made = dataFileMap(
			"id,age,happy,twice,twice,extra,more\n1,-100,-98,,,,\n",
			MAP,
			meta,
		);
		expect(made.map).toEqual({
			respondent: 0,
			columns: [
				{
					column: 2,
					variable: "urn:happy",
					values: { "-98": "1", "-100": null },
				},
				{
					column: 1,
					variable: "urn:age",
					values: { "-98": "D", "-100": null },
				},
			],
		});
		expect(made.findings.map((f) => [f.code, f.column, f.count])).toEqual([
			["responses-header", "twice", 1],
			["responses-missing-column", undefined, 1],
			["responses-unmapped-column", "extra", 1],
		]);
		expect(made.rows).toEqual([
			{ line: 2, cells: ["1", "-100", "-98", "", "", "", ""] },
		]);
	});

	it("reads nothing without one respondent column, or a header", () => {
		for (const text of ["happy\n1\n", "id,id\n1,1\n", ""]) {
			const made = dataFileMap(text, MAP, meta);
			expect(made.map).toBeUndefined();
			expect(made.findings.map((f) => f.code)).toEqual([
				"responses-unreadable",
			]);
		}
	});
});

describe("filtered and censored columns", () => {
	it("reads no value that stands for a range, with one note per column, and every other value", () => {
		const r = readResponses(
			["id", "age"],
			rows(["a", "17"], ["b", "30"], ["c", "45"], ["d", "45"]),
			{
				respondent: 0,
				columns: [
					{
						column: 1,
						variable: "urn:age",
						censored: { "17": "17 or younger", "45": "45 or older" },
					},
				],
			},
			REPRESENTATIONS,
		);
		expect(r.answers.map((a) => a.value)).toEqual(["30"]);
		expect(r.findings).toEqual([
			{
				code: "responses-censored",
				severity: "info",
				message:
					'Its values 17 and 45 mean "17 or younger" and "45 or older", so they aren\'t read as numbers.',
				line: 2,
				column: "age",
				count: 3,
			},
		]);
	});

	it("reads nothing from a filtered column, with one note, whether or not the file has it", () => {
		const map = dataMapOf({
			source: "survey",
			answered_by: "Other",
			respondent: "id",
			columns: [
				{ column: "happy", variable: "urn:happy", filtered: true },
				{ column: "gone", variable: "urn:note", filtered: true },
				{ column: "age", variable: "urn:age", censored: { "6": "6 or more" } },
			],
		});
		if (map === undefined) throw new Error("the map isn't read");
		const made = dataFileMap("id,happy,age\na,1,6\n", map, meta);
		expect(made.map?.columns).toEqual([
			{ column: 2, variable: "urn:age", censored: { "6": "6 or more" } },
		]);
		expect(made.findings.map((f) => [f.code, f.severity, f.column])).toEqual([
			["responses-filtered", "info", "happy"],
			["responses-filtered", "info", "gone"],
		]);
		expect(made.findings[0]?.message).toBe(
			"Filtered from this source, so its values aren't read.",
		);
		for (const bad of [{ filtered: false }, { censored: { "6": null } }])
			expect(
				dataMapOf({
					source: "survey",
					answered_by: "Other",
					respondent: "id",
					columns: [{ column: "age", variable: "urn:age", ...bad }],
				}),
			).toBeUndefined();
	});
});

describe("a data file's metadata and interview date", () => {
	const BASE = {
		source: "survey",
		answered_by: "ResearchData.Published",
		citation: { title: "A release", publisher: "A publisher" },
		respondent: "id",
		columns: [{ column: "happy", variable: "urn:happy" }],
	};
	const SHIFT = {
		column: "shift",
		label: "Shift",
		role: "design",
		unit: { other: "survey organization" },
		codes: { "1": "Day", "2": "Night", "9": "Not recorded" },
		modes: { "1": "Interview.Telephone", "2": "Interview.FaceToFace" },
		values: { "-1": null },
		access: "public",
	};
	const W = { column: "w", number: true, weight: true };
	const ADVICE = {
		advice: "Use w.",
		source: { title: "A codebook", url: "https://example.org/c" },
		read: "2026-11-12",
	};

	it("reads metadata columns, weighting advice and an interview date, and refuses a map that breaks a rule", () => {
		const json = {
			...BASE,
			metadata: [SHIFT, W],
			weighting: ADVICE,
			interview_date: { column: "day", form: "MMDD", year: "yr" },
		};
		expect(dataMapOf(json)).toEqual(json);
		for (const bad of [
			// A column twice, or the respondent's, or an answer's.
			{ metadata: [W, W], weighting: ADVICE },
			{ metadata: [{ ...SHIFT, column: "id", modes: undefined }] },
			{ metadata: [{ ...SHIFT, column: "happy" }] },
			{ metadata: [{ ...SHIFT, column: "a-b" }] },
			// Codes or a number, never both or neither.
			{ metadata: [{ column: "x" }] },
			{ metadata: [{ column: "x", number: true, codes: { "1": "a" } }] },
			// A mode is one of the codes, and one column says the modes.
			{ metadata: [{ ...SHIFT, modes: { "3": "Interview" } }] },
			{ metadata: [{ ...SHIFT, modes: {} }] },
			{ metadata: [SHIFT, { ...SHIFT, column: "shift2" }] },
			// A weight is a number, and weights and advice come together.
			{
				metadata: [{ ...W, number: undefined, codes: { "1": "a" } }],
				weighting: ADVICE,
			},
			{ metadata: [W] },
			{ weighting: ADVICE },
			{ metadata: [W], weighting: { ...ADVICE, read: "12 Nov" } },
			// A year column exactly when the form has no year.
			{ interview_date: { column: "day", form: "MMDD" } },
			{ interview_date: { column: "day", form: "YYYY-MM-DD", year: "yr" } },
			{ interview_date: { column: "day", form: "DDMM" } },
		])
			expect(dataMapOf({ ...BASE, ...bad })).toBeUndefined();
	});

	it("reads a metadata column into the dataset's own variable, with its own translations only", () => {
		const map = dataMapOf({
			...BASE,
			values: { "-1": "D" },
			metadata: [SHIFT],
		});
		if (map === undefined) throw new Error("the map isn't read");
		const made = dataFileMap("id,happy,shift\na,1,-1\nb,-1,2\n", map, meta);
		expect(made.map?.columns).toEqual([
			{ column: 1, variable: "urn:happy", values: { "-1": "D" } },
			{ column: 2, variable: meta("shift"), values: { "-1": null } },
		]);
		expect(made.findings).toEqual([]);
		const shift = map.metadata?.[0];
		if (shift === undefined || made.map === undefined)
			throw new Error("no shift");
		const r = readResponses(
			made.header,
			made.rows,
			made.map,
			new Map([
				...REPRESENTATIONS,
				[meta("shift"), metadataRepresentation(shift)],
			]),
		);
		expect(r.answers.filter((a) => a.variable === meta("shift"))).toEqual([
			{ respondent: "b", variable: meta("shift"), value: "2" },
		]);
	});

	it("reads a date only where the calendar has it, and never guesses", () => {
		expect(dateOf("315", "MMDD", "2010")).toBe("2010-03-15");
		expect(dateOf("1231", "MMDD", "2010")).toBe("2010-12-31");
		// Zero-padded, as some publishers write it.
		expect(dateOf("0315", "MMDD", "2010")).toBe("2010-03-15");
		expect(dateOf("229", "MMDD", "2012")).toBe("2012-02-29");
		expect(dateOf("2010-03-15", "YYYY-MM-DD")).toBe("2010-03-15");
		for (const [cell, year] of [
			["229", "2010"],
			["1301", "2010"],
			["431", "2010"],
			["0", "2010"],
			["-1", "2010"],
			["315.0", "2010"],
			["", "2010"],
			["315", ""],
			["315", "-100"],
		])
			expect(dateOf(cell ?? "", "MMDD", year)).toBeUndefined();
		expect(dateOf("2010-02-30", "YYYY-MM-DD")).toBeUndefined();
		expect(dateOf("2010-3-15", "YYYY-MM-DD")).toBeUndefined();
	});

	it("gives each interview its date as start and end, and an unreadable one no time, with one finding", () => {
		const map = dataMapOf({
			...BASE,
			interview_date: { column: "day", form: "MMDD", year: "yr" },
		});
		if (map === undefined) throw new Error("the map isn't read");
		const made = dataFileMap(
			"id,happy,day,yr\na,1,315,2010\nb,1,-100,2010\nc,1,229,2010\n",
			map,
			meta,
		);
		expect(made.map?.date).toEqual({ column: 2, form: "MMDD", year: 3 });
		// The date's columns are read: neither is unmapped.
		expect(made.findings).toEqual([]);
		if (made.map === undefined) throw new Error("no map");
		const r = readResponses(made.header, made.rows, made.map, REPRESENTATIONS);
		expect(r.respondents).toEqual([
			{ id: "a", start: "2010-03-15", end: "2010-03-15" },
			{ id: "b" },
			{ id: "c" },
		]);
		expect(r.findings).toEqual([
			{
				code: "responses-date",
				severity: "warning",
				message:
					"This cell and the year beside it aren't a date (`MMDD`, and a year such as `2010`), so this interview has no time.",
				line: 3,
				column: "day",
				count: 2,
			},
		]);
		// A date column the file lacks gives no date, and says so.
		const lacking = dataFileMap("id,happy\na,1\n", map, meta);
		expect(lacking.map?.date).toBeUndefined();
		expect(lacking.findings.map((f) => f.code)).toEqual([
			"responses-missing-column",
		]);
	});
});
