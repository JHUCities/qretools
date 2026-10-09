import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Bank } from "../evaluate.ts";
import { bankOf } from "../evaluate.ts";
import { instrumentCompletion } from "../instrument/complete.ts";
import { readBank } from "./index.ts";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

const HEAD = [
	"uses:",
	"  hh: ../households",
	"inputs:",
	"  county:",
	"    responses:",
	'      "1": North',
	"flow:",
	"  - compute: renter",
	'    value: hh.tenure = "2"',
	"  - roster: members",
	"    count: hh.size",
	"    flow: []",
	"",
].join("\n");

describe("completion in an instrument", async () => {
	const banks: Record<string, Bank> = {
		hh: bankOf(await readBank(here("../../fixtures/households"))),
	};
	/** Complete at the `|` in the text, after the shared head. */
	const at = (text: string, with_ = banks) => {
		const source = HEAD + text;
		const offset = source.indexOf("|");
		const result = instrumentCompletion(source.replace("|", ""), offset, with_);
		return result === undefined
			? undefined
			: {
					typed: source.slice(result.from, offset),
					labels: result.options.map((o) => o.label),
					options: result.options,
				};
	};

	it("offers the banks' questions after `ask:`, with no space yet or at the end of the text", () => {
		for (const text of [
			"  - ask: |",
			"  - ask:|",
			"  - ask: |\n  - say: x\n",
		]) {
			const r = at(text);
			expect(r?.typed).toBe("");
			expect(r?.labels).toContain("hh.size");
		}
		const size = at("  - ask: |")?.options.find((o) => o.label === "hh.size");
		expect(size).toMatchObject({
			kind: "question",
			detail: "How many people live in your household, including you?",
		});
	});

	it("replaces the whole name being typed, from its start", () => {
		expect(at("  - ask: hh.|")?.typed).toBe("hh.");
		expect(at("  - ask: hh.co|")?.typed).toBe("hh.co");
	});

	it("offers nothing with the caret inside a word", () => {
		expect(at("  - ask: hh.si|ze")).toBeUndefined();
		expect(at("  - if: hh.si|ze > 1\n    then: []\n")).toBeUndefined();
	});

	it("offers the names a condition reads, in conditions however they're written", () => {
		const plain = at("  - if: hh.si|\n    then: []\n");
		expect(plain?.typed).toBe("hh.si");
		expect(plain?.labels.slice(0, 3)).toEqual([
			"county",
			"renter",
			"members.index",
		]);
		expect(plain?.labels).toContain("hh.size");
		expect(plain?.options.slice(0, 3).map((o) => o.detail)).toEqual([
			"from outside",
			"computed",
			"row number",
		]);
		expect(at('  - if: "hh.size > 2 and hh.co|"\n    then: []\n')?.typed).toBe(
			"hh.co",
		);
		expect(
			at("  - if: >\n      hh.size > 2 and hh.co|\n    then: []\n")?.typed,
		).toBe("hh.co");
		expect(at("  - if: hh.size > |\n    then: []\n")?.typed).toBe("");
	});

	it("offers nothing inside a condition's string, or past a quoted value's closing quote", () => {
		expect(at('  - stop: "hh.tenure and \\"x|\\""\n')).toBeUndefined();
		expect(at('  - say: x\n    stop: hh.tenure > "2|"\n')).toBeUndefined();
		expect(at('  - ask: "hh.co"|\n')).toBeUndefined();
		expect(at("  - ask: 'hh.co'|\n")).toBeUndefined();
		expect(at('  - if: "renter and hh"|\n    then: []\n')).toBeUndefined();
		// Inside the quotes it still completes.
		expect(at('  - ask: "hh.co|"\n')?.typed).toBe("hh.co");
	});

	it("offers a coded answer's codes where one is compared, each with its label", () => {
		/** The text a pick of `"2"` leaves, as CodeMirror would apply it. */
		const pick = (text: string, code = '"2"') => {
			const source = HEAD + text;
			const offset = source.indexOf("|");
			const clean = source.replace("|", "");
			const r = instrumentCompletion(clean, offset, banks);
			const o = r?.options.find((x) => x.label === code);
			if (r === undefined || o === undefined) return undefined;
			return (
				clean.slice(0, r.from) +
				(o.apply ?? o.label) +
				clean.slice(r.to ?? offset)
			).slice(HEAD.length);
		};
		const r = at("  - stop: hh.tenure = |\n");
		expect(r?.options).toEqual([
			{ label: '"1"', kind: "code", detail: "Own" },
			{ label: '"2"', kind: "code", detail: "Rent" },
			{ label: '"3"', kind: "code", detail: "Neither" },
			// The bank's missing codes are answers too.
			{ label: '"-8"', kind: "code", detail: "Refused" },
			{ label: '"-9"', kind: "code", detail: "Don't know" },
		]);
		// Closed quotes (as closeBrackets pairs them), open, inside a code, or none:
		// one well-formed code each time.
		for (const text of [
			'  - stop: hh.tenure = "|"\n',
			'  - stop: hh.tenure = "1|"\n',
			'  - stop: hh.tenure = "|\n',
			"  - stop: hh.tenure = |\n",
		])
			expect(pick(text)).toBe('  - stop: hh.tenure = "2"\n');
		expect(pick("  - stop: hh.tenure <> |\n")).toBe(
			'  - stop: hh.tenure <> "2"\n',
		);
		expect(pick("  - stop: county = |\n", '"1"')).toBe(
			'  - stop: county = "1"\n',
		);
		// Touching the operator or a comma, a code brings its own space; never a second one.
		for (const text of [
			"  - stop: hh.tenure =|\n",
			'  - stop: hh.tenure ="|"\n',
			'  - stop: hh.tenure ="|\n',
		])
			expect(pick(text)).toBe('  - stop: hh.tenure = "2"\n');
		expect(pick("  - stop: 'hh.tenure in {\"1\",|}'\n")).toBe(
			'  - stop: \'hh.tenure in {"1", "2"}\'\n',
		);
		expect(pick("  - stop: 'hh.tenure in {|}'\n")).toBe(
			"  - stop: 'hh.tenure in {\"2\"}'\n",
		);
		expect(pick('  - stop: "hh.tenure in {\\"1\\",|}"\n')).toBe(
			'  - stop: "hh.tenure in {\\"1\\", \\"2\\"}"\n',
		);
		// Inside a double-quoted value its quotes are escaped.
		expect(pick('  - stop: "hh.tenure in {\\"1\\", |}"\n')).toBe(
			'  - stop: "hh.tenure in {\\"1\\", \\"2\\"}"\n',
		);
	});

	it("offers a select-all option's codes: chosen or not, and the bank's missing ones", () => {
		const b = bankOf({
			"bank.yaml": "agency: org.example\n",
			"missing.yaml": 'labels:\n  "-9": Don\'t know\n',
			"questions/t/q.yaml":
				'name: q\ntext: Which?\nintent: Which.\nselect: many\nresponses:\n  "1": A\n  "2": B\n',
		});
		const source = 'uses:\n  b: ./b\nflow:\n  - stop: b.q_1 = ""\n';
		const r = instrumentCompletion(source, source.length - 2, { b });
		expect(r?.options.map((o) => [o.label, o.detail])).toEqual([
			['"0"', "No"],
			['"1"', "Yes"],
			['"-9"', "Don't know"],
		]);
	});

	it("offers a set's codes but those already in it", () => {
		expect(at("  - stop: 'hh.tenure in {|}'\n")?.labels.slice(0, 3)).toEqual([
			'"1"',
			'"2"',
			'"3"',
		]);
		expect(
			at("  - stop: 'hh.tenure not_in {\"1\", |}'\n")?.labels.slice(0, 2),
		).toEqual(['"2"', '"3"']);
	});

	it("offers no codes for a name that isn't coded, or that nothing has", () => {
		expect(at("  - stop: hh.size = |\n")?.labels).toEqual([]);
		expect(at("  - stop: hh.nope = |\n")?.labels).toEqual([]);
		// Not after a keyword or a value: names, as before.
		expect(at("  - stop: hh.size > |\n")?.labels).toContain("renter");
	});

	it("finds every place the parser reads a condition or value", () => {
		for (const text of [
			"  - stop: |\n",
			"  - compute: x\n    value: |\n",
			"  - roster: r\n    count: |\n    flow: []\n",
			"  - roster: r\n    more: |\n    flow: []\n",
			"  - if: renter\n    then: []\n    else:\n      if: |\n      then: []\n",
			"  - ask: hh.size\n    checks:\n      - ensure: |\n",
			"  - ask: hh.utilities\n    fill:\n      rent: |\n",
		])
			expect([text, at(text)?.labels.includes("renter")]).toEqual([text, true]);
		// Prose and other fields offer nothing.
		expect(at("  - say: |\n")).toBeUndefined();
		expect(at("  - section: |\n    flow: []\n")).toBeUndefined();
		expect(
			at("  - ask: hh.size\n    checks:\n      - message: |\n"),
		).toBeUndefined();
	});

	it("offers nothing from a bank that isn't loaded, and doesn't fail", () => {
		expect(at("  - ask: |", {})?.labels).toEqual([]);
		expect(at("  - if: hh.|\n    then: []\n", {})?.labels).toEqual([
			"county",
			"renter",
			"members.index",
		]);
	});
});
