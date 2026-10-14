import { evaluate } from "@qretools/core";
import { describe, expect, it } from "vitest";
import {
	EXAMPLE_SCALES,
	envOf,
	instrumentSource,
	type SchemeEntry,
} from "./model.js";

describe("EXAMPLE_SCALES", () => {
	it("names each bundled scale by its file, as a bank names a scale", () => {
		expect(Object.keys(EXAMPLE_SCALES).sort()).toEqual([
			"agree4",
			"satisfied5",
		]);
	});
});

describe("the workspace's agency", () => {
	const bank = (source: string): Record<number, SchemeEntry> => ({
		1: { id: 1, kind: "workspace", name: "workspace", source },
	});
	const urns = (source: string) =>
		Object.keys(
			evaluate("name: q\ntext: Q?\n", envOf(bank(source), false)).ddi
				.QuestionItem ?? {},
		);

	it("comes from the working copy of `workspace.yaml`, as it is typed", () => {
		expect(urns("agency: org.example\n")).toEqual(["org.example:q:1"]);
		expect(urns("agency: org.example.dept\n")).toEqual([
			"org.example.dept:q:1",
		]);
	});

	it("is `invalid` while the workspace declares none", () => {
		expect(urns("agency:\n")).toEqual(["invalid:q:1"]);
	});
});

describe("a new instrument's source", () => {
	it("is the template with its name filled in, every other field still to fill in", () => {
		const source = instrumentSource("wave1");
		expect(source).toMatch(/^name: wave1$/m);
		expect(source).toMatch(/^title:$/m);
		expect(source).toMatch(/^ {2}- ask:$/m);
	});
});
