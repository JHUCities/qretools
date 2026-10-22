/**
 * DDI another producer might write: references as URN strings, as objects and without a
 * version, a missing code marked on its category, questions no variable records, two
 * languages, an item type the codebook doesn't know, an ElseIf, and a variable derived
 * by a GenerationInstruction. Written by hand, for the reader's generality.
 */
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
					Value: { StringValue: "9" },
					CategoryReference: { Agency: "org.other", ID: "dk" },
				},
			],
		},
	},
	Category: {
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
		},
	},
};

describe("a codebook of another producer's DDI", () => {
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
			  "QuestionItem pets: Which pets do you have?",
			  "  instruction Read all options.",
			  "  codes many 1=Dog, 9!=Don't know",
			  "  asked (age < 21)",
			  "  asked not (age < 21) and (age < 65)",
			  "  notes Asked since 2019. ¶ See [https://example.org/pets].",
			  "Variable adult",
			  "  codes 1=Dog, 9!=Don't know",
			  "  derived VTL:age >= 18 From the age asked.",
			]
		`);
		expect(
			cb.entries.flatMap((e) => e.asked.map(asking)),
		).toMatchInlineSnapshot(`
			[
			  "always",
			  "(age < 21)",
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

	it("reads the language asked for, else the first", () => {
		const cb = codebookOf(parsed.value, { lang: "fr" });
		expect(outline(cb).slice(4, 10)).toMatchInlineSnapshot(`
			[
			  "QuestionItem pets: Quels animaux avez-vous ?",
			  "  instruction Read all options.",
			  "  codes many 1=Chien, 9!=Ne sait pas",
			  "  asked (age < 21)",
			  "  asked not (age < 21) and (age < 65)",
			  "  notes Posée depuis 2019.",
			]
		`);
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
