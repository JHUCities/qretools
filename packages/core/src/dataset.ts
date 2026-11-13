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
import { readInstruments } from "./instrument/read.ts";
import { type Recording, recordsOf } from "./instrument/records.ts";
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
		// A roster's rows: roster names have no hyphen, so these parts never meet another.
		row: identity(agency, `${base}.row`),
		key: (roster: string) => identity(agency, `${base}.key-${roster}`),
		rows: (roster: string) => identity(agency, `${base}.rows-${roster}`),
		records: identity(agency, `${base}.records`),
		record: identity(agency, `${base}.record`),
		recordOf: (roster: string) => identity(agency, `${base}.record-${roster}`),
		link: (roster: string) => identity(agency, `${base}.link-${roster}`),
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

/** An ItemValue: a value of a variable (its URN, which `datasetOf` has checked) for a record. */
const itemValue = (urn: string, record: string, value: string): JsonObject => {
	const [Agency = "", ID = "", Version = ""] = partsOf(urn) ?? [];
	return {
		VariableReference: ref({
			type: "Variable",
			identity: { URN: urn, Agency, ID, Version },
		}),
		RecordReference: record,
		Value: [{ StringValue: value }],
	};
};

/** Code-unit order: the same in every locale. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Respondent, then variable URN, then row: the order of the canonical form and the CSV view. */
const byVariable = (a: Answer, b: Answer): number =>
	compare(a.respondent, b.respondent) ||
	compare(a.variable, b.variable) ||
	(a.row ?? 0) - (b.row ?? 0);

/** Respondent, then row, then variable URN: the order of a roster's ItemSet. */
const byRow = (a: Answer, b: Answer): number =>
	compare(a.respondent, b.respondent) ||
	(a.row ?? 0) - (b.row ?? 0) ||
	compare(a.variable, b.variable);

/** A roster row's record: the respondent's identifier, `#`, the row. The row is digits, so the text after the last `#` is always the row. */
const rowKey = (respondent: string, row: number): string =>
	`${respondent}#${row}`;

/**
 * Which roster records each variable the instrument DDI asks, and the most rows it
 * states (`recordsOf`): the DDI must hold one instrument, with no roster inside a roster.
 */
// shortcut: rosters are known by name, so two loops of another program's DDI that share a ConstructName are one record type; tell them apart by ID if such DDI comes.
export function rostersOf(
	index: DdiIndex,
): Result<ReadonlyMap<string, Recording>, string> {
	const { instruments } = readInstruments(index).value;
	const [instrument] = instruments;
	if (instrument === undefined || instruments.length > 1)
		return err(
			`The DDI holds ${instruments.length} instruments, and a dataset is the answers to one.`,
		);
	return recordsOf(instrument.flow);
}

/**
 * Every value of the dataset but a roster row's own (its key, respondent and row), as
 * `Answer`s: the answers, then each respondent's identifier and times on the dataset's
 * own variables, sorted by respondent, variable URN and row. The fingerprint is over it,
 * and the respondents' ItemSet is written from the values without a row.
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
	].sort(byVariable);
};

/**
 * The whole dataset in one canonical form, which its fingerprint is over: every value,
 * the dataset's own included, as `answersCsv` writes it, in `valuesOf`'s order. A roster
 * row's key, respondent and row values aren't in it: the answers decide them.
 */
export const canonicalForm = (d: Dataset): string => answersCsv(valuesOf(d));

