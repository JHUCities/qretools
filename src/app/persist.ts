/**
 * What survives a reload: the questions, their origins, and the bank settings,
 * as one JSON value validated by a Zod schema on the way back in. Anything
 * unparseable is a Failure, not a crash. The token is kept separately and
 * never in this value.
 */
import { z } from "zod";
import { compact } from "../core/compact.js";
import { err, ok, type Result } from "../core/result.js";
import type { Credentials } from "./auth.js";
import type { CredentialStore, Failure } from "./storage.js";

const OriginSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("draft") }),
	z.strictObject({
		kind: z.literal("bank"),
		path: z.string(),
		sha: z.string(),
		original: z.string(),
	}),
]);

/**
 * The Bank panel's settings. Older versions also stored a branch; saves now always go
 * to the author's own branch, so a stored one is read and dropped.
 */
const SettingsSchema = z
	.strictObject({
		owner: z.string(),
		repo: z.string(),
		branch: z.string().optional(),
		remember: z.boolean(),
	})
	.transform(({ owner, repo, remember }) => ({ owner, repo, remember }));

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

const AUTH_KEY = "qretools.auth";
/** Before sign-in, a pasted token was kept as a bare string under this key; read once. */
const OLD_TOKEN_KEY = "qretools.token";

const CredentialsSchema = z.strictObject({
	access: z.string(),
	expiresAt: z.number().optional(),
	refresh: z.string().optional(),
	refreshExpiresAt: z.number().optional(),
});

function readCredentials(storage: Storage): Credentials | null {
	const raw = storage.getItem(AUTH_KEY);
	if (raw !== null) {
		try {
			const parsed = CredentialsSchema.safeParse(JSON.parse(raw));
			if (parsed.success) return compact(parsed.data) as Credentials;
		} catch {
			// unreadable: treat as none
		}
		return null;
	}
	const old = storage.getItem(OLD_TOKEN_KEY);
	return old === null ? null : { access: old };
}

/** Session storage by default: gone when the tab closes. Local storage only when asked to remember. */
export const browserCredentialStore: CredentialStore = {
	load: () =>
		safe(() => {
			const session = readCredentials(sessionStorage);
			if (session !== null) return { credentials: session, remember: false };
			const local = readCredentials(localStorage);
			return local === null ? null : { credentials: local, remember: true };
		}, null),
	save: (credentials, remember) =>
		safe(() => {
			(remember ? localStorage : sessionStorage).setItem(
				AUTH_KEY,
				JSON.stringify(credentials),
			);
			for (const s of [sessionStorage, localStorage])
				s.removeItem(OLD_TOKEN_KEY);
			(remember ? sessionStorage : localStorage).removeItem(AUTH_KEY);
		}, undefined),
	clear: () =>
		safe(() => {
			for (const s of [sessionStorage, localStorage]) {
				s.removeItem(AUTH_KEY);
				s.removeItem(OLD_TOKEN_KEY);
			}
		}, undefined),
};
