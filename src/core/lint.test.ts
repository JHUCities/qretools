import { describe, expect, it } from "vitest";
import nhdNyrs from "../examples/nhd_nyrs.yaml?raw";
import nhdSat from "../examples/nhd_sat.yaml?raw";
import { lint } from "./lint.js";
import { EMPTY_ENV } from "./surface/env.js";
import { parseSurface } from "./surface/parse.js";

const base =
	"name: q\ntext: How often do you take the bus?\nintent: Prevalence of bus use among adults\n";
const lintOf = (source: string) =>
	lint(parseSurface(source, EMPTY_ENV).draft, EMPTY_ENV).map(
		(f) => `${f.severity}:${f.code}@${f.path}`,
	);

describe("lint", () => {
	it("has nothing to say about the examples", () => {
		expect(lintOf(nhdSat)).toEqual([]);
		expect(lintOf(nhdNyrs)).toEqual([]);
	});

	const table: Array<[title: string, source: string, expected: string[]]> = [
		[
			"duplicate labels, ignoring case and spacing",
			`${base}responses:\n  1: Often\n  2: Rarely\n  3: "  often "\n`,
			["warning:duplicate-label@responses.3"],
		],
		[
			"one response is not a choice",
			`${base}responses:\n  1: Often\n`,
			["warning:too-few-responses@responses"],
		],
		[
			"select-all without a none option",
			`${base}select: many\nresponses:\n  1: Bus\n  2: Train\n`,
			["warning:no-none-option@select"],
		],
		[
			"select-all with a none option",
			`${base}select: many\nresponses:\n  1: Bus\n  2: None of these\n`,
			[],
		],
		[
			"double-barreled text",
			"name: q\ntext: How satisfied are you with the cost and reliability of buses?\nintent: Prevalence of satisfaction with buses\nopen:\n",
			["info:double-barreled@text"],
		],
		[
			"“or” offers alternatives and is not flagged",
			"name: q\ntext: Do you rent or own your home?\nintent: Prevalence of housing tenure types\nopen:\n",
			[],
		],
		[
			"thin intent",
			"name: q\ntext: Do you rent?\nintent: Housing\nopen:\n",
			["info:thin-intent@intent"],
		],
		[
			"intent that repeats the text",
			"name: q\ntext: Do you rent your home today?\nintent: do you rent your home today?\nopen:\n",
			["info:thin-intent@intent"],
		],
	];

	it.each(table)("%s", (_title, source, expected) => {
		expect(lintOf(source)).toEqual(expected);
	});

	it("stays quiet on the false positives found in the BAS 2025 question texts", () => {
		const quiet = [
			"Do you and your household own a car?",
			"Some people register to vote and some do not. Are you registered to vote?",
			"In the past year, did you have trouble paying for utilities such as gas, electricity, and water?",
		];
		for (const text of quiet) {
			expect(
				lintOf(
					`name: q\ntext: "${text}"\nintent: Prevalence of the thing being measured here\nopen:\n`,
				),
			).toEqual([]);
		}
	});

	it("only ever advises, and every path it uses can be located in the source", () => {
		for (const [, source] of table) {
			const parsed = parseSurface(source, EMPTY_ENV);
			for (const f of lint(parsed.draft, EMPTY_ENV)) {
				expect(["warning", "info"]).toContain(f.severity);
				expect(parsed.ranges[f.path]).toBeDefined();
			}
		}
	});
});

describe("parse findings added with the lints", () => {
	it("min greater than max is an error and yields no domain", () => {
		const { draft, findings } = parseSurface(
			`${base}number:\n  min: 5\n  max: 1\n`,
			EMPTY_ENV,
		);
		expect(findings.map((f) => `${f.severity}:${f.code}@${f.path}`)).toEqual([
			"error:bad-range@number",
		]);
		expect(draft.domain).toBeUndefined();
	});

	it("select without responses is reported as ignored", () => {
		const { findings } = parseSurface(
			`${base}select: many\nopen:\n`,
			EMPTY_ENV,
		);
		expect(findings.map((f) => `${f.severity}:${f.code}@${f.path}`)).toEqual([
			"warning:ignored-key@select",
		]);
	});
});

describe("scheme lints", () => {
	it("an inline list identical to a shared scale is pointed at the scale; a reserved code is a warning", async () => {
		const { EMPTY_ENV } = await import("./surface/env.js");
		const { parseScale } = await import("./surface/scales.js");
		const agree4 = parseScale(
			"labels:\n  1: Strongly agree\n  2: Agree\n  3: Disagree\n  4: Strongly disagree\n",
		).scale;
		const missing =
			parseScale('labels:\n  "-8": Item non-response\n').scale?.codes ?? [];
		const env = { ...EMPTY_ENV, scales: agree4 ? { agree4 } : {}, missing };
		const head =
			"name: q\ntext: Neighbors help each other.\nintent: Prevalence of perceived social cohesion\n";
		const same = lint(
			parseSurface(
				`${head}responses:\n  1: strongly agree\n  2: Agree\n  3: Disagree\n  4: Strongly disagree\n`,
				env,
			).draft,
			env,
		);
		expect(same.map((f) => `${f.severity}:${f.code}@${f.path}`)).toEqual([
			"info:matches-scale@responses",
		]);
		expect(same[0]?.message).toMatch(/agree4/);
		const reserved = lint(
			parseSurface(`${head}responses:\n  1: Yes\n  -8: Refused\n`, env).draft,
			env,
		);
		expect(reserved.map((f) => `${f.severity}:${f.code}@${f.path}`)).toEqual([
			"warning:missing-code@responses.-8",
		]);
		expect(
			lint(parseSurface(`${head}responses: agree4\n`, env).draft, env),
		).toEqual([]);
	});
});