/**
 * The dataset as DDI. Refused, with nothing written, where it can't say what it was
 * given: a name that isn't one ID part, a variable that isn't a DDI URN, an answer for a
 * respondent it doesn't list, a row where the instrument DDI has no roster (or none
 * where it has one), a row above the most its roster states, or a provenance that can't
 * be written (`provenanceOf`). A roster's answers are a record type of their own: a
 * DataSet per roster, each row identified by a key of its own, and a DataRelationship
 * that says each row is a respondent's. Only a dataset with a roster value has them.
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
	const rosters = rostersOf(provenance.index);
	if (!rosters.ok) return rosters;
	for (const a of d.answers) {
		const parts = partsOf(a.variable);
		if (parts === undefined)
			return err(
				`\`${a.variable}\` isn't a DDI URN (urn:ddi:agency:id:version).`,
			);
		if (!listed.has(a.respondent))
			return err("An answer names a respondent the dataset doesn't list.");
		const r = rosters.value.get(a.variable);
		const name = r?.record.variable ?? a.variable;
		if ((r?.roster !== undefined) !== (a.row !== undefined))
			return err(
				r?.roster !== undefined
					? `Variable \`${name}\` is recorded in a roster: its answers need a \`row\`.`
					: `Variable \`${name}\` isn't recorded in a roster: its answers have no \`row\`.`,
			);
		// Its name is a part of DDI IDs (`rows-<roster>`): one part, with no hyphen to meet another.
		if (r?.roster !== undefined && !/^[A-Za-z0-9_]+$/.test(r.roster))
			return err(
				`The roster \`${r.roster}\` has a name a DDI ID can't hold: a dataset names its rows by the roster's name, so it may hold only letters, digits and \`_\`.`,
			);
		if (a.row !== undefined && r?.max !== undefined && a.row > r.max)
			return err(
				`Variable \`${name}\` is answered in row ${a.row}, and its roster \`${r.roster}\` has at most ${r.max} rows.`,
			);
	}
	const all = valuesOf(d);
	const flat = all.filter((v) => v.row === undefined);
	const timed = (k: "start" | "end") =>
		d.respondents.some((r) => r[k] !== undefined);
	const respondent = variable(ids.respondent, "respondent", {}, "TextDomain");
	// 4.0 beta 4's DateTimeDomain has no type code: the values are ISO 8601 date-times with a zone.
	const time = (id: Identity, name: string) =>
		variable(id, name, { IsTemporal: true }, "DateTimeDomain");
	const set = item("DataSet", ids.dataset, {
		DataSetName: [intl(d.name)],
		IdentifyingVariableReference: ref(respondent),
		ItemSet: {
			ItemValue: flat.map((v) => itemValue(v.variable, v.respondent, v.value)),
		},
	});
	const rows = rosterItems(d, rosters.value, ids, respondent, flat);
	const described = provenanceOf(provenance, {
		name: d.name,
		base: ids.dataset.ID,
		agency: d.agency,
		datasets: [set, ...rows.sets],
		...(rows.relationship && { relationship: rows.relationship }),
		present: [...flat.map((v) => v.variable), ...rows.present],
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
			...rows.sets,
			respondent,
			...(timed("start") ? [time(ids.start, "start")] : []),
			...(timed("end") ? [time(ids.end, "end")] : []),
			...metadata,
			...rows.variables,
			...(rows.relationship ? [rows.relationship] : []),
			...described.value,
		]),
	);
}

/**
 * The record types of a dataset's roster rows, none without a roster value. Each roster
 * is a DataSet of its rows, in roster name order: each row (with at least one value) is
 * keyed by `rowKey`, and holds that key, its respondent and its row on the dataset's own
 * variables beside its answers. The DataRelationship says how a row is found: by its
 * respondent and row, or by its key; and that it is a respondent's (a Child record,
 * linked by the respondent's identifier). `flat` is the respondents' own ItemSet.
 */
