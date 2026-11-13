/**
 * The provenance of one dataset as DDI-Lifecycle 4.0, from what its run folder holds:
 * the answers, a copy of the instrument's DDI, each file's digest, the column map of an
 * ingest, what the source itself says (a survey platform's export: its dates and channel,
 * read by that platform's package) and `run.json`, which holds only what no file says.
 * Derived, never declared twice: a fact in `run.json` that the folder already gives is
 * refused. It never reads or writes an answer's value or a respondent: only which
 * variables are present and how many respondents there are. Pure; no clock, so the same
 * folder gives the same document.
 *
 * One StudyUnit, one DataCollection with one CollectionEvent that names the instrument,
 * the data files as PhysicalInstances (SHA-256 fingerprint and size), every other file as
 * an OtherMaterial (its digest as a pair), the variables in groups, and the access level
 * as an InformationClassification. A data file's columns no respondent is asked (its
 * map's `metadata`: a mode, a phase, weights) become Variables the provenance owns, with
 * the publisher's advice on its weights as one Weighting. Every item is version 1 (a
 * provenance records one event, so `qretools provenance` refuses to overwrite one that
 * would differ), but for those Variables and their codes, which the map defines: they
 * keep `metadataUrn`'s identity, since answers.csv names them.
 */
import { z } from "zod";
import {
	type DdiDocument,
	documentOf,
	type Identity,
	type Item,
	type ItemType,
	identity,
	intl,
	type JsonObject,
	obj,
	ref,
	structured,
} from "./ddi/document.ts";
import { type DdiIndex, deref } from "./ddi/read.ts";
import { aboveLevel, type FilterRefusal } from "./filter.ts";
import {
	type Answer,
	type MetadataColumn,
	metadataUrn,
	type Term,
	termSchema,
	type WeightingAdvice,
} from "./responses.ts";
import { err, ok, type Result } from "./result.ts";

export type { Term };

/** What the folder gives of how the data were collected; `run.json` may not repeat any of it. */
export interface Collection {
	/** DDI ModeOfCollection notations. */
	readonly asked_by?: readonly Term[];
	/** A DDI DataSourceType notation. */
	readonly answered_by?: Term;
	/** ISO 8601: a date, or a date and time with its zone. */
	readonly start?: string;
	readonly end?: string;
	readonly runtime?: {
		readonly name: string;
		readonly version?: string | undefined;
	};
}

/** A file of the run folder, as read: its name in the folder, SHA-256 (hex) and size. */
export interface RunFile {
	readonly path: string;
	readonly sha256: string;
	readonly size: number;
}

/** An ingest's column map: its file, the source it names, and the variables it reads. */
export interface RunMap {
	readonly path: string;
	readonly source: string;
	/** The variables its columns are read into (not those marked `filtered`). */
	readonly reads: readonly string[];
	/** A data file's columns no respondent is asked, and what the publisher advises of its weights. */
	readonly metadata?: readonly MetadataColumn[];
	readonly weighting?: WeightingAdvice;
}

export interface RunFolder {
	/** The folder's own name: every ID hangs off it. */
	readonly name: string;
	/** `ddi.json`, read. */
	readonly index: DdiIndex;
	/** Every file in the folder but the provenance itself. */
	readonly files: readonly RunFile[];
	/** `answers.csv`, read. */
	readonly answers: readonly Answer[];
	/** `run.json` as JSON, or undefined when the folder has none. */
	readonly run: unknown;
	/** What the source says of itself (a platform's export); `{}` for a data file or a synthetic run. */
	readonly collection: Collection;
	/** An ingest's map; none for a synthetic run. */
	readonly map?: RunMap;
}

/** Why no provenance is written: the file it's about, the field, and what is wrong. Never a value. */
export interface ProvenanceProblem {
	readonly file: string;
	readonly field?: string;
	readonly message: string;
}

