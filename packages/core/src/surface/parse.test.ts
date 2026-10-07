import { describe, expect, it } from "vitest";
import type { Finding } from "../findings.js";
import { EMPTY_ENV } from "./env.js";
import { parseSurface } from "./parse.js";

const WITH_UNITS = { ...EMPTY_ENV, units: { years: { label: "years" } } };

const brief = (f: Finding) => `${f.severity}:${f.code}@${f.path}`;

const complete = `name: nhd_sat
text: How satisfied are you with your neighborhood as a place to live?
intent: Prevalence of overall neighborhood satisfaction
responses:
  "1": Very satisfied
  "2": Somewhat satisfied
  "3": Very dissatisfied
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
			'responses:\n  "2": b\n  "10": c\n  "1": a\n',
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
			'name: q1\ntext: Rate this: good or bad\nintent: i\nresponses:\n  "1": a\n',
			[
				"error:yaml-syntax@",
				"error:wrong-type@text",
				"hole:hole@intent",
				"hole:hole@",
			],
		],
		[
			"number-valued label is an error with a quoting hint",
			'name: q1\ntext: Q?\nintent: i\nresponses:\n  "1": 7\n',
			["error:wrong-type@responses.1"],
		],
		[
			"two domains",
			'name: q1\ntext: Q?\nintent: i\nresponses:\n  "1": a\nnumber:\n  min: 0\n',
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
			'number:\n  min: 0\nresponses:\n  "1": a\n',
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
			parseSurface(`${full}title:\nopen: {}\n`, EMPTY_ENV).findings.map(brief),
		).toEqual(["hole:hole@title"]);
		const num = parseSurface(
			`${full}number:\n  min:\n  unit: years\n`,
			WITH_UNITS,
		);
		expect(num.findings.map(brief)).toEqual(["hole:hole@number.min"]);
		expect(num.draft.domain).toEqual({
			kind: "number",
			unit: { kind: "ref", name: "years", value: { label: "years" } },
		});
		expect(
			parseSurface(
				`${full}select:\nresponses:\n  "1": a\n  "2": b\n`,
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
			parseSurface(`${full}source:\nopen: {}\n`, EMPTY_ENV).findings[0]?.hint,
		).toMatch(/remove the line/);
	});

	it("a domain written empty is a hole at its key, and no domain", () => {
		const full = "name: q\ntext: Q?\nintent: Prevalence of a thing\n";
		for (const [key, hint] of [
			["number", /number: \{\}/],
			["open", /open: \{\}/],
			["responses", /"1": Yes/],
		] as const) {
			const p = parseSurface(`${full}${key}:\n`, EMPTY_ENV);
			expect(p.findings.map(brief)).toEqual([`hole:hole@${key}`]);
			expect(p.findings[0]?.message).toBe(`\`${key}\` is empty.`);
			expect(p.findings[0]?.hint).toMatch(hint);
			expect(p.draft.domain).toBeUndefined();
		}
		// An empty `responses:` still reads its `select`.
		expect(
			parseSurface(`${full}responses:\nselect:\n`, EMPTY_ENV).findings.map(
				brief,
			),
		).toEqual(["hole:hole@responses", "hole:hole@select"]);
	});

	it("an option's label written empty is a hole at the label, absent at the option", () => {
		const full =
			"name: q\ntext: Q?\nintent: Prevalence of a thing\nselect: many\n";
		expect(
			parseSurface(
				`${full}responses:\n  a:\n    label:\n  b:\n    title: B\n`,
				EMPTY_ENV,
			).findings.map(brief),
		).toEqual(["hole:hole@responses.a.label", "hole:hole@responses.b"]);
	});

	it("reads number and open domains, and select many", () => {
		expect(
			parseSurface("number:\n  min: 0\n  unit: years\n", WITH_UNITS).draft
				.domain,
		).toEqual({
			kind: "number",
			min: 0,
			unit: { kind: "ref", name: "years", value: { label: "years" } },
		});
		expect(
			parseSurface("open:\n  max_length: 200\n", EMPTY_ENV).draft.domain,
		).toEqual({
			kind: "open",
			maxLength: 200,
		});
		expect(parseSurface("open: {}\n", EMPTY_ENV).draft.domain).toEqual({
			kind: "open",
		});
		expect(
			parseSurface('responses:\n  "1": a\nselect: many\n', EMPTY_ENV).draft
				.domain,
		).toMatchObject({ select: "many" });
	});

	it("indexes source ranges by dotted path", () => {
		const { ranges } = parseSurface(complete, EMPTY_ENV);
		expect(ranges[""]).toEqual([0, complete.length]);
		const r = ranges["responses.2"];
		expect(r && complete.slice(r[0], r[1])).toBe('"2": Somewhat satisfied');
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

	it("says library errors in plain words and keeps the library's as detail", () => {
		const { findings } = parseSurface(
			"name: q1\ntext: Q?\nintent: i\nnumber:\n  min: low\n  decimals: -1\ntags: [\n",
			EMPTY_ENV,
		);
		const syntax = findings.find((f) => f.code === "yaml-syntax");
		expect(syntax?.message).toBe("This line can't be read as YAML.");
		expect(syntax?.detail).toBeTruthy();
		const min = findings.find((f) => f.path === "number.min");
		expect(min?.message).toBe("`min` must be a number.");
		const decimals = findings.find((f) => f.path === "number.decimals");
		expect(decimals?.message).toBe("`decimals` must be at least 0.");
	});
});

