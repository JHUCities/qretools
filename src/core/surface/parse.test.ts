import { describe, expect, it } from "vitest";
import type { Finding } from "../findings.js";
import { EMPTY_ENV } from "./env.js";
import { parseSurface } from "./parse.js";

const brief = (f: Finding) => `${f.severity}:${f.code}@${f.path}`;

const complete = `name: nhd_sat
text: How satisfied are you with your neighborhood as a place to live?
intent: Prevalence of overall neighborhood satisfaction
responses:
  1: Very satisfied
  2: Somewhat satisfied
  3: Very dissatisfied
`;

describe("parseSurface", () => {
	it("parses a complete question with no findings", () => {
		const { draft, findings } = parseSurface(complete, EMPTY_ENV);
		expect(findings).toEqual([]);
		expect(draft.name).toBe("nhd_sat");
		expect(draft.domain).toEqual({
			kind: "responses",
			select: "one",
			codes: [
				{ code: "1", label: "Very satisfied" },
				{ code: "2", label: "Somewhat satisfied" },
				{ code: "3", label: "Very dissatisfied" },
			],
		});
	});

	it("keeps response codes in the author's order", () => {
		const { draft } = parseSurface(
			"responses:\n  2: b\n  10: c\n  1: a\n",
			EMPTY_ENV,
		);
		expect(
			draft.domain?.kind === "responses" &&
				draft.domain.codes.map((c) => c.code),
		).toEqual(["2", "10", "1"]);
	});

	const table: Array<[title: string, input: string, expected: string[]]> = [
		[
			"empty text is all holes",
			"",
			["hole:hole@name", "hole:hole@text", "hole:hole@intent", "hole:hole@"],
		],
		[
			"a domain typed but left empty is a hole, not a type error",
			"name: q1\ntext: Q?\nintent: i\nresponses:\n",
			["hole:hole@responses"],
		],
		["unknown key", `${complete}wording: x\n`, ["error:unknown-key@wording"]],
		[
			"a colon in unquoted text swallows the rest of the document",
			"name: q1\ntext: Rate this: good or bad\nintent: i\nresponses:\n  1: a\n",
			[
				"error:yaml-syntax@",
				"error:wrong-type@text",
				"hole:hole@intent",
				"hole:hole@",
			],
		],
		[
			"number-valued label is an error with a quoting hint",
			"name: q1\ntext: Q?\nintent: i\nresponses:\n  1: 7\n",
			["error:wrong-type@responses.1"],
		],
		[
			"two domains",
			"name: q1\ntext: Q?\nintent: i\nresponses:\n  1: a\nnumber:\n  min: 0\n",
			["error:too-many-domains@number"],
		],
		[
			"bad nested field in number",
			"name: q1\ntext: Q?\nintent: i\nnumber:\n  min: low\n  units: years\n",
			["error:wrong-type@number.min", "error:unknown-key@number.units"],
		],
		[
			"bad name",
			"name: 1st\ntext: Q?\nintent: i\nopen: {}\n",
			["error:wrong-type@name"],
		],
		["not a map", "- a\n- b\n", ["error:not-a-map@"]],
	];

	it.each(table)("%s", (_title, input, expected) => {
		const { findings } = parseSurface(input, EMPTY_ENV);
		expect(findings.map(brief).sort()).toEqual(expected.sort());
	});

	it("keeps the author's spelling of codes", () => {
		const { draft } = parseSurface(
			"responses:\n  010: a\n  '02': b\n",
			EMPTY_ENV,
		);
		expect(
			draft.domain?.kind === "responses" &&
				draft.domain.codes.map((c) => c.code),
		).toEqual(["010", "02"]);
	});

	it("reports the later domain in document order as the extra one", () => {
		const { findings } = parseSurface(
			"number:\n  min: 0\nresponses:\n  1: a\n",
			EMPTY_ENV,
		);
		expect(findings.filter((f) => f.severity === "error").map(brief)).toEqual([
			"error:too-many-domains@responses",
		]);
	});

	it("clamps syntax ranges to the text", () => {
		for (const input of ["a: [", "number: {min: 1", "x"]) {
			for (const f of parseSurface(input, EMPTY_ENV).findings) {
				if (f.range) {
					expect(f.range[0]).toBeLessThanOrEqual(f.range[1]);
					expect(f.range[1]).toBeLessThanOrEqual(input.length);
				}
			}
		}
	});

	it("a key written with no value is a hole, required or not, at every depth", () => {
		const brief = (f: { severity: string; code: string; path: string }) =>
			`${f.severity}:${f.code}@${f.path}`;
		const full = "name: q\ntext: Q?\nintent: Prevalence of a thing\n";
		expect(
			parseSurface(`${full}title:\nopen:\n`, EMPTY_ENV).findings.map(brief),
		).toEqual(["hole:hole@title"]);
		const num = parseSurface(
			`${full}number:\n  min:\n  unit: years\n`,
			EMPTY_ENV,
		);
		expect(num.findings.map(brief)).toEqual(["hole:hole@number.min"]);
		expect(num.draft.domain).toEqual({ kind: "number", unit: "years" });
		expect(
			parseSurface(
				`${full}select:\nresponses:\n  1: a\n  2: b\n`,
				EMPTY_ENV,
			).findings.map(brief),
		).toEqual(["hole:hole@select"]);
		const opt = parseSurface(
			`${full}select: many\nresponses:\n  a: { label: Yes, title: }\n  b: No\n`,
			EMPTY_ENV,
		);
		expect(opt.findings.map(brief)).toEqual(["hole:hole@responses.a.title"]);
		expect(
			opt.draft.domain?.kind === "responses" && opt.draft.domain.codes[0],
		).toEqual({ code: "a", label: "Yes" });
		// An empty optional's hint says the line may simply go.
		expect(
			parseSurface(`${full}source:\nopen:\n`, EMPTY_ENV).findings[0]?.hint,
		).toMatch(/remove the line/);
	});

	it("reads number and open domains, and select many", () => {
		expect(
			parseSurface("number:\n  min: 0\n  unit: years\n", EMPTY_ENV).draft
				.domain,
		).toEqual({
			kind: "number",
			min: 0,
			unit: "years",
		});
		expect(
			parseSurface("open:\n  max_length: 200\n", EMPTY_ENV).draft.domain,
		).toEqual({
			kind: "open",
			maxLength: 200,
		});
		expect(parseSurface("open:\n", EMPTY_ENV).draft.domain).toEqual({
			kind: "open",
		});
		expect(
			parseSurface("responses:\n  1: a\nselect: many\n", EMPTY_ENV).draft
				.domain,
		).toMatchObject({ select: "many" });
	});

	it("indexes source ranges by dotted path", () => {
		const { ranges } = parseSurface(complete, EMPTY_ENV);
		expect(ranges[""]).toEqual([0, complete.length]);
		const r = ranges["responses.2"];
		expect(r && complete.slice(r[0], r[1])).toBe("2: Somewhat satisfied");
		const t = ranges.text;
		expect(
			t && complete.slice(t[0], t[1]).startsWith("text: How satisfied"),
		).toBe(true);
	});

	it("never throws", () => {
		for (const s of [
			"{",
			"a: [",
			"\t\tx",
			": :",
			"!!binary x",
			"a: &x *x",
			"---\n---\n",
		]) {
			expect(() => parseSurface(s, EMPTY_ENV)).not.toThrow();
		}
	});
});
