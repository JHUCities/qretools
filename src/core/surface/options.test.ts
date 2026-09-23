import { describe, expect, it } from "vitest";
import demRace from "../../examples/dem_race.yaml?raw";
import { lint } from "../lint.js";
import { codebookView } from "../render.js";
import { optionVariable } from "./draft.js";
import { parseSurface } from "./parse.js";

const brief = (f: { severity: string; code: string; path: string }) =>
	`${f.severity}:${f.code}@${f.path}`;
const base =
	"name: dem_race\ntext: What is your race?\nintent: Prevalence of racial identification, allowing more than one\nselect: many\n";

describe("select-many options", () => {
	it("read the example: labels, titles, legacy, note", () => {
		const { draft, findings } = parseSurface(demRace, {});
		expect(findings).toEqual([]);
		expect(draft.title).toBe("Race");
		expect(draft.legacy).toEqual(["surveys_used", "vargroup"]);
		expect(draft.domain?.kind === "responses" && draft.domain.codes[0]).toEqual(
			{
				code: "wh",
				label: "White",
				title: "Race selected -- White",
			},
		);
		// The example has no "none of these" option, and that advice is correct for a real BAS item.
		expect(lint(draft).map(brief)).toEqual([
			"warning:no-none-option@select",
			"info:legacy-fields@legacy",
		]);
	});

	it("each option becomes <name>_<code> unless it names its variable", () => {
		expect(optionVariable("dem_race", { code: "wh", label: "White" })).toBe(
			"dem_race_wh",
		);
		expect(
			optionVariable("tsp_pubmr", {
				code: "car",
				label: "x",
				variable: "tsp_pubmrcar",
			}),
		).toBe("tsp_pubmrcar");
		expect(
			optionVariable(undefined, { code: "wh", label: "White" }),
		).toBeUndefined();
	});

	it("the codebook lists one variable per option", () => {
		const v = codebookView(parseSurface(demRace, {}).draft);
		expect(v.values).toMatchObject({ kind: "lines" });
		expect(v.values.kind === "lines" && v.values.lines[0]).toBe(
			"dem_race_wh: Race selected -- White",
		);
		expect(v.notes[0]).toMatch(/each option is its own variable/);
	});

	const table: Array<[title: string, source: string, expected: string[]]> = [
		[
			"an option without a label is a hole",
			`${base}responses:\n  wh: { title: White }\n`,
			["hole:hole@responses.wh"],
		],
		[
			"an unknown option field is an error",
			`${base}responses:\n  wh: { label: White, tittle: x }\n`,
			["error:wrong-type@responses.wh.tittle"],
		],
		[
			"a bad variable name is an error",
			`${base}responses:\n  wh: { label: White, variable: 1st }\n`,
			["error:wrong-type@responses.wh.variable"],
		],
		[
			"titles on a single select are ignored, and said so",
			"name: q\ntext: Q?\nintent: Prevalence of a thing\nresponses:\n  1: { label: Yes, title: T }\n  2: No\n",
			["warning:ignored-key@responses.1"],
		],
		[
			"a non-map legacy is an error",
			`${base}responses:\n  a: A\n  b: B\nlegacy: 3\n`,
			["error:wrong-type@legacy"],
		],
		[
			"an empty legacy is nothing",
			`${base}responses:\n  a: A\n  b: B\nlegacy:\n`,
			[],
		],
	];

	it.each(table)("%s", (_t, source, expected) => {
		expect(parseSurface(source, {}).findings.map(brief)).toEqual(expected);
	});

	it("lints duplicate and unprefixed option variables", () => {
		const { draft } = parseSurface(
			`${base}responses:\n  a: { label: A, variable: dem_race_x }\n  b: { label: B, variable: dem_race_x }\n  c: { label: C, variable: other_c }\n  d: None of these\n`,
			{},
		);
		expect(lint(draft).map(brief)).toEqual([
			"warning:duplicate-option-variable@responses.b",
			"info:option-variable-prefix@responses.c",
		]);
	});
});
