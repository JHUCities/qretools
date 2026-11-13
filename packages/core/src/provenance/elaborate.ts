/**
 * The provenance of one dataset as DDI-Lifecycle 4.0: where it came from, from the facts a
 * harness gives (`facts.ts`). One StudyUnit, one DataCollection with one CollectionEvent,
 * the files as PhysicalInstances (data, with a SHA-256 fingerprint) or OtherMaterials
 * (anything else, with the digest as a pair), the dataset's variables in groups, and the
 * variables no one is asked (mode, weight) defined here. It never reads answers. Pure.
 *
 * Every item is version 1: a provenance records one event, and a rerun has another name.
 * IDs hang off the provenance's name under a namespace (`study-<name>`, `variable-<name>.mode`),
 * so they can't collide with an instrument's (`variable-<question>`).
 */
import { addressOf } from "../address.ts";
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
} from "../ddi/document.ts";
import type { DdiIndex } from "../ddi/read.ts";
import type { Finding } from "../findings.ts";
import {
	type ProvenanceCode,
	type ProvenanceFacts,
	type Term,
	URN,
} from "./facts.ts";

/** The DDI vocabularies a term is read from, by the version-free URI each version is a version of. */
const VOCABULARY = {
	mode: "http://rdf-vocabulary.ddialliance.org/cv/ModeOfCollection/",
	source: "http://rdf-vocabulary.ddialliance.org/cv/DataSourceType/",
	unit: "http://rdf-vocabulary.ddialliance.org/cv/ResponseUnit/",
} as const;

/**
 * Our own keys and terms, written once. The pairs' keys follow `version.ts`'s `git-*`;
 * none has a published vocabulary yet.
 */
const KEY = {
	sha256: "sha256",
	repository: "git-repository",
	path: "git-path",
	tag: "git-tag",
	weight: "weight",
	/** `mode:<code>`: the mode a code of the mode variable stands for. */
	mode: (code: string) => `mode:${code}`,
} as const;
const MATERIAL = {
	instrument: "instrument",
	prompt: "prompt",
	policy: "policy",
};
const RELATION = { describes: "describes" };

const codedPair = (key: string, value: JsonObject): JsonObject => ({
	AttributeKey: { StringValue: key },
	AttributeValue: value,
});
const pair = (key: string, value: string): JsonObject =>
	codedPair(key, { StringValue: value });

/** A term as DDI's CodeValueType: the notation, or `Other` with ours beside it. */
const codeValueOf = (t: Term, vocabulary?: string): JsonObject =>
	obj({
		...(typeof t === "string"
			? { StringValue: t }
			: { StringValue: "Other", OtherValue: t.other }),
		ControlledVocabularyURI: vocabulary,
	});

/** `[agency, id, version]` of a URN `facts.ts` has already read. */
const partsOf = (urn: string): readonly [string, string, string] => {
	const m = URN.exec(urn);
	return m === null ? ["", "", ""] : [m[1] ?? "", m[2] ?? "", m[3] ?? ""];
};

/** A reference to an item in another document, by its URN. */
const refTo = (type: ItemType, urn: string): JsonObject => ({
	$type: type,
	value: [...partsOf(urn)],
});

/** A date as DDI's date: a date, or a date and time. */
const dateOf = (d: string): JsonObject =>
	d.includes("T") ? { DateTime: d } : { Date: d };

const pairsOf = (
	record: Readonly<Record<string, string>> | undefined,
): JsonObject[] | undefined =>
	record === undefined || Object.keys(record).length === 0
		? undefined
		: Object.entries(record).map(([k, v]) => pair(k, v));

const fingerprint = (sha: string): JsonObject => ({
	Type: "dataFile",
	AlgorithmSpecification: "SHA-256",
	DigitalFingerprintValue: sha,
});

/** The provenance's agency: as the facts say, else the instrument's. */
const agencyOf = (f: ProvenanceFacts): string =>
	f.agency ?? partsOf(f.instrument.urn)[0];

/** The URN a metadata variable has, for the column map that names it. */
export const metadataUrn = (f: ProvenanceFacts, name: string): string =>
	identity(agencyOf(f), `variable-${f.name}.${name}`).URN;

