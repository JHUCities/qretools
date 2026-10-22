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
	 * a definition inside an item, the field it was found in (`OutParameter`, `Code`).
	 */
	readonly type: string;
	readonly urn: string;
	readonly item: JsonObject;
	/**
	 * The nearest identified object a nested definition was found in: a parameter's
	 * question or response domain's question, a code's list or parent code.
	 */
	readonly owner?: Indexed;
}

/**
 * How deep a reader of DDI goes inside an item, so a hostile document can't overflow the
 * stack; real DDI nests a few levels.
 */
export const DDI_DEPTH = 64;

/** A reference as written, in the identified object it's written in (none at the top level). */
export interface DdiReference {
	readonly from?: Indexed;
	/** The field it's written in (`QuestionReference`). */
	readonly field: string;
	readonly ref: unknown;
}

export interface DdiIndex {
	/** Every item, by its URN (`urnKey`). */
	readonly byUrn: ReadonlyMap<string, Indexed>;
	/** The highest version of each item, by `agency:id`: what a versionless reference names. */
	readonly latest: ReadonlyMap<string, Indexed>;
	/** Every reference in the document, every version of every item included. */
	readonly references: readonly DdiReference[];
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
 * (`Variable: { "a:id:1": {…} }`), and every identified object written inside one at
 * any depth (a question's parameters, a response domain's or a command's, a list's
 * codes and their codes), which references name too. A field named `…Reference…` holds
 * references, listed in `references`, except where it holds a structure
 * (`isReference`): the schema writes some definitions there (a loop's or a computation's
 * parameter), so those are searched last, and a copy of a definition found there never
 * replaces the real one. An object with neither a URN
 * nor an Agency and ID can't be referred to, so it isn't indexed; a nested one never
 * replaces an item already indexed. Total: anything else is no items.
 */
export function ddiIndexOf(doc: unknown): DdiIndex {
	const byUrn = new Map<string, Indexed>();
	const latest = new Map<string, Indexed>();
	const references: DdiReference[] = [];
	const refer = (from: Indexed | undefined, field: string, ref: unknown) =>
		references.push({ ...(from && { from }), field, ref });
	const add = (type: string, o: JsonObject, owner?: Indexed) => {
		const urn = urnFrom(o);
		const parts = urn === undefined ? undefined : partsOf(urn);
		if (urn === undefined || parts === undefined) return undefined;
		if (owner !== undefined && byUrn.has(urnKey(urn))) return undefined;
		const it: Indexed = { type, urn, item: o, ...(owner && { owner }) };
		byUrn.set(urnKey(urn), it);
		const was = latest.get(parts.item);
		const wasVersion = was === undefined ? undefined : partsOf(was.urn);
		// An item's root version is authoritative: a nested object never displaces it as latest;
		// nested ones (a code in two versions of a list) compete among themselves.
		const displaces = owner === undefined || was?.owner !== undefined;
		if (
			was === undefined ||
			(displaces && newer(parts.version ?? "0", wasVersion?.version ?? "0"))
		)
			latest.set(parts.item, it);
		return it;
	};
	const structures: [string, JsonObject, Indexed, number][] = [];
	// shortcut: nesting deeper than DDI_DEPTH isn't searched, so a hostile document can't
	// overflow the stack; real DDI nests a few levels. Raise it if a producer needs more.
	const within = (o: JsonObject, owner: Indexed, depth = 0) => {
		if (depth > DDI_DEPTH) return;
		for (const [field, value] of Object.entries(o)) {
			if (field.includes("Reference")) {
				for (const x of Array.isArray(value) ? value : [value]) {
					const nested = asObj(x);
					if (isReference(x)) refer(owner, field, x);
					else if (nested !== undefined)
						structures.push([field, nested, owner, depth + 1]);
				}
				continue;
			}
			for (const x of Array.isArray(value) ? value : [value]) {
				const nested = asObj(x);
				if (nested === undefined) continue;
				within(nested, add(field, nested, owner) ?? owner, depth + 1);
			}
		}
	};
	const roots = Object.entries(asObj(doc) ?? {}).flatMap(([type, bucket]) =>
		Object.values(asObj(bucket) ?? {}).flatMap((item) => {
			const o = asObj(item);
			const it = o === undefined ? undefined : add(type, o);
			return o === undefined || it === undefined ? [] : [[o, it] as const];
		}),
	);
	for (const [o, it] of roots) within(o, it);
	// shortcut: a full parameter in a SourceParameterReference stands in for one the document
	// lacks, so that reference doesn't read as dangling; in 4.0 the schema calls it a definition.
	for (const [field, o, owner, depth] of structures)
		if (depth <= DDI_DEPTH) within(o, add(field, o, owner) ?? owner, depth);
	for (const [field, value] of Object.entries(asObj(doc) ?? {}))
		if (field.includes("Reference"))
			for (const x of Array.isArray(value) ? value : [value])
				if (isReference(x)) refer(undefined, field, x);
	return { byUrn, latest, references };
}

/** Fields whose references point outside the document by nature: provenance cites other studies. */
const OUTSIDE = new Set(["BasedOnReference"]);

/**
 * Each reference that names a URN the document has no item for, with that URN; one that
 * points outside by nature (`OUTSIDE`) isn't.
 */
export const danglingIn = (
	index: DdiIndex,
): readonly { readonly from?: Indexed; readonly urn: string }[] =>
	index.references.flatMap(({ from, field, ref }) => {
		const urn = refUrn(ref);
		return urn === undefined ||
			OUTSIDE.has(field) ||
			deref(index, ref) !== undefined
			? []
			: [{ ...(from && { from }), urn }];
	});

/** The highest version the index holds of an item: what a versionless reference to it names. */
export const latestOf = (index: DdiIndex, it: Indexed): Indexed => {
	const parts = partsOf(it.urn);
	return (parts === undefined ? undefined : index.latest.get(parts.item)) ?? it;
};

const REFERENCE_KEYS = [
	new Set(["$type", "value"]),
	new Set(["URN", "Agency", "ID", "Version", "TypeOfObject"]),
];

/**
 * Whether a value is written as a reference, in a form `refUrn` reads: a string, or an
 * object of nothing but the schema's `$type` and `value`, or of an identity (URN, Agency,
 * ID, Version). Anything more is a structure, such as a parameter defined in place.
 */
export const isReference = (j: unknown): boolean => {
	if (typeof j === "string") return true;
	const keys = Object.keys(asObj(j) ?? {});
	return (
		keys.length > 0 &&
		REFERENCE_KEYS.some((allowed) => keys.every((k) => allowed.has(k)))
	);
};

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
