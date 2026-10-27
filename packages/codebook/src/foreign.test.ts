/**
 * DDI written loosely, as a converter or a hand might, which the official schema would
 * refuse: the reader tolerates it. References as URN strings, as objects and without a
 * version, a missing code marked on its category, questions no variable records, two
 * languages, an item type the codebook doesn't know, an ElseIf, a variable derived by a
 * GenerationInstruction and one by a ComputationItem, an ask bound to its variable,
 * domains by reference to managed representations, nested codes, and a select-all limit
 * on the question item. Written by hand, for the reader's generality; valid.test.ts holds
 * a document the schema accepts.
 */
import { DDI_DEPTH } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { codebookOf, parse } from "./model.ts";
import { asking, outline } from "./testing.ts";

const s = (en: string, fr?: string) => ({
	Content: [
		{ MultilingualStringValue: { LanguageTag: "en", Value: en } },
		...(fr === undefined
			? []
			: [{ MultilingualStringValue: { LanguageTag: "fr", Value: fr } }]),
	],
});
const said = (lang: string, text: string) => ({
	AudienceLanguage: lang,
	TextContent: [
		{ Text: { MultilingualStringValue: { LanguageTag: lang, Value: text } } },
	],
});
const id = (ID: string, Version = "1") => ({
	URN: `urn:ddi:org.other:${ID}:${Version}`,
	Agency: "org.other",
	ID,
	Version,
});
const vtl = (command: string) => ({
	Command: [
		{ ProgramLanguage: { StringValue: "VTL" }, CommandContent: command },
	],
});

