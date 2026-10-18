import { describe, expect, it } from "vitest";
import { DDI_FUNCTIONS } from "../cond/ast.ts";
import { evaluateCondition, type Value } from "../cond/eval.ts";
import { parseCondition } from "../cond/parse.ts";
import {
	type Atom,
	compileCondition,
	type Dnf,
	type Forms,
	MAX_TESTS,
} from "./logic.ts";
import type { Cond, Domain, Source } from "./read.ts";

const choice = (...codes: string[]): Extract<Domain, { kind: "choice" }> => ({
	kind: "choice",
	many: false,
	choices: codes.map((code) => ({ code, label: code })),
});
const answer = (
	variable: string,
	asks: string[],
	domain: Domain,
	option?: { code: string; ticked: string; unticked: string },
): Source => ({
	kind: "answer",
	variable,
	asks,
	question: { id: variable, name: variable, domain },
	...(option !== undefined && { option }),
});
const NUMBER: Domain = { kind: "number", decimals: 0 };
/** c: one of 1–3; o: option x of a select-all over x, y; n: a number; m: a number two exclusive asks record; i: an input. */
const SOURCES = new Map<string, Source>([
	["c", answer("c", ["A"], choice("1", "2", "3"))],
	[
		"o",
		answer(
			"o_x",
			["B"],
			{ ...choice("x", "y"), many: true },
			{
				code: "x",
				ticked: "1",
				unticked: "0",
			},
		),
	],
	["n", answer("n", ["C"], NUMBER)],
	["m", answer("m", ["D1", "D2"], NUMBER)],
	["i", { kind: "input", variable: "i" }],
	["r", { kind: "compute", variable: "r" }],
]);
const cond = (text: string): Cond => {
	const parsed = parseCondition(text, DDI_FUNCTIONS);
	expect(parsed.problems).toEqual([]);
	return { expr: parsed.expr, sources: SOURCES };
};

/** What each ask shows: skipped (undefined), the codes ticked, or a value typed. */
type Shown = Readonly<Record<string, readonly string[] | number | undefined>>;
type Fields = Readonly<Record<string, string | undefined>>;

/** A Qualtrics test as measured: on a skipped question only NotSelected, NotEqualTo and Empty hold. */
const test = (a: Atom, shown: Shown, fields: Fields): boolean => {
	const x =
		a.subject.kind === "ask" ? shown[a.subject.ask] : fields[a.subject.name];
	const v = a.value ?? "";
	const num = typeof x === "number";
	const cmp = (op: (l: number | string, r: number | string) => boolean) =>
		(typeof x === "string" || num) && op(x, num ? Number(v) : v);
	switch (a.op) {
		case "Selected":
			return Array.isArray(x) && x.includes(v);
		case "NotSelected":
			return !(Array.isArray(x) && x.includes(v));
		case "EqualTo":
			return cmp((l, r) => l === r);
		case "NotEqualTo":
			return !cmp((l, r) => l === r);
		case "GreaterThan":
			return cmp((l, r) => l > r);
		case "GreaterThanOrEqual":
			return cmp((l, r) => l >= r);
		case "LessThan":
			return cmp((l, r) => l < r);
		case "LessThanOrEqual":
			return cmp((l, r) => l <= r);
		case "Empty":
			return x === undefined;
		case "NotEmpty":
			return x !== undefined;
		default:
			return a.op satisfies never;
	}
};
const holds = (d: Dnf, shown: Shown, fields: Fields) =>
	d.some((g) => g.every((a) => test(a, shown, fields)));

/** Every way a respondent can answer: m's asks are exclusive, so at most one is shown. */
const worlds = (): {
	shown: Shown;
	fields: Fields;
	values: Record<string, Value>;
}[] => {
	const out: ReturnType<typeof worlds> = [];
	const cs = [undefined, ["1"], ["2"], ["3"]];
	const os = [undefined, ["x"], ["y"], ["x", "y"]];
	const ns = [undefined, 4, 5, 6];
	const ms: [string, number][] = [
		["D1", 4],
		["D1", 5],
		["D2", 5],
		["D2", 6],
	];
	for (const c of cs)
		for (const o of os)
			for (const n of ns)
				for (const m of [undefined, ...ms])
					for (const i of [undefined, "1", "2"])
						out.push({
							shown: { A: c, B: o, C: n, ...(m && { [m[0]]: m[1] }) },
							fields: { i },
							values: {
								c: c?.[0] ?? null,
								o: o === undefined ? null : o.includes("x") ? "1" : "0",
								n: n ?? null,
								m: m?.[1] ?? null,
								i: i ?? null,
							},
						});
	return out;
};
const WORLDS = worlds();

