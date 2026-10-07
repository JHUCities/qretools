import { describe, expect, it } from "vitest";
import { applyEdits, renameEdits } from "./edit.ts";

describe("applying edits", () => {
	it("replaces a block map with the name, keeping the line that follows", () => {
		const src = "name: q\nresponses:\n  1: Yes\n  2: No\nselect: one\n";
		expect(applyEdits(src, [{ path: "responses", value: "yesno" }])).toBe(
			"name: q\nresponses: yesno\nselect: one\n",
		);
	});

	it("replaces a block map at the end of a text with no final newline", () => {
		expect(
			applyEdits("name: q\nresponses:\n  1: Yes\n  2: No", [
				{ path: "responses", value: "yesno" },
			]),
		).toBe("name: q\nresponses: yesno");
	});

	it("replaces a flow map, a comment on its last line included in a block one", () => {
		expect(
			applyEdits("responses: {1: Yes, 2: No}\n", [
				{ path: "responses", value: "yesno" },
			]),
		).toBe("responses: yesno\n");
		expect(
			applyEdits("responses:\n  1: Yes\n  2: No # c\nname: q\n", [
				{ path: "responses", value: "yesno" },
			]),
		).toBe("responses: yesno\nname: q\n");
	});

	it("replaces a block scalar and a nested unit, block or flow", () => {
		expect(
			applyEdits("instruction: |\n  Select one\nname: q\n", [
				{ path: "instruction", value: "select_one" },
			]),
		).toBe("instruction: select_one\nname: q\n");
		expect(
			applyEdits("number:\n  min: 0\n  unit: Days\n", [
				{ path: "number.unit", value: "days" },
			]),
		).toBe("number:\n  min: 0\n  unit: days\n");
		expect(
			applyEdits("number: {min: 0, unit: Days}\n", [
				{ path: "number.unit", value: "days" },
			]),
		).toBe("number: {min: 0, unit: days}\n");
	});

	it("quotes a value only when it must be", () => {
		expect(
			applyEdits("number:\n  unit: x\n", [
				{ path: "number.unit", value: "per: cent" },
			]),
		).toBe('number:\n  unit: "per: cent"\n');
	});

	it("does nothing when a path is no longer there, and applies several in any order", () => {
		expect(applyEdits("name: q\n", [{ path: "universe", value: "x" }])).toBe(
			undefined,
		);
		expect(
			applyEdits("universe: All\ninstruction: One\n", [
				{ path: "universe", value: "all" },
				{ path: "instruction", value: "one" },
			]),
		).toBe("universe: all\ninstruction: one\n");
	});
});

describe("a key as written", () => {
	it("is kept whole, dots and all", () => {
		expect(
			applyEdits('responses:\n  "1.5": { label: A, note: x }\n', [
				{ path: "responses.1.5", value: "B" },
			]),
		).toBe('responses:\n  "1.5": B\n');
	});
});

describe("renaming a shared file in a question", () => {
	it("rewrites where the question names it, resolved or not", () => {
		const src = "name: q\nresponses: agree\nuniverse: agree\n";
		expect(renameEdits(src, "scale", "agree", "agree4")).toEqual([
			{ path: "responses", value: "agree4" },
		]);
		expect(renameEdits("name: q\n", "scale", "agree", "agree4")).toEqual([]);
	});
});

describe("a unit inside a flow map", () => {
	it("is rewritten in place", () => {
		expect(
			applyEdits("number: { min: 0, unit: day }\n", [
				{ path: "number.unit", value: "days" },
			]),
		).toBe("number: { min: 0, unit: days }\n");
	});
});
