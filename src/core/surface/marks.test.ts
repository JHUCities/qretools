import { describe, expect, it } from "vitest";
import { type Finding, locate } from "../findings.js";
import { evaluateScheme, type SchemeKind } from "../schemes.js";
import { EMPTY_ENV, type Env } from "./env.js";
import type { Mark } from "./marks.js";
import { parseSurface } from "./parse.js";
import { parseScale } from "./scales.js";

const QUESTIONS = import.meta.glob(
	["../../templates/*.yaml", "../../examples/*.yaml"],
	{
		query: "?raw",
		import: "default",
		eager: true,
	},
) as Readonly<Record<string, string>>;
const SCALES = import.meta.glob("../../examples/scales/*.yaml", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Readonly<Record<string, string>>;

const scale = (text: string) => {
	const { scale } = parseScale(text);
	if (scale === undefined) throw new Error("fixture scale does not parse");
	return scale;
};

const ENV: Env = {
	...EMPTY_ENV,
	scales: { agree4: scale("labels:\n  1: Agree\n  2: Disagree\n") },
	universes: { adults: { text: "All adults" } },
};

/** Each mark as the text it covers (a hole as its offset). */
const shown = (text: string, marks: readonly Mark[]) =>
	marks.map((m) =>
		m.kind === "hole"
			? `hole@${m.range[0]}`
			: `${m.kind}:${text.slice(m.range[0], m.range[1])}`,
	);

describe("marksOf", () => {
	it("marks resolved names, codes, the legacy block and holes", () => {
		const text = [
			"name: q",
			"title:",
			"universe: adults",
			"instruction: nobody_has_this",
			"responses:",
			"  1: Yes",
			"  010: No",
			"legacy:",
			"  old:",
			"  kept: x",
		].join("\n");
		const { marks } = parseSurface(text, ENV);
		expect(shown(text, marks)).toEqual([
			"ref:adults",
			`hole@${text.indexOf("title:") + "title:".length}`,
			"code:1",
			"code:010",
			"legacy:legacy:\n  old:\n  kept: x",
		]);
	});

	it("marks a scale name as a reference, not codes, and only when it resolves", () => {
		const known = "responses: agree4\n";
		expect(shown(known, parseSurface(known, ENV).marks)).toEqual([
			"ref:agree4",
		]);
		const unknown = "responses: agree5\n";
		expect(parseSurface(unknown, ENV).marks).toEqual([]);
	});

	it("marks empty option fields and domain fields, not an empty number or legacy", () => {
		const options =
			"select: many\nresponses:\n  a:\n    label: A\n    title:\n";
		expect(shown(options, parseSurface(options, ENV).marks)).toEqual([
			"code:a",
			`hole@${options.length - 1}`,
		]);
		const number = "number:\n  min:\n";
		expect(shown(number, parseSurface(number, ENV).marks)).toEqual([
			`hole@${number.length - 1}`,
		]);
		expect(parseSurface("number:\nlegacy:\n", ENV).marks).toEqual([
			{ kind: "legacy", range: [8, 15] },
		]);
	});

	it("marks nothing where the text is not a map", () => {
		expect(parseSurface("- a\n- b\n", ENV).marks).toEqual([]);
	});
});

describe("scheme file marks", () => {
	it("marks a scale's codes and its empty labels", () => {
		const text = "labels:\n  1: Yes\n  2:\n";
		expect(shown(text, evaluateScheme("scale", text, ENV).marks)).toEqual([
			"code:1",
			"code:2",
			`hole@${text.length - 1}`,
		]);
	});

	it("marks the missing list's codes", () => {
		const text = "labels:\n  -99: Refused\n  -98: Don't know\n";
		expect(shown(text, evaluateScheme("missing", text, ENV).marks)).toEqual([
			"code:-99",
			"code:-98",
		]);
	});

	it("marks only the hole of an empty universe", () => {
		expect(evaluateScheme("universe", "text:\n", ENV).marks).toEqual([
			{ kind: "hole", range: [5, 5] },
		]);
		expect(evaluateScheme("universe", "text: All\n", ENV).marks).toEqual([]);
	});
});

/** A chip must agree with `opened()`'s rule: every hole mark sits where a hole finding is. */
const agrees = (
	marks: readonly Mark[],
	findings: readonly Finding[],
	ranges: Parameters<typeof locate>[1],
) =>
	marks
		.filter((m) => m.kind === "hole")
		.every((m) =>
			findings.some((f) => {
				if (f.severity !== "hole") return false;
				const [from, to] = locate(f, ranges);
				return from <= m.range[0] && m.range[0] <= to;
			}),
		);

describe("every hole mark is a hole finding", () => {
	const envs: readonly [string, Env][] = [
		["empty", EMPTY_ENV],
		["with scales", ENV],
	];
	for (const [path, text] of Object.entries(QUESTIONS))
		for (const [label, env] of envs)
			it(`${path}, ${label} environment`, () => {
				const p = parseSurface(text, env);
				expect(agrees(p.marks, p.findings, p.ranges)).toBe(true);
			});

	const kinds: readonly SchemeKind[] = ["scale", "missing"];
	for (const [path, text] of Object.entries(SCALES))
		for (const kind of kinds)
			it(`${path} as ${kind}`, () => {
				const ev = evaluateScheme(kind, text, ENV);
				expect(agrees(ev.marks, ev.findings, ev.ranges)).toBe(true);
			});

	it("holds on hand-written edge cases", () => {
		for (const text of [
			"name:\ntitle:\nselect:\nresponses:\n",
			"number:\n  min:\nresponses:\n  1:\nselect:\n",
			"responses:\n  1:\n    label:\n    title:\n  2: B\nselect: many\n",
			"open:\n  max_length:\nfoo:\n",
			"universe:\ninstruction:\nlegacy:\n  a:\n",
		]) {
			const p = parseSurface(text, ENV);
			expect(agrees(p.marks, p.findings, p.ranges), text).toBe(true);
			expect(p.marks.some((m) => m.kind === "hole")).toBe(true);
		}
	});
});
