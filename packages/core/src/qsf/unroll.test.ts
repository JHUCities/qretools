import { describe, expect, it } from "vitest";
import { readInstrument } from "./read.ts";
import { ddiOf, outline } from "./testing.ts";
import { unroll } from "./unroll.ts";
import { writeQsf } from "./write.ts";

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
      - if: bas.nick = "Al"
        then:
          - say: Hello Al.
        else:
          - say: Not Al.
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
			  "loop count size {people_index=row(roster-people), size=size} max 2",
			  "  say Person <row(roster-people)>.",
			  "  ask nick text nick: nick?",
			  "  if nick = "Al" {nick=nick}",
			  "    say Hello Al.",
			  "  else",
			  "    say Not Al.",
			  "if size >= 1 {size=size}",
			  "  say About <nick@1>, person 1.",
			  "if size >= 2 {size=size}",
			  "  say About <nick@2>, person 2.",
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

	it("writes a count roster Qualtrics can loop as Loop & Merge, its conditions on the current round", () => {
		const { qsf, findings } = writeQsf(
			readInstrument(ddiOf(ROSTERS)).instrument,
			{
				name: "rows",
				created: "2026-10-18 00:00:00",
			},
		);
		expect(findings.filter((f) => f.severity === "error")).toEqual([]);
		const elements = qsf.SurveyElements as {
			Element: string;
			Payload: unknown;
		}[];
		const blocks = elements.find((e) => e.Element === "BL")?.Payload as {
			ID: string;
			Options?: { Looping: string; LoopingOptions: { Locator: string } };
		}[];
		expect(
			blocks.flatMap((b) =>
				b.Options
					? [`${b.ID} ${b.Options.Looping} ${b.Options.LoopingOptions.Locator}`]
					: [],
			),
		).toEqual([
			"BL_qretoolsLoop001 Question q://QID1/LoopAndMerge/MergeOnNumericResponse?v=2",
		]);
		const text = (start: string) =>
			(elements.find(
				(e) =>
					e.Element === "SQ" &&
					String(
						(e.Payload as { QuestionText: string }).QuestionText,
					).startsWith(start),
			)?.Payload as Record<string, unknown>) ?? {};
		const hello = text("Hello Al") as {
			DisplayLogic: { "0": { "0": Record<string, string> } };
		};
		expect(hello.DisplayLogic["0"]["0"]).toMatchObject({
			QuestionIsInLoop: "yes",
			LoopAndMergeLoops: "current",
			Operator: "EqualTo",
		});
		expect(text("Person").QuestionText).toBe(
			`Person \${lm://CurrentLoopNumber}.`,
		);
		expect(text("About").QuestionText).toBe(
			`About \${q://1_QID3/ChoiceTextEntryValue}, person 1.`,
		);
	});

	it("writes out a roster whose if asks what its condition reads: display logic would change mid-arm", () => {
		const source = `name: asks
uses:
  bas: here
flow:
  - ask: bas.size
  - roster: people
    count: bas.size
    max: 2
    flow:
      - if: isnull(bas.why)
        then:
          - ask: bas.why
          - say: Asked.
`;
		const { instrument } = unroll(readInstrument(ddiOf(source)).instrument);
		expect(outline(instrument.flow)).toMatchInlineSnapshot(`
			[
			  "ask size number size: size?",
			  "if size >= 1 {size=size}",
			  "  if isnull(why) {why=1_why}",
			  "    ask why text 1_why: why?",
			  "    say Asked.",
			  "if size >= 2 {size=size}",
			  "  if isnull(why) {why=2_why}",
			  "    ask why text 2_why: why?",
			  "    say Asked.",
			]
		`);
	});
});
