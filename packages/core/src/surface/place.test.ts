import { describe, expect, it } from "vitest";
import { placeAt } from "./place.js";

/** The place at `▮`. */
const at = (marked: string) =>
	placeAt(marked.replace("▮", ""), marked.indexOf("▮"));

describe("where the caret is, for completion", () => {
	it("names the key whose value is being written, at any depth", () => {
		expect(at("name: q\nselect: ▮")).toEqual({
			kind: "value",
			segments: ["select"],
			typed: "",
			spaced: true,
		});
		expect(at("select: ▮\ntext: x\n")).toEqual({
			kind: "value",
			segments: ["select"],
			typed: "",
			spaced: true,
		});
		expect(at("number:\n  unit: ▮")).toEqual({
			kind: "value",
			segments: ["number", "unit"],
			typed: "",
			spaced: true,
		});
		expect(at("name: q\nselect: ma▮")).toEqual({
			kind: "value",
			segments: ["select"],
			typed: "ma",
			spaced: true,
		});
		// Straight after the colon: completion brings its own space.
		expect(at("name: q\nselect:▮")).toEqual({
			kind: "value",
			segments: ["select"],
			typed: "",
			spaced: false,
		});
		expect(at("name: q\nselect:ma▮")).toBeUndefined();
	});

	it("puts a key at the top level beside the keys written there", () => {
		expect(at("name: q\n▮\ntext: x\n")).toEqual({
			kind: "key",
			segments: [],
			siblings: ["name", "text"],
			typed: "",
		});
		expect(at("name: q\ntext: x\n▮")).toEqual({
			kind: "key",
			segments: [],
			siblings: ["name", "text"],
			typed: "",
		});
		expect(at("name: q\nte▮")).toEqual({
			kind: "key",
			segments: [],
			siblings: ["name"],
			typed: "te",
		});
		expect(at("▮")).toEqual({
			kind: "key",
			segments: [],
			siblings: [],
			typed: "",
		});
	});

	it("puts an indented key under its parent, blank lines and half-typed words aside", () => {
		const under = (siblings: string[], typed = "") => ({
			kind: "key",
			segments: ["number"],
			siblings,
			typed,
		});
		expect(at("number:\n  ▮")).toEqual(under([]));
		expect(at("number:\n  mi▮")).toEqual(under([], "mi"));
		expect(at("number:\n  min: 1\n  ▮")).toEqual(under(["min"]));
		expect(at("number:\n  min: 1\n  ma▮")).toEqual(under(["min"], "ma"));
		expect(at("number:\n  min: 1\n  ▮\n  max: 3\ntext: x\n")).toEqual(
			under(["min", "max"]),
		);
		expect(at("number:\n  min: 1\n\n  ▮")).toEqual(under(["min"]));
		expect(at("number:\n  # c\n  ▮")).toEqual(under([]));
		expect(at("number:\n  ▮\n  max: 2")).toEqual(under(["max"]));
	});

	it("goes as deep as the text does, codes and quoted keys included", () => {
		expect(at("responses:\n  1:\n    ▮")).toEqual({
			kind: "key",
			segments: ["responses", "1"],
			siblings: [],
			typed: "",
		});
		expect(at('responses:\n  "1":\n    ▮')).toEqual({
			kind: "key",
			segments: ["responses", "1"],
			siblings: [],
			typed: "",
		});
		expect(at("responses:\n  1.5:\n    label: x\n    ▮")).toEqual({
			kind: "key",
			segments: ["responses", "1.5"],
			siblings: ["label"],
			typed: "",
		});
	});

	it("offers nothing where completion has nothing to add", () => {
		expect(at("na▮me: q")).toBeUndefined(); // inside a word
		expect(at("name: q\n  ▮")).toBeUndefined(); // under a written value
		expect(at("  ▮")).toBeUndefined(); // indented with no parent
		expect(at("number: {min: 1, ▮}")).toBeUndefined(); // a flow map
		expect(at("name: q # a ▮")).toBeUndefined(); // a comment
		expect(at("number:\n\t▮")).toBeUndefined(); // a tab, which YAML forbids
		expect(at("legacy:\n  - a\n  ▮")).toBeUndefined(); // a list
	});
});
