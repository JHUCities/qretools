/**
 * A dataset as a DDI-Lifecycle 4.0 document: a `DataSet` whose `ItemSet` holds one
 * `ItemValue` per answer, keyed by the instrument's Variable (by reference, never
 * embedded) and the respondent as the source spells them. The dataset owns three
 * Variables of its own: the respondent's identifier (its `IdentifyingVariableReference`,
 * one value per respondent, so a respondent with no answers is kept) and each
 * interview's `start` and `end` where the source gives them. Values are sorted by
 * respondent, then variable URN, so the same answers give the same bytes. `readDataset`
 * reads such a document back, once, into the value `datasetOf` writes from. Beside the
 * DataSet, the document holds its provenance (`provenanceOf`); `provenanceView` is the
 * document without the values.
 */

import {
	type DdiDocument,
	documentOf,
	type Identity,
	type Item,
	identity,
	intl,
	item,
	type JsonObject,
	ref,
} from "./ddi/document.ts";
import { asList, asObj, str } from "./ddi/read.ts";
import { type Provenance, provenanceOf } from "./provenance.ts";
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

/** The dataset's own items' identities, all hung off `dataset-<name>`. */
const owned = (agency: string, name: string) => {
	const base = `dataset-${name}`;
	return {
		dataset: identity(agency, base),
		respondent: identity(agency, `${base}.respondent`),
		start: identity(agency, `${base}.start`),
		end: identity(agency, `${base}.end`),
	};
};

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
	const values: { respondent: string; urn: string; value: JsonObject }[] = [];
	const put = (respondent: string, target: Identity, v: string) =>
		values.push({
			respondent,
			urn: target.URN,
			value: {
				VariableReference: ref({ type: "Variable", identity: target }),
				RecordReference: respondent,
				Value: [{ StringValue: v }],
			},
		});
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
		const [Agency, ID, Version] = parts;
		put(a.respondent, { URN: urnOf(parts), Agency, ID, Version }, a.value);
	}
	for (const r of d.respondents) {
		put(r.id, ids.respondent, r.id);
		if (r.start !== undefined) put(r.id, ids.start, r.start);
		if (r.end !== undefined) put(r.id, ids.end, r.end);
	}
	values.sort(
		(a, b) => compare(a.respondent, b.respondent) || compare(a.urn, b.urn),
	);
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
		starts: d.respondents.flatMap((r) => r.start ?? []),
		ends: d.respondents.flatMap((r) => r.end ?? []),
	});
	if (!described.ok) return described;
	return ok(
		documentOf([
			set,
			respondent,
			...(timed("start") ? [time(ids.start, "start")] : []),
			...(timed("end") ? [time(ids.end, "end")] : []),
			...described.value,
		]),
	);
}

/**
 * A dataset document read back, all or none: one `DataSet` identified by its own
 * respondent variable, with an `ItemSet`, each value naming a Variable, a respondent and
 * one value, never two for one variable and respondent. Values of the dataset's own
 * variables become its respondents and their times; every other value is an answer, of a
 * respondent the dataset identifies.
 */
// shortcut: start and end values aren't checked as date-times, nor the variables' items read; check them when another program writes datasets.
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
 * The answers as long CSV, as `answersCsv` writes them, sorted by respondent and then
 * variable URN: the canonical form the dataset's fingerprint is over. The dataset's own
 * variables aren't answers.
 */
export const csvView = (d: Dataset): string =>
	answersCsv(
		[...d.answers].sort(
			(a, b) =>
				compare(a.respondent, b.respondent) || compare(a.variable, b.variable),
		),
	);

/**
 * A dataset document without its values: its DataSet is kept, without the ItemSet, so
 * every reference to it still resolves. Read with `readDataset` first.
 */
export const provenanceView = (doc: unknown): DdiDocument => ({
	...asObj(doc),
	DataSet: Object.fromEntries(
		Object.entries(asObj(asObj(doc)?.DataSet) ?? {}).map(([key, set]) => {
			const { ItemSet: _, ...kept } = asObj(set) ?? {};
			return [key, kept];
		}),
	),
});
