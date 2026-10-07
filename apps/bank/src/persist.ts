/**
 * What survives a reload. Two values, each validated by a Zod schema on the way back in:
 * the tab's own work in session storage (gone when the tab closes; owner, 2026-09-28),
 * and the Bank panel's settings in local storage, a default for the next new tab.
 * Anything unparseable is a Failure, not a crash, and is set aside, never dropped. The
 * token is kept separately and never in either value.
 *
 * Versions 1 to 4 lived in local storage under `qretools.v1`, shared by every tab; they
 * are read once, by `migrate`, and retired.
 */

import { compact } from "@qretools/core/compact.js";
import { err, ok, type Result } from "@qretools/core/result.js";
import { SCHEME_KINDS, type SchemeKind } from "@qretools/core/schemes.js";
import { z } from "zod";
import type { Credentials } from "./auth.js";
import {
	type BankSettings,
	type CredentialStore,
	type Failure,
	parseRepo,
} from "./storage.js";

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

// Every kind the core knows. Widening it reads older work unchanged: no version bump.
const SCHEME_KIND = z.enum(SCHEME_KINDS as [SchemeKind, ...SchemeKind[]]);

/**
 * Version 3: working copies split by kind, each with the base it started from. The
 * remote slice is not stored: on load it is rebuilt from the bases, which record
 * exactly the last GitHub state this browser knew.
 */
const V3Schema = z.strictObject({
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

const QuestionSchema = z.strictObject({
	kind: z.literal("question"),
	id: z.int().positive(),
	source: z.string(),
	base: BaseSchema.optional(),
});
const SchemeSchema = z.strictObject({
	kind: SCHEME_KIND,
	name: z.string(),
	id: z.int().positive(),
	source: z.string(),
	base: BaseSchema.optional(),
});

/**
 * Version 4: working copies belong to one bank and one person. `workOf` says whose the
 * current ones are (`owner/repo`, and the login once known); `kept` holds the others,
 * by `owner/repo@login`, set aside when someone signs in to another bank or as
 * someone else, and brought back when they return. Nothing in `kept` is ever dropped.
 */
export const PersistedSchema = z.strictObject({
	version: z.literal(4),
	nextId: z.int().positive(),
	questions: z.array(QuestionSchema),
	schemes: z.array(SchemeSchema),
	settings: SettingsSchema,
	workOf: z
		.strictObject({ repo: z.string(), login: z.string().optional() })
		.optional(),
	kept: z.record(
		z.string(),
		z.strictObject({
			questions: z.array(QuestionSchema),
			schemes: z.array(SchemeSchema),
		}),
	),
});

/**
 * Version 3's work was one pool, saved while connected to its settings' repository:
 * it is that bank's, by a person not recorded (assumed to be whoever signs in there next).
 */
const v3ToV4 = (v3: z.infer<typeof V3Schema>): Persisted => ({
	...v3,
	version: 4,
	workOf: { repo: `${v3.settings.owner}/${v3.settings.repo}` },
	kept: {},
});

type V3 = z.infer<typeof V3Schema>;

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
	V3Schema.transform(v3ToV4),
	V2Schema.transform((v2) => v3ToV4(v2ToV3(v2))),
	V1Schema.transform((v1) => v3ToV4(v2ToV3(v1ToV2(v1)))),
]);

export type Persisted = z.infer<typeof PersistedSchema>;

/** Where versions 1 to 4 lived: local storage, shared by every tab. Read once, then retired. */
export const LEGACY_KEY = "qretools.v1";
/** The old value, renamed rather than deleted once migrated: nothing is ever dropped. */
export const RETIRED_KEY = "qretools.v1.retired";

/** Versions 1 to 4, upgraded to 4. Only `migrate` reads them now. */
export function readPersisted(
	raw: string | null,
): Result<Persisted | undefined, Failure> {
	return parseStored(raw, StoredSchema, {
		what: "The work kept in this browser by an older version",
		key: RETIRED_KEY,
	});
}

/**
 * Version 5: one tab's work, in session storage. `repo` is the bank it belongs to, which
 * wins over the stored settings when the tab reloads, so another tab's sign-in never
 * points this tab's work at another bank; `login` is whose it is, once someone has
 * signed in with it.
 */
export const WorkSchema = z.strictObject({
	version: z.literal(5),
	repo: z.string(),
	login: z.string().optional(),
	nextId: z.int().positive(),
	questions: z.array(QuestionSchema),
	schemes: z.array(SchemeSchema),
});

export type Work = z.infer<typeof WorkSchema>;

export const WORK_KEY = "qretools.work";
/** Unreadable work, kept in local storage so it outlives the tab. */
export const WORK_UNREADABLE_KEY = "qretools.work.unreadable";
/** Work set aside because it was someone else's or another bank's: a list, only ever appended to. */
export const WORK_ASIDE_KEY = "qretools.work.aside";

export function readWork(
	raw: string | null,
): Result<Work | undefined, Failure> {
	return parseStored(raw, WorkSchema, {
		what: "The work kept in this tab",
		key: WORK_UNREADABLE_KEY,
	});
}

/** Version 1 of the stored settings: the default bank and "remember" for a new tab. */
const StoredSettingsSchema = z.strictObject({
	version: z.literal(1),
	owner: z.string(),
	repo: z.string(),
	remember: z.boolean(),
});

export const SETTINGS_KEY = "qretools.settings";

/**
 * The theme chosen on this device. index.html's inline script reads the same key before
 * the first paint (a test holds the two to one spelling).
 */
export const THEME_KEY = "qretools.theme";

/** The stored theme, or undefined (the system's) for anything else. */
export const readTheme = (raw: string | null): "light" | "dark" | undefined =>
	raw === "light" || raw === "dark" ? raw : undefined;

