/**
 * The example instrument: the written one in the example bank, with nothing to fill in,
 * and none at all in a bank it doesn't read in.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeValidator } from "../ddi/validate.ts";
import { bankOf } from "../evaluate.ts";
import { exampleInstrument } from "../instrument/example.ts";
import { instrumentOf } from "../instrument/instrument.ts";
import { parseInstrument } from "../instrument/parse.ts";
import { readBank } from "./index.ts";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

/** Its holes and errors in `bank`: none, for an example. */
const wrong = (text: string, bank: ReturnType<typeof bankOf>) =>
	parseInstrument(text, { bank })
		.findings.filter((f) => f.severity === "hole" || f.severity === "error")
		.map((f) => f.message);

describe("the example instrument", async () => {
	const example = bankOf(await readBank(here("../../fixtures/bank")));
	const households = bankOf(await readBank(here("../../fixtures/households")));

	// This is what keeps the written text and the template's bank together: a mismatch
	// would only show as the example no longer being offered.
	it("reads in the example bank with nothing to fill in, named and pointed at it", () => {
		const text = exampleInstrument("demo", "../banks/example", example) ?? "";
		expect(text).toMatch(/^name: demo$/m);
		expect(text).toContain("uses:\n  bank: ../banks/example\n");
		expect(text).toContain("rating: label(bank.service_satisfaction)");
		expect(text).toContain(
			"  - roster: members\n    count: bank.household_size",
		);
		expect(text).toContain("      - if: dissatisfied");
		expect(wrong(text, example)).toEqual([]);
	});

	it("exports as DDI the official schema accepts, with nothing but advice to say", async () => {
		const validator = makeValidator(
			JSON.parse(
				await readFile(
					new URL(import.meta.resolve("@qretools/core/schema.json")),
					"utf8",
				),
			),
		);
		if (!validator.ok) throw new Error(validator.error.message);
		const instrument = instrumentOf(
			exampleInstrument("demo", "../banks/example", example) ?? "",
			{ banks: { bank: example }, agency: "org.example" },
		);
		expect(instrument.findings.filter((f) => f.severity !== "info")).toEqual(
			[],
		);
		expect(validator.value(instrument.ddi)).toEqual([]);
	});

	it("is not made in a bank it doesn't read in", () => {
		expect(exampleInstrument("demo", "../", households)).toBeUndefined();
		const empty = bankOf({ "bank.yaml": "agency: org.example\n" });
		expect(exampleInstrument("demo", "../", empty)).toBeUndefined();
	});
});
