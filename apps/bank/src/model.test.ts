import { evaluate } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { EXAMPLE_SCALES, envOf, type SchemeEntry } from "./model.js";

describe("EXAMPLE_SCALES", () => {
	it("names each bundled scale by its file, as a bank names a scale", () => {
		expect(Object.keys(EXAMPLE_SCALES).sort()).toEqual([
			"agree4",
			"satisfied5",
		]);
	});
});

describe("the bank's agency", () => {
	const bank = (source: string): Record<number, SchemeEntry> => ({
		1: { id: 1, kind: "bank", name: "bank", source },
	});
	const urns = (source: string) =>
		Object.keys(
			evaluate("name: q\ntext: Q?\n", envOf(bank(source), {})).ddi
				.QuestionItem ?? {},
		);

	it("comes from the working copy of the bank's own file, as it is typed", () => {
		expect(urns("agency: org.example\n")).toEqual(["org.example:q:1"]);
		expect(urns("agency: org.example.dept\n")).toEqual([
			"org.example.dept:q:1",
		]);
	});

	it("is `invalid` while the bank declares none", () => {
		expect(urns("agency:\n")).toEqual(["invalid:q:1"]);
	});
});
