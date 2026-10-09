/** Return after a list field opens its first item, for exactly the fields the parser reads as lists. */
import { describe, expect, it } from "vitest";
import { instrumentOf } from "../instrument/instrument.ts";
import { LIST_FIELDS, newLineAfter, SNIPPETS } from "../instrument/parse.ts";

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

describe("a list item opened and not yet written", () => {
	it("is a hole drawn just past its dash, in a flow and in checks; `- null` is a wrong type", () => {
		const hole = (text: string) =>
			instrumentOf(text, { banks: {} }).findings.find((f) =>
				f.message.includes("still to be written"),
			)?.range;
		const flow = "name: n\nflow:\n  - ";
		expect(hole(`${flow}\n`)).toEqual([flow.length, flow.length]);
		const checks = "name: n\nflow:\n  - ask: hh.q\n    checks:\n      - ";
		expect(hole(`${checks}\n`)).toEqual([checks.length, checks.length]);
		const written = instrumentOf(`${flow}null\n`, { banks: {} }).findings;
		expect(written.some((f) => f.code === "wrong-type")).toBe(true);
	});
});

describe("a construct written out", () => {
	it("parses with nothing missing once its placeholders are filled in", () => {
		const fill = (template: string) =>
			template
				.replace(/\$\{name\}/g, "r")
				.replace(/\$\{title\}/g, "About you")
				.replace(/\$\{roster\}/g, "r")
				.replace(/\$\{warning\}/g, "warning")
				// The empty stops where a name or condition goes.
				.replace(/(if|ensure): \$\{\}/g, "$1: true")
				.replace(/each: \$\{\}/g, "each: r")
				// An empty stop: a value where one goes, a step where a list starts.
				.replace(/: \$\{\}/g, ": 3")
				.replace(/- \$\{\}/g, "- say: Hello.")
				.replace(/message: 3/, "message: Is that right?");
		for (const [construct, written] of Object.entries(SNIPPETS)) {
			const step =
				construct === "check"
					? `  - ask: hh.q\n    checks:\n      - ${fill(written("        "))}\n`
					: `  - ${fill(written("    "))}\n`;
			// `each` reads a roster: one before it, as the filled name says.
			const before =
				construct === "each"
					? "  - roster: r\n    count: 3\n    flow:\n      - say: Hi.\n"
					: "";
			const { findings } = instrumentOf(`name: n\nflow:\n${before}${step}`, {
				banks: {},
			});
			const wrong = findings
				.filter(
					(f) =>
						(f.severity === "hole" || f.severity === "error") &&
						f.path !== "" &&
						// The ask names a bank no test loads; the snippet is the check.
						!f.path.endsWith(".ask"),
				)
				.map((f) => `${f.path}: ${f.message}`);
			expect([construct, wrong]).toEqual([construct, []]);
		}
	});

	it("left as written, every place untouched, has holes to fill in and nothing wrong", () => {
		for (const [construct, written] of Object.entries(SNIPPETS)) {
			// Tab through: each place keeps its default, an empty one stays empty.
			const left = written("    ").replace(/\$\{([^}]*)\}/g, "$1");
			const step =
				construct === "check"
					? `  - ask: hh.q\n    checks:\n      - ${written("        ").replace(/\$\{([^}]*)\}/g, "$1")}\n`
					: `  - ${left}\n`;
			const { findings } = instrumentOf(`name: n\nflow:\n${step}`, {
				banks: {},
			});
			const errors = findings
				.filter(
					(f) =>
						f.severity === "error" &&
						f.path !== "" &&
						// The ask names a bank no test loads, as above.
						!f.path.endsWith(".ask"),
				)
				.map((f) => `${f.path}: ${f.message}`);
			expect([construct, errors]).toEqual([construct, []]);
			expect(findings.some((f) => f.severity === "hole")).toBe(true);
		}
	});
});