const FOREIGN = {
	QuestionItem: {
		a: {
			...id("pets"),
			QuestionItemName: [s("pets_old")],
			QuestionText: [said("en", "Which pets?")],
		},
		b: {
			...id("pets", "2"),
			QuestionItemName: [s("pets")],
			QuestionText: [
				said("en", "Which pets do you have?"),
				said("fr", "Quels animaux avez-vous ?"),
			],
			Description: s(
				"Asked since 2019.\n\nSee https://example.org/pets.",
				"Posée depuis 2019.",
			),
			ResponseDomain: {
				CodeListReference: "urn:ddi:org.other:pet-codes",
				ResponseCardinality: { MaximumResponses: 3 },
			},
			InterviewerInstructionAttachment: [
				{ InterviewerInstructionReference: "urn:ddi:org.other:read-all:1" },
			],
			BasedOnObject: {
				BasedOnReference: [
					{ $type: "QuestionItem", value: ["org.else", "q9", "4"] },
				],
			},
		},
		colour: {
			...id("colour"),
			QuestionItemName: [s("colour")],
			QuestionText: [said("en", "Which colours?")],
			ResponseDomainReference: "urn:ddi:org.other:colour-domain:1",
			ResponseCardinality: { MaximumResponses: 2 },
		},
		shade: {
			...id("shade"),
			QuestionItemName: [s("shade")],
			QuestionText: [said("en", "Which shades?")],
			ResponseDomainReference: "urn:ddi:org.other:colour-domain:1",
			ResponseCardinality: { MaximumResponses: 2 },
		},
		c: {
			...id("age"),
			QuestionItemName: [s("age")],
			QuestionText: [said("en", "How old are you?")],
			ResponseDomain: {
				$type: "NumericDomain",
				NumberRange: [{ Low: { DecimalValue: 18 } }],
			},
		},
	},
	CodeList: {
		colours: {
			...id("colour-codes"),
			Code: [
				{
					...id("colour-codes.1"),
					Value: "1",
					CategoryReference: "urn:ddi:org.other:red:1",
					Code: [
						{
							...id("colour-codes.11"),
							Value: "11",
							CategoryReference: "urn:ddi:org.other:crimson:1",
						},
					],
				},
			],
		},
		yesno: {
			...id("yes-no"),
			Code: [
				{ ...id("yes-no.0"), Value: "0" },
				{ ...id("yes-no.1"), Value: "1" },
			],
		},
		l: {
			...id("pet-codes"),
			Code: [
				{
					...id("pet-codes.1"),
					Value: { StringValue: "1" },
					CategoryReference: { URN: "urn:ddi:org.other:dog:1" },
				},
				{
					...id("pet-codes.9"),
					Value: "9",
					CategoryReference: { Agency: "org.other", ID: "dk" },
				},
			],
		},
	},
	ManagedCodeRepresentation: {
		colours: {
			...id("colour-domain"),
			CodeListReference: "urn:ddi:org.other:colour-codes:1",
		},
	},
	ManagedNumericRepresentation: {
		cm: { ...id("centimetres"), DecimalPositions: 1 },
	},
	Category: {
		red: { ...id("red"), Label: [s("Red")] },
		crimson: { ...id("crimson"), Label: [s("Crimson")] },
		dog: { ...id("dog"), Label: [s("Dog", "Chien")] },
		dk: {
			...id("dk"),
			Label: [s("Don't know", "Ne sait pas")],
			IsMissing: true,
		},
	},
	Instruction: {
		i: {
			...id("read-all"),
			InstructionText: [said("en", "Read all options.")],
		},
	},
	Widget: { w: { ...id("widget"), Anything: true } },
	Variable: {
		red: {
			...id("colour-red"),
			VariableName: [s("colour_red")],
			QuestionReference: "urn:ddi:org.other:colour:1",
			VariableRepresentation: {
				ValueRepresentation: {
					CodeListReference: "urn:ddi:org.other:yes-no:1",
				},
			},
		},
		height: {
			...id("height"),
			VariableName: [s("height")],
			VariableRepresentation: {
				ValueRepresentationReference: "urn:ddi:org.other:centimetres:1",
			},
		},
		v: {
			...id("adult"),
			VariableName: [s("adult")],
			VariableRepresentation: {
				ValueRepresentation: {
					CodeListReference: "urn:ddi:org.other:pet-codes:1",
				},
				ProcessingInstructionReference: {
					Agency: "org.other",
					ID: "make-adult",
					Version: "1",
				},
			},
			SourceVariableReference: ["urn:ddi:org.other:birth-year:1"],
		},
		senior: {
			...id("senior"),
			VariableName: [s("senior")],
			OutParameter: { URN: "urn:ddi:org.other:senior.out:1" },
		},
		now: {
			...id("pets-now"),
			VariableName: [s("pets_now")],
			QuestionReference: ["urn:ddi:org.other:pets"],
			OutParameter: { URN: "urn:ddi:org.other:pets-now.out:1" },
		},
	},
	ComputationItem: {
		c: {
			...id("compute-senior"),
			AssignedVariableReference: "urn:ddi:org.other:senior.out",
			CommandCode: vtl("age >= 65"),
		},
	},
	GenerationInstruction: {
		g: {
			...id("make-adult"),
			Description: s("From the age asked."),
			CommandCode: [vtl("age >= 18")],
		},
	},
	Instrument: {
		ins: {
			...id("survey"),
			InstrumentName: [s("Pets")],
			ControlConstructReference: "urn:ddi:org.other:flow:1",
		},
	},
	Sequence: {
		flow: {
			...id("flow"),
			ControlConstructReference: [
				"urn:ddi:org.other:ask-age:1",
				"urn:ddi:org.other:branch:1",
			],
		},
	},
	IfThenElse: {
		branch: {
			...id("branch"),
			IfCondition: vtl("age < 21"),
			ThenConstructReference: "urn:ddi:org.other:ask-pets:1",
			ElseIf: [
				{
					IfCondition: vtl("age < 65"),
					ThenConstructReference: "urn:ddi:org.other:ask-pets-again:1",
				},
			],
		},
	},
	QuestionConstruct: {
		age: { ...id("ask-age"), QuestionReference: "urn:ddi:org.other:age:1" },
		pets: { ...id("ask-pets"), QuestionReference: "urn:ddi:org.other:pets" },
		again: {
			...id("ask-pets-again"),
			QuestionReference: { URN: "urn:ddi:org.other:pets:2" },
			Binding: [{ TargetParameterReference: "urn:ddi:org.other:pets-now.out" }],
		},
	},
};

