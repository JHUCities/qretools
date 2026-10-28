import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ddiIndexOf } from "../ddi/read.ts";
import { bankOf } from "../evaluate.ts";
import { instrumentOf } from "../instrument/instrument.ts";
import { pathsOf } from "../instrument/paths.ts";
import { readInstruments } from "../instrument/read.ts";
import { readWorkspace } from "./index.ts";

const root = fileURLToPath(
	new URL("../../fixtures/households", import.meta.url),
);
const made = instrumentOf(
	await readFile(`${root}/instruments/households.yaml`, "utf8"),
	{ banks: { hh: bankOf(await readWorkspace(root)) }, agency: "org.example" },
);
const read = readInstruments(ddiIndexOf(made.ddi)).value;
const households = read.instruments[0];
if (households === undefined) throw new Error("no instrument read");
const p = pathsOf(households, read.inputs);
const ask = (name: string) => `instrument-households.ask-${name}`;
const reach = (name: string) => p.reach.get(ask(name));

// Counted by hand. consent: yes, no (screened out) or blank. size: blank, or a number,
// so the members roster and `each: members` both have rows or neither does. renter or
// not. In `each`, works is 1 or not. So 1 screened out, plus size blank (2: renter or
// not) and size given (2 x 2): 7 paths.
describe("the households instrument's paths", () => {
	it("counts each way through once, keeping conditions on one answer consistent", () => {
		expect(p.paths).toBe(7);
		expect(p.stopped).toBe(1);
		// Paths not screened out: size blank (6, or 8 with rent and utilities); size given (8 or 10, each twice).
		expect([...p.lengths]).toEqual([
			[6, 1],
			[8, 3],
			[10, 2],
		]);
	});

	it("says how many paths reach each question, and what comes before it", () => {
		expect(reach("consent")).toEqual({ paths: 7, fewest: 0, most: 0 });
		expect(reach("size")).toEqual({ paths: 6, fewest: 1, most: 1 });
		expect(reach("age")).toEqual({ paths: 4, fewest: 2, most: 2 });
		expect(reach("rent")).toEqual({ paths: 3, fewest: 3, most: 5 });
		expect(reach("comments")).toEqual({ paths: 6, fewest: 5, most: 9 });
		expect(p.completed.get(ask("consent"))).toBe(6);
	});

	it("names what decides each question, a computed value by its definition", () => {
		expect(p.decidedBy.get(ask("consent"))).toEqual([]);
		expect(p.decidedBy.get(ask("age"))).toEqual(["consent", "size"]);
		expect(p.decidedBy.get(ask("rent"))).toEqual(["consent", "renter"]);
		expect([...p.computes]).toEqual([["renter", ["tenure"]]]);
	});

	it("names the rosters it follows for one row, and has no input to split by", () => {
		expect(p.repeated).toHaveLength(3);
		expect(p.byInput).toEqual([]);
		expect(p.unread).toBe(0);
	});
});

describe("an input read by two conditions", () => {
	// Two ifs on one input: each code takes both the same way, so they don't multiply.
	// consent is asked only in county 1, so in county 2 it is blank and `isnull` holds.
	const yaml = `name: split
uses:
  hh: ../
inputs:
  county:
    responses:
      "1": North County
      "2": South County
flow:
  - if: county = "1"
    then:
      - ask: hh.consent
  - if: county = "2" or isnull(hh.consent)
    then:
      - ask: hh.comments
`;
	it("keeps them consistent, and counts each code of the input on its own", async () => {
		const bank = bankOf(await readWorkspace(root));
		const r = readInstruments(
			ddiIndexOf(
				instrumentOf(yaml, { banks: { hh: bank }, agency: "org.example" }).ddi,
			),
		).value;
		const split = r.instruments[0];
		if (split === undefined) throw new Error("no instrument read");
		const q = pathsOf(split, r.inputs);
		// County 1: consent blank (then comments) or answered: 2 paths. County 2: comments, 1.
		// Not 4: no path takes the first if one way and the second the other.
		expect(q.paths).toBe(3);
		const comments = "instrument-split.ask-comments";
		expect(q.reach.get(comments)?.paths).toBe(2);
		expect(
			q.byInput.map((b) => [b.code, b.paths, b.reach.get(comments)?.paths]),
		).toEqual([
			["1", 2, 1],
			["2", 1, 1],
		]);
	});
});

describe("a screen-out on one branch", () => {
	// county 1 asks consent, then may screen out; county 2 skips both. consent is asked on
	// 2 of 3 paths, which is every path but the one screened out, yet the completed path
	// in county 2 never asks it: it isn't asked on every path that isn't screened out.
	const yaml = `name: branch
uses:
  hh: ../
inputs:
  county:
    responses:
      "1": North County
      "2": South County
flow:
  - if: county = "1"
    then:
      - ask: hh.consent
      - stop: hh.consent = "2"
        say: Thank you for your time.
  - ask: hh.comments
`;
	it("counts a question on completed paths apart from screened-out ones", async () => {
		const bank = bankOf(await readWorkspace(root));
		const r = readInstruments(
			ddiIndexOf(
				instrumentOf(yaml, { banks: { hh: bank }, agency: "org.example" }).ddi,
			),
		).value;
		const branch = r.instruments[0];
		if (branch === undefined) throw new Error("no instrument read");
		const q = pathsOf(branch, r.inputs);
		expect([q.paths, q.stopped]).toEqual([3, 1]);
		expect(q.reach.get("instrument-branch.ask-consent")?.paths).toBe(2);
		expect(q.completed.get("instrument-branch.ask-consent")).toBe(1);
		expect(q.completed.get("instrument-branch.ask-comments")).toBe(2);
	});
});
