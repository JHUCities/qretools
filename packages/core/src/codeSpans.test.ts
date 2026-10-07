import { describe, expect, it } from "vitest";
import { codeSpans, plainText } from "./codeSpans.ts";

describe("codeSpans", () => {
	it("splits plain text and backticked code", () => {
		expect(codeSpans("`name` is required.")).toEqual([
			{ code: true, text: "name" },
			{ code: false, text: " is required." },
		]);
	});

	it("leaves text without backticks whole", () => {
		expect(codeSpans("Choose a folder.")).toEqual([
			{ code: false, text: "Choose a folder." },
		]);
	});

	it("removes backticks for plain text", () => {
		expect(plainText("No scale named `x`.")).toBe("No scale named x.");
	});
});
