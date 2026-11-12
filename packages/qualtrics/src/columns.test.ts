import type { DdiDocument } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { type Column, choiceSuffixes } from "./columns.ts";
import { readInstrument } from "./read.ts";
import { ddiOf } from "./testing.ts";
import { writeQsf } from "./write.ts";

const OPTIONS = { name: "t", created: "2026-11-12 00:00:00" };
const write = (ddi: DdiDocument) =>
	writeQsf(readInstrument(ddi).instrument, OPTIONS);
/** A column as `importId[choice] @row ×rounds -> variable`, the variable by its ID. */
const shown = (c: Column) =>
	`${c.importId}${c.choice === undefined ? "" : `[${c.choice}]`}${c.row === undefined ? "" : ` @${c.row}`}${c.rounds === undefined ? "" : ` x${c.rounds}`} -> ${c.variable.split(":")[3]}`;
const src = (flow: string) => `name: t\nuses:\n  bas: here\nflow:\n${flow}`;

describe("the column map", () => {
	it("names a select-all option whose code is letters by its position", () => {
		const { columns } = write(ddiOf(src("  - ask: bas.modes\n")));
		expect(columns.columns.map(shown)).toEqual([
			"QID1[1] -> instrument-t.var-modes_b",
			"QID1[2] -> instrument-t.var-modes_w",
		]);
	});

	it("names a select-all option whose code is a number by that number", () => {
		const { columns } = write(ddiOf(src("  - ask: bas.trips\n")));
		expect(columns.columns.map(shown)).toEqual([
			"QID1[1] -> instrument-t.var-trips_1",
			"QID1[2] -> instrument-t.var-trips_2",
			"QID1[3] -> instrument-t.var-trips_3",
			"QID1[9] -> instrument-t.var-trips_9",
		]);
	});

	// As experiment 13 measured; anything else, or a suffix two options share, is unnamed.
	it.each([
		[
			["0", "1", "2"],
			["0", "1", "2"],
		],
		[
			["-1", "1", "2"],
			["-1", "1", "2"],
		],
		[
			["010", "01", "3"],
			["10", "1", "3"],
		],
		[
			["1.5", "2", "3"],
			["1.5", "2", "3"],
		],
		[
			["100", "1", "2"],
			["100", "1", "2"],
		],
		[
			["1", "b", "3"],
			["1", "2", "3"],
		],
		[
			["2", "b", "9"],
			[undefined, undefined, "9"],
		],
		[
			["1", "01", "2"],
			[undefined, undefined, "2"],
		],
		[
			[
				"-0",
				"1.50",
				"+1",
				"1e2",
				" 1",
				"opt1",
				"00",
				"0.5",
				"1234567890123456",
			],
			Array(9).fill(undefined),
		],
	])("gives codes %j the column suffixes %j", (codes, suffixes) => {
		expect(choiceSuffixes(codes)).toEqual(suffixes);
	});

	it("says so when it can't tell a select-all option's column", () => {
		const { instrument } = readInstrument(ddiOf(src("  - ask: bas.trips\n")));
		const [ask] = instrument.flow;
		if (ask?.kind !== "ask" || ask.question.domain.kind !== "choice")
			throw new Error("a choice first");
		const domain = ask.question.domain;
		// A code no measured form covers.
		const choices = domain.choices.map((c) =>
			c.code === "2" ? { ...c, code: "1.0" } : c,
		);
		const { columns, findings } = writeQsf(
			{
				...instrument,
				flow: [
					{
						...ask,
						question: { ...ask.question, domain: { ...domain, choices } },
					},
				],
			},
			OPTIONS,
		);
		expect(columns.columns.map(shown)).toEqual([
			"QID1[1] -> instrument-t.var-trips_1",
			"QID1[3] -> instrument-t.var-trips_3",
			"QID1[9] -> instrument-t.var-trips_9",
		]);
		expect(
			findings.filter((f) => f.code === "qsf-unmapped").map((f) => f.message),
		).toEqual([
			"The QSF column map can't tell which column records option `1.0` of `trips`: Qualtrics' name for it isn't known for this code.",
		]);
	});

	it("says so when a select-all option records no variable", () => {
		const { instrument } = readInstrument(ddiOf(src("  - ask: bas.modes\n")));
		const [ask] = instrument.flow;
		if (ask?.kind !== "ask") throw new Error("an ask first");
		const { columns, findings } = writeQsf(
			{ ...instrument, flow: [{ ...ask, records: ask.records.slice(0, 1) }] },
			OPTIONS,
		);
		expect(columns.columns.map(shown)).toEqual([
			"QID1[1] -> instrument-t.var-modes_b",
		]);
		expect(
			findings.filter((f) => f.code === "qsf-unmapped").map((f) => f.message),
		).toEqual([
			"The QSF column map can't name the DDI variable for option `w` of `modes`.",
		]);
	});

	it("gives a value computed in a written-out roster a column for each row", () => {
		const { columns, findings } = write(
			ddiOf(
				src(`  - roster: rents
    more: bas.more = "1"
    max: 2
    flow:
      - ask: bas.rent
      - compute: total
        value: bas.rent + 1
      - ask: bas.more
`),
			),
		);
		expect(findings.filter((f) => f.code === "qsf-unmapped")).toEqual([]);
		expect(
			columns.columns.filter((c) => c.importId.endsWith("total")).map(shown),
		).toEqual([
			"1_total @1 -> instrument-t.var-total",
			"2_total @2 -> instrument-t.var-total",
		]);
	});

	it("gives two exclusive asks of one variable a column each, for the same variable", () => {
		const { columns } = write(
			ddiOf(
				src(`  - ask: bas.consent
  - if: bas.consent = "1"
    then:
      - ask: bas.why
    else:
      - ask: bas.why
`),
			),
		);
		expect(columns.columns.map(shown)).toEqual([
			"QID1 -> instrument-t.var-consent",
			"QID2_TEXT -> instrument-t.var-why",
			"QID3_TEXT -> instrument-t.var-why",
		]);
	});

	it("says which column it can't name a variable for, rather than leave it out unsaid", () => {
		// DDI from before computed values had Variables: the compute's column has none.
		const ddi = ddiOf(
			src(`  - ask: bas.rent
  - compute: total
    value: bas.rent + 1
`),
		);
		const older = Object.fromEntries(
			Object.entries(ddi).flatMap(([type, items]) =>
				type === "GenerationInstruction"
					? []
					: type === "Variable"
						? [
								[
									type,
									Object.fromEntries(
										Object.entries(items as object).filter(
											([key]) => !key.includes(".var-total:"),
										),
									),
								],
							]
						: [[type, items]],
			),
		) as DdiDocument;
		const { columns, findings } = write(older);
		expect(columns.columns.map(shown)).toEqual([
			"QID1_TEXT -> instrument-t.var-rent",
		]);
		expect(
			findings
				.filter((f) => f.code === "qsf-unmapped")
				.map((f) => `${f.severity}: ${f.message}`),
		).toEqual([
			"warning: The QSF column map can't name the DDI variable of the computed value `total`.",
		]);
	});

	it("heads the map with what the survey's own provenance fields say", () => {
		const { columns } = writeQsf(
			readInstrument(ddiOf(src("  - ask: bas.why\n"))).instrument,
			{ ...OPTIONS, version: "9.9.9", digest: "sha256:abc" },
		);
		expect(columns).toMatchObject({
			qretools: "9.9.9",
			instrument: "urn:ddi:org.example:instrument-t:1",
			ddi: "sha256:abc",
		});
	});
});
