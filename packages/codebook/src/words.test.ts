/**
 * Conditions in words, three-valued as VTL is: what an else is taken on includes "not
 * answered", but never for an input; codes are matched as written.
 */
import {
	type Condition,
	DDI_FUNCTIONS,
	parseCondition,
	type Source,
} from "@qretools/core";
import { describe, expect, it } from "vitest";
import { conditionsWords, type Known, type Mode } from "./words.ts";

const yesNo = [
	{ code: "1", label: [[{ kind: "text", text: "Yes" }] as const] },
	{ code: "2", label: [[{ kind: "text", text: "No" }] as const] },
];
const KNOWN: Record<string, Known> = {
	consent: { nullable: true, codes: yesNo },
	scale: {
		nullable: true,
		codes: ["01", "02", "03", "04"].map((code) => ({
			code,
			label: [[{ kind: "text", text: `Label ${code}` }]],
		})),
	},
	rent: { nullable: true },
	county: { nullable: false, codes: yesNo },
};

/** A condition as the core reads it, each name bound to its variable; another language kept as written. */
const command = (text: string, language = "VTL"): Condition => {
	const parsed = parseCondition(text, DDI_FUNCTIONS);
	if (language !== "VTL" || parsed.problems.length > 0)
		return { kind: "verbatim", command: { text, language } };
	const sources = new Map<string, Source>(
		[...text.matchAll(/[a-z_]+/g)]
			.map((m) => m[0])
			.filter((n) => n in KNOWN)
			.map((n) => [n, { kind: "input", urn: `urn:ddi:a:${n}:1`, variable: n }]),
	);
	return {
		kind: "parsed",
		command: { text, language },
		expr: parsed.expr,
		sources,
	};
};

const say = (text: string, mode: Mode = "true", language = "VTL") => {
	const said = conditionsWords(
		[{ cond: command(text, language), mode }],
		(source) => {
			const known = KNOWN[source.variable ?? ""];
			return {
				ref: {
					kind: "ref",
					type: "Variable",
					urn: source.urn,
					name: source.variable ?? "",
				},
				...(known !== undefined && { known }),
			};
		},
	);
	return said?.map((s) => ("text" in s ? s.text : s.name)).join("");
};

describe("a condition in words", () => {
	it("says a code by its label, and what an else is taken on with 'not answered'", () => {
		expect(say('consent = "1"')).toBe("consent is “Yes”");
		expect(say('consent = "1"', "notTrue")).toBe(
			"consent is “No”, or not answered",
		);
		expect(say('consent <> "1"')).toBe("consent is “No”");
	});

	it("never says an input isn't answered", () => {
		expect(say('county = "1"', "notTrue")).toBe("county is “No”");
	});

	it("says a run of codes as a range, matching codes as written", () => {
		expect(say('scale in {"01", "02", "03"}')).toBe(
			"scale is 01 to 03 (“Label 01” to “Label 03”)",
		);
		expect(say("scale = 1")).toBe("scale is code 1");
		expect(say("rent = 1")).toBe("rent is 1");
	});

	it("reads a check's nvl as the condition that shows its message", () => {
		expect(say("not nvl(rent < 10000, true)")).toBe("rent is at least 10000");
		expect(say("isnull(rent)")).toBe("rent isn't answered");
	});

	it("turns and into or under an else, bracketing what must be", () => {
		expect(say('consent = "1" or rent > 5', "notTrue")).toBe(
			"(consent is “No”, or not answered), and (rent is at most 5, or not answered)",
		);
	});

	it("names a name with no binding as written", () => {
		expect(say("other = 1")).toBe("other is 1");
	});

	it("says nothing of a command in another language, or one it can't read", () => {
		expect(say('consent = "1"', "true", "SPSS")).toBeUndefined();
		expect(say("consent = = 1")).toBeUndefined();
	});
});
