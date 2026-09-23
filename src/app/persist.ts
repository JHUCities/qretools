/**
 * What survives a reload: the questions, their origins, and the bank settings,
 * as one JSON value validated by a Zod schema on the way back in. Anything
 * unparseable is a Failure, not a crash. The token is kept separately and
 * never in this value.
 */
import { z } from "zod";
import { err, ok, type Result } from "../core/result.js";
import type { Failure, TokenStore } from "./storage.js";

export const OriginSchema = z.discriminatedUnion("kind", [
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

const FileSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		id: z.int().positive(),
		kind: z.literal("question"),
		source: z.string(),
		origin: OriginSchema,
	}),
	z.strictObject({
		id: z.int().positive(),
		kind: z.enum(["scale", "universe", "instruction", "missing"]),
		name: z.string(),
		source: z.string(),
		origin: OriginSchema,
	}),
]);

export const PersistedSchema = z.strictObject({
	version: z.literal(2),
	nextId: z.int().positive(),
	files: z.array(FileSchema),
	settings: SettingsSchema,
});

/** Version 1 held only questions; read it as version 2, so saved drafts survive the upgrade. */
const V1Schema = z
	.strictObject({
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
	})
	.transform(
		({ nextId, questions, settings }): z.infer<typeof PersistedSchema> => ({
			version: 2,
			nextId,
			files: questions.map((q) => ({ ...q, kind: "question" as const })),
			settings,
		}),
	);

const StoredSchema = z.union([PersistedSchema, V1Schema]);

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
