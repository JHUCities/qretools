import type { DdiDocument } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { type Column, exportedCodes } from "./columns.ts";
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
		// Measured in Qualtrics, 2026-11-12 (CSV and JSON exports): `parseFloat`, and a
		// code that isn't a number is its position.
		[
			["a", "b", "DK"],
			["1", "2", "3"],
		],
		[
			["-0", "1.5", "+1"],
			["0", "1.5", "1"],
		],
		[
			["1.50", "opt1", "010"],
			["1.5", "2", "10"],
		],
		[
			["00", "-01", ".5", "5."],
			["0", "-1", "0.5", "5"],
		],
		[
			["1e2", "1e-1", " 1"],
			["100", "0.1", "1"],
		],
		[["1E2"], ["100"]],
		[["1 "], ["1"]],
		[["0x10"], ["0"]],
		[["1,5"], ["1"]],
		[
			["NaN", "\u0661"],
			["1", "2"],
		],
		[["12345678901234567890"], ["12345678901234567000"]],
		[["0.1000000000000000055511151231257827"], ["0.1"]],
		// Qualtrics writes nothing for a code that reads as infinity: the answer is lost.
		[
			["Infinity", "-Infinity", "1e999", "2"],
			[undefined, undefined, undefined, "2"],
		],
		// Two options written the same: neither is read.
		[
			["+1", "1", "2"],
			[undefined, undefined, "2"],
		],
		[
			["1.50", "1.5", "2"],
			[undefined, undefined, "2"],
		],
		[
			["-0", "0", "2"],
			[undefined, undefined, "2"],
		],
		[
			["1e2", "100", "2"],
			[undefined, undefined, "2"],
		],
		[
			["2", "opt1", "9"],
			[undefined, undefined, "9"],
		],
	])("gives codes %j the exported forms %j", (codes, suffixes) => {
		expect(exportedCodes(codes)).toEqual(suffixes);
	});

	it("says so when it can't tell a select-all option's column", () => {
		const { instrument } = readInstrument(ddiOf(src("  - ask: bas.trips\n")));
		const [ask] = instrument.flow;
		if (ask?.kind !== "ask" || ask.question.domain.kind !== "choice")
			throw new Error("a choice first");
		const domain = ask.question.domain;
		// A code no measured form covers.
		const choices = domain.choices.map((c) =>
			c.code === "2" ? { ...c, code: "Infinity" } : c,
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
			"The QSF column map can't tell which column records option `Infinity` of `trips`: Qualtrics gives it no name, or the same name as another option.",
		]);
	});

	/** The map and its warnings for `bas.consent` (select one) asked with `codes`. */
	const selectOne = (codes: readonly string[]) => {
		const { instrument } = readInstrument(ddiOf(src("  - ask: bas.consent\n")));
		const [ask] = instrument.flow;
		if (ask?.kind !== "ask" || ask.question.domain.kind !== "choice")
			throw new Error("a choice first");
		const domain = ask.question.domain;
		const choices = codes.map((code, i) => ({
			...domain.choices[0],
			code,
			label: `option ${i}`,
		}));
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
		return {
			column: columns.columns[0],
			unmapped: findings
				.filter((f) => f.code === "qsf-unmapped")
				.map((f) => f.message),
		};
	};

	it("gives a single-choice question's exported values, as Qualtrics drops leading zeros", () => {
		const { column, unmapped } = selectOne(["010", "02", "3"]);
		expect(column?.values).toEqual({ "10": "010", "2": "02", "3": "3" });
		expect(unmapped).toEqual([]);
	});

	it("reads neither of two single-choice codes Qualtrics exports the same", () => {
		const { column, unmapped } = selectOne(["1", "01", "2"]);
		expect(column?.values).toEqual({ "2": "2" });
		expect(unmapped).toEqual([
			"The QSF column map can't read options `1`, `01` of `consent`: Qualtrics writes no value for each, or the same value as for another option.",
		]);
	});

	it("gives no values for a single-choice question whose codes export as written", () => {
		const { column, unmapped } = selectOne(["1", "2", "9"]);
		expect(column).toBeDefined();
		expect(column?.values).toBeUndefined();
		expect(unmapped).toEqual([]);
	});

	it("reads a single-choice code of letters by its position", () => {
		const { column, unmapped } = selectOne(["a", "b", "DK"]);
		expect(column?.values).toEqual({ "1": "a", "2": "b", "3": "DK" });
		expect(unmapped).toEqual([]);
	});

	it("reads no single-choice code Qualtrics writes nothing for", () => {
		const { column, unmapped } = selectOne(["1", "Infinity"]);
		expect(column?.values).toEqual({ "1": "1" });
		expect(unmapped).toEqual([
			"The QSF column map can't read option `Infinity` of `consent`: Qualtrics writes no value for it, or the same value as for another option.",
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
