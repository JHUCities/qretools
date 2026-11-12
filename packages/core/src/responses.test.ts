import { describe, expect, it } from "vitest";
import {
	answersCsv,
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
});
