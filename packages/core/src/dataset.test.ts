import { describe, expect, it } from "vitest";
import schemaText from "../ddi/ddi-lifecycle-4.0-beta4.schema.json?raw";
import { csvView, type Dataset, datasetOf, readDataset } from "./dataset.ts";
import { makeValidator } from "./ddi/validate.ts";
import { answersCsv } from "./responses.ts";

const validator = makeValidator(JSON.parse(schemaText));
const v = (name: string) => `urn:ddi:org.example:instrument-t.var-${name}:1`;

const DATASET: Dataset = {
	name: "wave1",
	agency: "org.example",
	respondents: [
		{ id: "R_2", start: "2026-11-12T23:15:41Z", end: "2026-11-12T23:15:50Z" },
		{ id: "R_1", start: "2026-11-12T23:14:02Z", end: "2026-11-12T23:16:02Z" },
		// No answers: kept by its identifier.
		{ id: "R_3" },
	],
	answers: [
		{ respondent: "R_2", variable: v("tenure"), value: "1" },
		{ respondent: "R_1", variable: v("tenure"), value: "2" },
		{ respondent: "R_1", variable: v("modes_b"), value: "1" },
		{ respondent: "R_1", variable: v("why"), value: 'Close, "mostly"' },
	],
};

const made = (d: Dataset) => {
	const r = datasetOf(d);
	if (!r.ok) throw new Error(r.error);
	return r.value;
};