describe("a codebook of loosely written DDI", () => {
	const parsed = parse(FOREIGN);
	if (!parsed.ok) throw new Error("unparsed");

	it("reads what DDI says however it is written, and only a missing item is a finding", () => {
		const cb = codebookOf(parsed.value);
		expect(outline(cb)).toMatchInlineSnapshot(`
			[
			  "title Pets",
			  "QuestionItem age: How old are you?",
			  "  format {"kind":"number","min":18}",
			  "  asked always",
			  "Variable pets_now: Which pets do you have?",
			  "  instruction Read all options.",
			  "  codes many 1=Dog, 9!=Don't know",
			  "  asked not (age < 21) and (age < 65)",
			  "  notes Asked since 2019. ¶ See [https://example.org/pets].",
			  "Variable colour_red: Which colours?",
			  "  codes 0=, 1=",
			  "Variable height",
			  "  format {"kind":"number","decimals":1}",
			  "Variable adult",
			  "  codes 1=Dog, 9!=Don't know",
			  "  derived VTL:age >= 18 From the age asked.",
			  "Variable senior",
			  "  derived VTL:age >= 65",
			  "QuestionItem shade: Which shades?",
			  "  codes many 1=Red, 11=Crimson",
			]
		`);
		expect(
			cb.entries.flatMap((e) => e.asked.map(asking)),
		).toMatchInlineSnapshot(`
			[
			  "always",
			  "not (age < 21) and (age < 65)",
			]
		`);
		expect(cb.findings).toMatchInlineSnapshot(`
			[
			  {
			    "code": "codebook-dangling",
			    "message": "\`urn:ddi:org.other:birth-year:1\` isn't in the document.",
			    "path": "urn:ddi:org.other:adult:1",
			    "severity": "error",
			  },
			]
		`);
	});

	it("reads the document's first language when none is asked for", () => {
		expect(codebookOf(parsed.value).lang).toBe("en");
		const empty = parse({});
		if (empty.ok) expect(codebookOf(empty.value).lang).toBeUndefined();
	});

	it("reads the language asked for, else the first", () => {
		const cb = codebookOf(parsed.value, { lang: "fr" });
		expect(outline(cb).slice(4, 10)).toMatchInlineSnapshot(`
			[
			  "Variable pets_now: Quels animaux avez-vous ?",
			  "  instruction Read all options.",
			  "  codes many 1=Chien, 9!=Ne sait pas",
			  "  asked not (age < 21) and (age < 65)",
			  "  notes Posée depuis 2019.",
			  "Variable colour_red: Which colours?",
			]
		`);
	});
});

describe("codes nested in codes", () => {
	it("stops far below a list, rather than overflow the stack", () => {
		let code: Record<string, unknown> = { Value: "x" };
		for (let i = 0; i < 10_000; i++) code = { Value: "x", Code: [code] };
		const parsed = parse({
			QuestionItem: {
				q: {
					...id("deep"),
					ResponseDomain: { CodeListReference: "urn:ddi:org.other:list:1" },
				},
			},
			CodeList: { l: { ...id("list"), Code: [code] } },
		});
		if (!parsed.ok) throw new Error("unparsed");
		expect(codebookOf(parsed.value).entries[0]?.responses?.rows.length).toBe(
			DDI_DEPTH + 1,
		);
	});
});

describe("shared items", () => {
	it("lists one referred to at two versions once, at its newest", () => {
		const parsed = parse({
			Concept: {
				old: { ...id("pet"), Label: [s("Pets")] },
				new: { ...id("pet", "2"), Label: [s("Pets kept")] },
			},
			Variable: {
				a: { ...id("a"), ConceptReference: "urn:ddi:org.other:pet:1" },
				b: { ...id("b"), ConceptReference: "urn:ddi:org.other:pet:2" },
			},
		});
		if (!parsed.ok) throw new Error("unparsed");
		const cb = codebookOf(parsed.value);
		expect(cb.shared.concepts.map((c) => [c.urn, c.label?.[0]?.[0]])).toEqual([
			["urn:ddi:org.other:pet:2", { kind: "text", text: "Pets kept" }],
		]);
		expect(cb.entries.map((e) => e.concepts[0]?.urn)).toEqual([
			"urn:ddi:org.other:pet:1",
			"urn:ddi:org.other:pet:2",
		]);
	});
});

describe("parse", () => {
	it("refuses anything but a JSON object, without throwing", () => {
		for (const j of [null, undefined, 1, "x", [], [{}], true])
			expect(parse(j)).toMatchObject({
				ok: false,
				error: [{ code: "codebook-unreadable" }],
			});
	});
	it("reads any object as a codebook, empty or not", () => {
		for (const j of [
			{},
			{ a: 1 },
			{ Variable: [1, null] },
			{ Variable: { v: { VariableName: 3, QuestionReference: {} } } },
		]) {
			const parsed = parse(j);
			expect(parsed.ok).toBe(true);
			if (parsed.ok) expect(codebookOf(parsed.value).findings).toEqual([]);
		}
	});
});
