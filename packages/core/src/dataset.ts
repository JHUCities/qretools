/**
 * A dataset as a DDI-Lifecycle 4.0 document: a `DataSet` whose `ItemSet` holds one
 * `ItemValue` per answer, keyed by the instrument's Variable (by reference, never
 * embedded) and the respondent as the source spells them. The dataset owns three
 * Variables of its own: the respondent's identifier (its `IdentifyingVariableReference`,
 * one value per respondent, so a respondent with no answers is kept) and each
 * interview's `start` and `end` where the source gives them (a date-time with a zone, or a
 * date where the source gives only that), and one for each column of a data file that no
 * respondent is asked (`metadata` in its map: a mode, a weight). Values are sorted by
 * respondent, then variable URN, so the same answers give the same bytes. `readDataset`
 * reads such a document back, once, into the value `datasetOf` writes from. Beside the
 * DataSet, the document holds its provenance (`provenanceOf`); `provenanceView` is the
 * document without the values. A view can be filtered to an access level (`accessOf`);
 * the dataset itself never is.
 */

import {
	type DdiDocument,
	documentOf,
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
import { embargo } from "./ddi/elaborate.ts";
import { asList, asObj, type DdiIndex, deref, str, words } from "./ddi/read.ts";
import {
	accessPoliciesOf,
	type FilterRefusal,
	filterAnswers,
	type Removed,
} from "./filter.ts";
import {
	codeValueOf,
	type Provenance,
	provenanceOf,
	refTo,
	VOCABULARY,
} from "./provenance.ts";
import { type Answer, answersCsv, type Respondent } from "./responses.ts";
import { err, ok, type Result } from "./result.ts";

/** What a dataset holds, as `datasetOf` writes it and `readDataset` reads it. */
export interface Dataset {
	/** Its name: the base of every ID it owns. */
	readonly name: string;
	readonly agency: string;
	readonly respondents: readonly Respondent[];
	readonly answers: readonly Answer[];
}

/** What a dataset's name may be: one part of a DDI ID, without a dot. */
export const DATASET_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * The dataset's own items' identities, all hung off `dataset-<name>`. A data file's
 * metadata column is `var-<header>`, as an instrument's variables are `var-<name>`: no
 * other part starts so, so a header such as `mode` never meets the provenance's `.mode`.
 */
const owned = (agency: string, name: string) => {
	const base = `dataset-${name}`;
	return {
		variable: (column: string) => identity(agency, `${base}.var-${column}`),
		dataset: identity(agency, base),
		respondent: identity(agency, `${base}.respondent`),
		start: identity(agency, `${base}.start`),
		end: identity(agency, `${base}.end`),
		// The OtherMaterial of the instrument DDI (`provenanceOf`'s `ddi`).
		ddi: identity(agency, `${base}.ddi`),
	};
};

/** The URN of the dataset's own variable for a data file's metadata column. */
export const metadataUrn = (
	agency: string,
	name: string,
	column: string,
): string => owned(agency, name).variable(column).URN;

/** `[agency, id, version]` of a URN as `urn:ddi:agency:id:version` writes it. */
const partsOf = (
	urn: string,
): readonly [string, string, string] | undefined => {
	const [scheme, nid, agency, id, version, ...rest] = urn.split(":");
	// Lowercase only: the reference is written back as `urn:ddi:`, so another spelling would change.
	return scheme === "urn" &&
		nid === "ddi" &&
		agency &&
		id &&
		version &&
		rest.length === 0
		? [agency, id, version]
		: undefined;
};

const urnOf = (parts: readonly string[]): string =>
	`urn:ddi:${parts.join(":")}`;

const variable = (
	id: Identity,
	name: string,
	body: JsonObject,
	domain: string,
): Item =>
	item("Variable", id, {
		VariableName: [intl(name)],
		...body,
		VariableRepresentation: { ValueRepresentation: { $type: domain } },
	});

/** Code-unit order: the same in every locale. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every value the DataSet holds, as `Answer`s: the answers, then each respondent's
 * identifier and times on the dataset's own variables, sorted by respondent and then
 * variable URN. The ItemSet is written from it, and the fingerprint is over it.
 */
const valuesOf = (d: Dataset): Answer[] => {
	const ids = owned(d.agency, d.name);
	return [
		...d.answers,
		...d.respondents.flatMap((r) => [
			{ respondent: r.id, variable: ids.respondent.URN, value: r.id },
			...(r.start === undefined
				? []
				: [{ respondent: r.id, variable: ids.start.URN, value: r.start }]),
			...(r.end === undefined
				? []
				: [{ respondent: r.id, variable: ids.end.URN, value: r.end }]),
		]),
	].sort(
		(a, b) =>
			compare(a.respondent, b.respondent) || compare(a.variable, b.variable),
	);
};

/**
 * The whole DataSet in one canonical form, which its fingerprint is over: every value,
 * the dataset's own included, as `answersCsv` writes it, in the ItemSet's order.
 */
export const canonicalForm = (d: Dataset): string => answersCsv(valuesOf(d));

/**
 * The dataset as DDI. Refused, with nothing written, where it can't say what it was
 * given: a name that isn't one ID part, an answer in a roster row (not yet described), a
 * variable that isn't a DDI URN, an answer for a respondent it doesn't list, or a
 * provenance that can't be written (`provenanceOf`).
 */
export function datasetOf(
	d: Dataset,
	provenance: Provenance,
): Result<DdiDocument, string> {
	if (!DATASET_NAME.test(d.name))
		return err(
			`The dataset's name \`${d.name}\` isn't one a DDI ID can hold: use letters, digits, \`-\` and \`_\` only.`,
		);
	const ids = owned(d.agency, d.name);
	const listed = new Set(d.respondents.map((r) => r.id));
	for (const a of d.answers) {
		if (a.row !== undefined)
			return err(
				`\`${a.variable}\` is answered in a roster row, and a dataset can't hold roster rows yet.`,
			);
		const parts = partsOf(a.variable);
		if (parts === undefined)
			return err(
				`\`${a.variable}\` isn't a DDI URN (urn:ddi:agency:id:version).`,
			);
		if (!listed.has(a.respondent))
			return err("An answer names a respondent the dataset doesn't list.");
	}
	// Every variable is a DDI URN now, so its parts are read again without a check.
	const values = valuesOf(d).map((v) => {
		const [Agency = "", ID = "", Version = ""] = partsOf(v.variable) ?? [];
		return {
			urn: v.variable,
			value: {
				VariableReference: ref({
					type: "Variable",
					identity: { URN: v.variable, Agency, ID, Version },
				}),
				RecordReference: v.respondent,
				Value: [{ StringValue: v.value }],
			},
		};
	});
	const timed = (k: "start" | "end") =>
		d.respondents.some((r) => r[k] !== undefined);
	const respondent = variable(ids.respondent, "respondent", {}, "TextDomain");
	// 4.0 beta 4's DateTimeDomain has no type code: the values are ISO 8601 date-times with a zone.
	const time = (id: Identity, name: string) =>
		variable(id, name, { IsTemporal: true }, "DateTimeDomain");
	const set = item("DataSet", ids.dataset, {
		DataSetName: [intl(d.name)],
		IdentifyingVariableReference: ref(respondent),
		ItemSet: { ItemValue: values.map((v) => v.value) },
	});
	const described = provenanceOf(provenance, {
		name: d.name,
		base: ids.dataset.ID,
		agency: d.agency,
		dataset: set,
		present: values.map((v) => v.urn),
		metadata: (provenance.metadata ?? []).map(
			(m) => ids.variable(m.column).URN,
		),
		starts: d.respondents.flatMap((r) => r.start ?? []),
		ends: d.respondents.flatMap((r) => r.end ?? []),
	});
	if (!described.ok) return described;
	const weighting = described.value.find((it) => it.type === "Weighting");
	const metadata: Item[] = [];
	for (const m of provenance.metadata ?? []) {
		const id = ids.variable(m.column);
		const level =
			m.access === undefined
				? undefined
				: policyFor(provenance.index, m.access);
		if (level !== undefined && !level.ok)
			return err(`The map's column \`${m.column}\` ${level.error}`);
		const codes = Object.entries(m.codes ?? {});
		const part = (p: string) => identity(d.agency, `${id.ID}-${p}`);
		const categories = codes.map(([, label], i) =>
			item("Category", part(`cat-${i + 1}`), { Label: [structured(label)] }),
		);
		const list =
			m.codes &&
			item("CodeList", part("codes"), {
				Code: codes.map(([code], i) => ({
					...part(`code-${i + 1}`),
					Value: { StringValue: code },
					CategoryReference: ref(categories[i] as Item),
				})),
			});
		metadata.push(
			item(
				"Variable",
				id,
				obj({
					VariableName: [intl(m.column)],
					Label: m.label && [structured(m.label)],
					SourceUnit: m.unit && codeValueOf(m.unit, VOCABULARY.unit),
					IsWeight: m.weight,
					WeightingProcessReference: m.weight && weighting && ref(weighting),
					VariableRepresentation: obj({
						VariableRole: m.role && { StringValue: m.role },
						ValueRepresentation: list
							? { $type: "CodeDomain", CodeListReference: ref(list) }
							: { $type: "NumericDomain" },
					}),
					// Without a level stated, no embargo: the most closed level, as the respondent's.
					EmbargoReference:
						level &&
						embargo(
							identity(d.agency, `${id.ID}-embargo`),
							m.access ?? "",
							level.value.open,
							level.value.policy,
						),
				}),
			),
			...(list ? [list] : []),
			...categories,
		);
	}
	return ok(
		documentOf([
			set,
			respondent,
			...(timed("start") ? [time(ids.start, "start")] : []),
			...(timed("end") ? [time(ids.end, "end")] : []),
			...metadata,
			...described.value,
		]),
	);
}

/**
 * The policy a level a map states belongs to, and whether it is that policy's most open:
 * only where the DDI holds exactly one policy and it lists the level, so the order it is
 * read in is never a guess.
 */
function policyFor(
	index: DdiIndex,
	level: string,
): Result<{ readonly policy: string; readonly open: boolean }, string> {
	const listed = accessPoliciesOf(index);
	const policies = listed.ok ? listed.value.policies : [];
	const [policy] = policies;
	if (policies.length !== 1 || policy === undefined)
		return err(
			`states the access level \`${level}\`, and the DDI holds ${policies.length} access policies: a level is read against exactly one.`,
		);
	if (!policy.levels.includes(level))
		return err(
			`states the access level \`${level}\`, which the DDI's access policy doesn't list: its levels are ${policy.levels.map((l) => `\`${l}\``).join(", ")}.`,
		);
	return ok({ policy: policy.urn, open: policy.levels[0] === level });
}

/**
 * A dataset document read back, all or none: one `DataSet` identified by its own
 * respondent variable, with an `ItemSet`, each value naming a Variable, a respondent and
 * one value, never two for one variable and respondent. Values of the dataset's own
 * variables become its respondents and their times; every other value is an answer, of a
 * respondent the dataset identifies.
 */
// shortcut: start and end values aren't checked as dates or date-times, nor the variables' items read; check them when another program writes datasets.
export function readDataset(json: unknown): Result<Dataset, string> {
	const sets = Object.values(asObj(asObj(json)?.DataSet) ?? {});
	const [set] = sets;
	const head = asObj(set);
	if (sets.length !== 1 || head === undefined)
		return err("This isn't a dataset: it doesn't hold exactly one DataSet.");
	const agency = str(head.Agency);
	const base = str(head.ID);
	const name = base?.startsWith("dataset-") ? base.slice(8) : undefined;
	if (agency === undefined || name === undefined || !DATASET_NAME.test(name))
		return err(
			"This isn't a dataset QREtools wrote: its DataSet's ID isn't `dataset-<name>`.",
		);
	const ids = owned(agency, name);
	if (asObj(head.ItemSet) === undefined)
		return err(
			"This is a dataset's provenance: it holds no values, so it has no view but itself.",
		);
	const identifying = asObj(head.IdentifyingVariableReference)?.value;
	if (
		!Array.isArray(identifying) ||
		urnOf(identifying.map(String)) !== ids.respondent.URN
	)
		return err("This dataset isn't identified by its own respondent variable.");
	const respondents = new Map<
		string,
		{ id: string; start?: string; end?: string }
	>();
	const answers: Answer[] = [];
	const seen = new Set<string>();
	for (const v of asList(asObj(head.ItemSet)?.ItemValue)) {
		const target = asObj(v.VariableReference)?.value;
		const parts = Array.isArray(target) ? target.map(str) : [];
		const respondent = str(v.RecordReference);
		const values = asList(v.Value);
		const value = str(values[0]?.StringValue);
		if (
			parts.length !== 3 ||
			parts.some((p) => p === undefined) ||
			respondent === undefined ||
			values.length !== 1 ||
			value === undefined
		)
			return err(
				"A value of the dataset isn't one variable, one respondent and one value.",
			);
		const urn = urnOf(parts as string[]);
		const key = `${respondent}\u0000${urn}`;
		if (seen.has(key))
			return err(`The dataset gives \`${urn}\` twice for one respondent.`);
		seen.add(key);
		const r = respondents.get(respondent) ?? { id: respondent };
		respondents.set(respondent, r);
		if (urn === ids.respondent.URN) {
			if (value !== respondent)
				return err(
					"A respondent's identifier isn't the respondent it's recorded for.",
				);
		} else if (urn === ids.start.URN) r.start = value;
		else if (urn === ids.end.URN) r.end = value;
		else answers.push({ respondent, variable: urn, value });
	}
	if (
		[...respondents.keys()].some(
			(r) => !seen.has(`${r}\u0000${ids.respondent.URN}`),
		)
	)
		return err("A value names a respondent the dataset doesn't identify.");
	return ok({ name, agency, respondents: [...respondents.values()], answers });
}

