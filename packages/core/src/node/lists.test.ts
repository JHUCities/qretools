/** Return after a list field opens its first item, for exactly the fields the parser reads as lists. */
import { describe, expect, it } from "vitest";
import { instrumentOf } from "../instrument/instrument.ts";
import { LIST_FIELDS, newListItem } from "../instrument/parse.ts";

describe("a list field", () => {
	it("is read as a list by the parser: anything else there is a wrong type", () => {
		// A Map: an object with a `then` key would read as a promise.
		const where = new Map<string, string>([
			["flow", "flow: 3\n"],
			["then", "flow:\n  - if: x\n    then: 3\n"],
			["else", "flow:\n  - if: x\n    then: []\n    else: 3\n"],
			["checks", "flow:\n  - ask: hh.q\n    checks: 3\n"],
		]);
		for (const field of LIST_FIELDS) {
			const { findings } = instrumentOf(`name: n\n${where.get(field)}`, {
				banks: {},
			});
			expect([field, findings.some((f) => f.code === "wrong-type")]).toEqual([
				field,
				true,
			]);
		}
	});

	it("opens its first item on Return, two past the key's column", () => {
		expect(newListItem("flow:", "")).toBe("\n  - ");
		expect(newListItem("    then:  ", "")).toBe("\n      - ");
		expect(newListItem("  - section: x", "")).toBeUndefined();
		expect(newListItem("    checks:", "")).toBe("\n      - ");
		// Not a list, or something after the caret: the editor's own newline.
		expect(newListItem("name:", "")).toBeUndefined();
		expect(newListItem("flow:", " []")).toBeUndefined();
	});
});
