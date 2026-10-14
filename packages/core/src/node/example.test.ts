/**
 * The example instrument: the written one beside the example questions, with nothing to
 * fill in, and none at all in a bank it doesn't read in.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HERE } from "../address.ts";
import { makeValidator } from "../ddi/validate.ts";
import { bankOf } from "../evaluate.ts";
import { exampleInstrument } from "../instrument/example.ts";
import { instrumentOf } from "../instrument/instrument.ts";
import { parseInstrument } from "../instrument/parse.ts";
import { workspaceOf } from "../workspace.ts";
import { readWorkspace } from "./index.ts";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

/** Its holes and errors in `bank`: none, for an example. */
const wrong = (text: string, bank: ReturnType<typeof bankOf>) =>
	parseInstrument(text, { example: bank })
		.findings.filter((f) => f.severity === "hole" || f.severity === "error")
		.map((f) => f.message);

describe("the example instrument", async () => {
	const example = bankOf(await readWorkspace(here("../../fixtures/bank")));
	const households = bankOf(
		await readWorkspace(here("../../fixtures/households")),
	);

	// This is what keeps the written text and the template's bank together: a mismatch
	// would only show as the example no longer being offered.
	it("reads beside the example questions with nothing to fill in, named and pointed at its workspace", () => {
		const text = exampleInstrument("demo", HERE, example) ?? "";
		expect(text).toMatch(/^name: demo$/m);
		expect(text).toContain("uses:\n  example: ../\n");
		expect(text).toContain("rating: label(example.service_satisfaction)");
		expect(text).toContain(
			"  - roster: members\n    count: example.household_size",
		);
		expect(text).toContain("      - if: dissatisfied");
		expect(wrong(text, example)).toEqual([]);
	});

	it("reads in a workspace whose example questions are in questions/example/", async () => {
		const files = await readWorkspace(here("../../fixtures/bank"));
		const asked = [
			...(exampleInstrument("demo", HERE, example) ?? "").matchAll(
				/\bexample\.(\w+)/g,
			),
		].map((m) => m[1]);
		// Every question it names is one of that folder's, and no other folder has any.
		const names = Object.keys(files)
			.filter((p) => p.startsWith("questions/"))
			.map((p) => p.match(/^questions\/example\/(\w+)\.yaml$/)?.[1]);
		expect(names).not.toContain(undefined);
		expect(asked).toEqual(expect.arrayContaining(names));
		const read = workspaceOf({
			...files,
			"workspace.yaml": "agency: org.example\n",
			"instruments/demo.yaml": exampleInstrument("demo", HERE, example) ?? "",
		}).instruments["instruments/demo.yaml"];
		expect(read?.uses).toEqual({ example: { kind: "local" } });
		expect(
			read?.instrument.findings.filter(
				(f) => f.severity === "hole" || f.severity === "error",
			),
		).toEqual([]);
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
			exampleInstrument("demo", HERE, example) ?? "",
			{ banks: { example }, agency: "org.example" },
		);
		expect(instrument.findings.filter((f) => f.severity !== "info")).toEqual(
			[],
		);
		expect(validator.value(instrument.ddi)).toEqual([]);
	});

	it("is not made in a bank it doesn't read in", () => {
		expect(exampleInstrument("demo", HERE, households)).toBeUndefined();
		const empty = bankOf({ "workspace.yaml": "agency: org.example\n" });
		expect(exampleInstrument("demo", HERE, empty)).toBeUndefined();
	});
});
