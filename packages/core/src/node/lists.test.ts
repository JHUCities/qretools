/** Return after a list field opens its first item, for exactly the fields the parser reads as lists. */
import { describe, expect, it } from "vitest";
import { instrumentOf } from "../instrument/instrument.ts";
import { LIST_FIELDS, newLineAfter } from "../instrument/parse.ts";

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
		expect(newLineAfter("flow:", "")).toBe("\n  - ");
		expect(newLineAfter("    then:  ", "")).toBe("\n      - ");
		expect(newLineAfter("  - section: x", "")).toBe("\n    ");
		expect(newLineAfter("    checks:", "")).toBe("\n      - ");
		// After an item with its value, the item's field column, and nothing more.
		expect(newLineAfter("  - ask: hh.size", "")).toBe("\n    ");
		expect(newLineAfter("      - ensure: hh.size > 0", "")).toBe("\n        ");
		// Not a list, or something after the caret: the editor's own newline.
		expect(newLineAfter("name:", "")).toBeUndefined();
		expect(newLineAfter("flow:", " []")).toBeUndefined();
	});
});