describe("a dataset as DDI", () => {
	it("is a DataSet of ItemValues, identified by its own respondent variable, valid DDI", () => {
		const doc = made(DATASET);
		expect(validator.ok && validator.value(doc)).toEqual([]);
		expect(Object.keys(doc.Variable ?? {})).toEqual([
			"org.example:dataset-wave1.respondent:1",
			"org.example:dataset-wave1.start:1",
			"org.example:dataset-wave1.end:1",
		]);
		// The schema takes any ValueRepresentation, so its shape is checked here.
		expect(doc.Variable?.["org.example:dataset-wave1.start:1"]).toEqual({
			URN: "urn:ddi:org.example:dataset-wave1.start:1",
			Agency: "org.example",
			ID: "dataset-wave1.start",
			Version: "1",
			VariableName: [
				{
					String: [
						{ MultilingualStringValue: { LanguageTag: "en", Value: "start" } },
					],
				},
			],
			IsTemporal: true,
			VariableRepresentation: {
				ValueRepresentation: { $type: "DateTimeDomain" },
			},
		});
		const set = doc.DataSet?.["org.example:dataset-wave1:1"];
		expect(set?.IdentifyingVariableReference).toEqual({
			$type: "Variable",
			value: ["org.example", "dataset-wave1.respondent", "1"],
		});
		const values =
			(set?.ItemSet as { ItemValue: never[] } | undefined)?.ItemValue ?? [];
		// Sorted by respondent, then variable URN; instrument variables referenced, not embedded.
		expect(
			values.map(
				(x: {
					RecordReference: string;
					VariableReference: { value: string[] };
					Value: { StringValue: string }[];
				}) =>
					`${x.RecordReference} ${x.VariableReference.value[1]} ${x.Value[0]?.StringValue}`,
			),
		).toEqual([
			"R_1 dataset-wave1.end 2026-11-12T23:16:02Z",
			"R_1 dataset-wave1.respondent R_1",
			"R_1 dataset-wave1.start 2026-11-12T23:14:02Z",
			"R_1 instrument-t.var-modes_b 1",
			"R_1 instrument-t.var-tenure 2",
			'R_1 instrument-t.var-why Close, "mostly"',
			"R_2 dataset-wave1.end 2026-11-12T23:15:50Z",
			"R_2 dataset-wave1.respondent R_2",
			"R_2 dataset-wave1.start 2026-11-12T23:15:41Z",
			"R_2 instrument-t.var-tenure 1",
			"R_3 dataset-wave1.respondent R_3",
		]);
		expect(doc.Variable?.[v("tenure")]).toBeUndefined();
	});

	it("gives the same bytes for the same answers in any order", () => {
		const shuffled = {
			...DATASET,
			respondents: [...DATASET.respondents].reverse(),
			answers: [...DATASET.answers].reverse(),
		};
		expect(JSON.stringify(made(shuffled))).toBe(JSON.stringify(made(DATASET)));
	});

	it("reads back what it wrote, and its CSV view is the answers as answersCsv writes them", () => {
		const read = readDataset(JSON.parse(JSON.stringify(made(DATASET))));
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value.name).toBe("wave1");
		expect(read.value.agency).toBe("org.example");
		expect(read.value.respondents).toEqual([
			{ id: "R_1", start: "2026-11-12T23:14:02Z", end: "2026-11-12T23:16:02Z" },
			{ id: "R_2", start: "2026-11-12T23:15:41Z", end: "2026-11-12T23:15:50Z" },
			{ id: "R_3" },
		]);
		expect(csvView(read.value)).toBe(
			answersCsv(
				[
					DATASET.answers[2],
					DATASET.answers[1],
					DATASET.answers[3],
					DATASET.answers[0],
				].flatMap((a) => (a === undefined ? [] : [a])),
			),
		);
	});

	it("has no start or end variable when no interview's time is known", () => {
		const doc = made({
			...DATASET,
			respondents: DATASET.respondents.map((r) => ({ id: r.id })),
		});
		expect(Object.keys(doc.Variable ?? {})).toEqual([
			"org.example:dataset-wave1.respondent:1",
		]);
	});

	it("refuses what it can't say: roster rows, a bad name, an unlisted respondent", () => {
		const refused = (d: Dataset) => {
			const r = datasetOf(d);
			return r.ok ? "" : r.error;
		};
		expect(
			refused({
				...DATASET,
				answers: [
					{ respondent: "R_1", variable: v("age"), row: 1, value: "40" },
				],
			}),
		).toMatch(/roster row/);
		expect(refused({ ...DATASET, name: "wave.1" })).toMatch(
			/isn't one a DDI ID/,
		);
		expect(
			refused({
				...DATASET,
				answers: [{ respondent: "R_9", variable: v("tenure"), value: "1" }],
			}),
		).toMatch(/doesn't list/);
		expect(
			refused({
				...DATASET,
				answers: [{ respondent: "R_1", variable: "tenure", value: "1" }],
			}),
		).toMatch(/isn't a DDI URN/);
		// Written back as `urn:ddi:`, so no other spelling is taken.
		expect(
			refused({
				...DATASET,
				answers: [
					{
						respondent: "R_1",
						variable: v("tenure").toUpperCase(),
						value: "1",
					},
				],
			}),
		).toMatch(/isn't a DDI URN/);
	});

	it("reads no document that isn't one of its datasets", () => {
		const doc = JSON.parse(JSON.stringify(made(DATASET)));
		const key = "org.example:dataset-wave1:1";
		const values = doc.DataSet[key].ItemSet.ItemValue;
		const refused = (j: unknown) => {
			const r = readDataset(j);
			return r.ok ? "" : r.error;
		};
		expect(refused({})).toMatch(/exactly one DataSet/);
		expect(
			refused({
				DataSet: {
					[key]: {
						...doc.DataSet[key],
						ItemSet: { ItemValue: [...values, values[3]] },
					},
				},
			}),
		).toMatch(/twice/);
		expect(
			refused({
				DataSet: {
					[key]: {
						...doc.DataSet[key],
						ItemSet: {
							ItemValue: values.filter(
								(x: {
									RecordReference: string;
									VariableReference: { value: string[] };
								}) =>
									!(
										x.RecordReference === "R_1" &&
										x.VariableReference.value[1] === "dataset-wave1.respondent"
									),
							),
						},
					},
				},
			}),
		).toMatch(/doesn't identify/);
		expect(
			refused({
				DataSet: {
					[key]: {
						...doc.DataSet[key],
						ItemSet: { ItemValue: [{ ...values[0], Value: [] }] },
					},
				},
			}),
		).toMatch(/one variable, one respondent and one value/);
	});
});
