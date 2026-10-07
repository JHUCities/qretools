import { readFile } from "node:fs/promises";
import {
	bankOf,
	EMPTY_ENV,
	evaluate,
	makeValidator,
	status,
} from "@qretools/core";
import { readBank } from "@qretools/core/node";
import { describe, expect, it } from "vitest";

/**
 * The README's examples, run. Each README block appears below verbatim (indentation
 * aside), followed by `expect`s for what its `// →` comments claim; the last test holds
 * the README to this file, so an example can't change without its test. The examples
 * read `fixtures/bank` as a user would, from the package's directory, where its tests run.
 */
describe("the README's examples", () => {
	it("run as written, in order", async () => {
		const question = `name: nhd_sat
text: How satisfied are you with your neighborhood as a place to live?
intent: How satisfied residents are with their neighborhood overall
responses:
  "1": Satisfied
  "2": Neither satisfied nor dissatisfied
  "3": Dissatisfied
`;
		const env = { ...EMPTY_ENV, agency: "org.example" };
		const evaluation = evaluate(question, env);
		status(evaluation.findings).kind; // → "complete"
		Object.keys(evaluation.ddi); // → ["QuestionItem", "CodeList", "Category", "Variable"]
		expect(status(evaluation.findings).kind).toBe("complete");
		expect(Object.keys(evaluation.ddi)).toEqual([
			"QuestionItem",
			"CodeList",
			"Category",
			"Variable",
		]);

		const draft = evaluate("name: nhd_sat\n", EMPTY_ENV);
		draft.findings.map((f) => [f.severity, f.path]);
		// → [["hole", "text"], ["hole", "intent"], ["hole", ""]]
		expect(draft.findings.map((f) => [f.severity, f.path])).toEqual([
			["hole", "text"],
			["hole", "intent"],
			["hole", ""],
		]);

		const bank = bankOf(await readBank("fixtures/bank"));
		Object.keys(bank.questions).length; // → 6
		bank.ignored; // → []
		bank.agency; // → "org.example"
		expect(Object.keys(bank.questions).length).toBe(6);
		expect(bank.ignored).toEqual([]);
		expect(bank.agency).toBe("org.example");

		const schema = JSON.parse(
			await readFile(
				new URL(import.meta.resolve("@qretools/core/schema.json")),
				"utf8",
			),
		);
		const validator = makeValidator(schema);
		validator.ok && validator.value(evaluation.ddi); // → []
		expect(validator.ok && validator.value(evaluation.ddi)).toEqual([]);
	});

	it("are this file's code, block for block", async () => {
		const readme = await readFile(
			new URL("../../README.md", import.meta.url),
			"utf8",
		);
		const fences = [...readme.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)];
		const lines = (text: string) =>
			text
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l !== "");
		// `ts` blocks are this file's code; `sh` blocks are commands (the CLI's own tests
		// run them). Any other kind would be skipped silently, so there is none.
		expect(fences.length).toBeGreaterThan(0);
		expect(fences.filter((f) => f[1] !== "ts" && f[1] !== "sh")).toEqual([]);
		const test = lines(await readFile(new URL(import.meta.url), "utf8")).join(
			"\n",
		);
		for (const [, , block] of fences.filter((f) => f[1] === "ts"))
			expect(`\n${test}\n`).toContain(`\n${lines(block ?? "").join("\n")}\n`);
	});
});
