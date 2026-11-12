import type { DdiDocument } from "@qretools/core";
import { describe, expect, it } from "vitest";
import type { Column } from "./columns.ts";
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
	it("gives a select-all option its position, never its code", () => {
		const { columns } = write(ddiOf(src("  - ask: bas.modes\n")));
		expect(columns.columns.map(shown)).toEqual([
			"QID1[1] -> instrument-t.var-modes_b",
			"QID1[2] -> instrument-t.var-modes_w",
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
			"The column map can't name the DDI variable for option `w` of `modes`.",
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
			"warning: The column map can't name the DDI variable of the computed value `total`.",
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
