import { describe, expect, it } from "vitest";
import { type Expr, holesOf, namesOf } from "./ast.ts";
import { evaluateCondition, UNKNOWN, type Value } from "./eval.ts";
import { parseCondition } from "./parse.ts";
import { printCondition } from "./print.ts";
import { type Scope, type Type, typeCondition, typeOf } from "./type.ts";

const print = (text: string) => printCondition(parseCondition(text).expr);
const problems = (text: string) =>
	parseCondition(text).problems.map((p) => p.message);

const SAT: Type = {
	kind: "code",
	codes: [
		{ code: "1", label: "Satisfied" },
		{ code: "2", label: "Neutral" },
		{ code: "3", label: "Dissatisfied" },
		{ code: "-8", label: "Refused" },
	],
};
const scope: Scope = (name) =>
	({
		"bas.nhd_sat": SAT,
		"bas.veh_n": { kind: "number" } as Type,
		renter: { kind: "boolean" } as Type,
	})[name];
const typed = (text: string) => typeOf(parseCondition(text).expr, scope);

describe("parsing conditions", () => {
	it("reads VTL's scalar operators in its evaluation order", () => {
		expect(print('bas.nhd_sat in {"2", "3"} and bas.veh_n >= 1 + 2 * 3')).toBe(
			'bas.nhd_sat in {"2", "3"} and bas.veh_n >= 1 + 2 * 3',
		);
		expect(print("(a or b) and c")).toBe("(a or b) and c");
		expect(print("a or b and c")).toBe("a or b and c");
		expect(print("a - (b - c)")).toBe("a - (b - c)");
		expect(print("isnull(x) or between(n, 18, 64)")).toBe(
			"isnull(x) or between(n, 18, 64)",
		);
	});

	it("binds `not` tighter than `=`, as VTL does", () => {
		const { expr } = parseCondition('not x = "1"');
		expect(expr.kind === "binary" && expr.left.kind).toBe("unary");
		expect(print('not(x = "1")')).toBe('not (x = "1")');
	});

	it("leaves a hole where a value is still to be written, without a problem", () => {
		for (const text of ["", "bas.x =", "x and", 'x in {"1", }', "isnull()"]) {
			const { expr } = parseCondition(text);
			expect([text, holesOf(expr).length > 0]).toEqual([text, true]);
		}
		expect(problems("bas.x =")).toEqual([]);
	});

	it("says what's wrong at its place, and carries on", () => {
		expect(problems('x = "1')).toEqual(["This text has no closing quote."]);
		expect(problems("(x = 1")).toEqual(["This `(` isn't closed."]);
		expect(problems("x in 1")[0]).toBe("`in` takes a set of values in braces.");
		expect(problems("x = 1 y = 2")[0]).toMatch(/doesn't follow/);
		expect(problems("x @ 1")[0]).toBe("`@` isn't part of a condition.");
		expect(problems("count(x) > 1")[0]).toBe(
			"`count` isn't a function conditions can use.",
		);
		expect(parseCondition('x = "1' + '"').problems).toEqual([]);
	});

	it("reads other languages' operators, and says how VTL writes each", () => {
		const fixes = (text: string) =>
			parseCondition(text).problems.map((p) => p.replace);
		expect(fixes('x == "1" | x != "2" && !y')).toEqual([
			"=",
			"or",
			"<>",
			"and",
			"not ",
		]);
		expect(print('x == "1" || y')).toBe('x = "1" or y');
	});

	it("knows the names it reads, and where", () => {
		expect(namesOf(parseCondition("a.b = c").expr)).toEqual([
			{ name: "a.b", range: [0, 3] },
			{ name: "c", range: [6, 7] },
		]);
	});

	it("never throws, and keeps every range inside the text, whatever it's given", () => {
		const alphabet = ' ab.1"(){},=<>-+*/!andornotin_\n';
		let seed = 7;
		const random = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		for (let i = 0; i < 3000; i++) {
			const length = Math.floor(random() * 24);
			let text = "";
			for (let j = 0; j < length; j++)
				text += alphabet[Math.floor(random() * alphabet.length)];
			const { expr, problems } = parseCondition(text);
			const ranges = [
				...problems.map((p) => p.range),
				...holesOf(expr),
				...namesOf(expr).map((n) => n.range),
				expr.range,
			];
			for (const [from, to] of ranges)
				expect([text, from >= 0 && from <= to && to <= text.length]).toEqual([
					text,
					true,
				]);
			// Printing and reading again gives the same expression, holes included.
			const printed = printCondition(expr);
			if (problems.length === 0 && holesOf(expr).length === 0)
				expect(print(printed)).toBe(printed);
		}
	});
});

describe("typing conditions against the questions", () => {
	it("accepts what fits", () => {
		for (const text of [
			'bas.nhd_sat = "1"',
			'bas.nhd_sat in {"2", "3"}',
			"bas.veh_n >= 1 and renter",
			"isnull(bas.nhd_sat) or between(bas.veh_n, 0, 20)",
			'not (bas.nhd_sat = "-8")',
		])
			expect([text, typed(text).problems]).toEqual([text, []]);
		expect(typed("bas.veh_n + 1").type.kind).toBe("number");
	});

	it("tells a code from a number, with the fix when the code exists", () => {
		const [p] = typed("bas.nhd_sat = 1").problems;
		expect(p?.message).toBe('A code is text: write `"1"`.');
		expect(p?.replace).toBe('"1"');
		expect(p?.range).toEqual([14, 15]);
		const [none] = typed("bas.nhd_sat = 7").problems;
		expect(none?.replace).toBeUndefined();
		expect(none?.hint).toContain('"1" Satisfied');
	});

	it("says `= null` is never true, with `isnull` as the fix", () => {
		const [p] = typed("bas.veh_n = null").problems;
		expect(p?.replace).toBe("isnull(bas.veh_n)");
		expect(typed("bas.veh_n <> null").problems[0]?.replace).toBe(
			"not isnull(bas.veh_n)",
		);
	});

	it("tells a condition from an answer", () => {
		const scoped = (text: string) =>
			typeCondition(parseCondition(text).expr, scope).problems.map(
				(p) => p.message,
			);
		expect(scoped("bas.nhd_sat")).toEqual([
			"This is a coded answer, not a condition.",
		]);
		expect(scoped('bas.nhd_sat = "1"')).toEqual([]);
		expect(scoped("")).toEqual([]);
	});

	it("says what kind of problem each is", () => {
		expect(typed('nope = "1"').problems[0]?.kind).toBe("unknown-name");
		expect(typed("bas.veh_n and renter").problems[0]?.kind).toBe("type");
		expect(parseCondition('x = "1').problems[0]?.kind).toBe("syntax");
	});

	it("names a code that doesn't exist, listing those that do", () => {
		const [p] = typed('bas.nhd_sat in {"1", "9"}').problems;
		expect(p?.message).toBe("`\"9\"` isn't one of this answer's codes.");
		expect(p?.hint).toContain('"2" Neutral');
	});

	it("won't order codes, which are text", () => {
		expect(typed('bas.nhd_sat > "2"').problems[0]?.hint).toContain("in");
	});

	it("says once that a name is unknown, not again for everything around it", () => {
		expect(
			typed('nope = "1" and nope > 2').problems.map((p) => p.message),
		).toEqual([
			"Nothing is named `nope` here.",
			"Nothing is named `nope` here.",
		]);
		expect(typed('bas.veh_n = "x"').problems).toHaveLength(1);
	});

	it("explains `not`'s precedence where it bites", () => {
		expect(typed('not bas.nhd_sat = "1"').problems[0]?.hint).toContain(
			'not(bas.x = "1")',
		);
	});
});

describe("evaluating conditions", () => {
	const value = (text: string, values: Record<string, Value>) =>
		evaluateCondition(parseCondition(text).expr, (n) => values[n] ?? null);

	it("is three-valued: unanswered is null, and null and false is false", () => {
		expect(value('x = "1"', { x: "1" })).toBe(true);
		expect(value('x = "1"', {})).toBe(null);
		expect(value('x = "1" and y = "1"', { y: "2" })).toBe(false);
		expect(value('x = "1" or y = "1"', { y: "1" })).toBe(true);
		expect(value('not x = "1"', {})).toBe(null);
		expect(value("isnull(x)", {})).toBe(true);
		expect(value('x in {"1", "2"}', { x: "2" })).toBe(true);
		expect(value('x not_in {"1", "2"}', { x: "2" })).toBe(false);
		expect(value("between(n, 1, 3)", { n: 3 })).toBe(true);
		expect(value("n / 0", { n: 3 })).toBe(null);
	});

	it("leaves a hole undecided, never false, except where its value can't matter", () => {
		const hole: Expr = { kind: "hole", range: [0, 0] };
		expect(evaluateCondition(hole, () => 1)).toBe(UNKNOWN);
		expect(value("isnull()", {})).toBe(UNKNOWN);
		expect(value('x = "1" and', { x: "1" })).toBe(UNKNOWN);
		expect(value('x = "1" and', { x: "2" })).toBe(false);
		expect(value('x = "1" or', { x: "1" })).toBe(true);
		expect(value('x in {"1", }', { x: "1" })).toBe(true);
	});

	it("gives null, not JavaScript's coercions, for operands of the wrong type", () => {
		expect(value("1 and 2", {})).toBe(null);
		expect(value('n > "1"', { n: 2 })).toBe(null);
		expect(value("between(s, 1, 3)", { s: "2" })).toBe(null);
	});
});
