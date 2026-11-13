/**
 * A dataset's provenance as DDI-Lifecycle 4.0 items, which `datasetOf` writes beside its
 * DataSet: one StudyUnit; one DataCollection with one CollectionEvent that names the
 * instrument, the dates (the earliest start and the latest end of the interviews), how
 * the respondents were asked and who answered; the dataset and its source file as
 * PhysicalInstances with their fingerprints; the map and the DDI as OtherMaterial, each
 * by its digest; the variables in groups; and, from a data file's map, the publisher's
 * citation and its advice on the weights. Every fact comes from the data first, then
 * from an option (`factsOf`). Pure: the shell reads, hashes and measures the files. It
 * never holds an answer's value: only which variables have values.
 */

import {
	type Identity,
	type Item,
	identity,
	intl,
	item,
	type Json,
	type JsonObject,
	obj,
	ref,
	structured,
} from "./ddi/document.ts";
import type { DdiIndex } from "./ddi/read.ts";
import type { Citation, MetadataColumn, WeightingAdvice } from "./responses.ts";
import { err, ok, type Result } from "./result.ts";

/** A term of a DDI controlled vocabulary, or `Other` with words of our own. */
export type Term = string | { readonly other: string };

/** A mode a data file records for each respondent: its term, and the code of the variable that holds it. */
export interface Mode {
	readonly term: Term;
	/** The URN and name of the variable, and the code that is this mode. */
	readonly variable: string;
	readonly name: string;
	readonly code: string;
}

/** What the data (or an option) says of its collection. */
export interface Facts {
	/** A DDI ModeOfCollection term, or the modes a variable records, each by its code. */
	readonly asked_by?: Term | readonly Mode[] | undefined;
	/** A DDI DataSourceType term. */
	readonly answered_by?: Term;
	/** The software the data were collected with, as the data (or an option) names it. */
	readonly software?: { readonly name: string; readonly version?: string };
}

/**
 * How a data file's respondents were asked, from its map's mode column (its variable's
 * URN given): each mode whose code a respondent has, in the order JSON reads `modes` (an
 * integer code first, in number order). None when no
 * column says, or no respondent has a mode, so an option must.
 */
export function modesOf(
	metadata: readonly MetadataColumn[],
	answers: readonly { readonly variable: string; readonly value: string }[],
	urnOf: (column: string) => string,
): readonly Mode[] | undefined {
	const column = metadata.find((m) => m.modes !== undefined);
	if (column === undefined) return undefined;
	const variable = urnOf(column.column);
	const used = new Set(
		answers.filter((a) => a.variable === variable).map((a) => a.value),
	);
	const modes = Object.entries(column.modes ?? {})
		.filter(([code]) => used.has(code))
		.map(([code, term]) => ({ term, variable, name: column.column, code }));
	return modes.length === 0 ? undefined : modes;
}

/** The options that give a fact the data doesn't. */
export const FACT_OPTIONS = {
	asked_by: "--asked-by",
	answered_by: "--answered-by",
} as const;

export type Fact = keyof typeof FACT_OPTIONS;

/**
 * The facts, the data's first: an option gives only what the data doesn't, and a fact
 * nothing gives is a problem. Each problem is the fact and why: `missing` (no option
 * gives it) or `given` (the data gives it, so its option is refused, the same value or not).
 */
export function factsOf(
	data: Facts,
	options: Readonly<Partial<Record<Fact, string>>>,
): Result<
	Facts & Required<Pick<Facts, Fact>>,
	readonly { readonly fact: Fact; readonly problem: "missing" | "given" }[]
> {
	const problems: { fact: Fact; problem: "missing" | "given" }[] = [];
	for (const fact of ["asked_by", "answered_by"] as const) {
		const given = data[fact] !== undefined;
		const option = options[fact] !== undefined;
		if (given && option) problems.push({ fact, problem: "given" });
		else if (!given && !option) problems.push({ fact, problem: "missing" });
	}
	const asked_by = data.asked_by ?? options.asked_by;
	const answered_by = data.answered_by ?? options.answered_by;
	if (asked_by === undefined || answered_by === undefined || problems.length)
		return err(problems);
	return ok({ ...data, asked_by, answered_by });
}

