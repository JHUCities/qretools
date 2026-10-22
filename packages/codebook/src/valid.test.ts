/**
 * A document the official DDI-Lifecycle 4.0 schema accepts, written by hand as another
 * producer might: its own agency, references in the schema's `{$type, value}` form,
 * two languages, a managed code representation shared by reference, nested codes, a
 * missing-values representation, a loop, and an IfThenElse with an ElseIf. The schema
 * refuses unknown keys only at the root, so a misspelled field still validates: the
 * outline below, not the validator, shows each field is read.
 */
import { makeValidator } from "@qretools/core";
import schema from "@qretools/core/schema.json";
import { describe, expect, it } from "vitest";
import { codebookOf, parse } from "./model.ts";
import { outline } from "./testing.ts";

const AGENCY = "org.example";
const id = (ID: string) => ({
	URN: `urn:ddi:${AGENCY}:${ID}:1`,
	Agency: AGENCY,
	ID,
	Version: "1",
});
const ref = ($type: string, ID: string) => ({
	$type,
	value: [AGENCY, ID, "1"],
});
const s = (en: string, fr: string) => ({
	Content: [
		{ MultilingualStringValue: { LanguageTag: "en", Value: en } },
		{ MultilingualStringValue: { LanguageTag: "fr", Value: fr } },
	],
});
const said = (en: string, fr: string) =>
	["en", "fr"].map((lang) => ({
		AudienceLanguage: lang,
		TextContent: [
			{
				Text: {
					MultilingualStringValue: {
						LanguageTag: lang,
						Value: lang === "en" ? en : fr,
					},
				},
			},
		],
	}));
const vtl = (command: string) => ({
	Command: [
		{ ProgramLanguage: { StringValue: "VTL" }, CommandContent: command },
	],
});
const category = (ID: string, en: string, fr: string, missing = false) => ({
	...id(ID),
	Label: [s(en, fr)],
	...(missing && { IsMissing: true }),
});

const VALID = {
	topLevelReference: [ref("Instrument", "survey")],
	Instrument: {
		survey: {
			...id("survey"),
			InstrumentName: [s("Travel", "Voyages")],
			ControlConstructReference: ref("Sequence", "main"),
		},
	},
	Sequence: {
		main: {
			...id("main"),
			ConstructSequence: { ItemSequenceType: "InOrderOfAppearance" },
			ControlConstructReference: [
				ref("QuestionConstruct", "ask-trips"),
				ref("IfThenElse", "if-trips"),
			],
		},
	},
	IfThenElse: {
		trips: {
			...id("if-trips"),
			IfCondition: vtl("trips > 0"),
			ThenConstructReference: ref("Loop", "each-trip"),
			ElseIf: [
				{
					IfCondition: vtl("trips = 0"),
					ThenConstructReference: ref("QuestionConstruct", "ask-why"),
				},
			],
		},
	},
	Loop: {
		each: {
			...id("each-trip"),
			LoopWhile: vtl("i <= trips"),
			ControlConstructReference: ref("QuestionConstruct", "ask-mode"),
		},
	},
	QuestionConstruct: {
		trips: {
			...id("ask-trips"),
			QuestionReference: ref("QuestionItem", "trips"),
		},
		mode: {
			...id("ask-mode"),
			QuestionReference: ref("QuestionItem", "mode"),
			ResponseSequence: { ItemSequenceType: "Random" },
		},
		why: { ...id("ask-why"), QuestionReference: ref("QuestionItem", "why") },
	},
	QuestionItem: {
		trips: {
			...id("trips"),
			QuestionItemName: [s("trips", "trips")],
			QuestionText: said(
				"How many trips did you make?",
				"Combien de voyages avez-vous faits ?",
			),
			ResponseDomainReference: ref("ManagedNumericRepresentation", "count"),
		},
		mode: {
			...id("mode"),
			QuestionItemName: [s("mode", "mode")],
			QuestionText: said("How did you travel?", "Comment avez-vous voyagé ?"),
			ResponseDomainReference: ref("ManagedCodeRepresentation", "modes"),
			ResponseCardinality: { MinimumResponses: 1, MaximumResponses: 3 },
		},
		why: {
			...id("why"),
			QuestionItemName: [s("why", "why")],
			QuestionText: said("Why not?", "Pourquoi pas ?"),
			ResponseDomain: { $type: "TextDomain", MaxLength: 200 },
		},
	},
	ManagedNumericRepresentation: {
		count: {
			...id("count"),
			NumberRange: [{ Low: { DecimalValue: 0 }, High: { DecimalValue: 99 } }],
		},
	},
	ManagedCodeRepresentation: {
		modes: { ...id("modes"), CodeListReference: ref("CodeList", "mode-codes") },
	},
	CodeList: {
		modes: {
			...id("mode-codes"),
			Code: [
				{
					...id("mode-codes.1"),
					Value: { StringValue: "1" },
					CategoryReference: ref("Category", "public"),
					Code: [
						{
							...id("mode-codes.11"),
							Value: { StringValue: "11" },
							CategoryReference: ref("Category", "train"),
						},
					],
				},
				{
					...id("mode-codes.2"),
					Value: { StringValue: "2" },
					CategoryReference: ref("Category", "car"),
				},
			],
		},
		missing: {
			...id("missing-codes"),
			Code: [
				{
					...id("missing-codes.9"),
					Value: { StringValue: "-9" },
					CategoryReference: ref("Category", "refused"),
				},
			],
		},
	},
	Category: {
		public: category("public", "Public transport", "Transports en commun"),
		train: category("train", "Train", "Train"),
		car: category("car", "Car", "Voiture"),
		refused: category("refused", "Refused", "Refus", true),
	},
	ManagedMissingValuesRepresentation: {
		missing: {
			...id("missing"),
			MissingCodeRepresentation: [
				{ CodeListReference: ref("CodeList", "missing-codes") },
			],
		},
	},
	Variable: {
		trips: {
			...id("v-trips"),
			VariableName: [s("trips", "trips")],
			QuestionReference: [ref("QuestionItem", "trips")],
			VariableRepresentation: {
				ValueRepresentationReference: ref(
					"ManagedNumericRepresentation",
					"count",
				),
				MissingValuesReference: ref(
					"ManagedMissingValuesRepresentation",
					"missing",
				),
			},
		},
	},
};

describe("a schema-valid document from another producer", () => {
	it("is valid DDI-Lifecycle 4.0", () => {
		const validator = makeValidator(schema);
		if (!validator.ok) throw new Error("no validator");
		expect(validator.value(VALID)).toEqual([]);
	});

	const parsed = parse(VALID);
	if (!parsed.ok) throw new Error("unparsed");

	it("reads as a codebook with no findings", () => {
		const cb = codebookOf(parsed.value, { lang: "fr" });
		expect(outline(cb)).toMatchInlineSnapshot(`
			[
			  "title Voyages",
			  "Variable trips: Combien de voyages avez-vous faits ?",
			  "  codes -9!=Refus",
			  "  format {"kind":"number","min":0,"max":99}",
			  "  asked always order InOrderOfAppearance",
			  "QuestionItem mode: Comment avez-vous voyagé ?",
			  "  codes many 1=Transports en commun, 11=Train, 2=Voiture",
			  "  asked (trips > 0) in 1 loop order InOrderOfAppearance options Random",
			  "QuestionItem why: Pourquoi pas ?",
			  "  format {"kind":"text","maxLength":200}",
			  "  asked not (trips > 0) and (trips = 0) order InOrderOfAppearance",
			]
		`);
		expect(cb.findings).toEqual([]);
	});
});
