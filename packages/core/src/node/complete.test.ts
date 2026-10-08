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
		expect(at('  - stop: hh.tenure = "2|"\n')).toBeUndefined();
		expect(at('  - ask: "hh.co"|\n')).toBeUndefined();
		expect(at("  - ask: 'hh.co'|\n")).toBeUndefined();
		expect(at('  - if: "renter and hh"|\n    then: []\n')).toBeUndefined();
		// Inside the quotes it still completes.
		expect(at('  - ask: "hh.co|"\n')?.typed).toBe("hh.co");
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
