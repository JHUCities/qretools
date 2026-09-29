import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import type { Finding } from "../findings.js";
import { evaluateScheme, type SchemeKind } from "../schemes.js";
import { EMPTY_ENV, type Env } from "./env.js";
import type { Mark } from "./marks.js";
import { indexDocument, parseSurface } from "./parse.js";
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
			`hole@${text.indexOf("title:") + "title:".length}`,
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

	it("marks empty option fields, domain fields and domains, not legacy", () => {
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
			{ kind: "hole", range: [7, 7] },
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

/**
 * Chips and hole findings agree both ways: every chip is a hole finding at a value
 * written empty, and every such finding has exactly one chip, where the value starts.
 */
function agrees(
	marks: readonly Mark[],
	findings: readonly Finding[],
	empties: Readonly<Record<string, number>>,
): void {
	const chips = marks.filter((m) => m.kind === "hole").map((m) => m.range[0]);
	const holes = findings.filter((f) => f.severity === "hole");
	for (const at of chips)
		expect(holes.some((f) => empties[f.path] === at)).toBe(true);
	for (const f of holes) {
		const at = empties[f.path];
		if (at === undefined) continue;
		expect(chips.filter((c) => c === at)).toHaveLength(1);
	}
}

const emptiesOf = (text: string) =>
	indexDocument(parseDocument(text, { prettyErrors: false }), text.length)
		.empties;

describe("hole chips and hole findings agree", () => {
	const envs: readonly [string, Env][] = [
		["empty", EMPTY_ENV],
		["with scales", ENV],
	];
	for (const [path, text] of Object.entries(QUESTIONS))
		for (const [label, env] of envs)
			it(`${path}, ${label} environment`, () => {
				const p = parseSurface(text, env);
				agrees(p.marks, p.findings, p.empties);
			});

	const kinds: readonly SchemeKind[] = ["scale", "missing"];
	for (const [path, text] of Object.entries(SCALES))
		for (const kind of kinds)
			it(`${path} as ${kind}`, () => {
				const ev = evaluateScheme(kind, text, ENV);
				agrees(ev.marks, ev.findings, emptiesOf(text));
			});

	it("holds on hand-written questions, each with a chip", () => {
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
			agrees(p.marks, p.findings, p.empties);
			expect(
				p.marks.some((m) => m.kind === "hole"),
				text,
			).toBe(true);
		}
	});

	it("holds on hand-written scheme files, each with a chip", () => {
		for (const [kind, text] of [
			["scale", "labels:\n"],
			["missing", "labels:\n"],
			["scale", "labels:\n  1: Yes\n  2:\n"],
			["universe", "text:\n"],
			["instruction", "text:\n"],
		] as const) {
			const ev = evaluateScheme(kind, text, ENV);
			agrees(ev.marks, ev.findings, emptiesOf(text));
			expect(
				ev.marks.some((m) => m.kind === "hole"),
				text,
			).toBe(true);
		}
	});
});
