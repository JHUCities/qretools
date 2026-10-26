/**
 * The flow is walked down from each instrument, following references as written: what no
 * instrument reaches isn't asked, a pinned version is the one followed, a question is
 * asked whichever of its versions a variable names, and the nearest sequence's order holds.
 */
import { describe, expect, it } from "vitest";
import type { Command, LinkedAsk, Step } from "./flow.ts";
import { codebookOf, parse } from "./model.ts";
import { asking, plain } from "./testing.ts";

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

/** A tree of steps as indented lines: what each is, and the entry an ask links to. */
const lines = (steps: readonly Step<LinkedAsk>[], indent = ""): string[] =>
	steps.flatMap((s): string[] => {
		const cmd = (c?: Command) => (c === undefined ? "?" : c.command);
		switch (s.kind) {
			case "ask":
				return [`${indent}ask ${s.entry?.name ?? s.question}`];
			case "say":
				return [`${indent}say ${plain(s.text)}`];
			case "compute":
				return [
					`${indent}compute ${s.assigns.map((r) => r.name).join(",")} = ${cmd(s.command)}`,
				];
			case "branch":
				return [
					...s.arms.flatMap((a, i) => [
						`${indent}${i === 0 ? "if" : "else if"} ${cmd(a.command)}${i === 0 && s.type ? ` (${s.type})` : ""}`,
						...lines(a.steps, `${indent}  `),
					]),
					...(s.otherwise === undefined
						? []
						: [`${indent}else`, ...lines(s.otherwise, `${indent}  `)]),
				];
			case "loop":
				return [
					`${indent}${s.loop} ${s.ref.name ?? ""} ${cmd(s.command)}`,
					...lines(s.steps, `${indent}  `),
				];
			case "section":
				return [
					`${indent}section ${s.name ?? ""}${s.order ? ` ${s.order}` : ""}`,
					...lines(s.steps, `${indent}  `),
				];
			default:
				return s satisfies never;
		}
	});

const text = (s: string) => [
	{
		TextContent: [
			{ Text: { MultilingualStringValue: { LanguageTag: "en", Value: s } } },
		],
	},
];
const construct = (n: string) => [
	{ String: [{ MultilingualStringValue: { LanguageTag: "en", Value: n } }] },
];

/** Every kind of construct, an unnamed sequence spliced, a named one kept, and a cycle. */
const TREE = {
	Instrument: {
		i: {
			...id("survey"),
			InstrumentName: construct("survey"),
			ControlConstructReference: urn("top"),
		},
	},
	Sequence: {
		top: {
			...id("top"),
			ControlConstructReference: [
				urn("hello"),
				urn("ask-a"),
				urn("choose"),
				urn("part"),
			],
		},
		part: {
			...id("part"),
			ConstructName: construct("Part two"),
			// Refers back to itself: walked once.
			ControlConstructReference: [urn("ask-a-again"), urn("part")],
		},
	},
	StatementItem: { hello: { ...id("hello"), DisplayText: text("Hello.") } },
	IfThenElse: {
		choose: {
			...id("choose"),
			TypeOfIfThenElse: { StringValue: "routing" },
			IfCondition: vtl("x = 1"),
			ThenConstructReference: urn("again"),
			ElseIf: [
				{ IfCondition: vtl("z = 1"), ThenConstructReference: urn("ask-c") },
			],
			ElseConstructReference: urn("set"),
		},
	},
	RepeatUntil: {
		again: {
			...id("again"),
			ConstructName: construct("visits"),
			UntilCondition: vtl("y = 2"),
			UntilConstructReference: urn("ask-b"),
		},
	},
	ComputationItem: {
		set: {
			...id("set"),
			CommandCode: vtl("w := 0"),
			AssignedVariableReference: {
				...id("out-w"),
				ParameterName: construct("w"),
			},
		},
	},
	QuestionConstruct: {
		a: ask("ask-a", "a"),
		again: ask("ask-a-again", "a"),
		b: ask("ask-b", "b"),
		c: ask("ask-c", "c"),
	},
	QuestionItem: { a: question("a"), b: question("b"), c: question("c") },
	Variable: {
		va: { ...id("va"), VariableName: name("va"), QuestionReference: urn("a") },
	},
};

describe("the instrument's map", () => {
	const parsed = parse(TREE);
	if (!parsed.ok) throw new Error("unparsed");
	const cb = codebookOf(parsed.value);

	it("is the instrument's tree, unnamed sequences spliced, each ask linked to its entry", () => {
		expect(cb.instruments.map((i) => i.name)).toEqual(["survey"]);
		expect(lines(cb.instruments[0]?.steps ?? [])).toEqual([
			"say Hello.",
			"ask va",
			"if x = 1 (routing)",
			"  RepeatUntil visits y = 2",
			"    ask b",
			"else if z = 1",
			"  ask c",
			"else",
			"  compute w = w := 0",
			"section Part two",
			"  ask va",
		]);
	});

	it("gives the asked places the map's conditions and loops", () => {
		expect(
			cb.entries.map((e) => `${e.name}: ${e.asked.map(asking).join(" | ")}`),
		).toEqual([
			"va: always | always",
			"b: (x = 1) in 1 loop",
			"c: not (x = 1) and (z = 1)",
		]);
	});
});