/** A file the dataset was made from: its name (no folder), SHA-256 (hex) and size in bytes, and the URL it was read from, if it was. */
export interface FileDigest {
	readonly name: string;
	readonly sha256: string;
	readonly size: number;
	readonly url?: string;
}

/** What the shell gives of a dataset's provenance: the files, read and hashed, and the facts. */
export interface Provenance {
	/** The DDI given, read: it holds the instrument and its variables. */
	readonly index: DdiIndex;
	readonly facts: Facts & Required<Pick<Facts, Fact>>;
	/** The columns of a data file no respondent is asked: the dataset owns their variables. */
	readonly metadata?: readonly MetadataColumn[];
	/** The published data file, as its map cites it. */
	readonly citation?: Citation;
	/** What the publisher advises of its weights, as the map says. */
	readonly weighting?: WeightingAdvice;
	/** The variables (URNs) the map reads a column into; none without a map, which reads any. */
	readonly reads?: readonly string[];
	/** SHA-256 (hex) of the whole DataSet in its canonical form (`canonicalForm`). */
	readonly fingerprint: string;
	readonly source: FileDigest;
	/** The map, and the DDI digest it names, where the source was read with one. */
	readonly map?: FileDigest & { readonly ddi?: string };
	/** Other files of the collection (a model's traces, its settings), cited by digest. */
	readonly files?: readonly FileDigest[];
	readonly ddi: FileDigest;
	/** The DDI digests the source names of itself (a Qualtrics export's `qretools_ddi`). */
	readonly claimed: readonly string[];
}

/** What the dataset itself gives its provenance (`datasetOf` derives it). */
export interface Described {
	readonly name: string;
	/** The base of every ID, `dataset-<name>`, and its agency. */
	readonly base: string;
	readonly agency: string;
	/** The DataSet these items describe. */
	readonly dataset: Pick<Item, "type" | "identity">;
	/** The variables (URNs) with at least one value, the dataset's own included. */
	readonly present: readonly string[];
	/** The dataset's own variables for a data file's metadata columns (URNs). */
	readonly metadata: readonly string[];
	/** The interview times (ISO 8601 date-times with a zone, or dates). */
	readonly starts: readonly string[];
	readonly ends: readonly string[];
}

/** What the fingerprint of the DataSet is over, as `canonicalForm` writes it. */
export const DATA_FINGERPRINT =
	"SHA-256 of every value of the DataSet (the answers, the values of the dataset's own variables a data file's map describes, and each respondent's identifier and interview times) as long CSV: UTF-8, LF line ends, the header respondent,variable,row,value, then one line for each value, sorted by respondent and then variable URN in code-unit order";

/** The DDI vocabularies a term is from (the version-free URI). */
export const VOCABULARY = {
	mode: "http://rdf-vocabulary.ddialliance.org/cv/ModeOfCollection/",
	source: "http://rdf-vocabulary.ddialliance.org/cv/DataSourceType/",
	unit: "http://rdf-vocabulary.ddialliance.org/cv/ResponseUnit/",
} as const;

export const codeValueOf = (t: Term, vocabulary: string): JsonObject =>
	typeof t === "string"
		? { StringValue: t, ControlledVocabularyURI: vocabulary }
		: {
				StringValue: "Other",
				OtherValue: t.other,
				ControlledVocabularyURI: vocabulary,
			};

const pair = (key: string, value: string): JsonObject => ({
	AttributeKey: { StringValue: key },
	AttributeValue: { StringValue: value },
});

