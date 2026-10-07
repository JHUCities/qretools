import { describe, expect, it } from "vitest";
import type { Finding } from "./findings.ts";
import { EMPTY_ENV } from "./surface/env.ts";
import { parseSurface } from "./surface/parse.ts";
import {
	bankFindings,
	indexOf,
	othersOf,
	schemeSymbols,
	symbolsOf,
	usedBy,
} from "./symbols.ts";

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

describe("duplication across the bank", () => {
	const label = (k: string) => k;
	const indexed = (files: Record<string, ReturnType<typeof symbols>>) =>
		indexOf(Object.entries(files).map(([key, s]) => ({ key, symbols: s })));
	const codes = (
		files: Record<string, ReturnType<typeof symbols>>,
		k: string,
	) =>
		bankFindings(
			k,
			files[k] as ReturnType<typeof symbols>,
			indexed(files),
			label,
		).map((f) => `${f.severity}:${f.code}@${f.path}`);

	it("finds the same question text, as written or apart from case and punctuation, on each file", () => {
		const files = {
			a: symbols("name: a\ntext: Are you registered to vote?\n"),
			b: symbols("name: b\ntext: are you registered to vote\n"),
			c: symbols("name: c\ntext: Something else entirely?\n"),
		};
		const index = indexed(files);
		const [f] = bankFindings("a", files.a, index, label);
		expect(f).toMatchObject({
			code: "duplicate-text",
			severity: "warning",
			path: "text",
			others: ["b"],
		});
		expect(f?.message).toBe(
			"The same question text is in `b` (apart from case or punctuation).",
		);
		expect(codes(files, "b")).toEqual(["warning:duplicate-text@text"]);
		expect(codes(files, "c")).toEqual([]);
	});

	it("says nothing about a pair either side marks as a variant, and flags a name that isn't a question", () => {
		const files = {
			a: symbols(
				"name: a\ntext: How much more should we spend?\nvariant_of:\n  b: split ballot, less\n",
			),
			b: symbols("name: b\ntext: How much more should we spend?\n"),
			c: symbols("name: c\ntext: Other\nvariant_of:\n  nobody: why\n"),
		};
		expect(codes(files, "a")).toEqual([]);
		expect(codes(files, "b")).toEqual([]);
		expect(codes(files, "c")).toEqual([
			"warning:unknown-variant@variant_of.nobody",
		]);
	});

	it("compares response lists by labels, codes ignored, and like with like", () => {
		const files = {
			a: symbols("name: a\nresponses:\n  1: Often\n  2: Never\n"),
			b: symbols("name: b\nresponses:\n  x: often\n  y: never\n"),
			c: symbols("name: c\nresponses: often2\n"),
		};
		expect(codes(files, "a")).toEqual(["warning:duplicate-list@responses"]);
		expect(codes(files, "c")).toEqual([]);
	});

	it("finds two shared scales with the same labels", () => {
		const files = {
			yesno01: schemeSymbols("scale", {
				kind: "labels",
				codes: [
					{ code: "0", label: "No" },
					{ code: "1", label: "Yes" },
				],
			}),
			yes_no_01: schemeSymbols("scale", {
				kind: "labels",
				codes: [
					{ code: "0", label: "No" },
					{ code: "1", label: "Yes" },
				],
			}),
		};
		const index = indexed(files);
		expect(
			bankFindings("yesno01", files.yesno01, index, label)[0]?.message,
		).toBe("The same labels are in the shared scale `yes_no_01`.");
	});

	it("notes similar wording as info, quoting the other", () => {
		const files = {
			a: symbols(
				"name: a\ntext: How strongly do you agree that Black residents are treated fairly by police officers in your own neighborhood these days?\n",
			),
			b: symbols(
				"name: b\ntext: How strongly do you agree that White residents are treated fairly by police officers in your own neighborhood these days?\n",
			),
		};
		const [f] = bankFindings("a", files.a, indexed(files), label);
		expect(f).toMatchObject({
			code: "similar-text",
			severity: "info",
			others: ["b"],
		});
		expect(f?.message).toMatch(/^Reads like `b`: “How strongly/);
	});
});

describe("the other files a finding names", () => {
	it("are read from the finding, so an older copy (a list settling after typing) still has them", () => {
		const files = {
			a: symbols("name: a\ntext: Same?\n"),
			b: symbols("name: b\ntext: Same?\n"),
		};
		const index = indexOf(
			Object.entries(files).map(([key, s]) => ({ key, symbols: s })),
		);
		const [before] = bankFindings("a", files.a, index, (k) => k);
		const settled = { ...before } as Finding;
		expect(othersOf<string>(settled)).toEqual(["b"]);
		expect(
			othersOf({ code: "hole", severity: "hole", path: "", message: "" }),
		).toEqual([]);
	});
});

describe("two concept files with the same label", () => {
	it("report on each other", () => {
		const files = {
			trust: schemeSymbols("concept", {
				kind: "labelled",
				entry: { label: "Trust in government" },
			}),
			gov_trust: schemeSymbols("concept", {
				kind: "labelled",
				entry: { label: "trust in government." },
			}),
		};
		const index = indexOf(
			Object.entries(files).map(([key, s]) => ({ key, symbols: s })),
		);
		expect(
			bankFindings("trust", files.trust, index, (k) => k)[0],
		).toMatchObject({
			code: "duplicate-concept",
			path: "label",
			others: ["gov_trust"],
		});
	});
});