/**
 * What a view at an access level holds: the answers it keeps, the variables it removes
 * (never a value), and whether the dataset's own variables (respondent, start, end) are
 * kept. They have no question to take a level from and can identify a respondent, so
 * they stand at the most closed level: kept only at the most closed level of every policy.
 * So does a metadata column's variable, unless its map stated a level, which its embargo
 * records as a question's does.
 */
export interface Access {
	readonly level: string;
	readonly kept: readonly Answer[];
	readonly removed: readonly Removed[];
	readonly owned: boolean;
}

/**
 * A view's access, by the instrument DDI the dataset was made from: none when the DDI
 * declares no levels and none is asked for; refused when it declares levels and none is
 * given (`level-required`), or as `filterAnswers` refuses.
 */
export function accessOf(
	index: DdiIndex,
	d: Dataset,
	level: string | undefined,
): Result<Access | undefined, FilterRefusal> {
	const listed = accessPoliciesOf(index);
	if (!listed.ok) return listed;
	const { policies } = listed.value;
	if (level === undefined)
		return policies.length === 0
			? ok(undefined)
			: err({ kind: "level-required", policies });
	// A metadata variable with no embargo (or none in the index) stands with the respondent's.
	const ids = owned(d.agency, d.name);
	const closed = new Set(
		d.answers
			.map((a) => a.variable)
			.filter(
				(u) =>
					partsOf(u)?.[1].startsWith(`${ids.dataset.ID}.var-`) &&
					deref(index, u)?.item.EmbargoReference === undefined,
			),
	);
	const filtered = filterAnswers(
		index,
		d.answers.filter((a) => !closed.has(a.variable)),
		level,
	);
	if (!filtered.ok) return filtered;
	// Above the level in some policy: the most closed level there is what it stands at.
	const above = policies
		.map((p) => p.levels.at(-1) ?? "")
		.find((closed) => closed !== level);
	const ownedRemoved = (
		[
			[ids.respondent, "respondent"],
			...(d.respondents.some((r) => r.start !== undefined)
				? ([[ids.start, "start"]] as const)
				: []),
			...(d.respondents.some((r) => r.end !== undefined)
				? ([[ids.end, "end"]] as const)
				: []),
		] as const
	)
		.map(([id, name]): Removed => ({ urn: id.URN, name, level: above ?? "" }))
		.concat(
			[...closed].sort().map((urn) => ({
				urn,
				name: words(deref(index, urn)?.item.VariableName) ?? urn,
				level: above ?? "",
			})),
		);
	return ok({
		level,
		kept: [
			...filtered.value.kept,
			...(above === undefined
				? d.answers.filter((a) => closed.has(a.variable))
				: []),
		],
		removed: [
			...filtered.value.removed,
			...(above === undefined ? [] : ownedRemoved),
		],
		owned: above === undefined,
	});
}

