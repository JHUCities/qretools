import { describe, expect, it } from "vitest";
import {
	answersCsv,
	type DataMap,
	dataFileMap,
	dataMapOf,
	metadataRepresentation,
	metadataUrn,
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
			source: "survey",
			answered_by: "ResearchData.Published",
			citation: { title: "Survey 2010, release 2", url: "https://example.org" },
			respondent: "id",
			values: { "-98": "D", "-100": null },
			columns: [{ column: "happy", variable: "urn:happy", values: { x: "1" } }],
		};
		expect(dataMapOf(json)).toEqual(json);
		// A key JSON can hold is kept as data, never as the object's prototype.
		const proto = dataMapOf(
			JSON.parse(
				'{"source":"s","answered_by":"x","respondent":"id","columns":[],"values":{"__proto__":"D"}}',
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
			{ ...json, answered_by: undefined },
			{ ...json, answered_by: { other: "" } },
			{ ...json, citation: { url: "https://example.org" } },
			{ ...json, citation: { title: "t", year: 2010 } },
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
			"",
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
			const made = dataFileMap(text, MAP, "");
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
			answered_by: "ResearchData.Published",
			respondent: "id",
			columns: [
				{ column: "happy", variable: "urn:happy", filtered: true },
				{ column: "gone", variable: "urn:note", filtered: true },
				{ column: "age", variable: "urn:age", censored: { "6": "6 or more" } },
			],
		});
		if (map === undefined) throw new Error("the map isn't read");
		const made = dataFileMap("id,happy,age\na,1,6\n", map, "");
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
					answered_by: "ResearchData.Published",
					respondent: "id",
					columns: [{ column: "age", variable: "urn:age", ...bad }],
				}),
			).toBeUndefined();
	});
});

describe("metadata columns", () => {
	const INSTRUMENT = "urn:ddi:org.example:instrument-wave1:3";
	const json = {
		source: "survey",
		ddi: "sha256:0",
		answered_by: "ResearchData.Published",
		respondent: "id",
		values: { "-98": "D" },
		columns: [{ column: "happy", variable: "urn:happy" }],
		metadata: [
			{
				column: "mode",
				// A code that is no mode names none.
				codes: { "1": "In person", "2": "By phone", "9": "Not recorded" },
				modes: { "1": "Interview.FaceToFace", "2": "Interview.Telephone" },
			},
			{ column: "wt", number: true, weight: true, values: { "-1": null } },
		],
		weighting: {
			advice: "Use wt.",
			source: { title: "Codebook" },
			read: "2026-11-12",
		},
	};

	it("reads a map's metadata, and refuses metadata it can't give a variable", () => {
		expect(dataMapOf(json)).toEqual(json);
		const meta = (m: object) => ({
			...json,
			metadata: [...json.metadata, m],
		});
		for (const bad of [
			meta({ column: "phase" }),
			meta({ column: "phase", codes: { "1": "x" }, number: true }),
			meta({ column: "phase", codes: { "1": "x" }, modes: { "2": "y" } }),
			meta({ column: "phase", codes: { "1": "x" }, modes: { "1": "y" } }),
			meta({ column: "phase", codes: { "1": "x" }, weight: true }),
			meta({ column: "a.b", number: true }),
			meta({ column: "happy", number: true }),
			meta({ column: "id", number: true }),
			meta({ column: "phase", number: true, extra: 1 }),
			{ ...json, weighting: undefined },
			{ ...json, metadata: json.metadata.slice(0, 1) },
			{ ...json, weighting: { ...json.weighting, read: "12 Nov" } },
			{ ...json, source: "a-b" },
			{ ...json, ddi: undefined },
			meta({ column: "phase", codes: { "1": "x" }, modes: {} }),
		])
			expect(dataMapOf(bad), JSON.stringify(bad)).toBeUndefined();
	});

	it("reads them into variables of their own, with their own translations only", () => {
		const map = dataMapOf(json) as DataMap;
		const made = dataFileMap(
			"id,happy,mode,wt\n1,-98,1,0.5\n2,1,-98,-1\n",
			map,
			INSTRUMENT,
		);
		const mode = metadataUrn(INSTRUMENT, "survey", "mode");
		const wt = metadataUrn(INSTRUMENT, "survey", "wt");
		expect([mode, wt]).toEqual([
			"urn:ddi:org.example:instrument-wave1-survey.mode:3",
			"urn:ddi:org.example:instrument-wave1-survey.wt:3",
		]);
		const representations = new Map<string, Representation>([
			["urn:happy", { kind: "codes", codes: ["1", "D"] }],
			...(map.metadata ?? []).map(
				(m) =>
					[
						metadataUrn(INSTRUMENT, "survey", m.column),
						metadataRepresentation(m),
					] as const,
			),
		]);
		const r = readResponses(
			made.header,
			made.rows,
			made.map as ResponseMap,
			representations,
		);
		expect(r.answers).toEqual([
			{ respondent: "1", variable: "urn:happy", value: "D" },
			{ respondent: "1", variable: mode, value: "1" },
			{ respondent: "1", variable: wt, value: "0.5" },
			{ respondent: "2", variable: "urn:happy", value: "1" },
		]);
		// The shared -98 is the instrument's "don't know": no code of `mode`.
		expect(r.findings.map((f) => [f.code, f.column])).toEqual([
			["responses-not-a-code", "mode"],
		]);
	});
});
