import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type Bank, bankOf, makeValidator, status } from "@qretools/core";
import { readBank } from "@qretools/core/node";
import { beforeAll, describe, expect, it } from "vitest";

const AGENCY = "org.example";

/** A path beside this file, whatever directory the tests run from. */
const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

const SAMPLE = here("../../fixtures/bank");

/** The official schema, compiled once for the file. */
async function validator() {
	const schema = JSON.parse(
		await readFile(
			new URL(import.meta.resolve("@qretools/core/schema.json")),
			"utf8",
		),
	);
	const v = makeValidator(schema);
	if (!v.ok) throw new Error(v.error.message);
	return v.value;
}

describe("the sample bank (fixtures/bank, our own)", () => {
	let files: Readonly<Record<string, string>>;
	let bank: Bank;
	beforeAll(async () => {
		files = await readBank(SAMPLE);
		bank = bankOf(files, AGENCY);
	});

	it("reads every bank file and nothing else", () => {
		expect(Object.keys(files).length).toBe(21);
		expect(bank.ignored).toEqual([]);
		expect(Object.keys(bank.schemes)).toContain("missing.yaml");
	});

	it("has no holes or errors in any file", () => {
		for (const [path, findings] of Object.entries(bank.findings))
			expect([path, status(findings).kind]).not.toEqual([path, "incomplete"]);
	});

	it("resolves the shared names its questions use", () => {
		expect(Object.keys(bank.env.scales)).toContain("support4");
		expect(bank.env.missing.length).toBeGreaterThan(0);
	});

	it("elaborates every question to valid DDI", async () => {
		const validate = await validator();
		for (const [path, ev] of Object.entries(bank.questions))
			expect([path, validate(ev.ddi)]).toEqual([path, []]);
	});

	it("doesn't depend on the order the files are given in", () => {
		const reversed = Object.fromEntries(Object.entries(files).reverse());
		expect(JSON.stringify(bankOf(reversed, AGENCY).findings)).toBe(
			JSON.stringify(bank.findings),
		);
	});
});

/**
 * Another team's live bank, read where it's checked out beside this repository and
 * skipped where it isn't; never copied in. Only what must hold whatever they edit.
 */
const REFERENCE = here("../../../../../bas-question-bank");

describe.skipIf(!existsSync(REFERENCE))(
	"the reference bank, when present",
	() => {
		it("evaluates whole, and every question's DDI is valid", async () => {
			const bank = bankOf(await readBank(REFERENCE), AGENCY);
			expect(Object.keys(bank.questions).length).toBeGreaterThan(0);
			const validate = await validator();
			for (const [path, ev] of Object.entries(bank.questions))
				expect([path, validate(ev.ddi)]).toEqual([path, []]);
		});
	},
);
