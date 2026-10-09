/**
 * The example instrument: the written one in the template's bank, one built from the
 * bank's own questions anywhere else, and in both nothing to fill in.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bankOf } from "../evaluate.ts";
import { exampleInstrument } from "../instrument/example.ts";
import { parseInstrument } from "../instrument/parse.ts";
import { readBank } from "./index.ts";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

const CONSENT =
	'name: consent\ntext: Do you agree to take part?\nintent: Consent.\nresponses:\n  "1": Yes\n  "2": No\n';

/** Its holes and errors in `bank`: none, for an example. */
const wrong = (text: string, bank: ReturnType<typeof bankOf>) =>
	parseInstrument(text, { bank })
		.findings.filter((f) => f.severity === "hole" || f.severity === "error")
		.map((f) => f.message);

describe("the example instrument", async () => {
	const template = bankOf({
		...(await readBank(here("../../fixtures/bank"))),
		"questions/interview/consent.yaml": CONSENT,
	});
	const households = bankOf(await readBank(here("../../fixtures/households")));

	it("is the written one in the template's bank, named and pointed at it", () => {
		const text = exampleInstrument("demo", "../banks/local", template);
		expect(text).toMatch(/^name: demo$/m);
		expect(text).toContain("uses:\n  bank: ../banks/local\n");
		expect(text).toContain("ask: bank.service_satisfaction");
		expect(text).toContain('if: form = "1"');
		expect(wrong(text, template)).toEqual([]);
	});

	it("is built from the bank's own questions in any other bank, with nothing to fill in", () => {
		const text = exampleInstrument("demo", "../", households);
		expect(text).not.toContain("service_satisfaction");
		expect(text).toContain("uses:\n  bank: ../\n");
		expect(text).toMatch(/ - if: bank\.\w+ = "/);
		expect(text).toMatch(/ensure: bank\.\w+ >= \d/);
		expect(wrong(text, households)).toEqual([]);
	});

	it("is a welcome alone in a bank with no questions", () => {
		const empty = bankOf({ "bank.yaml": "agency: org.example\n" });
		const text = exampleInstrument("demo", "../", empty);
		expect(text).toBe(
			[
				"name: demo",
				"title: Example instrument",
				"description: A short instrument asking questions of this workspace's bank, to copy or delete.",
				"uses:",
				"  bank: ../",
				"flow:",
				"  - say: Thank you for taking part.",
				"",
			].join("\n"),
		);
		expect(wrong(text, empty)).toEqual([]);
	});

	// The reference bank: word and dotted codes, option variables named apart from their
	// question, names two questions share. Read here only when it's beside the repository.
	const REFERENCE = here("../../../../../bas-question-bank");
	it.skipIf(!existsSync(REFERENCE))(
		"is built with nothing to fill in from the reference bank too",
		async () => {
			const reference = bankOf(await readBank(REFERENCE));
			const text = exampleInstrument("demo", "../", reference);
			expect(text).toContain("  - section: Example");
			expect(wrong(text, reference)).toEqual([]);
		},
	);

	it("goes without the condition when the first code would need escaping", () => {
		const quoted = bankOf({
			"bank.yaml": "agency: org.example\n",
			"questions/t/a.yaml":
				'name: a\ntext: A?\nintent: A.\nresponses:\n  \'say "x"\': X\n  "2": Y\n',
			"questions/t/b.yaml": "name: b\ntext: B?\nintent: B.\nopen: {}\n",
		});
		const text = exampleInstrument("demo", "../", quoted);
		expect(text).toContain("ask: bank.a");
		expect(text).not.toContain("if:");
		expect(wrong(text, quoted)).toEqual([]);
	});
});