const agrees = (text: string, forms: Forms) => {
	const expr = cond(text).expr;
	for (const w of WORLDS) {
		const v = evaluateCondition(expr, (name) => w.values[name] ?? null);
		const got = {
			t: holds(forms.t, w.shown, w.fields),
			f: holds(forms.f, w.shown, w.fields),
			n: holds(forms.n, w.shown, w.fields),
			p: holds(forms.p, w.shown, w.fields),
		};
		const want = {
			t: v === true,
			f: v === false,
			n: v !== true,
			p: v !== false,
		};
		if (JSON.stringify(got) !== JSON.stringify(want))
			return `${text} at ${JSON.stringify(w.values)}: ${JSON.stringify(got)}`;
	}
	return undefined;
};

const ATOMS = [
	'c = "1"',
	'c <> "2"',
	'"3" = c',
	'c = "9"',
	'c in {"1", "2"}',
	'c not_in {"1"}',
	"isnull(c)",
	'o = "1"',
	'o = "0"',
	'o <> "1"',
	'o = "7"',
	"isnull(o)",
	"n > 5",
	"5 <= n",
	"n = 5",
	"n <> 5",
	"between(n, 4, 5)",
	"isnull(n)",
	"m >= 5",
	"m < 5",
	"m <> 4",
	"isnull(m)",
	'i = "1"',
	'i <> "1"',
	"isnull(i)",
	"true",
];

describe("conditions as Qualtrics logic", () => {
	it("agrees with the condition's own value, in every answer, for every test alone", () => {
		const wrong = ATOMS.flatMap((a) =>
			[a, `not (${a})`].flatMap((text) => {
				const { forms, problem } = compileCondition(cond(text));
				if (forms === undefined) return [`${text}: ${problem}`];
				return agrees(text, forms) ?? [];
			}),
		);
		expect(wrong).toEqual([]);
	});

	it("agrees for every pair of tests joined by and, or and xor, and negated", () => {
		const wrong: string[] = [];
		for (const a of ATOMS)
			for (const b of ATOMS)
				for (const op of ["and", "or", "xor"])
					for (const text of [
						`(${a}) ${op} (${b})`,
						`not ((${a}) ${op} (${b}))`,
					]) {
						const { forms, problem } = compileCondition(cond(text));
						const found =
							forms === undefined ? `${text}: ${problem}` : agrees(text, forms);
						if (found !== undefined) wrong.push(found);
					}
		expect(wrong.slice(0, 5)).toEqual([]);
	});

	it("inlines a computed condition where it's read, and refuses one it can't", () => {
		const r = cond('c = "1" and n > 5');
		const { forms } = compileCondition(cond("not r"), (v) =>
			v === "r" ? r : undefined,
		);
		expect(forms && agrees('not (c = "1" and n > 5)', forms)).toBeUndefined();
		expect(compileCondition(cond("r")).problem).toMatch(/computed/);
	});

	it("writes the tests Qualtrics reads", () => {
		const { forms } = compileCondition(cond('c = "1" or n >= 5'));
		const ask = (a: string) => ({ kind: "ask", ask: a });
		expect(forms?.t).toEqual([
			[{ subject: ask("A"), op: "Selected", value: "1" }],
			[{ subject: ask("C"), op: "GreaterThanOrEqual", value: "5" }],
		]);
		expect(compileCondition(cond('i <> "1"')).forms?.t).toEqual([
			[
				{ subject: { kind: "field", name: "i" }, op: "NotEqualTo", value: "1" },
				{ subject: { kind: "field", name: "i" }, op: "NotEmpty" },
			],
		]);
	});

	it("says what Qualtrics can't test", () => {
		const problem = (text: string) => compileCondition(cond(text)).problem;
		expect(problem("n + 1 > 5")).toMatch(/compares an answer/);
		expect(problem("n > m")).toMatch(/compares an answer/);
		expect(problem('c > "1"')).toMatch(/`=` and `<>`/);
		const wide = Array.from(
			{ length: 9 },
			(_, k) => `(n = ${k} or i = "${k}")`,
		).join(" and ");
		expect(problem(wide)).toBe("too-large");
		expect(2 ** 9).toBeGreaterThan(MAX_TESTS);
	});
});