const sorted = (xs: Iterable<string>): string[] =>
	[...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** The earliest or the latest time, compared as instants, so offsets may differ. The readers give only valid date-times. */
const extreme = (
	times: readonly string[],
	later: boolean,
): string | undefined =>
	times.reduce<string | undefined>((best, t) => {
		if (best === undefined) return t;
		const d = Date.parse(t) - Date.parse(best);
		return (later ? d > 0 : d < 0) ? t : best;
	}, undefined);

/** A date (`2010-03-15`) or a date-time, as DDI's date keeps each. */
const dateOf = (t: string): JsonObject =>
	t.length === 10 ? { Date: t } : { DateTime: t };

/** A published work as DDI cites it. */
const citationOf = (c: Citation): JsonObject =>
	obj({
		Title: intl(c.title),
		Publisher: c.publisher && [{ PublisherName: intl(c.publisher) }],
	});

/** A reference to an item by its URN (`urn:ddi:agency:id:version`). */
export const refTo = (type: string, urn: string): JsonObject => ({
	$type: type,
	value: urn.split(":").slice(2),
});

/**
 * The provenance items, or why there are none: the DDI given must hold exactly one
 * instrument (not one inside another).
 */
export function provenanceOf(
	p: Provenance,
	d: Described,
): Result<readonly Item[], string> {
	const all = [...p.index.byUrn.values()].filter(
		(it) => it.owner === undefined,
	);
	const instruments = all.filter((it) => it.type === "Instrument");
	const [instrument] = instruments;
	if (instrument === undefined || instruments.length > 1)
		return err(
			`The DDI holds ${instruments.length} instruments, and a dataset is the answers to one.`,
		);
	const id = (part: string): Identity =>
		identity(d.agency, `${d.base}.${part}`);
	const reads = p.reads && new Set(p.reads);
	const group = (part: string, description: string, urns: readonly string[]) =>
		item("VariableGroup", id(part), {
			VariableGroupName: [intl(part)],
			Description: structured(description),
			VariableReference: urns.map((u) => refTo("Variable", u)),
		});
	const groups = [
		group(
			"present",
			"The variables the dataset holds at least one value of, its own included.",
			sorted(d.present),
		),
		// Without a map, a variable with no value can't be told from one nobody answered.
		...(reads === undefined
			? []
			: [
					group(
						"not-in-source",
						"The instrument's variables the map reads no column into: the source doesn't hold them. Not missing answers.",
						sorted(
							all
								.filter((it) => it.type === "Variable" && !reads.has(it.urn))
								.map((it) => it.urn),
						),
					),
				]),
		...(d.metadata.length === 0
			? []
			: [
					group(
						"not-asked",
						"The variables of the data file's columns no respondent is asked (a mode, a sample phase, a weight), as its map describes them. They have no question.",
						sorted(d.metadata),
					),
				]),
	];
	// A file the dataset was made from, by its digest and size.
	const material = (
		part: string,
		type: string,
		f: FileDigest,
		more: Readonly<Record<string, Json | undefined>> = {},
	) =>
		item(
			"OtherMaterial",
			id(part),
			obj({
				TypeOfMaterial: { StringValue: type },
				Citation: { Title: intl(f.name) },
				ExternalURLReference: f.url === undefined ? undefined : [f.url],
				UserID: [
					{ StringValue: f.sha256, TypeOfUserID: { StringValue: "SHA-256" } },
				],
				SizeInBytes: f.size,
				...more,
			}),
		);
	const ddi = material("ddi", "instrument DDI", p.ddi, {
		Relationship: [
			{
				RelatedToReference_Versionable: refTo("Instrument", instrument.urn),
				TypeOfRelationship: { StringValue: "describes" },
			},
		],
	});
	const map =
		p.map &&
		material("map", "column map", p.map, {
			// The DDI digest the map names, which may not be the DDI given's.
			UserAttributePair:
				p.map.ddi === undefined ? undefined : [pair("ddi", p.map.ddi)],
		});
	const files = (p.files ?? []).map((f, i) =>
		material(`file-${i + 1}`, "supporting file", f),
	);
	const source = item(
		"PhysicalInstance",
		id("source"),
		obj({
			Citation: { Title: intl(p.source.name) },
			DataFingerprint: [
				{
					Type: "dataFile",
					AlgorithmSpecification: "SHA-256",
					DigitalFingerprintValue: p.source.sha256,
				},
			],
			DataFileIdentification: [
				{ Location: intl(p.source.name), SizeInBytes: p.source.size },
			],
			// The DDI digests the source names of itself.
			UserAttributePair:
				p.claimed.length === 0
					? undefined
					: sorted(p.claimed).map((d) => pair("ddi", d)),
		}),
	);
	const data = item("PhysicalInstance", id("data"), {
		DataFingerprint: [
			{
				Type: "data",
				AlgorithmSpecification: DATA_FINGERPRINT,
				DigitalFingerprintValue: p.fingerprint,
			},
		],
		RecordLayoutReference: [ref(d.dataset)],
		VariableGroupReference: groups.map(ref),
	});
	const methodology =
		p.facts.software === undefined
			? undefined
			: item("Methodology", id("methodology"), {
					DataCollectionSoftware: [
						obj({
							SoftwareName: [intl(p.facts.software.name)],
							SoftwareVersion: p.facts.software.version,
						}),
					],
				});
	const advice = p.weighting;
	const adviceMaterial =
		advice &&
		item(
			"OtherMaterial",
			id("advice"),
			obj({
				TypeOfMaterial: { StringValue: "weighting advice" },
				Citation: citationOf(advice.source),
				ExternalURLReference: advice.source.url && [advice.source.url],
				UserAttributePair: [pair("read", advice.read)],
			}),
		);
	const weighting =
		advice &&
		adviceMaterial &&
		item("Weighting", id("weighting"), {
			UsageGuide: { UsageRecommendations: structured(advice.advice) },
			RelatedOtherMaterialReference: [ref(adviceMaterial)],
		});
	const processingEvent =
		weighting &&
		item("ProcessingEvent", id("processing"), {
			WeightingReference: [ref(weighting)],
		});
	const processing =
		processingEvent &&
		item("ProcessingEventScheme", id("processing-scheme"), {
			ProcessingEventReference: [ref(processingEvent)],
		});
	const asked = p.facts.asked_by;
	const start = extreme(d.starts, false);
	const end = extreme(d.ends, true);
	const collection = item(
		"DataCollection",
		id("collection"),
		obj({
			MethodologyReference: methodology && ref(methodology),
			ProcessingEventSchemeReference: processing && [ref(processing)],
			CollectionEvent: [
				obj({
					...id("event"),
					DataSource: [
						obj({
							SourceType: [codeValueOf(p.facts.answered_by, VOCABULARY.source)],
							Origin: p.citation && [
								obj({
									Citation: citationOf(p.citation),
									OriginLocation: p.citation.url,
								}),
							],
						}),
					],
					DataCollectionDate:
						start === undefined && end === undefined
							? undefined
							: obj({
									StartDate: start && dateOf(start),
									EndDate: end && dateOf(end),
								}),
					// Modes a variable records: which respondents each asked is in that variable, by code.
					ModeOfCollection: Array.isArray(asked)
						? asked.map((m: Mode, i) => ({
								...id(`mode-${i + 1}`),
								TypeOfModeOfCollection: codeValueOf(m.term, VOCABULARY.mode),
								Description: structured(
									`Each respondent's mode is in the variable ${m.name}: this mode is its code ${m.code}.`,
								),
								UserAttributePair: [
									pair("variable", m.variable),
									pair("code", m.code),
								],
							}))
						: [
								{
									...id("mode"),
									TypeOfModeOfCollection: codeValueOf(
										asked as Term,
										VOCABULARY.mode,
									),
								},
							],
					InstrumentReference: [refTo("Instrument", instrument.urn)],
				}),
			],
		}),
	);
	const study = item("StudyUnit", id("study"), {
		Citation: { Title: intl(d.name) },
		DataCollectionReference: [ref(collection)],
		PhysicalInstanceReference: [ref(data), ref(source)],
		RelatedOtherMaterialReference: [...(map ? [map] : []), ddi, ...files].map(
			ref,
		),
	});
	return ok([
		study,
		collection,
		...(methodology ? [methodology] : []),
		...[processing, processingEvent, weighting, adviceMaterial].filter(
			(x) => x !== undefined,
		),
		data,
		source,
		...(map ? [map] : []),
		ddi,
		...files,
		...groups,
	]);
}
