import { describe, expect, it } from "vitest";
import schemaText from "../../ddi/ddi-lifecycle-4.0-beta4.schema.json?raw";
import { EMPTY_ENV, type Env } from "../surface/env.js";
import { parseSurface } from "../surface/parse.js";
import type { DdiDocument, ItemType, JsonObject } from "./document.js";
import { elaborate, type Versioning } from "./elaborate.js";
import { makeValidator } from "./validate.js";

const AGENCY = "org.example";
const validator = makeValidator(JSON.parse(schemaText));
const validate = (doc: DdiDocument) =>
	validator.ok ? validator.value(doc) : [validator.error];

const ENV: Env = {
	...EMPTY_ENV,
	scales: {
		agree4: {
			codes: [
				{ code: "1", label: "Agree" },
				{ code: "2", label: "Disagree" },
			],
		},
	},
	concepts: { trust: { label: "Trust" } },
	universes: { adults: { text: "Adults" } },
	instructions: { select_one: { text: "Select one" } },
	missing: [{ code: "-8", label: "Refused" }],
};
const QUESTION =
	"name: q\ntext: Do you trust them?\nintent: i\nconcept: trust\nuniverse: adults\ninstruction: select_one\nresponses: agree4\n";
const SELECT_ALL =
	'name: m\ntext: Which?\nintent: i\nselect: many\nresponses:\n  "a": A\n  "b": B\n';

const ddi = (source: string, versioning?: Versioning) =>
	elaborate(parseSurface(source, ENV).draft, AGENCY, ENV.missing, versioning);
const only = (doc: DdiDocument, type: ItemType): JsonObject[] =>
	Object.values(doc[type] ?? {});
const refVersion = (r: unknown): unknown =>
	(r as { value: unknown[] }).value[2];

const VERSIONS: Versioning = {
	own: {
		number: "4",
		date: "2026-10-07T12:00:00Z",
		blob: "q-blob",
		published: true,
	},
	shared: {
		"scales/agree4.yaml": { number: "3", blob: "scale-blob" },
		"concepts/trust.yaml": { number: "2" },
		"universes/adults.yaml": { number: "5" },
		"instructions/select_one.yaml": { number: "6" },
		"missing.yaml": { number: "7" },
		"scales/yesno01.yaml": { number: "8" },
	},
};

describe("DDI versions", () => {
	it("without history, every item is version 1 and says nothing more", () => {
		const doc = ddi(QUESTION);
		expect(validate(doc)).toEqual([]);
		for (const type of Object.keys(doc) as ItemType[])
			for (const it of only(doc, type)) {
				expect(it.Version).toBe("1");
				expect(it).not.toHaveProperty("VersionDate");
				expect(it).not.toHaveProperty("IsPublished");
				expect(it).not.toHaveProperty("UserID");
			}
	});

	it("gives two wordings at two versions two identities", () => {
		const one = ddi(QUESTION, { own: { number: "1" } });
		const two = ddi(QUESTION.replace("trust them", "trust them at all"), {
			own: { number: "2" },
		});
		expect(Object.keys(one.QuestionItem ?? {})).toEqual([`${AGENCY}:q:1`]);
		expect(Object.keys(two.QuestionItem ?? {})).toEqual([`${AGENCY}:q:2`]);
		expect(validate(two)).toEqual([]);
	});

	it("takes each file's version for its own items, and references carry it", () => {
		const doc = ddi(QUESTION, VERSIONS);
		expect(validate(doc)).toEqual([]);
		const q = only(doc, "QuestionItem")[0] ?? {};
		expect(q.Version).toBe("4");
		const domain = q.ResponseDomain as JsonObject;
		expect(refVersion(domain.CodeListReference)).toBe("3");
		expect(refVersion((q.ConceptReference as unknown[])[0])).toBe("2");
		const [attachment] = q.InterviewerInstructionAttachment as JsonObject[];
		expect(refVersion(attachment?.InterviewerInstructionReference)).toBe("6");
		const variable = only(doc, "Variable")[0] ?? {};
		expect(variable.Version).toBe("4");
		expect(refVersion((variable.UniverseReference as unknown[])[0])).toBe("5");
		const representation = variable.VariableRepresentation as JsonObject;
		expect(refVersion(representation.MissingValuesReference)).toBe("7");
		expect(
			refVersion(
				(representation.ValueRepresentation as JsonObject).CodeListReference,
			),
		).toBe("3");
	});

	it("says what is known on each item, the blob only on the file's principal item", () => {
		const doc = ddi(QUESTION, VERSIONS);
		const q = only(doc, "QuestionItem")[0] ?? {};
		expect(q).toMatchObject({
			VersionDate: { DateTime: "2026-10-07T12:00:00Z" },
			IsPublished: true,
			UserID: [
				{ StringValue: "q-blob", TypeOfUserID: { StringValue: "git-blob" } },
			],
		});
		const variable = only(doc, "Variable")[0] ?? {};
		expect(variable).toMatchObject({ IsPublished: true });
		expect(variable).not.toHaveProperty("UserID");
		const lists = only(doc, "CodeList");
		const scale = lists.find((l) => l.ID === "scale-agree4.codes") ?? {};
		expect(scale.UserID).toEqual([
			{ StringValue: "scale-blob", TypeOfUserID: { StringValue: "git-blob" } },
		]);
		// A code takes its list's version and nothing else: it isn't versionable on its own.
		for (const code of scale.Code as JsonObject[]) {
			expect(code.Version).toBe("3");
			expect(code).not.toHaveProperty("VersionDate");
			expect(code).not.toHaveProperty("UserID");
		}
	});

	it("an unmerged preview is said to be unpublished", () => {
		const doc = ddi(QUESTION, { own: { number: "5", published: false } });
		expect(only(doc, "QuestionItem")[0]?.IsPublished).toBe(false);
		expect(validate(doc)).toEqual([]);
	});

	it("the binary scale of a select-all question takes the bank's file's version", () => {
		const doc = ddi(SELECT_ALL, VERSIONS);
		expect(validate(doc)).toEqual([]);
		const binary = only(doc, "CodeList").find(
			(l) => l.ID === "scale-yesno01.codes",
		);
		expect(binary?.Version).toBe("8");
		for (const v of only(doc, "Variable"))
			expect(
				refVersion(
					(
						(v.VariableRepresentation as JsonObject)
							.ValueRepresentation as JsonObject
					).CodeListReference,
				),
			).toBe("8");
	});
});
