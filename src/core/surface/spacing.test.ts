import { describe, expect, it } from "vitest";
import { evaluateScheme } from "../schemes.js";
import { addSpace } from "./edit.js";
import { EMPTY_ENV } from "./env.js";
import { parseSurface } from "./parse.js";

const HEAD = "name: q\ntext: Hi\nintent: What we learn\n";
const slips = (text: string) =>
	parseSurface(text, EMPTY_ENV).findings.filter(
		(f) => f.code === "missing-space",
	);
/** Apply each slip's fix in turn, as clicking them would. */
const fixed = (text: string): string => {
	let t = text;
	for (;;) {
		const f = slips(t)[0];
		if (f?.fix?.kind !== "space") return t;
		const next = addSpace(t, f.fix.path, f.fix.word);
		if (next === undefined) return t;
		t = next;
	}
};

describe("a key's colon with no space after it", () => {
	it("is one finding, with a fix, in place of the unreadable line and the unknown key", () => {
		const text = `${HEAD}open:{}\n`;
		const { findings } = parseSurface(text, EMPTY_ENV);
		expect(findings.filter((f) => f.code === "missing-space")).toMatchObject([
			{ path: "open:{}", message: "Put a space after `open:`." },
		]);
		expect(findings.some((f) => f.code === "yaml-syntax")).toBe(false);
		expect(findings.some((f) => f.code === "unknown-key")).toBe(false);
		expect(fixed(text)).toBe(`${HEAD}open: {}\n`);
	});

	it("is found where it swallows the next line, nested, and as the first entry under a key", () => {
		expect(fixed("open:{}\nname: q\n")).toBe("open: {}\nname: q\n");
		expect(fixed("number:\n  min:1\n  max: 5\n")).toBe(
			"number:\n  min: 1\n  max: 5\n",
		);
		expect(fixed("responses:\n  1:Yes\n  2: No\n")).toBe(
			"responses:\n  1: Yes\n  2: No\n",
		);
	});

	it("leaves text alone: a block scalar's line, a quoted key, a URL after a space", () => {
		expect(slips(`${HEAD}note: |\n  Time:10pm\nopen: {}\n`)).toEqual([]);
		expect(slips(`${HEAD}legacy:\n  "a:b": 1\nopen: {}\n`)).toEqual([]);
		expect(slips(`${HEAD}source: http://example.org\nopen: {}\n`)).toEqual([]);
	});

	it("is found in a shared file too", () => {
		const ev = evaluateScheme("scale", "labels:\n  1:Yes\n", EMPTY_ENV);
		expect(ev.findings.map((f) => f.code)).toContain("missing-space");
	});

	it("fixes nothing once the place has gone", () => {
		expect(addSpace(`${HEAD}open: {}\n`, "open:{}", "open")).toBeUndefined();
	});
});