/** The stored settings, or undefined when there are none or they can't be read: only a default. */
export function readSettings(raw: string | null): BankSettings | undefined {
	if (raw === null) return undefined;
	try {
		const parsed = StoredSettingsSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) return undefined;
		const { owner, repo, remember } = parsed.data;
		return { owner, repo, remember };
	} catch {
		return undefined;
	}
}

export const settingsValue = ({
	owner,
	repo,
	remember,
}: BankSettings): string =>
	JSON.stringify({ version: 1, owner, repo, remember });

/**
 * The settings a tab starts with: its own work's bank wins over the stored default, so
 * a reload stays in the bank the work belongs to.
 */
export function startingSettings(
	stored: BankSettings | undefined,
	work: Work | undefined,
	fallback: BankSettings,
): BankSettings {
	const settings = stored ?? fallback;
	const own = work === undefined ? undefined : parseRepo(work.repo);
	return own?.ok ? { ...settings, ...own.value } : settings;
}

function parseStored<T>(
	raw: string | null,
	schema: z.ZodType<T>,
	{ what, key }: { readonly what: string; readonly key: string },
): Result<T | undefined, Failure> {
	if (raw === null) return ok(undefined);
	const hint = `It was set aside under \`${key}\`.`;
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return err({
			kind: "unreadable",
			message: `${what} can't be read.`,
			detail: "Not valid JSON.",
			hint,
		});
	}
	const parsed = schema.safeParse(json);
	if (!parsed.success) {
		return err({
			kind: "unreadable",
			message: `${what} doesn't match what this version of the app expects.`,
			detail: parsed.error.issues[0]?.message ?? "invalid",
			hint,
		});
	}
	return ok(parsed.data);
}

/**
 * The older versions' work, as this tab's: the bank and person it was recorded for
 * (the settings' bank when none was), with the settings as the new default. Work kept
 * for other banks and people has no tab to go to; `setAside` says whether there was any.
 */
export function fromLegacy(p: Persisted): {
	readonly work: Work;
	readonly settings: BankSettings;
	readonly setAside: boolean;
} {
	return {
		work: {
			version: 5,
			repo: p.workOf?.repo ?? `${p.settings.owner}/${p.settings.repo}`,
			...(p.workOf?.login !== undefined && { login: p.workOf.login }),
			nextId: p.nextId,
			questions: p.questions,
			schemes: p.schemes,
		},
		settings: p.settings,
		setAside: Object.values(p.kept).some(
			(k) => k.questions.length + k.schemes.length > 0,
		),
	};
}

/**
 * Once, before the app starts: a tab with no work of its own, in a browser an older
 * version used, takes that version's work and settings, and the old value is renamed to
 * `qretools.v1.retired` (never deleted). What could not come along is said, never
 * dropped silently: the returned failures are shown once.
 */
export function migrate(local: Storage, session: Storage): readonly Failure[] {
	const raw = local.getItem(LEGACY_KEY);
	if (raw === null || session.getItem(WORK_KEY) !== null) return [];
	const stored = readPersisted(raw);
	const notices: Failure[] = [];
	// A tab still on an older version may write the old key again after a first
	// migration: retire it beside, never over, what was retired before.
	const retired = freeKey(local, RETIRED_KEY);
	if (!stored.ok) notices.push(stored.error);
	else if (stored.value !== undefined) {
		const { work, settings, setAside } = fromLegacy(stored.value);
		session.setItem(WORK_KEY, JSON.stringify(work));
		local.setItem(SETTINGS_KEY, settingsValue(settings));
		if (setAside)
			notices.push({
				kind: "unreadable",
				message: `Unsaved work for other banks from an older version was set aside in this browser's storage (${retired}).`,
			});
	}
	local.setItem(retired, raw);
	local.removeItem(LEGACY_KEY);
	return notices;
}

/**
 * What a tab starts with: an older version's work migrated first (once), then this
 * tab's work and the stored default settings. Unreadable work is copied to
 * `qretools.work.unreadable` in local storage, so the first save does not destroy it.
 */
export function readStartup(
	local: Storage,
	session: Storage,
): {
	readonly work: Result<Work | undefined, Failure>;
	readonly settings?: BankSettings;
	readonly theme?: "light" | "dark";
	readonly notices: readonly Failure[];
} {
	const notices = migrate(local, session);
	const raw = session.getItem(WORK_KEY);
	const work = readWork(raw);
	if (!work.ok && raw !== null) local.setItem(WORK_UNREADABLE_KEY, raw);
	const settings = readSettings(local.getItem(SETTINGS_KEY));
	const theme = readTheme(local.getItem(THEME_KEY));
	return {
		work,
		...(settings !== undefined && { settings }),
		...(theme !== undefined && { theme }),
		notices,
	};
}

/**
 * Keep work that is leaving this tab (someone else's, or another bank's) at the end of
 * the set-aside list. A list that can't be read is kept inside the new one, as text.
 */
export function setAsideWork(local: Storage, work: Work): void {
	const raw = local.getItem(WORK_ASIDE_KEY);
	let list: unknown[] = [];
	if (raw !== null) {
		try {
			const parsed: unknown = JSON.parse(raw);
			list = Array.isArray(parsed) ? parsed : [raw];
		} catch {
			list = [raw];
		}
	}
	local.setItem(WORK_ASIDE_KEY, JSON.stringify([...list, work]));
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
	pasted: z.literal(true).optional(),
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
	return old === null ? null : { access: old, pasted: true };
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

/** `base`, or `base.2`, `base.3`… : the first key not already holding something. */
function freeKey(storage: Storage, base: string): string {
	if (storage.getItem(base) === null) return base;
	for (let n = 2; ; n++)
		if (storage.getItem(`${base}.${n}`) === null) return `${base}.${n}`;
}
