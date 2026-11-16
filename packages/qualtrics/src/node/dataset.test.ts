import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	bankOf,
	csvView,
	datasetOf,
	ddiIndexOf,
	instrumentOf,
	type Representation,
	readDataset,
	readResponses,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { describe, expect, it } from "vitest";
import { qsfOf } from "../qsf.ts";
import { exportMap } from "../responses.ts";
import { exportOfSurvey } from "../testing.ts";

const root = fileURLToPath(
	new URL("../../../core/fixtures/households", import.meta.url),
);
const ddi = instrumentOf(
	await readFile(`${root}/instruments/households.yaml`, "utf8"),
	{ banks: { hh: bankOf(await readWorkspace(root)) }, agency: "org.example" },
).ddi;
const v = (name: string) =>
	`urn:ddi:org.example:instrument-households.var-${name}:1`;
const codes = (...cs: string[]): Representation => ({
	kind: "codes",
	codes: cs,
});
// Written here: the CLI derives them from the DDI (`representationsOf`, private to cli.ts). No missing codes: every value is valid.
const number: Representation = { kind: "number", missing: [] };
const REPRESENTATIONS = new Map<string, Representation>([
	[v("county"), codes("1", "2")],
	[v("consent"), codes("1", "2")],
	[v("size"), number],
	[v("age"), number],
	[v("works"), codes("1", "2")],
	[v("tenure"), codes("1", "2")],
	[v("rent"), number],
	[v("utilities"), codes("1", "2")],
	[v("vehicle"), codes("1", "2", "3")],
	[v("more_vehicles"), codes("1", "2")],
	[v("comments"), { kind: "text" }],
]);
/**
 * One household's answers, by the export's ImportId: two members (rounds 1 and 2 of the
 * Loop & Merge) and two vehicles (the unrolled rows 1 and 2). Every value differs from
 * its row's other, and the rounds and rows not asked are blank.
 */
const ANSWERS: Readonly<Record<string, string>> = {
	county: "2",
	QID2: "1",
	QID4_TEXT: "2",
	"1_QID6_TEXT": "41",
	"2_QID6_TEXT": "7",
	"1_QID7": "1",
	"2_QID7": "2",
	QID8: "1",
	QID12: "2",
	QID13: "1",
	QID14: "3",
	QID15: "2",
	QID40_TEXT: "none",
	endDate: "2026-01-01 00:10:00",
};

describe("a dataset made from a Qualtrics export of a survey with rosters", () => {
	it("holds each round and row an export gives, in its roster's record", () => {
		const made = qsfOf(ddi, {
			name: "households",
			created: "2026-11-12 00:00:00",
		});
		if (made.kind !== "made") throw new Error("the survey isn't made");
		const text = exportOfSurvey(made, {
			value: (id) => ANSWERS[id] ?? "",
			extra: [["EndDate", "End Date", { ImportId: "endDate", timeZone: "Z" }]],
		});
		// The looped form this test reads (`<round>_<ImportId>`) is pinned here, not derived.
		expect(text.split("\r\n")[2]).toContain('{""ImportId"":""2_QID6_TEXT""}');
		const e = exportMap(text, made.columns, new Map());
		if (e.map === undefined) throw new Error("the export isn't read");
		// No `qretools_*` stamps: what they'd say isn't this test's.
		expect(e.findings.filter((f) => f.code !== "responses-provenance")).toEqual(
			[],
		);
		const r = readResponses(e.header, e.rows, e.map, REPRESENTATIONS);
		expect(r.findings).toEqual([]);
		expect(r.respondents).toHaveLength(1);
		const file = { name: "f", sha256: "0".repeat(64), size: 1 };
		const dataset = datasetOf(
			{
				name: "hh",
				agency: "org.example",
				respondents: r.respondents,
				answers: r.answers,
			},
			{
				index: ddiIndexOf(ddi),
				facts: { asked_by: "Simulation", answered_by: "Other" },
				reads: [],
				fingerprint: "0".repeat(64),
				source: file,
				map: file,
				ddi: file,
				claimed: [],
			},
		);
		if (!dataset.ok) throw new Error(dataset.error);
		expect(Object.keys(dataset.value.DataSet ?? {})).toEqual([
			"org.example:dataset-hh:1",
			"org.example:dataset-hh.rows-members:1",
			"org.example:dataset-hh.rows-vehicles:1",
		]);
		const back = readDataset(JSON.parse(JSON.stringify(dataset.value)));
		if (!back.ok) throw new Error(back.error);
		expect(csvView(back.value).split("\n")).toEqual([
			"respondent,variable,row,value",
			`R_1,${v("age")},1,41`,
			`R_1,${v("age")},2,7`,
			`R_1,${v("comments")},,none`,
			`R_1,${v("consent")},,1`,
			`R_1,${v("county")},,2`,
			`R_1,${v("more_vehicles")},1,1`,
			`R_1,${v("more_vehicles")},2,2`,
			`R_1,${v("size")},,2`,
			`R_1,${v("tenure")},,1`,
			`R_1,${v("vehicle")},1,2`,
			`R_1,${v("vehicle")},2,3`,
			`R_1,${v("works")},1,1`,
			`R_1,${v("works")},2,2`,
			"",
		]);
	});
});
