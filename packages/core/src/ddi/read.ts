/**
 * Reading DDI-Lifecycle 4.0 JSON as any producer writes it, not only as `elaborate`
 * does: untyped JSON in, small typed values out, never an exception. `ddiIndexOf` keys a
 * document's items by URN once; `deref` follows a reference in whichever form the
 * producer wrote it. A program that reads DDI it didn't make (a codebook) starts here.
 */

import type { JsonObject } from "./document.ts";

export const asObj = (j: unknown): JsonObject | undefined =>
	j !== null && typeof j === "object" && !Array.isArray(j)
		? (j as JsonObject)
		: undefined;

/**
 * An array's objects; a lone object as a list of one, since a converter from DDI's XML
 * may write a single repetition without its array. (qsf's private copy takes a lone
 * object as no list: it reads only the core's own output.)
 */
export const asList = (j: unknown): readonly JsonObject[] => {
	if (!Array.isArray(j)) return asObj(j) === undefined ? [] : [j as JsonObject];
	return j.flatMap((x) => (asObj(x) === undefined ? [] : [x as JsonObject]));
};

export const str = (j: unknown): string | undefined =>
	typeof j === "string" ? j : undefined;

/**
 * The words of an InternationalString, a StructuredString (a Name, a Label, a
 * Description, a LiteralText's Text) or a list of them: the words in `lang`, else the
 * first words written. A list may hold one language per element, or all in each.
 */
export function words(j: unknown, lang?: string): string | undefined {
	const values = asList(j)
		.flatMap((o) => [...asList(o.String), ...asList(o.Content), o])
		.map((s) => asObj(s.MultilingualStringValue))
		.filter((m) => m !== undefined && typeof m.Value === "string");
	const chosen =
		values.find((m) => lang !== undefined && m?.LanguageTag === lang) ??
		values[0];
	return str(chosen?.Value);
}

/** An item of a document, whatever its type: one the reader may not know. */
export interface Indexed {
	/**
	 * The root key it was found under, the DDI type name (`Variable`, `QuestionItem`); for
	 * a definition inside an item (`NESTED`), the field it was found in (`OutParameter`).
	 */
	readonly type: string;
	readonly urn: string;
	readonly item: JsonObject;
	/** The item a nested definition was found in: a parameter's question, a code's list. */
	readonly owner?: Indexed;
}

/**
 * Definitions DDI writes inside their item rather than at the root, which references
 * still name by URN: a question's parameters (a variable's source), a list's codes.
 */
const NESTED = ["OutParameter", "InParameter", "Code"] as const;

export interface DdiIndex {
	/** Every item, by its URN (`urnKey`). */
	readonly byUrn: ReadonlyMap<string, Indexed>;
	/** The highest version of each item, by `agency:id`: what a versionless reference names. */
	readonly latest: ReadonlyMap<string, Indexed>;
}

/** A URN as a key: the scheme is case-insensitive (`URN:DDI:`), the rest is compared as written. */
const urnKey = (urn: string): string =>
	/^urn:ddi:/i.test(urn) ? `urn:ddi:${urn.slice(8)}` : urn;

/** `agency:id` and the version, of a URN with or without one. */
const partsOf = (
	urn: string,
): { readonly item: string; readonly version?: string } | undefined => {
	const [scheme, nid, agency, id, version] = urnKey(urn).split(":");
	if (scheme !== "urn" || nid !== "ddi" || !agency || !id) return undefined;
	const latest =
		version === undefined ||
		version === "" ||
		version.toLowerCase() === "latest";
	return { item: `${agency}:${id}`, ...(!latest && { version }) };
};

/** Dotted versions compared part by part as numbers: `1.10` is after `1.9`. */
// shortcut: a version that isn't digits and dots compares as neither newer nor older, so the first seen stays; read it when a producer writes one.
const newer = (a: string, b: string): boolean => {
	const x = a.split(".").map(Number);
	const y = b.split(".").map(Number);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d !== 0) return d > 0;
	}
	return false;
};

const urnFrom = (o: JsonObject): string | undefined => {
	const urn = str(o.URN);
	if (urn !== undefined) return urn;
	const agency = str(o.Agency);
	const id = str(o.ID);
	return agency === undefined || id === undefined
		? undefined
		: `urn:ddi:${agency}:${id}:${str(o.Version) ?? ""}`;
};

/**
 * A document's items by URN: each object under each root key whose value is an object
 * (`Variable: { "a:id:1": {…} }`), and the definitions inside them (`NESTED`). An item
 * with neither a URN nor an Agency and ID
 * can't be referred to, so it isn't indexed. Total: anything else is no items.
 */
export function ddiIndexOf(doc: unknown): DdiIndex {
	const byUrn = new Map<string, Indexed>();
	const latest = new Map<string, Indexed>();
	const add = (type: string, o: JsonObject, owner?: Indexed) => {
		const urn = urnFrom(o);
		const parts = urn === undefined ? undefined : partsOf(urn);
		if (urn === undefined || parts === undefined) return undefined;
		const it: Indexed = { type, urn, item: o, ...(owner && { owner }) };
		byUrn.set(urnKey(urn), it);
		const was = latest.get(parts.item);
		const wasVersion = was === undefined ? undefined : partsOf(was.urn);
		if (
			was === undefined ||
			newer(parts.version ?? "0", wasVersion?.version ?? "0")
		)
			latest.set(parts.item, it);
		return it;
	};
	for (const [type, bucket] of Object.entries(asObj(doc) ?? {}))
		for (const item of Object.values(asObj(bucket) ?? {})) {
			const o = asObj(item);
			const it = o === undefined ? undefined : add(type, o);
			if (o === undefined || it === undefined) continue;
			for (const field of NESTED)
				for (const nested of asList(o[field])) add(field, nested, it);
		}
	return { byUrn, latest };
}

/**
 * The URN a reference names, in any form a producer writes one: `{ $type, value:
 * [agency, id, version] }` (the schema's, as the core writes it), a URN string, or an
 * object with a `URN` or an `Agency`, `ID` and `Version`. Without a version (or with
 * `latest`) the URN has none.
 */
export function refUrn(r: unknown): string | undefined {
	const s = str(r);
	if (s !== undefined) return partsOf(s) === undefined ? undefined : s;
	const o = asObj(r);
	if (o === undefined) return undefined;
	if (Array.isArray(o.value)) {
		const [agency, id, version] = o.value.map(str);
		return agency === undefined || id === undefined
			? undefined
			: `urn:ddi:${agency}:${id}:${version ?? ""}`;
	}
	const urn = urnFrom(o);
	return urn === undefined || partsOf(urn) === undefined ? undefined : urn;
}

/** The item a reference names: that version, or the highest present when it names none. */
export function deref(index: DdiIndex, r: unknown): Indexed | undefined {
	const urn = refUrn(r);
	const parts = urn === undefined ? undefined : partsOf(urn);
	if (urn === undefined || parts === undefined) return undefined;
	return parts.version === undefined
		? index.latest.get(parts.item)
		: index.byUrn.get(urnKey(urn));
}
