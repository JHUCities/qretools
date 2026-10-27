import { describe, expect, it } from "vitest";
import { hangOf } from "./hang.ts";

describe("where a wrapped line continues", () => {
	it("is past the indentation, list markers, a comment's # and a key", () => {
		expect(hangOf("text: In the past month, have you")).toBe(6);
		expect(hangOf("  - say: Thank you for taking part")).toBe(9);
		expect(hangOf("  - - x")).toBe(6);
		expect(hangOf("# What this shows: every question")).toBe(2);
		expect(hangOf("#   1. After intent: below, write")).toBe(7);
		expect(hangOf("#   - under the warning in the")).toBe(6);
		expect(hangOf("    universe: bank.park_visitors")).toBe(14);
		// A key with nothing after it, a block scalar's line, a quoted value.
		expect(hangOf("flow:")).toBe(0);
		expect(hangOf("    and its wording goes on")).toBe(4);
		expect(hangOf('  "1": Strongly agree')).toBe(2);
		expect(hangOf("")).toBe(0);
	});

	it("is the indentation alone on a line that continues a value", () => {
		expect(hangOf("  Title: the rest of a long value", true)).toBe(2);
		expect(hangOf("  # not a comment", true)).toBe(2);
		expect(hangOf("  - not a list item", true)).toBe(2);
	});
});
