import {
	DDI_FUNCTIONS,
	evaluateCondition,
	parseCondition,
	type Value,
} from "@qretools/core";
import { describe, expect, it } from "vitest";
import {
	type Atom,
	compileCondition,
	type Dnf,
	type Form,
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
	["k", { kind: "input", variable: "k", domain: NUMBER }],
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

/**
 * A Qualtrics test as measured (experiments 2, 4 and 6): on a skipped question or an empty
 * field only NotSelected, NotEqualTo and Empty hold; a typed number compares as a number;
 * an embedded field orders as a number but EqualTo compares its text.
 */
const test = (a: Atom, shown: Shown, fields: Fields): boolean => {
	const x =
		a.subject.kind === "ask" ? shown[a.subject.ask] : fields[a.subject.name];
	const v = a.value ?? "";
	const num = typeof x === "number";
	const cmp = (op: (l: number | string, r: number | string) => boolean) =>
		(typeof x === "string" || num) &&
		(num || a.subject.kind === "field" ? op(Number(x), Number(v)) : op(x, v));
	const same = () => (num ? x === Number(v) : typeof x === "string" && x === v);
	switch (a.op) {
		case "Selected":
			return Array.isArray(x) && x.includes(v);
		case "NotSelected":
			return !(Array.isArray(x) && x.includes(v));
		case "EqualTo":
			return same();
		case "NotEqualTo":
			return !same();
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
						for (const k of [undefined, "05", "6"])
							out.push({
								shown: { A: c, B: o, C: n, ...(m && { [m[0]]: m[1] }) },
								fields: { i, k },
								values: {
									c: c?.[0] ?? null,
									o: o === undefined ? null : o.includes("x") ? "1" : "0",
									n: n ?? null,
									m: m?.[1] ?? null,
									i: i ?? null,
									k: k === undefined ? null : Number(k),
								},
							});
	return out;
};
const WORLDS = worlds();
/** What each name reads in a world: its asks, or its field. */
const READS: Readonly<Record<string, readonly string[]>> = {
	c: ["A"],
	o: ["B"],
	n: ["C"],
	m: ["D1", "D2"],
	i: ["i"],
	k: ["k"],
};

/** Where a form's lists disagree with the condition's own value, or undefined; a form too large to write isn't checked. */
const agrees = (text: string, forms: Forms) => {
	const expr = cond(text).expr;
	const at = (d: Form, shown: Shown, fields: Fields) =>
		d === "too-large" ? undefined : holds(d, shown, fields);
	// Only the answers to the names it reads tell worlds apart: one world for each.
	const used = [...SOURCES.keys()].filter((n) =>
		new RegExp(`\\b${n}\\b`).test(text),
	);
	const seen = new Set<string>();
	for (const w of WORLDS) {
		const key = JSON.stringify(
			used.flatMap((n) =>
				(READS[n] ?? []).map((r) => w.shown[r] ?? w.fields[r] ?? null),
			),
		);
		if (seen.has(key)) continue;
		seen.add(key);
		const v = evaluateCondition(expr, (name) => w.values[name] ?? null);
		const want = {
			t: v === true,
			f: v === false,
			n: v !== true,
			p: v !== false,
		};
		for (const k of ["t", "f", "n", "p"] as const) {
			const got = at(forms[k], w.shown, w.fields);
			if (got !== undefined && got !== want[k])
				return `${text}, ${k}, at ${JSON.stringify(w.values)}: ${got}`;
		}
	}
	return undefined;
};
const compiled = (
	text: string,
	computed?: (v: string) => Cond | undefined,
): Forms | string => {
	const c = compileCondition(
		cond(text),
		computed &&
			((v) => {
				const value = computed(v);
				return value === undefined
					? { kind: "refused", why: `\`${v}\` isn't inlined` }
					: { kind: "inline", value };
			}),
	);
	return c.kind === "ok" ? c.forms : c.message;
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
	"k = 5",
	"k <> 5",
	"k > 5",
	"isnull(k)",
	"true",
];

// The model of Qualtrics above compares numbers as numbers and treats an empty field as a
// skipped question: assumptions, as logic.ts says, until experiment 6 measures them.
describe("conditions as Qualtrics logic", () => {
	it("agrees with the condition's own value, in every answer, for every test alone", () => {
		const wrong = ATOMS.flatMap((a) =>
			[a, `not (${a})`].flatMap((text) => {
				const forms = compiled(text);
				if (typeof forms === "string") return [`${text}: ${forms}`];
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
						const forms = compiled(text);
						const found =
							typeof forms === "string"
								? `${text}: ${forms}`
								: forms.t === "too-large"
									? `${text}: too large to say when it's true`
									: agrees(text, forms);
						if (found !== undefined) wrong.push(found);
					}
		expect(wrong.slice(0, 5)).toEqual([]);
		// Every pair in every answer: about 2 s alone, more beside the whole suite.
	}, 30_000);

	it("inlines a computed condition where it's read, and refuses one it can't", () => {
		const r = cond('c = "1" and n > 5');
		const inR = (v: string) => (v === "r" ? r : undefined);
		const forms = compiled("not r", inR);
		if (typeof forms === "string") throw new Error(forms);
		expect(agrees('not (c = "1" and n > 5)', forms)).toBeUndefined();
		const unknown = compiled("isnull(r)", inR);
		if (typeof unknown === "string") throw new Error(unknown);
		expect(agrees('isnull(c = "1" and n > 5)', unknown)).toBeUndefined();
		expect(compiled("r")).toMatch(/a number/);
		expect(compiled("r", () => cond("r or n > 5"))).toMatch(/from itself/);
	});

	it("writes the tests Qualtrics reads", () => {
		const ask = (a: string) => ({ kind: "ask", ask: a });
		expect((compiled('c = "1" or n >= 5') as Forms).t).toEqual([
			[{ subject: ask("A"), op: "Selected", value: "1" }],
			[{ subject: ask("C"), op: "GreaterThanOrEqual", value: "5" }],
		]);
		expect((compiled('i <> "1"') as Forms).t).toEqual([
			[
				{ subject: { kind: "field", name: "i" }, op: "NotEqualTo", value: "1" },
				{ subject: { kind: "field", name: "i" }, op: "NotEmpty" },
			],
		]);
	});

	it("says what Qualtrics can't test, and what the DDI shouldn't say", () => {
		expect(compiled("n + 1 > 5")).toMatch(/compare an answer/);
		expect(compiled("n > m")).toMatch(/compare an answer/);
		expect(compiled('c > "1"')).toMatch(/`=` or `<>`/);
		expect(compiled("c = 1")).toMatch(/code in quotes/);
		expect(compiled('n = "5"')).toMatch(/with a number/);
		expect(compiled('i > "1"')).toMatch(/orders text/);
		expect(compiled("i = 1")).toMatch(/no type/);
		expect(compiled('r = "5"')).toMatch(/with a number/);
		expect((compiled("r >= 5") as Forms).t).toEqual([
			[
				{
					subject: { kind: "field", name: "r" },
					op: "GreaterThanOrEqual",
					value: "5",
				},
			],
		]);
	});

	it("keeps a wide condition's true list, and gives up on its else list quickly", () => {
		const names = Array.from({ length: 14 }, (_, k) => `n${k}`);
		const parsed = parseCondition(names.map((n) => `${n} > 5`).join(" or "));
		const wide: Cond = {
			expr: parsed.expr,
			sources: new Map(names.map((n) => [n, answer(n, [n], NUMBER)])),
		};
		const start = Date.now();
		const result = compileCondition(wide);
		expect(Date.now() - start).toBeLessThan(500);
		if (result.kind !== "ok") throw new Error(result.message);
		const forms = result.forms;
		expect(forms.t).not.toBe("too-large");
		expect(forms.n).toBe("too-large");
		const product = Array.from(
			{ length: 9 },
			(_, k) => `(n = ${k} or i = "${k}")`,
		).join(" and ");
		expect((compiled(product) as Forms).t).toBe("too-large");
		expect(2 ** 9).toBeGreaterThan(MAX_TESTS);
	});
});
