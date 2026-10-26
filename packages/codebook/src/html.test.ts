import { describe, expect, it } from "vitest";
import { formatWords } from "./html.ts";

describe("a format in words", () => {
	it("says a number's range, decimals and unit, and a text's length", () => {
		expect([
			formatWords({ kind: "number" }),
			formatWords({ kind: "number", min: 1, max: 20 }),
			formatWords({ kind: "number", min: 0, decimals: 1, unit: "<km>" }),
			formatWords({ kind: "number", max: 9, decimals: 2 }),
			formatWords({ kind: "text" }),
			formatWords({ kind: "text", maxLength: 500 }),
		]).toEqual([
			"Number",
			"Number from 1 to 20",
			"Number, at least 0, 1 decimal place, in <km>",
			"Number, at most 9, 2 decimal places",
			"Text",
			"Text, up to 500 characters",
		]);
	});
});