function rosterItems(
	d: Dataset,
	rosters: ReadonlyMap<string, Recording>,
	ids: ReturnType<typeof owned>,
	respondent: Item,
	flat: readonly Answer[],
): {
	readonly sets: readonly Item[];
	readonly variables: readonly Item[];
	readonly relationship?: Item;
	readonly present: readonly string[];
} {
	const rowed = d.answers.filter((a) => a.row !== undefined);
	if (rowed.length === 0) return { sets: [], variables: [], present: [] };
	// `datasetOf` has refused a row on a variable outside a roster.
	const rosterOf = (a: Answer) => rosters.get(a.variable)?.roster ?? "";
	const urns = (xs: readonly string[]) =>
		[...new Set(xs)].sort(compare).map((u) => refTo("Variable", u));
	const row = variable(ids.row, "row", {}, "NumericDomain");
	const sets: Item[] = [];
	const keys: Item[] = [];
	const records: JsonObject[] = [
		{
			...ids.record,
			LogicalRecordName: [intl("respondent")],
			CaseIdentification: [
				{
					FixedIdentifier: { VariableReference: [ref(respondent)] },
					IsPrimary: true,
				},
			],
			VariablesInRecord: {
				VariableUsedReference: urns(flat.map((v) => v.variable)),
			},
		},
	];
	const links: JsonObject[] = [];
	for (const name of [...new Set(rowed.map(rosterOf))].sort(compare)) {
		const key = variable(
			ids.key(name),
			`${name}_key`,
			{
				Description: structured(
					`Identifies a row of the roster ${name}: the respondent's identifier, then #, then the row's number.`,
				),
			},
			"TextDomain",
		);
		keys.push(key);
		const mine = rowed.filter((a) => rosterOf(a) === name);
		const own = (a: Answer, urn: string, value: string): Answer => ({
			...a,
			variable: urn,
			value,
		});
		const firsts = new Map(
			mine.map((a) => [rowKey(a.respondent, a.row ?? 0), a]),
		);
		const values = [
			...mine,
			...[...firsts].flatMap(([k, a]) => [
				own(a, key.identity.URN, k),
				own(a, ids.respondent.URN, a.respondent),
				own(a, ids.row.URN, String(a.row)),
			]),
		].sort(byRow);
		sets.push(
			item("DataSet", ids.rows(name), {
				DataSetName: [intl(name)],
				IdentifyingVariableReference: ref(key),
				ItemSet: {
					ItemValue: values.map((v) =>
						itemValue(v.variable, rowKey(v.respondent, v.row ?? 0), v.value),
					),
				},
			}),
		);
		records.push({
			...ids.recordOf(name),
			LogicalRecordName: [intl(name)],
			CaseIdentification: [
				{
					FixedIdentifier: { VariableReference: [ref(respondent), ref(row)] },
					IsPrimary: true,
				},
				{ FixedIdentifier: { VariableReference: [ref(key)] } },
			],
			VariablesInRecord: {
				VariableUsedReference: [
					ref(key),
					ref(respondent),
					ref(row),
					...urns(mine.map((a) => a.variable)),
				],
			},
		});
		// The schema types these references as the record itself: its identity alone is written.
		links.push({
			...ids.link(name),
			SourceLogicalRecordReference: { ...ids.recordOf(name) },
			TargetLogicalRecordReference: { ...ids.record },
			SourceTargetLink: [
				{
					SourceLinkVariableReference: ref(respondent),
					TargetLinkVariableReference: ref(respondent),
				},
			],
			RelationToTarget: "Child",
		});
	}
	return {
		sets,
		variables: [row, ...keys],
		relationship: item("DataRelationship", ids.records, {
			DataRelationshipName: [intl("records")],
			LogicalRecord: records,
			RecordRelationship: links,
		}),
		present: [row, ...keys].map((v) => v.identity.URN),
	};
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
 * A dataset document read back, all or none: a `DataSet` of respondents, identified by
 * its own respondent variable, with an `ItemSet`, and a DataSet for each roster
 * (`dataset-<name>.rows-<roster>`), identified by its key; each value naming a Variable,
 * a record and one value, never two for one variable and record. Values of the dataset's
 * own variables become its respondents and their times, and each row's respondent and
 * row; every other value is an answer, of a respondent the dataset identifies.
 */
// shortcut: start and end values aren't checked as dates or date-times, nor the variables' items read; check them when another program writes datasets.
export function readDataset(json: unknown): Result<Dataset, string> {
	const sets = Object.values(asObj(asObj(json)?.DataSet) ?? {}).map(asObj);
	// The respondents' DataSet is the one whose ID is one part: `dataset-<name>`.
	const heads = sets.filter((s) => !str(s?.ID)?.includes("."));
	const [head] = heads;
	if (heads.length !== 1 || head === undefined)
		return err(
			"This isn't a dataset: it doesn't hold exactly one DataSet of respondents.",
		);
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
	const identifiedBy = (set: JsonObject, urn: string) => {
		const by = asObj(set.IdentifyingVariableReference)?.value;
		return Array.isArray(by) && urnOf(by.map(String)) === urn;
	};
	if (!identifiedBy(head, ids.respondent.URN))
		return err("This dataset isn't identified by its own respondent variable.");
	/** Each value of a DataSet: its variable's URN, record and value; or undefined where one isn't. */
	const valuesIn = (set: JsonObject) =>
		asList(asObj(set.ItemSet)?.ItemValue).map((v) => {
			const target = asObj(v.VariableReference)?.value;
			const parts = Array.isArray(target) ? target.map(str) : [];
			const record = str(v.RecordReference);
			const values = asList(v.Value);
			const value = str(values[0]?.StringValue);
			return parts.length !== 3 ||
				parts.some((p) => p === undefined) ||
				record === undefined ||
				values.length !== 1 ||
				value === undefined
				? undefined
				: { urn: urnOf(parts as string[]), record, value };
		});
	const unreadable =
		"A value of the dataset isn't one variable, one record and one value.";
	const respondents = new Map<
		string,
		{ id: string; start?: string; end?: string }
	>();
	const answers: Answer[] = [];
	const seen = new Set<string>();
	for (const v of valuesIn(head)) {
		if (v === undefined) return err(unreadable);
		const { urn, record: respondent, value } = v;
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
	for (const set of sets) {
		if (set === undefined || set === head) continue;
		const roster = str(set.ID)?.slice(`${base}.rows-`.length);
		if (
			str(set.ID) !== `${base}.rows-${roster}` ||
			roster === undefined ||
			!identifiedBy(set, ids.key(roster).URN)
		)
			return err(
				"This isn't a dataset QREtools wrote: a DataSet beside the respondents' isn't a roster's, identified by its key.",
			);
		const rows = new Map<string, { urn: string; value: string }[]>();
		for (const v of valuesIn(set)) {
			if (v === undefined) return err(unreadable);
			rows.set(v.record, [...(rows.get(v.record) ?? []), v]);
		}
		for (const [record, values] of rows) {
			const own = (urn: string) =>
				values.filter((v) => v.urn === urn).map((v) => v.value);
			const [respondent, ...more] = own(ids.respondent.URN);
			const [row, ...rowsMore] = own(ids.row.URN);
			const [key, ...keysMore] = own(ids.key(roster).URN);
			if (
				respondent === undefined ||
				row === undefined ||
				!/^[1-9][0-9]*$/.test(row) ||
				key !== record ||
				record !== rowKey(respondent, Number(row)) ||
				more.length + rowsMore.length + keysMore.length > 0
			)
				return err(
					`A row of the roster \`${roster}\` isn't keyed by one respondent and one row: its key must be the respondent's identifier, #, the row.`,
				);
			if (!respondents.has(respondent))
				return err(
					`A row of the roster \`${roster}\` names a respondent the dataset doesn't identify.`,
				);
			const given = new Set<string>();
			for (const v of values) {
				if (
					v.urn === ids.respondent.URN ||
					v.urn === ids.row.URN ||
					v.urn === ids.key(roster).URN
				)
					continue;
				if (given.has(v.urn))
					return err(
						`The dataset gives \`${v.urn}\` twice in row ${row} of one respondent.`,
					);
				given.add(v.urn);
				answers.push({
					respondent,
					variable: v.urn,
					row: Number(row),
					value: v.value,
				});
			}
		}
	}
	return ok({ name, agency, respondents: [...respondents.values()], answers });
}

/**
 * What a view at an access level holds: the answers it keeps, the variables it removes
 * (never a value), and whether the dataset's own variables (respondent, start, end) are
 * kept. They have no question to take a level from and can identify a respondent, so
 * they stand at the most closed level: kept only at the most closed level of every policy.
 * A roster's key holds the respondent's identifier, so it stands with them; its row
 * number identifies no one, so it stays with the answers.
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
	// Only a dataset with rows has keys: one without is read as before, whatever the DDI's rosters.
	const rowed = d.answers.filter((a) => a.row !== undefined);
	const rosters =
		rowed.length === 0 ? ok(new Map<string, Recording>()) : rostersOf(index);
	if (!rosters.ok) return err({ kind: "rosters", reason: rosters.error });
	const keyed = [
		...new Set(
			rowed.flatMap((a) => rosters.value.get(a.variable)?.roster ?? []),
		),
	].sort(compare);
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
			...keyed.map((r) => [ids.key(r), `${r}_key`] as const),
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
 * The answers as long CSV, as `answersCsv` writes them, sorted by respondent, variable URN
 * and row: the canonical form the dataset's fingerprint is over. The dataset's own
 * variables aren't answers. At an access level, only the answers it keeps; where the
 * respondent variable is above it, each respondent is numbered from 1 instead, in the
 * order of the `digest` of their identifier (the shell gives SHA-256 in hex), so the
 * numbers keep a respondent's answers together but don't show the identifiers' order.
 */
export const csvView = (
	d: Dataset,
	...at: [] | [access: Access | undefined, digest: (id: string) => string]
): string => {
	const [access, digest] = at;
	if (access === undefined || access.owned || digest === undefined)
		return answersCsv([...(access?.kept ?? d.answers)].sort(byVariable));
	// Every respondent named anywhere is numbered, so none can come out blank.
	const ids = [
		...new Set([
			...d.respondents.map((r) => r.id),
			...access.kept.map((a) => a.respondent),
		]),
	].map((id) => ({ id, key: digest(id) }));
	const numbers = new Map(
		ids
			.sort((a, b) => compare(a.key, b.key) || compare(a.id, b.id))
			.map(({ id }, i) => [id, i + 1]),
	);
	// Never 0: every kept respondent is numbered above; 0 rather than the identifier.
	const num = (a: Answer) => numbers.get(a.respondent) ?? 0;
	return answersCsv(
		[...access.kept]
			.sort(
				(a, b) =>
					num(a) - num(b) ||
					compare(a.variable, b.variable) ||
					(a.row ?? 0) - (b.row ?? 0),
			)
			.map((a) => ({ ...a, respondent: String(num(a)) })),
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
	// The DataSet of respondents `readDataset` read: `dataset-<name>`, the base of every ID the dataset owns.
	const set = Object.values(asObj(root.DataSet) ?? {})
		.map(asObj)
		.find((s) => !str(s?.ID)?.includes("."));
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
