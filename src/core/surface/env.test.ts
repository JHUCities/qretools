import { describe, expect, it } from "vitest";
import { EMPTY_ENV, type Env, parseTextEntry } from "./env.js";
import { parseSurface } from "./parse.js";
import { parseScale } from "./scales.js";

const brief = (f: { severity: string; code: string; path: string }) =>
	`${f.severity}:${f.code}@${f.path}`;
const env: Env = {
	...EMPTY_ENV,
	universes: { renters: { text: "Respondents who rent their home" } },
	instructions: { select_one: { text: "Select one" } },
	missing:
		parseScale('labels:\n  "-8": Item non-response\n  "-7": Skipped\n').scale
			?.codes ?? [],
};
const base =
	"name: q\ntext: Do you rent?\nintent: Prevalence of renting among adults\nopen:\n";

describe("parseTextEntry", () => {
	it("reads a text file, and reports what is wrong with one", () => {
		expect(parseTextEntry("text: Renters\n")).toEqual({
			entry: { text: "Renters" },
			findings: [],
		});
		expect(parseTextEntry("").findings.map(brief)).toEqual(["hole:hole@text"]);
		expect(parseTextEntry("text:\n").findings.map(brief)).toEqual([
			"hole:hole@text",
		]);
		expect(parseTextEntry("text: x\nlabel: y\n").findings.map(brief)).toEqual([
			"error:unknown-key@label",
		]);
		expect(() => parseTextEntry("text: [")).not.toThrow();
	});
});

describe("references in a question", () => {
	it("a bare identifier resolves against its scheme and keeps its name", () => {
		const { draft, findings } = parseSurface(
			`${base}universe: renters\ninstruction: select_one\n`,
			env,
		);
		expect(findings).toEqual([]);
		expect(draft.universe).toEqual({
			kind: "ref",
			name: "renters",
			value: { text: "Respondents who rent their home" },
		});
		expect(draft.instruction).toEqual({
			kind: "ref",
			name: "select_one",
			value: { text: "Select one" },
		});
	});

	it("anything that is not an identifier is prose", () => {
		const { draft, findings } = parseSurface(
			`${base}universe: Renters only\ninstruction: Pick one.\n`,
			env,
		);
		expect(findings).toEqual([]);
		expect(draft.universe).toEqual({ kind: "text", text: "Renters only" });
		expect(draft.instruction).toEqual({ kind: "text", text: "Pick one." });
	});

	it("an identifier that resolves to nothing is a hole whose hint lists the names and allows a sentence", () => {
		const { draft, findings } = parseSurface(
			`${base}universe: everyone\n`,
			env,
		);
		expect(draft.universe).toBeUndefined();
		expect(findings.map(brief)).toEqual(["hole:hole@universe"]);
		expect(findings[0]?.hint).toMatch(/renters/);
		expect(findings[0]?.hint).toMatch(/sentence/);
	});
});
