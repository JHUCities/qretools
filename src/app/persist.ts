/**
 * What survives a reload: the questions, their origins, and the bank settings,
 * as one JSON value validated by a Zod schema on the way back in. Anything
 * unparseable is a Failure, not a crash. The token is kept separately and
 * never in this value.
 */
import { z } from "zod";
import { err, ok, type Result } from "../core/result.js";
import type { Failure, TokenStore } from "./storage.js";

const OriginSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("draft") }),
	z.strictObject({
		kind: z.literal("bank"),
		path: z.string(),
		sha: z.string(),
		original: z.string(),
	}),
]);

const SettingsSchema = z.strictObject({
	owner: z.string(),
	repo: z.string(),
	branch: z.string(),
	remember: z.boolean(),
});

const BaseSchema = z.strictObject({
	path: z.string(),
	sha: z.string(),
	text: z.string(),
});

const SCHEME_KIND = z.enum(["scale", "universe", "instruction", "missing"]);

/**
 * Version 3: working copies split by kind, each with the base it started from. The
 * remote slice is not stored: on load it is rebuilt from the bases, which record
 * exactly the last GitHub state this browser knew.
 */
export const PersistedSchema = z.strictObject({
	version: z.literal(3),
	nextId: z.int().positive(),
	questions: z.array(
		z.strictObject({
			kind: z.literal("question"),
			id: z.int().positive(),
			source: z.string(),
			base: BaseSchema.optional(),
		}),
	),
	schemes: z.array(
		z.strictObject({
			kind: SCHEME_KIND,
			name: z.string(),
			id: z.int().positive(),
			source: z.string(),
			base: BaseSchema.optional(),
		}),
	),
	settings: SettingsSchema,
});

type V3 = z.infer<typeof PersistedSchema>;

const baseOf = (origin: z.infer<typeof OriginSchema>) =>
	origin.kind === "bank"
		? { base: { path: origin.path, sha: origin.sha, text: origin.original } }
		: {};

/** Version 2: one list of files, each with an origin. */
const V2Schema = z.strictObject({
	version: z.literal(2),
	nextId: z.int().positive(),
	files: z.array(
		z.discriminatedUnion("kind", [
			z.strictObject({
				id: z.int().positive(),
				kind: z.literal("question"),
				source: z.string(),
				origin: OriginSchema,
			}),
			z.strictObject({
				id: z.int().positive(),
				kind: SCHEME_KIND,
				name: z.string(),
				source: z.string(),
				origin: OriginSchema,
			}),
		]),
	),
	settings: SettingsSchema,
});

const v2ToV3 = ({ nextId, files, settings }: z.infer<typeof V2Schema>): V3 => ({
	version: 3,
	nextId,
	questions: files.flatMap(({ origin, ...f }) =>
		f.kind === "question" ? [{ ...f, kind: f.kind, ...baseOf(origin) }] : [],
	),
	schemes: files.flatMap(({ origin, ...f }) =>
		f.kind !== "question" ? [{ ...f, ...baseOf(origin) }] : [],
	),
	settings,
});

/** Version 1 held only questions. */
const V1Schema = z.strictObject({
	version: z.literal(1),
	nextId: z.int().positive(),
	questions: z.array(
		z.strictObject({
			id: z.int().positive(),
			source: z.string(),
			origin: OriginSchema,
		}),
	),
	settings: SettingsSchema,
});

const v1ToV2 = ({
	nextId,
	questions,
	settings,
}: z.infer<typeof V1Schema>): z.infer<typeof V2Schema> => ({
	version: 2,
	nextId,
	files: questions.map((q) => ({ ...q, kind: "question" as const })),
	settings,
});

/** Every version this code has written, each upgraded one step at a time to the current one. */
const StoredSchema = z.union([
	PersistedSchema,
	V2Schema.transform(v2ToV3),
	V1Schema.transform((v1) => v2ToV3(v1ToV2(v1))),
]);

export type Persisted = z.infer<typeof PersistedSchema>;

export const STORAGE_KEY = "qretools.v1";
export const UNREADABLE_KEY = "qretools.v1.unreadable";
const TOKEN_KEY = "qretools.token";

export function readPersisted(
	raw: string | null,
): Result<Persisted | undefined, Failure> {
	if (raw === null) return ok(undefined);
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return err({
			kind: "unreadable",
			message: "The saved work in this browser is not readable JSON.",
			hint: `It was kept under \`${UNREADABLE_KEY}\`.`,
		});
	}
	const parsed = StoredSchema.safeParse(json);
	if (!parsed.success) {
		return err({
			kind: "unreadable",
			message: `The saved work in this browser does not match what this version expects: ${parsed.error.issues[0]?.message ?? "invalid"}.`,
			hint: `It was kept under \`${UNREADABLE_KEY}\`.`,
		});
	}
	return ok(parsed.data);
}

const safe = <T>(f: () => T, fallback: T): T => {
	try {
		return f();
	} catch {
		return fallback;
	}
};

/** Session storage by default: gone when the tab closes. Local storage only when asked to remember. */
export const browserTokenStore: TokenStore = {
	load: () =>
		safe(
			() =>
				sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY),
			null,
		),
	save: (token, remember) =>
		safe(() => {
			(remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
			(remember ? sessionStorage : localStorage).removeItem(TOKEN_KEY);
		}, undefined),
	clear: () =>
		safe(() => {
			sessionStorage.removeItem(TOKEN_KEY);
			localStorage.removeItem(TOKEN_KEY);
		}, undefined),
};
