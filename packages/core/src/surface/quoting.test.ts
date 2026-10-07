import { describe, expect, it } from "vitest";
import { type Finding, locate } from "../findings.ts";
import { quoteCode, spaceBefore } from "./edit.ts";
import { EMPTY_ENV } from "./env.ts";
import { parseSurface } from "./parse.ts";
import { parseScale } from "./scales.ts";

const QUESTIONS = import.meta.glob(
	["../../templates/*.yaml", "../../examples/*.yaml"],
	{ query: "?raw", import: "default", eager: true },
) as Readonly<Record<string, string>>;
const SCALES = import.meta.glob("../../starter/scales/*.yaml", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Readonly<Record<string, string>>;

const question = (responses: string) =>
	`name: q\ntext: Q?\nintent: i\nresponses:\n${responses}`;
const quoting = (findings: readonly Finding[]) =>
	findings.filter((f) => f.code === "unquoted-code");

describe("unquoted codes", () => {
	it("are advice on each code YAML reads as something other than text", () => {
		const source = question(
			'  1: Yes\n  "2": No\n  -8: Refused\n  DK: Don\'t know\n',
		);
		const { findings, ranges } = parseSurface(source, EMPTY_ENV);
		const found = quoting(findings);
		expect(found.map((f) => [f.severity, f.path])).toEqual([
			["info", "responses.1"],
			["info", "responses.-8"],
		]);
		// Underlined on the code alone, never its label.
		expect(found.map((f) => source.slice(...locate(f, ranges)))).toEqual([
			"1",
			"-8",
		]);
		expect(found[0]?.fix).toEqual({
			kind: "quote",
			label: "Quote `1`",
			path: "responses.1",
			code: "1",
		});
	});

	it("are advice in shared scales and the missing-value list alike", () => {
		expect(
			quoting(parseScale("labels:\n  1: a\n").findings).map((f) => f.path),
		).toEqual(["labels.1"]);
	});

	it("aren't in the tool's starting files", () => {
		for (const [path, text] of Object.entries(QUESTIONS))
			expect([path, quoting(parseSurface(text, EMPTY_ENV).findings)]).toEqual([
				path,
				[],
			]);
		for (const [path, text] of Object.entries(SCALES))
			expect([path, quoting(parseScale(text).findings)]).toEqual([path, []]);
	});
});

describe("the fix", () => {
	const fixed = (source: string, path: string, code: string) =>
		quoteCode(source, path, code);

	it("quotes the code as spelled, and nothing else", () => {
		expect(
			fixed("responses:\n  010: a # first\n", "responses.010", "010"),
		).toBe('responses:\n  "010": a # first\n');
		expect(fixed("labels:\n  -8: Refused\n", "labels.-8", "-8")).toBe(
			'labels:\n  "-8": Refused\n',
		);
		expect(fixed("responses:\n  1.5: a\n", "responses.1.5", "1.5")).toBe(
			'responses:\n  "1.5": a\n',
		);
		expect(fixed("responses:\n  true: a\n", "responses.true", "true")).toBe(
			'responses:\n  "true": a\n',
		);
	});

	it("keeps an option's fields, and works in flow maps and explicit keys", () => {
		expect(
			fixed(
				"responses:\n  2:\n    label: No\n    variable: q_no\n",
				"responses.2",
				"2",
			),
		).toBe('responses:\n  "2":\n    label: No\n    variable: q_no\n');
		expect(fixed('responses: {1: Yes, "2": No}\n', "responses.1", "1")).toBe(
			'responses: {"1": Yes, "2": No}\n',
		);
		expect(fixed("responses:\n  ? 1\n  : Yes\n", "responses.1", "1")).toBe(
			'responses:\n  ? "1"\n  : Yes\n',
		);
	});

	it("changes nothing once applied, or when the place is gone", () => {
		const once = fixed("responses:\n  1: a\n", "responses.1", "1") ?? "";
		expect(fixed(once, "responses.1", "1")).toBeUndefined();
		expect(fixed("responses:\n  2: a\n", "responses.1", "1")).toBeUndefined();
	});
});

describe("one code written two ways", () => {
	it("is an error when YAML can't tell", () => {
		const { findings } = parseSurface(
			question('  "1": a\n  1: b\n'),
			EMPTY_ENV,
		);
		expect(
			findings.filter((f) => f.code === "duplicate-code").map((f) => f.path),
		).toEqual(["responses.1"]);
	});

	it("is YAML's own report when it can, said once", () => {
		const { findings } = parseSurface(question("  1: a\n  1: b\n"), EMPTY_ENV);
		expect(findings.some((f) => f.code === "duplicate-code")).toBe(false);
		expect(findings.some((f) => f.code === "yaml-syntax")).toBe(true);
	});

	it("aren't the same once quoted (`01` and `1`)", () => {
		const { findings, draft } = parseSurface(
			question('  "01": a\n  "1": b\n'),
			EMPTY_ENV,
		);
		expect(findings).toEqual([]);
		expect(
			draft.domain?.kind === "responses" && draft.domain.codes.length,
		).toBe(2);
	});
});

describe("typing after a quoted code's colon", () => {
	it("writes the space first, as after any key", () => {
		const source = 'responses:\n  "1":\n';
		expect(spaceBefore(source, source.indexOf(":\n", 12) + 1, "Y")).toBe(true);
	});
});
