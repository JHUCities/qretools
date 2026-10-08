import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	type Bank,
	bankFrom,
	bankOf,
	makeValidator,
	ROOT,
	scopeOf,
	status,
	UNDECLARED_AGENCY,
} from "@qretools/core";
import { readBank } from "@qretools/core/node";
import { beforeAll, describe, expect, it } from "vitest";

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

describe("a bank only read (scopeOf)", () => {
	it("is what a whole check of it gives an instrument, without the check's findings", async () => {
		const files = await readBank(here("../../fixtures/households"));
		const whole = bankOf(files);
		const scope = scopeOf(files);
		expect(scope).toEqual({
			env: whole.env,
			questions: whole.questions,
			index: whole.index,
			...(whole.agency !== undefined && { agency: whole.agency }),
		});
	});
});

describe("the sample bank (fixtures/bank, our own)", () => {
	let files: Readonly<Record<string, string>>;
	let bank: Bank;
	beforeAll(async () => {
		files = await readBank(SAMPLE);
		bank = bankOf(files);
	});

	it("reads every bank file and nothing else", () => {
		expect(Object.keys(files).length).toBe(22);
		expect(bank.ignored).toEqual([]);
		for (const path of Object.values(ROOT))
			expect(Object.keys(bank.schemes)).toContain(path);
	});

	it("is, put together from its evaluations, what an instrument reads of it", () => {
		const scope = bankFrom(bank);
		expect(scope.env).toBe(bank.env);
		expect(scope.questions).toBe(bank.questions);
		expect(scope.index).toEqual(bank.index);
		expect(scope.agency).toBe(bank.agency);
		expect("versions" in scope).toBe(false);
		const versions = { "questions/x.yaml": { number: "2" } };
		expect(bankFrom({ ...bank, versions }).versions).toBe(versions);
	});

	it("publishes its items under the agency it declares", () => {
		expect(bank.agency).toBe("org.example");
		for (const ev of Object.values(bank.questions))
			expect(JSON.stringify(ev.ddi)).not.toContain(UNDECLARED_AGENCY);
	});

	it("without a bank file, says so once and publishes under `invalid`", async () => {
		const { "bank.yaml": _, ...rest } = files;
		const without = bankOf(rest);
		const validate = await validator();
		expect(without.agency).toBeUndefined();
		expect(
			without.findings["bank.yaml"]?.map((f) => [f.severity, f.path]),
		).toEqual([["hole", "agency"]]);
		for (const [path, ev] of Object.entries(without.questions)) {
			expect(JSON.stringify(ev.ddi)).toContain(
				`"Agency":"${UNDECLARED_AGENCY}"`,
			);
			expect([path, validate(ev.ddi)]).toEqual([path, []]);
			expect(without.findings[path]?.some((f) => f.path === "agency")).toBe(
				false,
			);
		}
	});

	it("has no holes or errors in any file", () => {
		for (const [path, findings] of Object.entries(bank.findings))
			expect([path, status(findings).kind]).not.toEqual([path, "incomplete"]);
	});

	it("writes every code quoted", () => {
		for (const [path, findings] of Object.entries(bank.findings))
			expect([
				path,
				findings.filter((f) => f.code === "unquoted-code"),
			]).toEqual([path, []]);
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

	it("takes each file's version when given, version 1 when not", async () => {
		const path = "questions/examples/parks_spending.yaml";
		const versioned = bankOf(files, {
			[path]: { number: "3" },
			"scales/support4.yaml": { number: "2" },
		});
		const ddi = JSON.stringify(versioned.questions[path]?.ddi);
		expect(ddi).toContain('"URN":"urn:ddi:org.example:parks_spending:3"');
		expect(ddi).toContain('"URN":"urn:ddi:org.example:scale-support4.codes:2"');
		expect(ddi).toContain(
			'"URN":"urn:ddi:org.example:concept-parks_spending_support:1"',
		);
		const validate = await validator();
		expect(validate(versioned.questions[path]?.ddi ?? {})).toEqual([]);
	});

	it("doesn't depend on the order the files are given in", () => {
		const reversed = Object.fromEntries(Object.entries(files).reverse());
		expect(JSON.stringify(bankOf(reversed).findings)).toBe(
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
			const bank = bankOf(await readBank(REFERENCE));
			expect(Object.keys(bank.questions).length).toBeGreaterThan(0);
			const validate = await validator();
			for (const [path, ev] of Object.entries(bank.questions))
				expect([path, validate(ev.ddi)]).toEqual([path, []]);
		});
	},
);
