import { describe, expect, it } from "vitest";
import { collisions } from "./ddi/document.js";
import { elaborateItems } from "./ddi/elaborate.js";
import { type Bank, bankOf } from "./evaluate.js";

const BANK = {
	"bank.yaml": "agency: org.example\n",
	"missing.yaml": 'labels:\n  "-8": Refused\n',
	"scales/yesno01.yaml": 'labels:\n  "0": No\n  "1": Yes\n',
};
const q = (name: string, rest = 'responses:\n  "1": A\n  "2": B\n') =>
	`name: ${name}\ntext: ${name}?\nintent: i\n${rest}`;
const ALL = 'select: many\nresponses:\n  "a": A\n  "b": B\n';

/** Every question's items, keyed by its path, as an export of the bank would gather them. */
const itemsOf = (bank: Bank) =>
	Object.entries(bank.questions).map(
		([path, ev]) =>
			[
				path,
				elaborateItems(ev.draft, bank.agency ?? "invalid", bank.env.missing),
			] as const,
	);
const codes = (bank: Bank, path: string) =>
	(bank.findings[path] ?? []).map((f) => f.code);

describe("one identity, one item", () => {
	it("a bank whose names are distinct has no collisions, though shared items repeat", () => {
		const bank = bankOf({
			...BANK,
			"questions/a/one.yaml": q("one"),
			"questions/a/two.yaml": q("two"),
			"questions/a/many.yaml": q("many", ALL),
		});
		expect(collisions(itemsOf(bank))).toEqual([]);
	});

	it("shared items emitted by every question stay identical with versions given", () => {
		const files = {
			...BANK,
			"questions/a/one.yaml": q("one", "responses: yesno01\n"),
			"questions/a/many.yaml": q("many", ALL),
		};
		const versions = {
			"scales/yesno01.yaml": { number: "2", blob: "y" },
			"missing.yaml": { number: "3", blob: "m" },
		};
		const bank = bankOf(files, versions);
		const items = Object.entries(bank.questions).map(
			([path, ev]) =>
				[
					path,
					elaborateItems(ev.draft, "org.example", bank.env.missing, {
						own: { number: "1" },
						shared: versions,
					}),
				] as const,
		);
		expect(collisions(items)).toEqual([]);
	});

	it("a question may be named like what the tool names its own items", () => {
		const bank = bankOf({
			...BANK,
			"questions/a/missing.yaml": q("missing"),
			"questions/a/other.yaml": q("other"),
		});
		expect(collisions(itemsOf(bank))).toEqual([]);
	});

	it("two questions with one name are told so, each naming the other", () => {
		const bank = bankOf({
			...BANK,
			"questions/a/dup.yaml": q("dup"),
			"questions/b/dup.yaml": q("dup", 'responses:\n  "1": Other\n'),
		});
		expect(codes(bank, "questions/a/dup.yaml")).toContain("duplicate-name");
		expect(codes(bank, "questions/b/dup.yaml")).toContain("duplicate-name");
		const found = collisions(itemsOf(bank));
		expect(found.length).toBeGreaterThan(0);
		expect(found[0]?.keys).toEqual([
			"questions/a/dup.yaml",
			"questions/b/dup.yaml",
		]);
	});

	it("a yesno01 scale that differs from the one select-all items use is told so", () => {
		const bank = bankOf({
			...BANK,
			"scales/yesno01.yaml": 'labels:\n  "0": no\n  "1": yes\n',
			"questions/a/many.yaml": q("many", ALL),
		});
		expect(codes(bank, "scales/yesno01.yaml")).toEqual(["binary-scale"]);
		expect(codes(bankOf(BANK), "scales/yesno01.yaml")).toEqual([]);
	});

	it("an ID the tool chooses has a hyphen, so it can't be a question's name", () => {
		const bank = bankOf({
			...BANK,
			"concepts/trust.yaml": "label: Trust\n",
			"questions/a/one.yaml": q(
				"one",
				'concept: trust\nresponses:\n  "1": A\n',
			),
			"questions/a/many.yaml": q("many", ALL),
			"questions/a/blank.yaml": "text: Untitled?\n",
		});
		const names = new Set(["one", "many"]);
		for (const [, items] of itemsOf(bank))
			for (const it of items) {
				const base = it.identity.ID.split(".")[0] ?? "";
				expect([it.identity.ID, names.has(base) || base.includes("-")]).toEqual(
					[it.identity.ID, true],
				);
			}
	});

	it("an item two sources emit differently is reported once, with both", () => {
		const item = (body: Record<string, string>) => ({
			type: "Universe" as const,
			identity: { URN: "urn:ddi:o:u:1", Agency: "o", ID: "u", Version: "1" },
			body,
		});
		expect(
			collisions([
				["a", [item({ x: "1" })]],
				["b", [item({ x: "1" })]],
				["c", [item({ x: "2" })]],
			]),
		).toEqual([{ urn: "urn:ddi:o:u:1", keys: ["a", "b", "c"] }]);
	});
});
