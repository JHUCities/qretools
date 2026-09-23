import { describe, expect, it } from "vitest";
import schemaText from "../../ddi/ddi-lifecycle-4.0-beta4.schema.json?raw";
import demRace from "../../examples/dem_race.yaml?raw";
import nhdCohes1 from "../../examples/nhd_cohes1.yaml?raw";
import nhdNyrs from "../../examples/nhd_nyrs.yaml?raw";
import nhdSat from "../../examples/nhd_sat.yaml?raw";
import agree4Text from "../../examples/scales/agree4.yaml?raw";
import { parseSurface } from "../surface/parse.js";
import { parseScale } from "../surface/scales.js";
import type { DdiDocument, ItemType, JsonObject } from "./document.js";
import { elaborate } from "./elaborate.js";
import { makeValidator } from "./validate.js";

const AGENCY = "org.example";
const EXAMPLES: Readonly<Record<string, string>> = {
	nhd_sat: nhdSat,
	nhd_nyrs: nhdNyrs,
};
const example = (name: string): string => EXAMPLES[name] ?? "";
const schema: unknown = JSON.parse(schemaText);
const validator = makeValidator(schema);
const validate = (doc: DdiDocument) =>
	validator.ok ? validator.value(doc) : [validator.error];

const itemOf = (doc: DdiDocument, type: ItemType, id: string): JsonObject =>
	doc[type]?.[`${AGENCY}:${id}:1`] ?? {};
const question = (doc: DdiDocument, id: string): JsonObject =>
	itemOf(doc, "QuestionItem", id);

describe("elaborate", () => {
	it("compiles the official schema", () => {
		expect(validator.ok).toBe(true);
	});

	it.each(["nhd_sat", "nhd_nyrs"])(
		"elaborates %s to a schema-valid document",
		(name) => {
			const { draft, findings } = parseSurface(example(name));
			expect(findings).toEqual([]);
			expect(validate(elaborate(draft, AGENCY))).toEqual([]);
		},
	);

	it("is total: an empty draft and a draft of holes still elaborate and validate", () => {
		for (const text of [
			"",
			"text: Only a text so far\n",
			"responses:\n",
			"name: q\nselect: many\nresponses:\n  1:\n",
		]) {
			const doc = elaborate(parseSurface(text).draft, AGENCY);
			expect(validate(doc)).toEqual([]);
			expect(Object.keys(doc.QuestionItem ?? {})).toHaveLength(1);
		}
	});

	it("uses a placeholder ID while name is a hole, and does not leak it into the name", () => {
		const q = question(elaborate({ text: "Q?" }, AGENCY), "untitled");
		expect(q.ID).toBe("untitled");
		expect(q.QuestionItemName).toBeUndefined();
	});

	it("maps a code list: author codes in Value, index-based IDs, references by [agency, id, version]", () => {
		const doc = elaborate(parseSurface(example("nhd_sat")).draft, AGENCY);
		const q = question(doc, "nhd_sat");
		expect(q.URN).toBe("urn:ddi:org.example:nhd_sat:1");
		expect(q.QuestionIntent).toEqual({
			Content: [
				{
					MultilingualStringValue: {
						LanguageTag: "en",
						Value:
							"Prevalence of overall neighborhood satisfaction; anchor item for the nhd module",
					},
				},
			],
		});
		expect(q.ResponseDomain).toEqual({
			$type: "CodeDomain",
			CodeListReference: {
				$type: "CodeList",
				value: [AGENCY, "nhd_sat.codes", "1"],
			},
			ResponseCardinality: { MaximumResponses: 1 },
		});
		const codes = itemOf(doc, "CodeList", "nhd_sat.codes")
			.Code as readonly JsonObject[];
		expect(codes.map((c) => (c.Value as JsonObject).StringValue)).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
		]);
		expect(codes[4]?.CategoryReference).toEqual({
			$type: "Category",
			value: [AGENCY, "nhd_sat.cat-4", "1"],
		});
		expect(Object.keys(doc.Category ?? {})).toHaveLength(5);
		expect(q.ConceptReference).toEqual([
			{ $type: "Concept", value: [AGENCY, "nhd_sat.concept", "1"] },
		]);
		expect(doc.Universe && Object.keys(doc.Universe)).toEqual([
			`${AGENCY}:nhd_sat.universe:1`,
		]);
	});

	it("select many allows as many responses as there are codes", () => {
		const { draft } = parseSurface(
			"name: q\nselect: many\nresponses:\n  1: a\n  2: b\n  3: c\n",
		);
		expect(
			(question(elaborate(draft, AGENCY), "q").ResponseDomain as JsonObject)
				.ResponseCardinality,
		).toEqual({
			MaximumResponses: 3,
		});
	});

	it("maps number and open domains", () => {
		const n = question(
			elaborate(parseSurface(example("nhd_nyrs")).draft, AGENCY),
			"nhd_nyrs",
		);
		expect(n.ResponseDomain).toEqual({
			$type: "NumericDomain",
			NumberRange: [
				{
					Low: { DecimalValue: 0, IsInclusive: true },
					High: { DecimalValue: 100, IsInclusive: true },
				},
			],
			NumericTypeCode: { StringValue: "Integer" },
			MeasurementUnit: { StringValue: "years" },
		});
		const half = question(
			elaborate(
				parseSurface("name: q\nnumber:\n  min: 0\n  decimals: 2\n").draft,
				AGENCY,
			),
			"q",
		);
		expect(half.ResponseDomain).toEqual({
			$type: "NumericDomain",
			NumberRange: [{ Low: { DecimalValue: 0, IsInclusive: true } }],
			NumericTypeCode: { StringValue: "Decimal" },
			DecimalPositions: 2,
		});
		const o = question(
			elaborate(
				parseSurface("name: q\nopen:\n  max_length: 200\n").draft,
				AGENCY,
			),
			"q",
		);
		expect(o.ResponseDomain).toEqual({ $type: "TextDomain", MaxLength: 200 });
	});
});