/** The provenance's items, unkeyed. The facts are assumed consistent (`provenanceFindings`). */
export function provenanceItems(f: ProvenanceFacts): readonly Item[] {
	const agency = agencyOf(f);
	const n = f.name;
	const make = (type: ItemType, id: string, body: JsonObject): Item => ({
		type,
		identity: identity(agency, id),
		body,
	});
	/** An identifiable part inside an item: its own identity, under the item's. */
	const part = (id: string): Identity => identity(agency, id);

	// Variables no one is asked, each with its codes or format.
	const weightings: Item[] = [];
	const owned: Item[] = [];
	const metadata = f.metadata.map((v) => {
		let value: JsonObject;
		if ("codes" in v) {
			const entries = v.codes;
			const categories = entries.map(({ label }, i) =>
				make("Category", `category-${n}.${v.name}-${i}`, {
					Label: [structured(label)],
				}),
			);
			const list = make("CodeList", `codes-${n}.${v.name}`, {
				Code: entries.map(({ code }, i) => ({
					...part(`code-${n}.${v.name}-${i}`),
					Value: { StringValue: code },
					CategoryReference: ref(categories[i] as Item),
				})),
			});
			owned.push(list, ...categories);
			value = { $type: "CodeDomain", CodeListReference: ref(list) };
		} else if ("number" in v) {
			const { min, max, decimals } = v.number;
			const bound = (x: number | undefined) =>
				x === undefined ? undefined : { DecimalValue: x, IsInclusive: true };
			value = obj({
				$type: "NumericDomain",
				NumberRange:
					min === undefined && max === undefined
						? undefined
						: [obj({ Low: bound(min), High: bound(max) })],
				// Unknown decimals say nothing: a weight is rarely whole.
				NumericTypeCode:
					decimals === undefined
						? undefined
						: { StringValue: decimals === 0 ? "Integer" : "Decimal" },
				DecimalPositions: decimals,
			});
		} else value = { $type: "TextDomain" };
		const weighting =
			v.weighting === undefined
				? undefined
				: make(
						"Weighting",
						`weighting-${n}.${v.name}`,
						obj({
							Description:
								v.weighting.description && structured(v.weighting.description),
							UsageGuide: v.weighting.usage && {
								UsageRecommendations: structured(v.weighting.usage),
							},
						}),
					);
		if (weighting) weightings.push(weighting);
		return make(
			"Variable",
			`variable-${n}.${v.name}`,
			obj({
				VariableName: [intl(v.name)],
				Label: v.label && [structured(v.label)],
				Description: v.description && structured(v.description),
				SourceUnit:
					v.source_unit && codeValueOf(v.source_unit, VOCABULARY.unit),
				VariableRepresentation: obj({
					VariableRole: v.role && { StringValue: v.role },
					ValueRepresentation: value,
				}),
				IsWeight: weighting && true,
				WeightingProcessReference: weighting && ref(weighting),
				// shortcut: a code's mode is a pair (DDI has no element for it), keyed `mode:<code>`.
				UserAttributePair: v.modes?.map(({ code, term: t }) =>
					codedPair(KEY.mode(code), codeValueOf(t, VOCABULARY.mode)),
				),
			}),
		);
	});
	const modeVariable = f.metadata.find((v) => v.modes !== undefined);
	// The researcher names the weight in use, never the tool: absent, none is marked.
	const weight = f.weight;

	// The variables, grouped: those in the dataset, those it lacks (by reason), and those no one is asked.
	const group = (
		key: string,
		name: string,
		description: string,
		urns: readonly JsonObject[],
		type?: string,
	): Item | undefined =>
		urns.length === 0
			? undefined
			: make(
					"VariableGroup",
					`group-${n}.${key}`,
					obj({
						TypeOfVariableGroup: type && { StringValue: type },
						VariableGroupName: [intl(name)],
						Description: structured(description),
						VariableReference: [...urns],
					}),
				);
	const groups = [
		group(
			"present",
			"present",
			"The variables the dataset holds, in the long form: one line for each respondent, variable, row and value (respondent,variable,row,value), each variable by its DDI URN.",
			[
				...f.dataset.present.map((u) => refTo("Variable", u)),
				...metadata.map(ref),
			],
		),
		group(
			"filtered",
			"filtered",
			"The instrument's variables removed from the dataset by the access filter.",
			f.dataset.removed
				.filter((r) => r.reason === "filtered")
				.map((r) => refTo("Variable", r.urn)),
			"filtered",
		),
		group(
			"not-published",
			"not published",
			"The instrument's variables the source didn't publish: filtered by the publisher, not missing answers.",
			f.dataset.removed
				.filter((r) => r.reason === "not-published")
				.map((r) => refTo("Variable", r.urn)),
			"not-published",
		),
		group(
			"metadata",
			"not asked",
			"Variables no respondent is asked: facts of each case, defined by this provenance.",
			metadata.map(ref),
		),
		group(
			"weights",
			"weights",
			"The weights in the dataset.",
			metadata.filter((m) => m.body.IsWeight === true).map(ref),
		),
	].filter((g): g is Item => g !== undefined);

	// The access level, and the policy that defines it.
	const policy =
		f.access?.policy === undefined
			? undefined
			: make(
					"OtherMaterial",
					`material-${n}.policy`,
					f.access.policy.startsWith("urn:")
						? {
								TypeOfMaterial: { StringValue: MATERIAL.policy },
								ExternalURNReference: f.access.policy,
							}
						: {
								TypeOfMaterial: { StringValue: MATERIAL.policy },
								ExternalURLReference: [f.access.policy],
							},
				);
	const access =
		f.access === undefined
			? undefined
			: make(
					"InformationClassification",
					`access-${n}`,
					obj({
						LevelOfInformationClassification: { StringValue: f.access.level },
						AuthorizedPolicySource: policy && [
							{ OtherMaterialReference: [ref(policy)] },
						],
					}),
				);

	// The files: data as PhysicalInstances, the rest as OtherMaterials.
	const location = (path: string, url: string | undefined): JsonObject =>
		obj({
			Location: intl(path),
			DataFileURI: url && { AnyURIValue: url },
		});
	const dataset = make(
		"PhysicalInstance",
		`file-${n}.dataset`,
		obj({
			Citation: { Title: intl("dataset") },
			DataFingerprint: [fingerprint(f.dataset.sha256)],
			DataFileIdentification: [location(f.dataset.path, f.dataset.url)],
			VariableGroupReference: groups.map(ref),
			InformationClassificationReference: access && [ref(access)],
			// The weight in use, by URN, only if the facts name one: `IsWeight` marks every weight.
			UserAttributePair: weight && [pair(KEY.weight, metadataUrn(f, weight))],
		}),
	);
	const data = f.data.map((d, i) =>
		make(
			"PhysicalInstance",
			`file-${n}.data-${i}`,
			obj({
				Citation: { Title: intl(d.role) },
				DataFingerprint: [fingerprint(d.sha256)],
				DataFileIdentification: [location(d.path, d.url)],
				InformationClassificationReference: access && [ref(access)],
			}),
		),
	);
	const material = (
		id: string,
		type: string,
		file: { path: string; sha256: string; url?: string | undefined },
		more: JsonObject = {},
	): Item =>
		make(
			"OtherMaterial",
			id,
			obj({
				TypeOfMaterial: { StringValue: type },
				Citation: { Title: intl(file.path) },
				ExternalURLReference: file.url && [file.url],
				...more,
				UserAttributePair: [
					pair(KEY.sha256, file.sha256),
					...((more.UserAttributePair as JsonObject[] | undefined) ?? []),
				],
			}),
		);
	const workspace = addressOf(f.instrument.workspace);
	const instrument = material(
		`material-${n}.instrument`,
		MATERIAL.instrument,
		f.instrument.ddi,
		{
			Relationship: [
				{
					RelatedToReference_Versionable: refTo("Instrument", f.instrument.urn),
					TypeOfRelationship: { StringValue: RELATION.describes },
				},
			],
			UserAttributePair:
				workspace.kind === "remote"
					? [
							pair(
								KEY.repository,
								`https://github.com/${workspace.owner}/${workspace.repo}`,
							),
							...(workspace.path === ""
								? []
								: [pair(KEY.path, workspace.path)]),
							pair(KEY.tag, workspace.ref),
						]
					: [],
		},
	);
	const materials = f.materials.map((m, i) =>
		material(`material-${n}.m-${i}`, m.role, m),
	);
	const prompts = f.prompts.map((p, i) =>
		make("OtherMaterial", `material-${n}.prompt-${i}`, {
			TypeOfMaterial: { StringValue: MATERIAL.prompt },
			Description: structured(p.text),
			Relationship: [
				{
					RelatedToReference_Versionable: refTo("QuestionItem", p.question),
					TypeOfRelationship: { StringValue: RELATION.describes },
				},
			],
		}),
	);

	// How the weights were made, reached from the collection through its processing.
	const processing =
		weightings.length === 0
			? undefined
			: make("ProcessingEvent", `processing-${n}`, {
					WeightingReference: weightings.map(ref),
				});
	const processes =
		processing &&
		make("ProcessingEventScheme", `processes-${n}`, {
			ProcessingEventReference: [ref(processing)],
		});

	const methodology = make(
		"Methodology",
		`methodology-${n}`,
		obj({
			DataCollectionSoftware:
				f.software.length === 0
					? undefined
					: f.software.map((s) =>
							obj({
								SoftwareName: [intl(s.name)],
								SoftwareVersion: s.version,
								Date: s.accessed && { SimpleDate: dateOf(s.accessed) },
								Description: s.description && structured(s.description),
							}),
						),
			UserAttributePair: pairsOf(f.planned),
		}),
	);
	const recorded =
		modeVariable &&
		f.asked_by.length > 1 &&
		`Recorded for each case in the variable ${modeVariable.name}.`;
	const event = obj({
		...part(`collection-${n}.event`),
		DataSource: [
			obj({
				SourceType: [codeValueOf(f.answered_by.source, VOCABULARY.source)],
				SourceDescription:
					f.answered_by.description && structured(f.answered_by.description),
				Origin:
					f.answered_by.citation || f.answered_by.url
						? [
								obj({
									Citation: f.answered_by.citation && {
										Title: intl(f.answered_by.citation),
									},
									OriginLocation: f.answered_by.url,
								}),
							]
						: undefined,
			}),
		],
		DataCollectionDate:
			f.dates && (f.dates.start || f.dates.end)
				? obj({
						StartDate: f.dates.start && dateOf(f.dates.start),
						EndDate: f.dates.end && dateOf(f.dates.end),
					})
				: undefined,
		ModeOfCollection: f.asked_by.map((t, i) =>
			obj({
				...part(`collection-${n}.mode-${i}`),
				TypeOfModeOfCollection: codeValueOf(t, VOCABULARY.mode),
				Description: recorded && structured(recorded),
			}),
		),
		InstrumentReference: [refTo("Instrument", f.instrument.urn)],
		CollectionSituation: f.situation && [
			{
				...part(`collection-${n}.situation`),
				TypeOfCollectionSituation: { StringValue: f.situation },
			},
		],
		UserAttributePair: pairsOf(f.attributes),
	});
	const collection = make(
		"DataCollection",
		`collection-${n}`,
		obj({
			MethodologyReference: ref(methodology),
			CollectionEvent: [event],
			ProcessingEventSchemeReference: processes && [ref(processes)],
		}),
	);
	const allMaterials = [instrument, ...materials, ...prompts];
	const study = make(
		"StudyUnit",
		`study-${n}`,
		obj({
			Purpose: f.purpose && structured(f.purpose),
			DataCollectionReference: [ref(collection)],
			PhysicalInstanceReference: [dataset, ...data].map(ref),
			RelatedOtherMaterialReference: allMaterials.map(ref),
		}),
	);
	return [
		study,
		collection,
		methodology,
		dataset,
		...data,
		...allMaterials,
		...(policy ? [policy] : []),
		...(access ? [access] : []),
		...groups,
		...metadata,
		...owned,
		...weightings,
		...(processing && processes ? [processing, processes] : []),
	];
}