/**
 * The answers as long CSV, as `answersCsv` writes them, sorted by respondent and then
 * variable URN: the canonical form the dataset's fingerprint is over. The dataset's own
 * variables aren't answers. At an access level, only the answers it keeps; where the
 * respondent variable is above it, each respondent is numbered from 1 in that order
 * instead, so a respondent's answers stay together without the identifier.
 */
export const csvView = (d: Dataset, access?: Access): string => {
	const answers = [...(access?.kept ?? d.answers)].sort(
		(a, b) =>
			compare(a.respondent, b.respondent) || compare(a.variable, b.variable),
	);
	if (access === undefined || access.owned) return answersCsv(answers);
	// Every respondent named anywhere is numbered, so none can come out blank.
	const numbers = new Map(
		[
			...new Set([
				...d.respondents.map((r) => r.id),
				...answers.map((a) => a.respondent),
			]),
		]
			.sort(compare)
			.map((id, i) => [id, String(i + 1)]),
	);
	return answersCsv(
		answers.map((a) => ({
			...a,
			respondent: numbers.get(a.respondent) ?? a.respondent,
		})),
	);
};

/**
 * A dataset document without its values: its DataSet is kept, without the ItemSet, so
 * every reference to it still resolves. Read with `readDataset` first. At an access
 * level, the variables it removes leave the group of variables with values, and the
 * collection's dates leave with the interview times; the view records the level (an
 * InformationClassification) and the variables removed (a VariableGroup), both
 * referenced from the data's PhysicalInstance.
 */