describe("shared scales and select-many", () => {
	const agree4 = parseScale(agree4Text).scale;
	const scales = agree4 ? { agree4 } : {};

	it("a named scale is one CodeList for the bank, identified by the scale, and validates", () => {
		const { draft, findings } = parseSurface(nhdCohes1, scales);
		expect(findings).toEqual([]);
		const doc = elaborate(draft, AGENCY);
		expect(validate(doc)).toEqual([]);
		expect(Object.keys(doc.CodeList ?? {})).toEqual([
			`${AGENCY}:scale-agree4.codes:1`,
		]);
		expect(question(doc, "nhd_cohes1").Label).toEqual([
			{
				Content: [
					{
						MultilingualStringValue: {
							LanguageTag: "en",
							Value: "Neighbors willing to help",
						},
					},
				],
			},
		]);
	});

	it("select-many yields one yes/no Variable per option, referencing the question", () => {
		const { draft, findings } = parseSurface(demRace);
		expect(findings).toEqual([]);
		const doc = elaborate(draft, AGENCY);
		expect(validate(doc)).toEqual([]);
		expect(Object.keys(doc.Variable ?? {})).toEqual(
			["wh", "bl", "am", "as", "ot"].map((c) => `${AGENCY}:dem_race_${c}:1`),
		);
		const wh = itemOf(doc, "Variable", "dem_race_wh");
		expect(wh.QuestionReference).toEqual([
			{ $type: "QuestionItem", value: [AGENCY, "dem_race", "1"] },
		]);
		expect(wh.VariableRepresentation).toEqual({
			ValueRepresentation: {
				$type: "CodeDomain",
				CodeListReference: {
					$type: "CodeList",
					value: [AGENCY, "scale-yesno01.codes", "1"],
				},
			},
		});
		expect(itemOf(doc, "CodeList", "scale-yesno01.codes").Code).toHaveLength(2);
		expect(question(doc, "dem_race").Description).toBeDefined();
	});

	it("emits no Variable while the name is a hole", () => {
		const { draft } = parseSurface(
			"select: many\nresponses:\n  a: A\n  b: B\n",
		);
		expect(elaborate(draft, AGENCY).Variable).toBeUndefined();
	});
});

describe("validate", () => {
	it("reports what the schema can catch", () => {
		const findings = validate({
			QuestionItem: { x: { ID: "x" } as JsonObject },
		});
		expect(findings.length).toBeGreaterThan(0);
		expect(
			findings.every((f) => f.code === "ddi-invalid" && f.severity === "error"),
		).toBe(true);
	});
});
