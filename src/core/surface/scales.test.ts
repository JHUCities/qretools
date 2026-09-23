import { describe, expect, it } from "vitest";
import { parseSurface } from "./parse.js";
import { parseScale, type Scales } from "./scales.js";
import { questionJsonSchema } from "./schema.js";

const agree4 = parseScale(
	"labels:\n  1: Strongly agree\n  2: Agree\n  3: Disagree\n  4: Strongly disagree\n",
);
const scales: Scales = agree4.scale ? { agree4: agree4.scale } : {};
const brief = (f: { severity: string; code: string; path: string }) =>
	`${f.severity}:${f.code}@${f.path}`;

describe("parseScale", () => {
	it("reads a labels map in author order", () => {
		expect(agree4.findings).toEqual([]);
		expect(agree4.scale?.codes.map((c) => c.code)).toEqual([
			"1",
			"2",
			"3",
			"4",
		]);
	});

	it("is total: no labels, or bad labels, are findings", () => {
		expect(parseScale("").findings.map(brief)).toEqual(["hole:hole@labels"]);
		expect(parseScale("labels:\n  1: 7\n").findings.map(brief)).toEqual([
			"error:wrong-type@labels.1",
		]);
		expect(() => parseScale("labels: [")).not.toThrow();
	});
});

describe("named scales in a question", () => {
	const base =
		"name: q\ntext: Neighbors help each other.\nintent: Prevalence of perceived social cohesion\n";

	it("resolve to the scale's codes and remember the name", () => {
		const { draft, findings } = parseSurface(
			`${base}responses: agree4\n`,
			scales,
		);
		expect(findings).toEqual([]);
		expect(draft.domain).toEqual({
			kind: "responses",
			select: "one",
			scale: "agree4",
			codes: agree4.scale?.codes,
		});
	});

	it("an unknown name is a hole that lists what exists", () => {
		const { draft, findings } = parseSurface(
			`${base}responses: agre4\n`,
			scales,
		);
		expect(draft.domain).toBeUndefined();
		expect(findings.map(brief)).toEqual(["hole:hole@responses"]);
		expect(findings[0]?.hint).toContain("agree4");
	});

	it("with no scales loaded, the hint says to write options inline", () => {
		const { findings } = parseSurface(`${base}responses: agree4\n`);
		expect(findings[0]?.hint).toMatch(/inline/);
	});
});

describe("questionJsonSchema with scales", () => {
	it("offers scale names as constants with their labels, only on the string branch", () => {
		const schema = questionJsonSchema(scales) as {
			properties: { responses: { anyOf: Array<Record<string, unknown>> } };
		};
		const branches = schema.properties.responses.anyOf;
		const text = branches.find((b) => b.type === "string") as {
			oneOf: Array<{ const: string; description: string }>;
		};
		expect(text.oneOf).toEqual([
			{
				const: "agree4",
				description:
					"1 Strongly agree · 2 Agree · 3 Disagree · 4 Strongly disagree",
			},
		]);
		expect(branches.filter((b) => "oneOf" in b)).toHaveLength(1);
	});

	it("is unchanged when there are no scales", () => {
		const schema = questionJsonSchema() as {
			properties: { responses: { anyOf: Array<Record<string, unknown>> } };
		};
		expect(schema.properties.responses.anyOf.some((b) => "oneOf" in b)).toBe(
			false,
		);
	});
});
