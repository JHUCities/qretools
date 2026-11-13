import { describe, expect, it } from "vitest";
import schemaText from "../ddi/ddi-lifecycle-4.0-beta4.schema.json?raw";
import {
	accessOf,
	canonicalForm,
	csvView,
	type Dataset,
	datasetOf,
	metadataUrn,
	provenanceView,
	readDataset,
	withMetadataVariables,
} from "./dataset.ts";
import {
	type DdiDocument,
	documentOf,
	identity,
	item,
} from "./ddi/document.ts";
import { ddiIndexOf, deref, type Indexed } from "./ddi/read.ts";
import { makeValidator } from "./ddi/validate.ts";
import { bankOf } from "./evaluate.ts";
import { instrumentOf } from "./instrument/instrument.ts";
import { factsOf, modesOf, type Provenance } from "./provenance.ts";
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

/** The instrument's DDI: the instrument and its variables, `unread` among them. */
const INSTRUMENT = documentOf([
	item("Instrument", identity("org.example", "instrument-t"), {}),
	...["tenure", "modes_b", "why", "unread"].map((n) =>
		item("Variable", identity("org.example", `instrument-t.var-${n}`), {}),
	),
]);

const digest = (name: string, c: string) => ({
	name,
	sha256: c.repeat(64),
	size: 10,
});

const PROVENANCE: Provenance = {
	index: ddiIndexOf(INSTRUMENT),
	facts: {
		asked_by: "SelfAdministeredQuestionnaire.CAWI",
		answered_by: "PopulationGroup",
		software: "Qualtrics",
	},
	reads: [v("tenure"), v("modes_b"), v("why")],
	fingerprint: "f".repeat(64),
	source: digest("export.csv", "a"),
	map: {
		...digest("t-ddi-qsf.columns.json", "b"),
		ddi: `sha256:${"c".repeat(64)}`,
	},
	ddi: digest("t.json", "d"),
	claimed: [`sha256:${"e".repeat(64)}`],
};