export const provenanceDocument = (f: ProvenanceFacts): DdiDocument =>
	documentOf(provenanceItems(f));

const problem = (
	code: ProvenanceCode,
	path: string,
	message: string,
	severity: Finding["severity"] = "error",
): Finding<ProvenanceCode> => ({ code, severity, path, message });

/**
 * What the facts get wrong that their schema can't say: the weight, names used twice, the
 * workspace, and (given the instrument's DDI) every URN they name, each of the type it
 * must be. An error refuses the provenance.
 */
export function provenanceFindings(
	f: ProvenanceFacts,
	instrument: DdiIndex | undefined,
): readonly Finding<ProvenanceCode>[] {
	const out: Finding<ProvenanceCode>[] = [];
	const names = new Set<string>();
	f.metadata.forEach((v, i) => {
		if (names.has(v.name))
			out.push(
				problem(
					"provenance-facts",
					`metadata.${i}.name`,
					`\`${v.name}\` is defined twice.`,
				),
			);
		names.add(v.name);
	});
	const weights = f.metadata.filter((v) => v.weighting !== undefined);
	if (f.weight !== undefined && !weights.some((v) => v.name === f.weight))
		out.push(
			problem(
				"provenance-weight",
				"weight",
				`\`${f.weight}\` isn't a metadata variable with \`weighting\`.`,
			),
		);
	if (f.metadata.filter((v) => v.modes !== undefined).length > 1)
		out.push(
			problem(
				"provenance-facts",
				"metadata",
				"Only one variable can give each case's `modes`.",
			),
		);
	// The modes the mode variable's codes stand for are the modes asked by, and the other way round.
	const key = (t: Term) => JSON.stringify(t);
	const modeVariables = f.metadata.filter((v) => v.modes !== undefined);
	const coded = new Set(
		modeVariables.flatMap((v) => (v.modes ?? []).map((m) => key(m.term))),
	);
	const asked = new Set(f.asked_by.map(key));
	if (
		modeVariables.length === 1 &&
		[...coded, ...asked].some((t) => !coded.has(t) || !asked.has(t))
	)
		out.push(
			problem(
				"provenance-facts",
				"asked_by",
				"The modes in `asked_by` aren't the modes the mode variable's codes stand for.",
			),
		);
	if (modeVariables.length === 0 && f.asked_by.length > 1)
		out.push(
			problem(
				"provenance-facts",
				"asked_by",
				"Several modes, and no metadata variable gives each case's mode (`modes`).",
				"warning",
			),
		);
	if (addressOf(f.instrument.workspace).kind !== "remote")
		out.push(
			problem(
				"provenance-workspace",
				"instrument.workspace",
				`\`${f.instrument.workspace}\` isn't a workspace at a tag, such as \`owner/repo@v1\`.`,
			),
		);
	if (instrument === undefined) return out;
	const expect = (urn: string, type: string, path: string) => {
		const found = instrument.byUrn.get(urn);
		if (found?.type !== type)
			out.push(
				problem(
					"provenance-unknown",
					path,
					found === undefined
						? `The instrument's DDI has no ${type} \`${urn}\`.`
						: `\`${urn}\` is a ${found.type}, not a ${type}.`,
				),
			);
	};
	expect(f.instrument.urn, "Instrument", "instrument.urn");
	for (const [i, u] of f.dataset.present.entries())
		expect(u, "Variable", `dataset.present.${i}`);
	for (const [i, r] of f.dataset.removed.entries())
		expect(r.urn, "Variable", `dataset.removed.${i}.urn`);
	for (const [i, p] of f.prompts.entries())
		expect(p.question, "QuestionItem", `prompts.${i}.question`);
	return out;
}

