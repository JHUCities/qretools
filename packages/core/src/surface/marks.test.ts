import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import type { Finding } from "../findings.ts";
import { evaluateScheme, type SchemeKind } from "../schemes.ts";
import { EMPTY_ENV, type Env } from "./env.ts";
import type { Mark } from "./marks.ts";
import { indexDocument, parseSurface } from "./parse.ts";
import { parseScale } from "./scales.ts";

const QUESTIONS = import.meta.glob(
	["../../templates/*.yaml", "../../examples/*.yaml"],
	{
		query: "?raw",
		import: "default",
		eager: true,
	},
) as Readonly<Record<string, string>>;
const SCALES = import.meta.glob("../../starter/scales/*.yaml", {
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

/** Each mark as the text it covers. */
const shown = (text: string, marks: readonly Mark[]) =>
	marks.map((m) => `${m.kind}:${text.slice(m.range[0], m.range[1])}`);

/** Where the hole markers go: the distinct points of the hole findings, in order. */
const points = (findings: readonly Finding[]): readonly number[] =>
	[
		...new Set(
			findings.flatMap((f) =>
				f.severity === "hole" &&
				f.range !== undefined &&
				f.range[0] === f.range[1]
					? [f.range[0]]
					: [],
			),
		),
	].sort((a, b) => a - b);

describe("marksOf", () => {
	it("marks resolved names, codes and the legacy block; a hole is a point finding", () => {
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
		const { marks, findings } = parseSurface(text, ENV);
		expect(points(findings)).toContain(
			text.indexOf("title:") + "title:".length,
		);
		expect(shown(text, marks)).toEqual([
			"ref:adults",
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

	it("points at empty option fields, domain fields and domains, not legacy", () => {
		const options =
			"select: many\nresponses:\n  a:\n    label: A\n    title:\n";
		expect(points(parseSurface(options, ENV).findings)).toEqual([
			options.length - 1,
		]);
		const number = "number:\n  min:\n";
		expect(points(parseSurface(number, ENV).findings)).toEqual([
			number.length - 1,
		]);
		const legacy = parseSurface("number:\nlegacy:\n", ENV);
		expect(points(legacy.findings)).toEqual([7]);
		expect(legacy.marks).toEqual([{ kind: "legacy", range: [8, 15] }]);
	});

	it("marks nothing where the text is not a map", () => {
		expect(parseSurface("- a\n- b\n", ENV).marks).toEqual([]);
	});
});

describe("scheme file marks", () => {
	it("marks a scale's codes, and points at its empty labels", () => {
		const text = "labels:\n  1: Yes\n  2:\n";
		const ev = evaluateScheme("scale", text, ENV, "x");
		expect(shown(text, ev.marks)).toEqual(["code:1", "code:2"]);
		expect(points(ev.findings)).toEqual([text.length - 1]);
	});

	it("marks the missing list's codes", () => {
		const text = "labels:\n  -99: Refused\n  -98: Don't know\n";
		expect(
			shown(text, evaluateScheme("missing", text, ENV, "missing").marks),
		).toEqual(["code:-99", "code:-98"]);
	});

	it("points at the hole of an empty universe, and marks nothing", () => {
		const ev = evaluateScheme("universe", "text:\n", ENV, "x");
		expect(ev.marks).toEqual([]);
		expect(points(ev.findings)).toEqual([5]);
		expect(evaluateScheme("universe", "text: All\n", ENV, "x").marks).toEqual(
			[],
		);
	});
});

/**
 * Every hole finding at a value written empty is a point where the value starts, and
 * every point a hole finding has is such a place.
 */
function agrees(
	findings: readonly Finding[],
	empties: Readonly<Record<string, number>>,
): void {
	for (const f of findings.filter((f) => f.severity === "hole")) {
		const at = empties[f.path];
		if (at !== undefined) expect(f.range).toEqual([at, at]);
	}
	const places = new Set(Object.values(empties));
	for (const at of points(findings)) expect(places.has(at)).toBe(true);
}

const emptiesOf = (text: string) =>
	indexDocument(parseDocument(text, { prettyErrors: false }), text.length)
		.empties;

describe("holes at empty values are points there", () => {
	const envs: readonly [string, Env][] = [
		["empty", EMPTY_ENV],
		["with scales", ENV],
	];
	for (const [path, text] of Object.entries(QUESTIONS))
		for (const [label, env] of envs)
			it(`${path}, ${label} environment`, () => {
				const p = parseSurface(text, env);
				agrees(p.findings, p.empties);
			});

	const kinds: readonly SchemeKind[] = ["scale", "missing"];
	for (const [path, text] of Object.entries(SCALES))
		for (const kind of kinds)
			it(`${path} as ${kind}`, () => {
				agrees(evaluateScheme(kind, text, ENV, "x").findings, emptiesOf(text));
			});

	it("holds on hand-written questions, each with a point", () => {
		for (const text of [
			"name:\ntitle:\nselect:\nresponses:\n",
			"number:\n",
			"open:\n",
			"responses:\n",
			"number:\n  min:\nresponses:\n  1:\nselect:\n",
			"responses:\n  1:\n    label:\n    title:\n  2: B\nselect: many\n",
			"open:\n  max_length:\nfoo:\n",
			"universe:\ninstruction:\nlegacy:\n  a:\n",
		]) {
			const p = parseSurface(text, ENV);
			agrees(p.findings, p.empties);
			expect(points(p.findings).length, text).toBeGreaterThan(0);
		}
	});

	it("holds on hand-written scheme files, each with a point", () => {
		for (const [kind, text] of [
			["scale", "labels:\n"],
			["missing", "labels:\n"],
			["scale", "labels:\n  1: Yes\n  2:\n"],
			["universe", "text:\n"],
			["instruction", "text:\n"],
		] as const) {
			const ev = evaluateScheme(kind, text, ENV, "x");
			agrees(ev.findings, emptiesOf(text));
			expect(points(ev.findings).length, text).toBeGreaterThan(0);
		}
	});
});