export const RUN = "run.json";
export const ANSWERS = "answers.csv";
export const DDI = "ddi.json";
export const SOURCE = "source.csv";
export const PROVENANCE = "provenance.json";

/** The DDI vocabularies a term is read from (the version-free URI). */
const VOCABULARY = {
	mode: "http://rdf-vocabulary.ddialliance.org/cv/ModeOfCollection/",
	source: "http://rdf-vocabulary.ddialliance.org/cv/DataSourceType/",
	unit: "http://rdf-vocabulary.ddialliance.org/cv/ResponseUnit/",
} as const;

/** A synthetic run: asked by a simulation, answered by no one real. */
const SYNTHETIC: Collection = {
	asked_by: ["Simulation"],
	answered_by: { other: "synthetic" },
};

const nonEmpty = z.string().min(1);
const date = z
	.string()
	.regex(
		/^\d{4}-\d\d-\d\d(T\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d))?$/,
		"a date (2026-11-12), or a date and time with its zone (2026-11-12T09:00:00Z)",
	);

/**
 * `run.json`: only what no file says. Unknown fields are refused, so a later field is
 * always a deliberate addition.
 */
const RunSchema = z.strictObject({
	respondent: z.literal("synthetic").optional(),
	start: date.optional(),
	end: date.optional(),
	asked_by: z.array(termSchema).min(1).optional(),
	answered_by: termSchema.optional(),
	source: z
		.strictObject({
			title: nonEmpty,
			publisher: nonEmpty.optional(),
			url: nonEmpty.optional(),
		})
		.optional(),
	runtime: z
		.strictObject({ name: nonEmpty, version: nonEmpty.optional() })
		.optional(),
	reported: z.record(z.string(), z.string()).optional(),
	access: nonEmpty.optional(),
});
type Run = z.infer<typeof RunSchema>;

/** Fields only one kind of folder may declare: a synthetic run (no map), or an ingest (a map). */
const ONLY: Readonly<Partial<Record<keyof Run, "synthetic" | "ingest">>> = {
	respondent: "synthetic",
	runtime: "synthetic",
	reported: "synthetic",
	source: "ingest",
};

/** A folder name every ID can hang off: DDI's ID characters, with no dot (the one dot is ours). */
const NAME = /^[A-Za-z0-9*@$_-]+$/;

const sorted = (xs: Iterable<string>): string[] =>
	[...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** What a refused filter means here, without a value. */
function accessMessage(r: FilterRefusal, level: string): string {
	switch (r.kind) {
		case "no-levels":
			return "The DDI defines no access levels, so `access` means nothing here.";
		case "unknown-level":
			return `The access policy ${r.policies.map((p) => p.urn).join(", ")} has no level \`${level}\`.`;
		case "unreadable-levels":
			return `The DDI's access levels can't be read: ${r.reason}.`;
		default:
			return `The access level of ${"urns" in r ? r.urns.map((u) => `\`${u}\``).join(", ") : "a variable"} can't be traced to one access policy in the DDI.`;
	}
}

/**
 * The run folder's provenance, or every reason it can't be written. The shell has read
 * the files and checked an ingest by doing it again; this decides what they say.
 */