/** A file the facts name, with its digest as given and as read (`undefined` when it isn't there). */
export interface Digest {
	readonly path: string;
	/** Where in the facts it is named. */
	readonly at: string;
	readonly given: string;
	readonly read: string | undefined;
}

/** Every file the facts name, with its digest: what the shell reads to check them. */
export const filesOf = (
	f: ProvenanceFacts,
): readonly Omit<Digest, "read">[] => [
	{
		path: f.instrument.ddi.path,
		at: "instrument.ddi",
		given: f.instrument.ddi.sha256,
	},
	{ path: f.dataset.path, at: "dataset", given: f.dataset.sha256 },
	...f.data.map((d, i) => ({ path: d.path, at: `data.${i}`, given: d.sha256 })),
	...f.materials.map((m, i) => ({
		path: m.path,
		at: `materials.${i}`,
		given: m.sha256,
	})),
];

/**
 * A file whose digest differs from the facts' refuses the provenance: it would describe
 * another file. One that isn't there is a note: its digest is written as given.
 */
export const digestFindings = (
	digests: readonly Digest[],
): readonly Finding<ProvenanceCode>[] =>
	digests.flatMap((d) =>
		d.read === undefined
			? [
					problem(
						"provenance-digest",
						d.at,
						`\`${d.path}\` isn't there, so its digest isn't checked.`,
						"info",
					),
				]
			: d.read === d.given
				? []
				: [
						problem(
							"provenance-digest",
							d.at,
							`\`${d.path}\` has another SHA-256 digest than the facts give: not the file they describe.`,
						),
					],
	);