describe("variant_of", () => {
	const at = (text: string) => parseSurface(text, EMPTY_ENV);

	it("reads each question named, with why the two differ", () => {
		const p = at("name: a\nvariant_of:\n  b: split ballot, lower range\n");
		expect(p.variants).toEqual([
			{ name: "b", path: "variant_of.b", why: "split ballot, lower range" },
		]);
		expect(p.findings.filter((f) => f.path.startsWith("variant_of"))).toEqual(
			[],
		);
	});

	it("makes an empty reason, or an empty field, a hole; a bad name an error", () => {
		const codes = (text: string) =>
			at(text)
				.findings.filter((f) => f.path.startsWith("variant_of"))
				.map((f) => `${f.severity}@${f.path}`);
		expect(codes("variant_of:\n  b:\n")).toEqual(["hole@variant_of.b"]);
		expect(codes("variant_of:\n")).toEqual(["hole@variant_of"]);
		expect(codes("variant_of:\n  Not A Name: why\n")).toEqual([
			"error@variant_of.Not A Name",
		]);
		expect(codes("variant_of: b\n")).toEqual(["error@variant_of"]);
	});
});

describe("concept", () => {
	const env = {
		...EMPTY_ENV,
		concepts: { trust: { label: "Trust in government" } },
	};

	it("names a shared concept; a name no concept has is a hole offering to create it", () => {
		expect(parseSurface("concept: trust\n", env).draft.concept).toMatchObject({
			kind: "ref",
			name: "trust",
		});
		const hole = parseSurface("concept: income\n", env).findings.find(
			(f) => f.path === "concept",
		);
		expect(hole).toMatchObject({
			severity: "hole",
			message: "No concept named `income`.",
			fix: {
				label: "New shared concept `income`",
				create: {
					scheme: "concept",
					name: "income",
					text: "",
					path: "concept",
				},
			},
		});
		expect(hole?.hint).not.toMatch(/sentence/);
	});

	it("keeps prose, which lint calls advice", () => {
		expect(
			parseSurface("concept: racial identification\n", env).draft.concept,
		).toEqual({ kind: "text", text: "racial identification" });
	});
});

describe("an unknown scale name", () => {
	it("is a hole offering to create the scale, like any shared name", () => {
		const hole = parseSurface(
			"name: q\nresponses: agree9\n",
			EMPTY_ENV,
		).findings.find((f) => f.path === "responses");
		expect(hole?.fix).toEqual({
			kind: "create",
			label: "New shared scale `agree9`",
			create: { scheme: "scale", name: "agree9", text: "", path: "responses" },
		});
	});
});

describe("unit", () => {
	const env = {
		...EMPTY_ENV,
		units: { days: { label: "days" }, dollars: { label: "US dollars" } },
	};
	const at = (unit: string) =>
		parseSurface(`name: q\nnumber:\n  min: 0\n  unit: ${unit}\n`, env);

	it("names a shared unit, recorded where it is written (inside number)", () => {
		const p = at("days");
		expect(p.draft.domain).toMatchObject({
			unit: { kind: "ref", name: "days" },
		});
		expect(p.mentions).toContainEqual({
			scheme: "unit",
			name: "days",
			path: "number.unit",
		});
		expect(p.marks).toContainEqual({ kind: "ref", range: expect.anything() });
	});

	it("offers the near one for a name that differs only in number, and to create any other", () => {
		expect(
			at("day").findings.find((f) => f.path === "number.unit"),
		).toMatchObject({
			severity: "hole",
			fix: {
				kind: "edit",
				label: "Use `days`",
				edits: [{ path: "number.unit", value: "days" }],
			},
		});
		expect(
			at("hours").findings.find((f) => f.path === "number.unit")?.fix,
		).toEqual({
			kind: "create",
			label: "New shared unit `hours`",
			create: { scheme: "unit", name: "hours", text: "", path: "number.unit" },
		});
	});

	it("keeps words, which lint calls advice", () => {
		expect(at("times per week").draft.domain).toMatchObject({
			unit: { kind: "text", text: "times per week" },
		});
	});
});
