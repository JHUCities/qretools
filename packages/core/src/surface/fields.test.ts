import { describe, expect, it } from "vitest";
import choice from "../../templates/choice.yaml?raw";
import { withFields } from "./edit.ts";
import { EMPTY_ENV } from "./env.ts";
import { parseSurface } from "./parse.ts";

describe("a template given its bank's required fields", () => {
	it("puts each where the field order does, empty, and nothing twice", () => {
		const out = withFields(choice, ["note", "concept", "title", "universe"]);
		expect(out).toBe(
			'name:\ntitle:\ntext:\nintent:\nconcept:\nuniverse:\nresponses:\n  "1":\n  "2":\n  "3":\nnote:\n',
		);
		// Each is a hole where it was put.
		const holes = parseSurface(out, EMPTY_ENV)
			.findings.filter((f) => f.severity === "hole")
			.map((f) => f.path);
		expect(holes).toEqual(
			expect.arrayContaining(["concept", "universe", "note"]),
		);
		// Nothing but holes: no line landed where it changes how the rest reads.
		expect(
			parseSurface(out, EMPTY_ENV).findings.filter(
				(f) => f.severity !== "hole",
			),
		).toEqual([]);
	});

	it("leaves the text as it is when nothing is missing", () => {
		expect(withFields(choice, ["title"])).toBe(choice);
		expect(withFields(choice, [])).toBe(choice);
	});

	it("ends a last line before adding after it", () => {
		expect(withFields("name: q", ["note"])).toBe("name: q\nnote:\n");
	});
});

describe("a template's comments and odd shapes", () => {
	it("keeps a comment with the field it introduces", () => {
		const text =
			'name:\nintent:\n\n# How it\'s answered\nresponses:\n  "1": Yes\n';
		expect(withFields(text, ["concept"])).toBe(
			'name:\nintent:\nconcept:\n\n# How it\'s answered\nresponses:\n  "1": Yes\n',
		);
	});

	it("never cuts a block of text short at an indented `#` line", () => {
		const text =
			'name: q\ntext: |\n  Some text\n  # not a comment\nresponses:\n  "1": Yes\n';
		expect(withFields(text, ["concept"])).toBe(
			'name: q\ntext: |\n  Some text\n  # not a comment\nconcept:\nresponses:\n  "1": Yes\n',
		);
	});

	it("leaves text that isn't fields alone, and fills an empty one", () => {
		expect(withFields("- a\n- b\n", ["note"])).toBe("- a\n- b\n");
		expect(withFields("{name: q}\n", ["note"])).toBe("{name: q}\n");
		expect(withFields("", ["note"])).toBe("note:\n");
	});
});
