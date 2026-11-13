/**
 * A dataset's provenance as DDI-Lifecycle 4.0 items, which `datasetOf` writes beside its
 * DataSet: one StudyUnit; one DataCollection with one CollectionEvent that names the
 * instrument, the dates (the earliest start and the latest end of the interviews), how
 * the respondents were asked and who answered; the dataset and its source file as
 * PhysicalInstances with their fingerprints; the map and the DDI as OtherMaterial, each
 * by its digest; and the variables in groups. Every fact comes from the data first, then
 * from an option (`factsOf`). Pure: the shell reads, hashes and measures the files. It
 * never holds an answer's value: only which variables have values.
 */

import {
	type Identity,
	type Item,
	identity,
	intl,
	item,
	type JsonObject,
	obj,
	ref,
	structured,
} from "./ddi/document.ts";
import type { DdiIndex } from "./ddi/read.ts";
import { err, ok, type Result } from "./result.ts";

/** A term of a DDI controlled vocabulary, or `Other` with words of our own. */
export type Term = string | { readonly other: string };

/** What the data (or an option) says of its collection. */
export interface Facts {
	/** A DDI ModeOfCollection term. */
	readonly asked_by?: Term;
	/** A DDI DataSourceType term. */
	readonly answered_by?: Term;
	/** The software the data were collected with, as the data names it. */
	readonly software?: string;
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
	const pick = (fact: Fact): Term | undefined => {
		const given = data[fact];
		const option = options[fact];
		if (given !== undefined && option !== undefined)
			problems.push({ fact, problem: "given" });
		else if (given === undefined && option === undefined)
			problems.push({ fact, problem: "missing" });
		return given ?? option;
	};
	const asked_by = pick("asked_by");
	const answered_by = pick("answered_by");
	if (asked_by === undefined || answered_by === undefined || problems.length)
		return err(problems);
	return ok({ ...data, asked_by, answered_by });
}

/** A file the dataset was made from: its name (no folder), SHA-256 (hex) and size in bytes. */
export interface FileDigest {
	readonly name: string;
	readonly sha256: string;
	readonly size: number;
}

/** What the shell gives of a dataset's provenance: the files, read and hashed, and the facts. */
export interface Provenance {
	/** The DDI given, read: it holds the instrument and its variables. */
	readonly index: DdiIndex;
	readonly facts: Facts & Required<Pick<Facts, Fact>>;
	/** The variables (URNs) the map reads a column into. */
	readonly reads: readonly string[];
	/** SHA-256 (hex) of the whole DataSet in its canonical form (`canonicalForm`). */
	readonly fingerprint: string;
	readonly source: FileDigest;
	/** The map, and the DDI digest it names. */
	readonly map: FileDigest & { readonly ddi?: string };
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
	/** The interview times (ISO 8601 date-times with a zone). */
	readonly starts: readonly string[];
	readonly ends: readonly string[];
}

/** What the fingerprint of the DataSet is over, as `canonicalForm` writes it. */
export const DATA_FINGERPRINT =
	"SHA-256 of every value of the DataSet (the answers, and each respondent's identifier and interview times on the dataset's own variables) as long CSV: UTF-8, LF line ends, the header respondent,variable,row,value, then one line for each value, sorted by respondent and then variable URN in code-unit order";

/** The DDI vocabularies a term is from (the version-free URI). */
const VOCABULARY = {
	mode: "http://rdf-vocabulary.ddialliance.org/cv/ModeOfCollection/",
	source: "http://rdf-vocabulary.ddialliance.org/cv/DataSourceType/",
} as const;

const codeValueOf = (t: Term, vocabulary: string): JsonObject =>
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
	const reads = new Set(p.reads);
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
		group(
			"not-in-source",
			"The instrument's variables the map reads no column into: the source doesn't hold them. Not missing answers.",
			sorted(
				all
					.filter((it) => it.type === "Variable" && !reads.has(it.urn))
					.map((it) => it.urn),
			),
		),
	];
	const ddi = item(
		"OtherMaterial",
		id("ddi"),
		obj({
			TypeOfMaterial: { StringValue: "instrument DDI" },
			Citation: { Title: intl(p.ddi.name) },
			UserID: [
				{ StringValue: p.ddi.sha256, TypeOfUserID: { StringValue: "SHA-256" } },
			],
			SizeInBytes: p.ddi.size,
			Relationship: [
				{
					RelatedToReference_Versionable: refTo("Instrument", instrument.urn),
					TypeOfRelationship: { StringValue: "describes" },
				},
			],
		}),
	);
	const map = item(
		"OtherMaterial",
		id("map"),
		obj({
			TypeOfMaterial: { StringValue: "column map" },
			Citation: { Title: intl(p.map.name) },
			UserID: [
				{ StringValue: p.map.sha256, TypeOfUserID: { StringValue: "SHA-256" } },
			],
			SizeInBytes: p.map.size,
			// The DDI digest the map names, which may not be the DDI given's.
			UserAttributePair:
				p.map.ddi === undefined ? undefined : [pair("ddi", p.map.ddi)],
		}),
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
					DataCollectionSoftware: [{ SoftwareName: [intl(p.facts.software)] }],
				});
	const start = extreme(d.starts, false);
	const end = extreme(d.ends, true);
	const collection = item(
		"DataCollection",
		id("collection"),
		obj({
			MethodologyReference: methodology && ref(methodology),
			CollectionEvent: [
				obj({
					...id("event"),
					DataSource: [
						{
							SourceType: [codeValueOf(p.facts.answered_by, VOCABULARY.source)],
						},
					],
					DataCollectionDate:
						start === undefined && end === undefined
							? undefined
							: obj({
									StartDate: start && { DateTime: start },
									EndDate: end && { DateTime: end },
								}),
					ModeOfCollection: [
						{
							...id("mode"),
							TypeOfModeOfCollection: codeValueOf(
								p.facts.asked_by,
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
		RelatedOtherMaterialReference: [ref(map), ref(ddi)],
	});
	return ok([
		study,
		collection,
		...(methodology ? [methodology] : []),
		data,
		source,
		map,
		ddi,
		...groups,
	]);
}
