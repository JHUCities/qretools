/**
 * A DDI-Lifecycle 4.0 document as plain JSON, plus the few constructors where
 * correctness lives. We deliberately do not model the 507 schema definitions:
 * the helpers below fix the shapes we emit, and tests plus the official JSON
 * Schema check them.
 */

import { compact } from "../compact.js";

export type Json = string | number | boolean | readonly Json[] | JsonObject;
export interface JsonObject {
	readonly [key: string]: Json;
}

export type ItemType =
	| "QuestionItem"
	| "CodeList"
	| "Category"
	| "Concept"
	| "Instruction"
	| "Universe"
	| "Variable"
	| "ManagedMissingValuesRepresentation";

export interface Identity {
	readonly URN: string;
	readonly Agency: string;
	readonly ID: string;
	readonly Version: string;
}

export interface Item {
	readonly type: ItemType;
	readonly identity: Identity;
	readonly body: JsonObject;
}

/** Root: item type -> `Agency:ID:Version` -> item. */
export type DdiDocument = Readonly<
	Partial<Record<ItemType, Readonly<Record<string, JsonObject>>>>
>;

const LANGUAGE = "en";

/** A JSON object without its `undefined` entries. One implementation (`compact`), two types. */
export const obj = (
	entries: Readonly<Record<string, Json | undefined>>,
): JsonObject => compact(entries) as JsonObject;

/** An item's identity at a version (`1` when nothing is known of its history). */
export const identity = (
	agency: string,
	id: string,
	version = "1",
): Identity => ({
	URN: `urn:ddi:${agency}:${id}:${version}`,
	Agency: agency,
	ID: id,
	Version: version,
});

export const item = (type: ItemType, id: Identity, body: JsonObject): Item => ({
	type,
	identity: id,
	body,
});

/**
 * A reference to another item. The `{ $type, value }` shape is required by the
 * schema; what goes in `value` is a COGS convention the schema does not constrain.
 * We use `[Agency, ID, Version]`, matching the root key. Inferred, not confirmed:
 * keep every reference going through here.
 */
export const ref = (target: Pick<Item, "type" | "identity">): JsonObject => ({
	$type: target.type,
	value: [target.identity.Agency, target.identity.ID, target.identity.Version],
});

const langString = (text: string): JsonObject => ({
	MultilingualStringValue: { LanguageTag: LANGUAGE, Value: text },
});

/** InternationalStringType / NameType. */
export const intl = (text: string): JsonObject => ({
	String: [langString(text)],
});

/** StructuredStringType / LabelType. */
export const structured = (text: string): JsonObject => ({
	Content: [langString(text)],
});

/** DynamicTextType holding one literal text. */
export const literalText = (text: string): JsonObject => ({
	TextContent: [{ Text: langString(text) }],
});

/** CodeValueType. */
export const codeValue = (value: string): JsonObject => ({
	StringValue: value,
});

/**
 * Items keyed by type and URN. A repeated URN keeps the last item silently: two
 * options naming one variable do this inside one question today (the
 * `duplicate-option-variable` lint warns the author), and role 2 will reach it by
 * concatenating questions.
 */
export const documentOf = (items: readonly Item[]): DdiDocument => {
	const doc: Partial<Record<ItemType, Record<string, JsonObject>>> = {};
	for (const it of items) {
		const { Agency, ID, Version } = it.identity;
		const bucket = doc[it.type] ?? {};
		bucket[`${Agency}:${ID}:${Version}`] = { ...it.identity, ...it.body };
		doc[it.type] = bucket;
	}
	return doc;
};
