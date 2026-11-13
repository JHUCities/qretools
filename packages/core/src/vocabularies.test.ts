import { describe, expect, it } from "vitest";
import { err, ok } from "./result.ts";
import {
	codeValueOf,
	DATA_SOURCE_TYPE,
	MODE_OF_COLLECTION,
	mapTermOf,
	RESPONSE_UNIT,
	termOf,
} from "./vocabularies.ts";

const unknown = (...suggestions: string[]) =>
	err({ kind: "unknown", suggestions });

describe("the vocabularies", () => {
	it("hold each version's code values, once each, with Other's one ID", () => {
		for (const [v, count] of [
			[MODE_OF_COLLECTION, 52],
			[DATA_SOURCE_TYPE, 23],
			[RESPONSE_UNIT, 5],
		] as const) {
			expect(v.codes).toHaveLength(count);
			expect(new Set(v.codes.map(([code]) => code)).size).toBe(count);
			expect(new Set(v.codes.map(([, id]) => id)).size).toBe(count);
			expect(v.codes.every(([, id]) => /^[0-9a-f]{7}$/.test(id))).toBe(true);
			expect(v.codes.find(([code]) => code === "Other")?.[1]).toBe("6311ae1");
		}
	});
});

describe("termOf", () => {
	it("takes a code value exactly as the vocabulary spells it, broader ones too", () => {
		expect(
			termOf(MODE_OF_COLLECTION, "SelfAdministeredQuestionnaire.CAWI"),
		).toEqual(ok("SelfAdministeredQuestionnaire.CAWI"));
		expect(termOf(MODE_OF_COLLECTION, "Interview")).toEqual(ok("Interview"));
		expect(termOf(RESPONSE_UNIT, "proxy")).toEqual(unknown("Proxy"));
		expect(termOf(RESPONSE_UNIT, " Proxy ")).toEqual(ok("Proxy"));
	});

	it("takes Other with words, trimmed, and refuses it without", () => {
		expect(termOf(DATA_SOURCE_TYPE, "Other:  a language model ")).toEqual(
			ok({ other: "a language model" }),
		);
		for (const bare of ["Other", "Other:", "Other:   ", "other"])
			expect(termOf(DATA_SOURCE_TYPE, bare)).toEqual(
				err({ kind: "otherNeedsWords" }),
			);
		expect(termOf(DATA_SOURCE_TYPE, "other:x")).toEqual(unknown("Other:x"));
	});

	it("suggests up to three terms, in the vocabulary's order", () => {
		// A dot-segment, case ignored.
		expect(termOf(MODE_OF_COLLECTION, "cawi")).toEqual(
			unknown("SelfAdministeredQuestionnaire.CAWI"),
		);
		expect(termOf(MODE_OF_COLLECTION, "Telephone")).toEqual(
			unknown(
				"Interview.Telephone",
				"Interview.Telephone.CATI",
				"FocusGroup.Telephone",
			),
		);
		// A segment or the English label that holds it.
		expect(termOf(MODE_OF_COLLECTION, "Web")).toEqual(
			unknown(
				"Interview.WebBased",
				"SelfAdministeredQuestionnaire.CAWI",
				"SelfAdministeredWritingsAndDiaries.WebBased",
			),
		);
		expect(termOf(MODE_OF_COLLECTION, "papi")).toEqual(
			unknown("Interview.FaceToFace.PAPI"),
		);
		expect(termOf(MODE_OF_COLLECTION, "paper")).toEqual(
			unknown(
				"SelfAdministeredQuestionnaire.Paper",
				"SelfAdministeredWritingsAndDiaries.Paper",
			),
		);
		expect(termOf(DATA_SOURCE_TYPE, "Respondents")).toEqual(unknown());
	});
});

describe("mapTermOf", () => {
	it("takes Other only as { other }", () => {
		expect(mapTermOf(DATA_SOURCE_TYPE, { other: "x" })).toEqual(
			ok({ other: "x" }),
		);
		expect(mapTermOf(DATA_SOURCE_TYPE, { other: " x " })).toEqual(
			ok({ other: "x" }),
		);
		expect(mapTermOf(DATA_SOURCE_TYPE, { other: "" })).toEqual(
			err({ kind: "otherNeedsWords" }),
		);
		expect(mapTermOf(DATA_SOURCE_TYPE, "Other")).toEqual(
			err({ kind: "otherInMap", words: "" }),
		);
		expect(mapTermOf(DATA_SOURCE_TYPE, "other: by phone")).toEqual(
			err({ kind: "otherInMap", words: "by phone" }),
		);
		expect(mapTermOf(DATA_SOURCE_TYPE, "ResearchData.Published")).toEqual(
			ok("ResearchData.Published"),
		);
	});
});

describe("codeValueOf", () => {
	it("writes the vocabulary without its version and the term's own URI with it", () => {
		expect(
			codeValueOf("SelfAdministeredQuestionnaire.CAWI", MODE_OF_COLLECTION),
		).toEqual({
			StringValue: "SelfAdministeredQuestionnaire.CAWI",
			ControlledVocabularyURI:
				"http://rdf-vocabulary.ddialliance.org/cv/ModeOfCollection/",
			ControlledVocabularyInstanceURI:
				"http://rdf-vocabulary.ddialliance.org/cv/ModeOfCollection/5.0.1/557586d",
		});
		expect(codeValueOf({ other: "synthetic" }, DATA_SOURCE_TYPE)).toEqual({
			StringValue: "Other",
			OtherValue: "synthetic",
			ControlledVocabularyURI:
				"http://rdf-vocabulary.ddialliance.org/cv/DataSourceType/",
			ControlledVocabularyInstanceURI:
				"http://rdf-vocabulary.ddialliance.org/cv/DataSourceType/1.0.2/6311ae1",
		});
	});
});
