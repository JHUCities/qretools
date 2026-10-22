/**
 * The flow is walked down from each instrument, following references as written: what no
 * instrument reaches isn't asked, a pinned version is the one followed, a question is
 * asked whichever of its versions a variable names, and the nearest sequence's order holds.
 */
import { describe, expect, it } from "vitest";
import { codebookOf, parse } from "./model.ts";
import { asking } from "./testing.ts";

const urn = (id: string, version = "1") => `urn:ddi:org.other:${id}:${version}`;
const id = (ID: string, Version = "1") => ({
	URN: urn(ID, Version),
	Agency: "org.other",
	ID,
	Version,
});
const name = (n: string) => [
	{
		Content: [{ MultilingualStringValue: { LanguageTag: "en", Value: n } }],
	},
];
const vtl = (command: string) => ({
	Command: [
		{ ProgramLanguage: { StringValue: "VTL" }, CommandContent: command },
	],
});
const question = (n: string, version = "1") => ({
	...id(n, version),
	QuestionItemName: name(n),
});
// Unversioned: the newest version of the question.
const ask = (n: string, q: string) => ({
	...id(n),
	QuestionReference: `urn:ddi:org.other:${q}`,
});

const DOC = {
	Instrument: {
		i: { ...id("survey"), ControlConstructReference: urn("main") },
	},
	Sequence: {
		main: {
			...id("main"),
			ConstructSequence: { ItemSequenceType: "Random" },
			// Pinned to version 1: version 2 holds another ask.
			ControlConstructReference: [urn("ask-a"), urn("part", "1")],
		},
		part1: {
			...id("part", "1"),
			ConstructSequence: { ItemSequenceType: "Rotate" },
			ControlConstructReference: [urn("ask-b")],
		},
		part2: {
			...id("part", "2"),
			ControlConstructReference: [urn("ask-c")],
		},
	},
	IfThenElse: {
		// No instrument reaches this one.
		orphan: {
			...id("orphan"),
			IfCondition: vtl("x = 1"),
			ThenConstructReference: urn("ask-a-again"),
		},
	},
	QuestionConstruct: {
		a: ask("ask-a", "a"),
		again: ask("ask-a-again", "a"),
		b: ask("ask-b", "b"),
		c: ask("ask-c", "c"),
	},
	QuestionItem: {
		a1: question("a"),
		a2: question("a", "2"),
		b: question("b"),
		c: question("c"),
	},
	Variable: {
		// Names the older version of question a.
		va: {
			...id("va"),
			VariableName: name("va"),
			QuestionReference: urn("a", "1"),
		},
	},
};

describe("the flow", () => {
	const parsed = parse(DOC);
	if (!parsed.ok) throw new Error("unparsed");
	const cb = codebookOf(parsed.value);

	it("asks only what an instrument reaches, following the versions written", () => {
		expect(
			cb.entries.map(
				(e) => `${e.name}: ${e.asked.map(asking).join(" | ") || "not asked"}`,
			),
		).toEqual([
			"va: always order Random",
			"b: always order Rotate",
			"c: not asked",
		]);
		expect(cb.findings).toEqual([]);
	});
});
