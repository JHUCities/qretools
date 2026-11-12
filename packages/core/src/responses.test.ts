import { describe, expect, it } from "vitest";
import {
	answersCsv,
	type DataMap,
	dataFileMap,
	dataMapOf,
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
			respondent: "id",
			values: { "-98": "D", "-100": null },
			columns: [{ column: "happy", variable: "urn:happy", values: { x: "1" } }],
		};
		expect(dataMapOf(json)).toEqual(json);
		// A key JSON can hold is kept as data, never as the object's prototype.
		const proto = dataMapOf(
			JSON.parse('{"respondent":"id","columns":[],"values":{"__proto__":"D"}}'),
		);
		expect(proto?.values && Object.hasOwn(proto.values, "__proto__")).toBe(
			true,
		);
		for (const bad of [
			null,
			[],
			{ ...json, respondent: 1 },
			{ ...json, columns: {} },
			{ ...json, values: { "-98": 1 } },
			{ ...json, columns: [{ column: "happy" }] },
			{ ...json, columns: [...json.columns, ...json.columns] },
		])
			expect(dataMapOf(bad)).toBeUndefined();
	});
});

describe("dataFileMap", () => {
	const MAP: DataMap = {
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
			const made = dataFileMap(text, MAP);
			expect(made.map).toBeUndefined();
			expect(made.findings.map((f) => f.code)).toEqual([
				"responses-unreadable",
			]);
		}
	});
});