const made = (d: Dataset) => {
	const r = datasetOf(d, PROVENANCE);
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
			const r = datasetOf(d, PROVENANCE);
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

/** The top-level item a nested object is in. */
const top = (it: Indexed): Indexed => (it.owner ? top(it.owner) : it);

describe("a dataset's provenance", () => {
	const doc = made(DATASET) as DdiDocument;
	const index = ddiIndexOf(doc);
	const study = "urn:ddi:org.example:dataset-wave1.study:1";

	it("resolves every reference, in the dataset or the instrument's DDI, and reaches every item from its StudyUnit without the values", () => {
		const instrument = ddiIndexOf(INSTRUMENT);
		expect(
			index.references.filter(
				// A record is named by the respondent's own string, not by a reference.
				(r) =>
					r.field !== "RecordReference" &&
					(deref(index, r.ref) ?? deref(instrument, r.ref)) === undefined,
			),
		).toEqual([]);
		const view = ddiIndexOf(provenanceView(JSON.parse(JSON.stringify(doc))));
		const reached = new Set([study]);
		for (const at of reached)
			for (const r of view.references)
				if (r.from && top(r.from).urn === at) {
					const to = deref(index, r.ref);
					if (to) reached.add(top(to).urn);
				}
		expect(
			[...index.byUrn.values()]
				.filter((it) => it.owner === undefined && !reached.has(it.urn))
				.map((it) => it.urn),
		).toEqual([]);
	});

	it("says what the dataset is, from what, and when, and groups its variables", () => {
		const event = doc.DataCollection?.["org.example:dataset-wave1.collection:1"]
			?.CollectionEvent as unknown[];
		expect(event[0]).toMatchObject({
			// The earliest start and the latest end.
			DataCollectionDate: {
				StartDate: { DateTime: "2026-11-12T23:14:02Z" },
				EndDate: { DateTime: "2026-11-12T23:16:02Z" },
			},
			InstrumentReference: [
				{ $type: "Instrument", value: ["org.example", "instrument-t", "1"] },
			],
			ModeOfCollection: [
				{
					TypeOfModeOfCollection: {
						StringValue: "SelfAdministeredQuestionnaire.CAWI",
					},
				},
			],
			DataSource: [{ SourceType: [{ StringValue: "PopulationGroup" }] }],
		});
		const ids = (key: string) =>
			(
				doc.VariableGroup?.[key]?.VariableReference as
					| { value: string[] }[]
					| undefined
			)?.map((r) => r.value[1]);
		expect(ids("org.example:dataset-wave1.present:1")).toEqual([
			"dataset-wave1.end",
			"dataset-wave1.respondent",
			"dataset-wave1.start",
			"instrument-t.var-modes_b",
			"instrument-t.var-tenure",
			"instrument-t.var-why",
		]);
		expect(ids("org.example:dataset-wave1.not-in-source:1")).toEqual([
			"instrument-t.var-unread",
		]);
		expect(
			doc.PhysicalInstance?.["org.example:dataset-wave1.data:1"],
		).toMatchObject({
			DataFingerprint: [
				{ Type: "data", DigitalFingerprintValue: "f".repeat(64) },
			],
			RecordLayoutReference: [
				{ $type: "DataSet", value: ["org.example", "dataset-wave1", "1"] },
			],
		});
		// Each digest, the ones the map and the export name included.
		const text = JSON.stringify(doc);
		for (const c of "abcde") expect(text).toContain(c.repeat(64));
	});

	it("compares times as instants, whatever their offsets", () => {
		const shifted = made({
			...DATASET,
			respondents: [
				{
					id: "R_1",
					start: "2026-11-12T20:00:00-05:00",
					end: "2026-11-13T00:30:00Z",
				},
				{
					id: "R_2",
					start: "2026-11-13T00:00:00Z",
					end: "2026-11-12T20:00:00-05:00",
				},
			],
		});
		expect(
			(
				shifted.DataCollection?.["org.example:dataset-wave1.collection:1"]
					?.CollectionEvent as { DataCollectionDate: unknown }[] | undefined
			)?.[0]?.DataCollectionDate,
		).toEqual({
			// As text, R_1's start would sort first and R_1's end last.
			StartDate: { DateTime: "2026-11-13T00:00:00Z" },
			EndDate: { DateTime: "2026-11-12T20:00:00-05:00" },
		});
	});

	it("has a view without values, valid DDI, that no reader takes for a dataset", () => {
		const view = provenanceView(JSON.parse(JSON.stringify(doc)));
		expect(validator.ok && validator.value(view)).toEqual([]);
		const text = JSON.stringify(view);
		expect(text).not.toMatch(/ItemSet|RecordReference|mostly|R_\d/);
		expect(text).toContain("org.example:dataset-wave1:1");
		const read = readDataset(view);
		expect(read.ok ? "" : read.error).toMatch(/holds no values/);
	});

	it("refuses a DDI that doesn't hold one instrument", () => {
		const r = datasetOf(DATASET, {
			...PROVENANCE,
			index: ddiIndexOf(documentOf([])),
		});
		expect(r.ok ? "" : r.error).toMatch(/holds 0 instruments/);
	});
});

describe("the canonical form of a dataset", () => {
	it("holds every value of the DataSet, so a time, an identifier or a respondent with no answers changes it", () => {
		const form = canonicalForm(DATASET);
		expect(form).toContain(
			"R_3,urn:ddi:org.example:dataset-wave1.respondent:1,,R_3",
		);
		expect(form).toContain(
			"R_1,urn:ddi:org.example:dataset-wave1.start:1,,2026-11-12T23:14:02Z",
		);
		const [first, ...rest] = DATASET.respondents;
		const changed = (d: Dataset) => expect(canonicalForm(d)).not.toBe(form);
		changed({
			...DATASET,
			respondents: [
				{ ...first, id: "R_1", start: "2026-11-12T23:14:03Z" },
				...rest,
			],
		});
		changed({
			...DATASET,
			respondents: DATASET.respondents.map((r) =>
				r.id === "R_3" ? { id: "R_4" } : r,
			),
		});
		changed({
			...DATASET,
			respondents: [...DATASET.respondents, { id: "R_5" }],
		});
		// A reader recomputes it from the document.
		const read = readDataset(JSON.parse(JSON.stringify(made(DATASET))));
		expect(read.ok && canonicalForm(read.value)).toBe(form);
	});
});

describe("the facts of a collection", () => {
	it("takes the data's first, an option only for what the data doesn't say, and names what is missing", () => {
		expect(
			factsOf(
				{ asked_by: "Simulation", answered_by: { other: "platform" } },
				{},
			),
		).toEqual({
			ok: true,
			value: { asked_by: "Simulation", answered_by: { other: "platform" } },
		});
		expect(
			factsOf(
				{ asked_by: "SelfAdministeredQuestionnaire.CAWI" },
				{ answered_by: "PopulationGroup" },
			).ok,
		).toBe(true);
		expect(
			factsOf(
				{ asked_by: "SelfAdministeredQuestionnaire.CAWI" },
				{ asked_by: "SelfAdministeredQuestionnaire.CAWI" },
			),
		).toEqual({
			ok: false,
			error: [
				{ fact: "asked_by", problem: "given" },
				{ fact: "answered_by", problem: "missing" },
			],
		});
	});
});

describe("a view at an access level", () => {
	const q = (name: string, rest = "") =>
		`name: ${name}\ntext: ${name}?\nintent: i\nopen: {}\n${rest}`;
	const instrument = (workspace: string, levels = true) =>
		instrumentOf(
			"name: t\nuses:\n  b: here\nflow:\n  - ask: b.tenure\n  - ask: b.why\n",
			{
				banks: {
					b: bankOf({
						"workspace.yaml": `agency: org.bank\n${workspace}`,
						"questions/a/tenure.yaml": q(
							"tenure",
							levels ? "access: public\n" : "",
						),
						"questions/a/why.yaml": q(
							"why",
							levels ? "access: restricted\n" : "",
						),
					}),
				},
				agency: "org.example",
			},
		).ddi;
	const LEVELED = ddiIndexOf(instrument("access: [public, restricted]\n"));
	const d: Dataset = {
		...DATASET,
		answers: DATASET.answers.filter((a) => a.variable !== v("modes_b")),
	};
	const doc = datasetOf(d, { ...PROVENANCE, index: LEVELED });
	if (!doc.ok) throw new Error(doc.error);
	const at = (level: string | undefined) => {
		const a = accessOf(LEVELED, d, level);
		if (!a.ok || a.value === undefined) throw new Error("no access");
		return a.value;
	};

	it("is required where the DDI declares levels, and refused where it declares none", () => {
		expect(accessOf(LEVELED, d, undefined)).toMatchObject({
			ok: false,
			error: {
				kind: "level-required",
				policies: [{ levels: ["public", "restricted"] }],
			},
		});
		const open = ddiIndexOf(instrument("", false));
		expect(accessOf(open, d, undefined)).toEqual({
			ok: true,
			value: undefined,
		});
		expect(accessOf(open, d, "public")).toMatchObject({
			ok: false,
			error: { kind: "no-levels" },
		});
		expect(accessOf(LEVELED, d, "secret")).toMatchObject({
			ok: false,
			error: { kind: "unknown-level" },
		});
	});

	it("removes the variables above it, the dataset's own at any but the most closed", () => {
		const open = at("public");
		expect(open.removed.map((r) => `${r.name} ${r.level}`)).toEqual([
			"why restricted",
			"respondent restricted",
			"start restricted",
			"end restricted",
		]);
		expect(open.owned).toBe(false);
		// Respondents numbered in their own order, never named.
		expect(csvView(d, open)).toBe(
			answersCsv([
				{ respondent: "1", variable: v("tenure"), value: "2" },
				{ respondent: "2", variable: v("tenure"), value: "1" },
			]),
		);
		const closed = at("restricted");
		expect(closed).toMatchObject({ owned: true, removed: [] });
		expect(csvView(d, closed)).toBe(csvView(d));
	});

	it("records the level and what it removed in the provenance view, and leaves no time", () => {
		const view = provenanceView(
			JSON.parse(JSON.stringify(doc.value)),
			at("public"),
		);
		expect(validator.ok && validator.value(view)).toEqual([]);
		const text = JSON.stringify(view);
		expect(text).not.toMatch(/DataCollectionDate|2026-11-12T/);
		expect(Object.values(view.InformationClassification ?? {})).toMatchObject([
			{ LevelOfInformationClassification: { StringValue: "public" } },
		]);
		const group = (part: string) =>
			(
				view.VariableGroup?.[`org.example:dataset-wave1.${part}:1`]
					?.VariableReference as { value: string[] }[] | undefined
			)?.map((r) => r.value[1]);
		expect(group("present")).toEqual(["instrument-t.var-tenure"]);
		expect(group("removed-by-access")).toEqual([
			"instrument-t.var-why",
			"dataset-wave1.respondent",
			"dataset-wave1.start",
			"dataset-wave1.end",
		]);
		const data = view.PhysicalInstance?.["org.example:dataset-wave1.data:1"];
		expect(JSON.stringify(data)).toContain("removed-by-access");
		expect(data?.InformationClassificationReference).toEqual([
			{
				$type: "InformationClassification",
				value: ["org.example", "dataset-wave1.access", "1"],
			},
		]);
		// Every group and collection is filtered, not one found by its key: another version is no way out.
		const moved = JSON.parse(JSON.stringify(doc.value));
		moved.VariableGroup = Object.fromEntries(
			Object.entries(moved.VariableGroup).map(([k, g]) => [
				k.replace(/present:1$/, "present:2"),
				g,
			]),
		);
		moved.DataCollection = Object.fromEntries(
			Object.entries(moved.DataCollection).map(([k, c]) => [
				k.replace(/:1$/, ":2"),
				c,
			]),
		);
		const still = JSON.stringify(provenanceView(moved, at("public")));
		expect(still).not.toMatch(/DataCollectionDate/);
		expect(still.match(/instrument-t\.var-why/g)?.length).toBe(1); // only in removed-by-access
		// At the most closed level the dataset's own variables and the dates stay.
		const closed = JSON.stringify(
			provenanceView(JSON.parse(JSON.stringify(doc.value)), at("restricted")),
		);
		expect(closed).toContain("DataCollectionDate");
	});
});

describe("a data file's metadata, weights and dates", () => {
	const m = (column: string) => metadataUrn("org.example", "wave1", column);
	const q = (name: string, rest = "") =>
		`name: ${name}\ntext: ${name}?\nintent: i\nopen: {}\n${rest}`;
	const instrument = (levels: string) =>
		instrumentOf("name: t\nuses:\n  b: here\nflow:\n  - ask: b.tenure\n", {
			banks: {
				b: bankOf({
					"workspace.yaml": `agency: org.bank\n${levels}`,
					"questions/a/tenure.yaml": q(
						"tenure",
						levels === "" ? "" : "access: public\n",
					),
				}),
			},
			agency: "org.example",
		}).ddi;
	const LEVELED = instrument("access: [public, restricted]\n");
	const tenure = Object.values(LEVELED.Variable ?? {})[0]?.URN as string;
	const d: Dataset = {
		name: "wave1",
		agency: "org.example",
		respondents: [
			{ id: "a", start: "2010-03-15", end: "2010-03-15" },
			{ id: "b", start: "2010-04-02", end: "2010-04-02" },
		],
		answers: [
			{ respondent: "a", variable: tenure, value: "own" },
			{ respondent: "a", variable: m("mode"), value: "1" },
			{ respondent: "b", variable: m("mode"), value: "2" },
			{ respondent: "a", variable: m("w"), value: "0.5" },
			{ respondent: "a", variable: m("phase"), value: "1" },
		],
	};
	const P: Provenance = {
		...PROVENANCE,
		index: ddiIndexOf(LEVELED),
		facts: {
			asked_by: [
				{
					term: "Interview.Telephone",
					variable: m("mode"),
					name: "mode",
					code: "1",
				},
				{
					term: "Interview.FaceToFace",
					variable: m("mode"),
					name: "mode",
					code: "2",
				},
			],
			answered_by: "ResearchData.Published",
		},
		reads: [tenure],
		citation: {
			title: "A release",
			publisher: "A publisher",
			url: "https://example.org/r",
		},
		metadata: [
			{
				column: "mode",
				label: "Mode",
				role: "mode",
				unit: "Interviewer",
				codes: { "1": "Phone", "2": "In person" },
				access: "public",
			},
			{
				column: "w",
				role: "weight",
				number: true,
				weight: true,
				access: "public",
			},
			{ column: "phase", codes: { "1": "First" } },
		],
		weighting: {
			advice: "Use w.",
			source: { title: "A codebook", url: "https://example.org/c" },
			read: "2026-11-12",
		},
	};
	const doc = datasetOf(d, P);
	if (!doc.ok) throw new Error(doc.error);

	it("owns a variable per metadata column, valid DDI, its values in the ItemSet", () => {
		expect(validator.ok && validator.value(doc.value)).toEqual([]);
		// `var-mode`, never the provenance's own `.mode`.
		const mode = doc.value.Variable?.["org.example:dataset-wave1.var-mode:1"];
		expect(mode).toMatchObject({
			VariableName: [
				{ String: [{ MultilingualStringValue: { Value: "mode" } }] },
			],
			SourceUnit: { StringValue: "Interviewer" },
			VariableRepresentation: {
				VariableRole: { StringValue: "mode" },
				ValueRepresentation: {
					$type: "CodeDomain",
					CodeListReference: {
						value: ["org.example", "dataset-wave1.var-mode-codes", "1"],
					},
				},
			},
			EmbargoReference: {
				EmbargoName: [
					{ String: [{ MultilingualStringValue: { Value: "public" } }] },
				],
			},
		});
		const w = doc.value.Variable?.["org.example:dataset-wave1.var-w:1"];
		expect(w).toMatchObject({
			IsWeight: true,
			WeightingProcessReference: {
				value: ["org.example", "dataset-wave1.weighting", "1"],
			},
			VariableRepresentation: {
				ValueRepresentation: { $type: "NumericDomain" },
			},
		});
		// No level stated: no embargo, the most closed level.
		expect(
			doc.value.Variable?.["org.example:dataset-wave1.var-phase:1"]
				?.EmbargoReference,
		).toBeUndefined();
		const back = readDataset(JSON.parse(JSON.stringify(doc.value)));
		expect(back.ok && csvView(back.value)).toBe(csvView(d));
		expect(canonicalForm(d)).toContain(`a,${m("w")},,0.5`);
	});

	it("cites the data file, describes the weighting and each mode, and keeps dates as dates", () => {
		const event = (
			doc.value.DataCollection?.["org.example:dataset-wave1.collection:1"]
				?.CollectionEvent as never[] | undefined
		)?.[0];
		expect(event).toMatchObject({
			DataCollectionDate: {
				StartDate: { Date: "2010-03-15" },
				EndDate: { Date: "2010-04-02" },
			},
			DataSource: [
				{
					SourceType: [{ StringValue: "ResearchData.Published" }],
					Origin: [{ OriginLocation: "https://example.org/r" }],
				},
			],
			ModeOfCollection: [
				{
					TypeOfModeOfCollection: { StringValue: "Interview.Telephone" },
					UserAttributePair: [
						{
							AttributeKey: { StringValue: "variable" },
							AttributeValue: { StringValue: m("mode") },
						},
						{
							AttributeKey: { StringValue: "code" },
							AttributeValue: { StringValue: "1" },
						},
					],
				},
				{ TypeOfModeOfCollection: { StringValue: "Interview.FaceToFace" } },
			],
		});
		expect(Object.values(doc.value.Weighting ?? {})).toMatchObject([
			{
				UsageGuide: {
					UsageRecommendations: {
						Content: [{ MultilingualStringValue: { Value: "Use w." } }],
					},
				},
			},
		]);
		expect(Object.keys(doc.value.ProcessingEventScheme ?? {})).toHaveLength(1);
		expect(
			doc.value.OtherMaterial?.["org.example:dataset-wave1.advice:1"],
		).toMatchObject({
			TypeOfMaterial: { StringValue: "weighting advice" },
			ExternalURLReference: ["https://example.org/c"],
		});
	});

	it("refuses a stated level the DDI's one policy doesn't list, or a DDI with none", () => {
		const level = (access: string, index = P.index) =>
			datasetOf(d, {
				...P,
				index,
				metadata: [{ column: "w", number: true, weight: true, access }],
			});
		expect(level("secret")).toMatchObject({ ok: false });
		expect(level("public", ddiIndexOf(instrument("")))).toMatchObject({
			ok: false,
		});
		expect(level("restricted").ok).toBe(true);
	});

	it("asks by the modes respondents have, in the map's order, and by none when no respondent has one", () => {
		const column = {
			column: "mode",
			codes: { "1": "Phone", "2": "In person", "9": "Not recorded" },
			modes: { "1": "Interview.Telephone", "2": "Interview.FaceToFace" },
		};
		const has = (...values: string[]) =>
			values.map((value) => ({ variable: m("mode"), value }));
		expect(
			modesOf([column], has("1", "9", "1", "2"), m)?.map((x) => x.code),
		).toEqual(["1", "2"]);
		expect(modesOf([column], has("9"), m)).toBeUndefined();
		expect(
			modesOf([{ column: "mode", codes: column.codes }], has("1"), m),
		).toBeUndefined();
	});

	it("keeps a metadata variable in a view at its stated level, and one with none only at the most closed", () => {
		const index = ddiIndexOf(
			withMetadataVariables(LEVELED, doc.value, d) as DdiDocument,
		);
		const open = accessOf(index, d, "public");
		if (!open.ok || open.value === undefined) throw new Error("no access");
		expect(open.value.removed.map((r) => r.name)).toEqual([
			"respondent",
			"start",
			"end",
			"phase",
		]);
		expect(csvView(d, open.value)).not.toContain(m("phase"));
		expect(csvView(d, open.value)).toContain(m("w"));
		const closed = accessOf(index, d, "restricted");
		expect(closed.ok && csvView(d, closed.value)).toBe(csvView(d));
		// Without the dataset's variables beside the DDI, nothing tells a stated level: all stand closed.
		const bare = accessOf(ddiIndexOf(LEVELED), d, "public");
		expect(bare.ok && bare.value?.removed.map((r) => r.urn)).toEqual(
			expect.arrayContaining([m("mode"), m("w"), m("phase")]),
		);
		// A level under a policy the DDI given lacks is refused, never kept.
		const other = JSON.parse(
			JSON.stringify(doc.value).replaceAll(
				"access-public-restricted",
				"access-public-secret",
			),
		);
		expect(
			accessOf(
				ddiIndexOf(withMetadataVariables(LEVELED, other, d) as DdiDocument),
				d,
				"public",
			),
		).toMatchObject({ ok: false, error: { kind: "untraced" } });
		// A dataset can't restate an instrument's variable beside the DDI.
		const forged = JSON.parse(JSON.stringify(doc.value));
		forged.Variable.x = {
			...forged.Variable["org.example:dataset-wave1.var-w:1"],
			ID: "instrument-t.var-tenure",
		};
		expect(
			Object.keys(
				(withMetadataVariables(LEVELED, forged, d) as DdiDocument).Variable ??
					{},
			),
		).not.toContain("x");
	});
});