export function provenanceOf(
	f: RunFolder,
): Result<DdiDocument, readonly ProvenanceProblem[]> {
	const problems: ProvenanceProblem[] = [];
	const say = (file: string, message: string, field?: string) =>
		problems.push({ file, message, ...(field !== undefined && { field }) });

	if (!NAME.test(f.name))
		say(
			f.name,
			"A run folder's name is letters, digits, `-` and `_` only: every ID in the provenance is made from it.",
		);
	const instruments = [...new Set(f.index.byUrn.values())].filter(
		(it) => it.type === "Instrument" && it.owner === undefined,
	);
	const [instrument] = instruments;
	if (instrument === undefined || instruments.length > 1)
		say(
			DDI,
			`This DDI holds ${instruments.length} instruments; a run asks one.`,
		);

	// run.json, parsed once.
	const parsed =
		f.run === undefined
			? { success: true as const, data: {} }
			: RunSchema.safeParse(f.run);
	if (!parsed.success)
		for (const issue of parsed.error.issues)
			say(
				RUN,
				issue.code === "unrecognized_keys"
					? `\`${issue.keys.join("`, `")}\` isn't a field of run.json.`
					: issue.message,
				issue.path.join(".") || undefined,
			);
	// The rules below read run.json's fields: unread, they would only add noise.
	if (!parsed.success) return err(problems);
	const run: Run = parsed.data;
	const kind = f.map === undefined ? "synthetic" : "ingest";
	const metadata = f.map?.metadata ?? [];
	const urnOf = (m: MetadataColumn) =>
		metadataUrn(instrument?.urn ?? "", f.map?.source ?? "", m.column);
	// Each mode the map's mode column codes: a fact of the map, never of the answers.
	const modeColumn = metadata.find((m) => m.modes !== undefined);
	const modes = Object.entries(modeColumn?.modes ?? {});
	const given: Collection =
		f.map === undefined
			? SYNTHETIC
			: {
					...f.collection,
					...(modes.length > 0 && { asked_by: modes.map(([, t]) => t) }),
				};
	for (const [key, only] of Object.entries(ONLY))
		if (run[key as keyof Run] !== undefined && only !== kind)
			say(
				RUN,
				only === "synthetic"
					? `Only a synthetic run (a folder with no column map) declares \`${key}\`; this folder has ${f.map?.path}.`
					: `Only an ingest (a folder with a column map) declares \`${key}\`.`,
				key,
			);
	if (kind === "synthetic" && run.respondent === undefined)
		say(
			RUN,
			'This folder has no column map, so it is a synthetic run: run.json must say `"respondent": "synthetic"`.',
			"respondent",
		);
	for (const key of Object.keys(given))
		if (run[key as keyof Run] !== undefined)
			say(
				RUN,
				`\`${key}\` is given by the folder (${f.map === undefined ? "a synthetic run is asked by a simulation" : `its source, read with ${f.map.path}`}), so run.json may not declare it.`,
				key,
			);
	const c: Collection = {
		...given,
		...(run.asked_by !== undefined && { asked_by: run.asked_by }),
		...(run.answered_by !== undefined && { answered_by: run.answered_by }),
		...(run.start !== undefined && { start: run.start }),
		...(run.end !== undefined && { end: run.end }),
		...(run.runtime !== undefined && { runtime: run.runtime }),
	};
	for (const key of ["asked_by", "answered_by"] as const)
		if (c[key] === undefined)
			say(RUN, `Nothing in the folder says \`${key}\`, so run.json must.`, key);
	if (kind === "synthetic" && c.runtime === undefined)
		say(
			RUN,
			"A synthetic run declares its `runtime` (name, version).",
			"runtime",
		);

	// Dates of one form compare as text; a date and a date and time aren't compared.
	if (
		c.start !== undefined &&
		c.end !== undefined &&
		c.start.length === c.end.length &&
		c.start > c.end
	)
		say(RUN, "`start` is after `end`.", "start");
	const paths = new Set(f.files.map((x) => x.path));
	for (const needed of [ANSWERS, DDI, ...(kind === "ingest" ? [SOURCE] : [])])
		if (!paths.has(needed)) say(needed, "The run folder has no such file.");

	// The variables: those present must be the instrument's; access must remove none.
	const isVariable = (u: string) => deref(f.index, u)?.type === "Variable";
	const metaUrns = new Set(metadata.map(urnOf));
	const present = sorted(f.answers.map((a) => a.variable));
	for (const u of present.filter((u) => !isVariable(u) && !metaUrns.has(u)))
		say(
			ANSWERS,
			`\`${u}\` isn't a Variable of ddi.json, nor one of the column map's metadata.`,
		);
	const variables = sorted(
		[...f.index.byUrn.values()]
			.filter((it) => it.type === "Variable" && it.owner === undefined)
			.map((it) => it.urn),
	);
	const reads = new Set(f.map?.reads ?? variables);
	const notInSource =
		f.map === undefined ? [] : variables.filter((u) => !reads.has(u));
	let removed: readonly string[] = [];
	if (run.access !== undefined) {
		const level = run.access;
		const seen = aboveLevel(f.index, present.filter(isVariable), level);
		const hidden = aboveLevel(
			f.index,
			variables.filter((u) => reads.has(u)),
			level,
		);
		if (!seen.ok) say(DDI, accessMessage(seen.error, level), "access");
		else if (seen.value.length > 0)
			say(
				ANSWERS,
				`It holds answers to ${seen.value.length} variables above \`${level}\` (${seen.value.map((u) => `\`${u}\``).join(", ")}): filter it at that level first.`,
				"access",
			);
		else if (hidden.ok) removed = hidden.value;
	}
	if (problems.length > 0 || instrument === undefined) return err(problems);

	const [agency = ""] = instrument.urn.split(":").slice(2);
	const n = f.name;
	const make = (type: ItemType, id: string, body: JsonObject): Item => ({
		type,
		identity: identity(agency, id),
		body,
	});
	const part = (id: string): Identity => identity(agency, id);
	const refTo = (type: ItemType, urn: string): JsonObject => {
		const [a = "", id = "", v = ""] = urn.split(":").slice(2);
		return { $type: type, value: [a, id, v] };
	};
	const instrumentRef = refTo("Instrument", instrument.urn);
	const pair = (key: string, value: string): JsonObject => ({
		AttributeKey: { StringValue: key },
		AttributeValue: { StringValue: value },
	});
	const codeValueOf = (t: Term, vocabulary: string): JsonObject =>
		typeof t === "string"
			? { StringValue: t, ControlledVocabularyURI: vocabulary }
			: {
					StringValue: "Other",
					OtherValue: t.other,
					ControlledVocabularyURI: vocabulary,
				};
	const dateOf = (d: string): JsonObject =>
		d.includes("T") ? { DateTime: d } : { Date: d };

	// The variables, grouped. An empty group isn't written.
	const group = (key: string, description: string, urns: readonly string[]) =>
		urns.length === 0
			? []
			: [
					make("VariableGroup", `group-${n}.${key}`, {
						VariableGroupName: [intl(key)],
						Description: structured(description),
						VariableReference: urns.map((u) => refTo("Variable", u)),
					}),
				];
	const groups = [
		...group(
			"present",
			"The variables the dataset holds, in the long form `responses` writes: one line for each respondent, variable, row and value, each variable by its DDI URN.",
			present,
		),
		...group(
			"not-in-source",
			"The instrument's variables the source doesn't hold: the column map reads no column into them, or marks theirs filtered. Not missing answers. A variable the source holds but no respondent answered is in no group.",
			notInSource,
		),
		...group(
			"not-asked",
			"The variables no respondent is asked: what the column map's `metadata` says of the source's other columns (the mode of each interview, a sample phase, a weight). They have no question.",
			sorted(metaUrns),
		),
		...group(
			"removed-by-access",
			`The instrument's variables above the access level \`${run.access}\`, so not in the dataset. Not missing answers.`,
			removed,
		),
	];
	const access =
		run.access === undefined
			? []
			: [
					make("InformationClassification", `access-${n}`, {
						LevelOfInformationClassification: { StringValue: run.access },
					}),
				];

	// The metadata columns' variables, hung off the instrument (`metadataUrn`), at its version.
	const [, , , instrumentId = "", instrumentVersion = "1"] =
		instrument.urn.split(":");
	const base = `${instrumentId}-${f.map?.source ?? ""}`;
	const defined = (type: ItemType, id: string, body: JsonObject): Item => ({
		type,
		identity: identity(agency, id, instrumentVersion),
		body,
	});
	const advice = f.map?.weighting;
	const adviceMaterial =
		advice === undefined
			? undefined
			: make(
					"OtherMaterial",
					`material-${n}.weighting-advice`,
					obj({
						TypeOfMaterial: { StringValue: "weighting advice" },
						Citation: obj({
							Title: intl(advice.source.title),
							Publisher: advice.source.publisher && [
								{ PublisherName: intl(advice.source.publisher) },
							],
						}),
						ExternalURLReference: advice.source.url && [advice.source.url],
						UserAttributePair: [pair("read", advice.read)],
					}),
				);
	const weighting =
		advice === undefined || adviceMaterial === undefined
			? undefined
			: make("Weighting", `weighting-${n}`, {
					UsageGuide: { UsageRecommendations: structured(advice.advice) },
					RelatedOtherMaterialReference: [ref(adviceMaterial)],
				});
	const metaItems = metadata.flatMap((m): Item[] => {
		const codes = Object.entries(m.codes ?? {});
		const categories = codes.map(([, label], i) =>
			defined("Category", `${base}.${m.column}-cat-${i}`, {
				Label: [structured(label)],
			}),
		);
		const codeList =
			m.codes === undefined
				? undefined
				: defined("CodeList", `${base}.${m.column}-codes`, {
						Code: codes.map(([code], i) => ({
							...identity(
								agency,
								`${base}.${m.column}-code-${i}`,
								instrumentVersion,
							),
							Value: { StringValue: code },
							CategoryReference: ref(categories[i] as Item),
						})),
					});
		const variable = defined(
			"Variable",
			`${base}.${m.column}`,
			obj({
				VariableName: [intl(m.column)],
				Label: m.label && [structured(m.label)],
				SourceUnit: m.unit && codeValueOf(m.unit, VOCABULARY.unit),
				IsWeight: m.weight,
				// shortcut: these URNs are the map's at the instrument's version, so a map edited without a new DDI keeps them, and the Weighting is this run's, so two runs refer to different ones; give the map a version of its own when one bank publishes several runs of one map.
				WeightingProcessReference: m.weight && weighting && ref(weighting),
				VariableRepresentation: obj({
					VariableRole: m.role && { StringValue: m.role },
					ValueRepresentation:
						codeList === undefined
							? { $type: "NumericDomain" }
							: { $type: "CodeDomain", CodeListReference: ref(codeList) },
				}),
			}),
		);
		return [variable, ...(codeList ? [codeList] : []), ...categories];
	});
	const processingEvent =
		weighting === undefined
			? undefined
			: make("ProcessingEvent", `processing-${n}.weighting`, {
					WeightingReference: [ref(weighting)],
				});
	const processing =
		processingEvent === undefined
			? undefined
			: make("ProcessingEventScheme", `processing-${n}`, {
					ProcessingEventReference: [ref(processingEvent)],
				});

	// The files, in name order: the answers and the source as data, the rest as material.
	const byName = [...f.files].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);
	const fingerprinted = (file: RunFile, id: string, more: JsonObject) =>
		make(
			"PhysicalInstance",
			id,
			obj({
				Citation: { Title: intl(file.path) },
				DataFingerprint: [
					{
						Type: "dataFile",
						AlgorithmSpecification: "SHA-256",
						DigitalFingerprintValue: file.sha256,
					},
				],
				DataFileIdentification: [
					{ Location: intl(file.path), SizeInBytes: file.size },
				],
				...more,
			}),
		);
	const data = byName.flatMap((file) =>
		file.path === ANSWERS
			? [
					fingerprinted(file, `file-${n}.answers`, {
						GrossFileStructure: {
							...part(`structure-${n}.answers`),
							CaseQuantity: new Set(f.answers.map((a) => a.respondent)).size,
						},
						VariableGroupReference: groups.map(ref),
						...(access.length > 0 && {
							InformationClassificationReference: access.map(ref),
						}),
					}),
				]
			: file.path === SOURCE && kind === "ingest"
				? [fingerprinted(file, `file-${n}.source`, {})]
				: [],
	);
	const MATERIAL: Readonly<Record<string, string>> = {
		[DDI]: "instrument",
		[RUN]: "run facts",
		...(f.map && { [f.map.path]: "column map" }),
	};
	const materials = byName
		.filter(
			(file) =>
				!(file.path === ANSWERS || (file.path === SOURCE && kind === "ingest")),
		)
		.map((file, i) =>
			make(
				"OtherMaterial",
				`material-${n}.${i + 1}`,
				obj({
					TypeOfMaterial: { StringValue: MATERIAL[file.path] ?? "file" },
					Citation: { Title: intl(file.path) },
					Relationship:
						file.path === DDI
							? [
									{
										RelatedToReference_Versionable: instrumentRef,
										TypeOfRelationship: { StringValue: "describes" },
									},
								]
							: undefined,
					UserAttributePair: [
						pair("sha256", file.sha256),
						pair("bytes", String(file.size)),
					],
				}),
			),
		);

	const methodology =
		c.runtime === undefined
			? []
			: [
					make("Methodology", `methodology-${n}`, {
						DataCollectionSoftware: [
							obj({
								SoftwareName: [intl(c.runtime.name)],
								SoftwareVersion: c.runtime.version,
							}),
						],
					}),
				];
	const source = run.source;
	const event = obj({
		...part(`collection-${n}.event`),
		DataSource: [
			obj({
				SourceType: c.answered_by && [
					codeValueOf(c.answered_by, VOCABULARY.source),
				],
				Origin: source && [
					obj({
						Citation: obj({
							Title: intl(source.title),
							Publisher: source.publisher && [
								{ PublisherName: intl(source.publisher) },
							],
						}),
						OriginLocation: source.url,
					}),
				],
			}),
		],
		DataCollectionDate:
			c.start === undefined && c.end === undefined
				? undefined
				: obj({
						StartDate: c.start && dateOf(c.start),
						EndDate: c.end && dateOf(c.end),
					}),
		// A mode the map gives: which respondents it asked is in the mode variable, by code.
		ModeOfCollection:
			modeColumn === undefined
				? (c.asked_by ?? []).map((t, i) => ({
						...part(`collection-${n}.mode-${i + 1}`),
						TypeOfModeOfCollection: codeValueOf(t, VOCABULARY.mode),
					}))
				: modes.map(([code, t], i) => ({
						...part(`collection-${n}.mode-${i + 1}`),
						TypeOfModeOfCollection: codeValueOf(t, VOCABULARY.mode),
						Description: structured(
							`Each respondent's mode is in the variable ${modeColumn.column}: this mode is its code ${code}.`,
						),
						UserAttributePair: [pair(urnOf(modeColumn), code)],
					})),
		InstrumentReference: [instrumentRef],
		// Written unread: what the runtime reported of itself.
		UserAttributePair:
			run.reported === undefined || Object.keys(run.reported).length === 0
				? undefined
				: sorted(Object.keys(run.reported)).map((k) =>
						pair(k, run.reported?.[k] ?? ""),
					),
	});
	const collection = make(
		"DataCollection",
		`collection-${n}`,
		obj({
			MethodologyReference: methodology[0] && ref(methodology[0]),
			ProcessingEventSchemeReference: processing && [ref(processing)],
			CollectionEvent: [event],
		}),
	);
	const study = make(
		"StudyUnit",
		`study-${n}`,
		obj({
			Citation: { Title: intl(n) },
			DataCollectionReference: [ref(collection)],
			PhysicalInstanceReference: data.map(ref),
			RelatedOtherMaterialReference: materials.map(ref),
		}),
	);
	return ok(
		documentOf([
			study,
			collection,
			...methodology,
			...data,
			...materials,
			...access,
			...groups,
			...metaItems,
			...[adviceMaterial, weighting, processingEvent, processing].filter(
				(x) => x !== undefined,
			),
		]),
	);
}
