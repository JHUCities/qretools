import { describe, expect, it } from "vitest";
import { readInstrument } from "./read.ts";
import { ddiOf, outline } from "./testing.ts";
import { unroll } from "./unroll.ts";

const ROSTERS = `name: rows
uses:
  bas: here
flow:
  - ask: bas.size
  - roster: people
    count: bas.size
    max: 2
    flow:
      - say: Person {{index}}.
      - ask: bas.nick
  - each: people
    flow:
      - say: About {{bas.nick}}, person {{index}}.
  - roster: cars
    more: bas.more = "1"
    max: 3
    flow:
      - ask: bas.why
      - ask: bas.more
  - each: cars
    flow:
      - say: Car {{index}}.
`;

describe("writing rosters out row by row", () => {
	it("gives each row its copies, its number, and the rows before it; rounds nest", () => {
		const read = readInstrument(ddiOf(ROSTERS));
		expect(read.findings).toEqual([]);
		const { instrument, findings } = unroll(read.instrument);
		expect(findings).toEqual([]);
		expect(outline(instrument.flow)).toMatchInlineSnapshot(`
			[
			  "ask size number size: size?",
			  "if size >= 1 {size=size}",
			  "  say Person 1.",
			  "  ask nick text 1_nick: nick?",
			  "if size >= 2 {size=size}",
			  "  say Person 2.",
			  "  ask nick text 2_nick: nick?",
			  "if size >= 1 {size=size}",
			  "  say About <1_nick>, person 1.",
			  "if size >= 2 {size=size}",
			  "  say About <2_nick>, person 2.",
			  "ask why text 1_why: why?",
			  "ask more choice 1_more: more?",
			  "if more = "1" {more=1_more}",
			  "  ask why text 2_why: why?",
			  "  ask more choice 2_more: more?",
			  "  if more = "1" {more=2_more}",
			  "    ask why text 3_why: why?",
			  "    ask more choice 3_more: more?",
			  "say Car 1.",
			  "if more = "1" {more=1_more}",
			  "  say Car 2.",
			  "if more = "1" and more_2 = "1" {more=1_more, more_2=2_more}",
			  "  say Car 3.",
			]
		`);
	});
});