export const provenanceView = (doc: unknown, access?: Access): DdiDocument => {
	const root = asObj(doc) ?? {};
	const view: Record<string, Json> = {
		...root,
		DataSet: Object.fromEntries(
			Object.entries(asObj(root.DataSet) ?? {}).map(([key, set]) => {
				const { ItemSet: _, ...kept } = asObj(set) ?? {};
				return [key, kept];
			}),
		),
	};
	if (access === undefined) return view as DdiDocument;
	// The DataSet `readDataset` read: `dataset-<name>`, the base of every ID the dataset owns.
	const set = asObj(Object.values(asObj(root.DataSet) ?? {})[0]);
	const agency = str(set?.Agency) ?? "";
	const base = str(set?.ID) ?? "";
	const id = (part: string) => identity(agency, `${base}.${part}`);
	const gone = new Set(access.removed.map((r) => r.urn));
	const classification = item("InformationClassification", id("access"), {
		LevelOfInformationClassification: { StringValue: access.level },
	});
	const removed = item("VariableGroup", id("removed-by-access"), {
		VariableGroupName: [intl("removed-by-access")],
		Description: structured(
			`The variables with values above the access level \`${access.level}\`, so not in this view. Not missing answers.`,
		),
		VariableReference: access.removed.map((r) => refTo("Variable", r.urn)),
	});
	// Every item of a type, not one found by its key: a key that missed would leave a removed variable in.
	const each = (type: string, f: (o: JsonObject) => JsonObject) => {
		view[type] = Object.fromEntries(
			Object.entries(asObj(view[type]) ?? {}).map(([k, o]) => [
				k,
				f(asObj(o) ?? {}),
			]),
		);
	};
	each("VariableGroup", (g) => ({
		...g,
		VariableReference: asList(g.VariableReference).filter(
			(r) => !Array.isArray(r.value) || !gone.has(urnOf(r.value.map(String))),
		),
	}));
	// The collection's dates are the earliest start and the latest end: values of the dataset's own variables.
	if (!access.owned)
		each("DataCollection", (c) => ({
			...c,
			CollectionEvent: asList(c.CollectionEvent).map(
				({ DataCollectionDate: _, ...e }) => e,
			),
		}));
	each("PhysicalInstance", (p) =>
		p.RecordLayoutReference === undefined
			? p
			: {
					...p,
					VariableGroupReference: [
						...asList(p.VariableGroupReference),
						ref(removed),
					],
					InformationClassificationReference: [ref(classification)],
				},
	);
	const added = documentOf([classification, removed]);
	return {
		...view,
		InformationClassification: added.InformationClassification ?? {},
		VariableGroup: { ...asObj(view.VariableGroup), ...added.VariableGroup },
	} as DdiDocument;
};

/**
 * The instrument's DDI with the dataset's metadata variables beside its own, so a level
 * their map stated is read as a question's is. Only `dataset-<name>.var-…` items: a
 * dataset can never restate an instrument's variable.
 */
export const withMetadataVariables = (
	ddi: unknown,
	doc: unknown,
	d: Dataset,
): unknown => {
	const prefix = `${owned(d.agency, d.name).dataset.ID}.var-`;
	const root = asObj(ddi) ?? {};
	return {
		...root,
		Variable: {
			...asObj(root.Variable),
			...Object.fromEntries(
				Object.entries(asObj(asObj(doc)?.Variable) ?? {}).filter(([, v]) =>
					str(asObj(v)?.ID)?.startsWith(prefix),
				),
			),
		},
	};
};

/** The SHA-256 (hex) of the instrument DDI the dataset was made from, as its provenance records it. */
export const recordedDdiOf = (doc: unknown, d: Dataset): string | undefined => {
	const { ddi } = owned(d.agency, d.name);
	const material = Object.values(asObj(asObj(doc)?.OtherMaterial) ?? {})
		.map(asObj)
		.find((m) => m?.Agency === ddi.Agency && m.ID === ddi.ID);
	return str(asList(material?.UserID)[0]?.StringValue);
};
