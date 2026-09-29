import { describe, expect, it } from "vitest";
import { EMPTY_ENV } from "./surface/env.js";
import { parseSurface } from "./surface/parse.js";
import { bankFindings, indexOf, symbolsOf, usedBy } from "./symbols.js";

const symbols = (text: string) => symbolsOf(parseSurface(text, EMPTY_ENV));

describe("the bank index", () => {
	const bank = {
		a: symbols("name: a\nresponses: agree4\nuniverse: renters\n"),
		b: symbols(
			"name: b\nselect: many\nresponses:\n  x: { label: X, variable: shared }\n  y: Y\n",
		),
		c: symbols("name: c\nresponses:\n  x: { label: X }\nnumber:\n  min: 0\n"),
		d: symbols("name: shared\nopen: {}\n"),
		e: symbols("universe: All respondents\n"),
	};
	const index = indexOf(
		Object.entries(bank).map(([key, s]) => ({ key, symbols: s })),
	);

	it("counts names as written, resolved or not", () => {
		expect(usedBy(index, "scale", "agree4")).toEqual([
			{ key: "a", path: "responses" },
		]);
		expect(usedBy(index, "universe", "renters")).toHaveLength(1);
		// Prose is not a name.
		expect(index.mentions.size).toBe(2);
	});

	it("defines the question's own variable, or one per option", () => {
		expect(bank.b.defines.map((d) => d.name)).toEqual(["shared", "b_y"]);
		expect(bank.d.defines).toEqual([{ name: "shared", path: "name" }]);
		expect(bank.e.defines).toEqual([]);
	});

	it("attaches a variable defined twice to each file involved", () => {
		const label = (k: string) => k;
		expect(bankFindings("b", bank.b, index, label)).toMatchObject([
			{
				code: "duplicate-variable",
				path: "responses.x",
				message: "Variable `shared` is also defined by d.",
			},
		]);
		expect(bankFindings("d", bank.d, index, label)[0]?.message).toMatch(
			/also defined by b/,
		);
		expect(bankFindings("a", bank.a, index, label)).toEqual([]);
	});
});
