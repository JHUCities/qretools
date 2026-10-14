/**
 * What survives a reload. Two values, each validated by a Zod schema on the way back in:
 * the tab's own work in session storage (gone when the tab closes; owner, 2026-09-28),
 * and the sign-in page's settings in local storage, a default for the next new tab.
 * Anything unparseable is a Failure, not a crash, and is set aside, never dropped. The
 * token is kept separately and never in either value.
 */

import {
	err,
	ok,
	type Result,
	SCHEME_KINDS,
	type SchemeKind,
} from "@qretools/core";
import { type BankSettings, type Failure, parseBank } from "@qretools/shell";
import { z } from "zod";

const BaseSchema = z.strictObject({
	path: z.string(),
	sha: z.string(),
	text: z.string(),
});

// Every kind the core knows. Widening it reads older work unchanged: no version bump.
const SCHEME_KIND = z.enum(SCHEME_KINDS as [SchemeKind, ...SchemeKind[]]);

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

/** The workspace's own files, not its bank's: its instruments. */
const WorkspaceEntrySchema = z.strictObject({
	kind: z.literal("instrument"),
	name: z.string(),
	id: z.int().positive(),
	source: z.string(),
	base: BaseSchema.optional(),
});

/**
 * One tab's work, in session storage: the working copies, each with the base it started
 * from (`remote` is rebuilt from the bases, which record the last GitHub state this
 * browser knew). `repo` is the workspace it belongs to (the folder of the repository
 * signed in to), which wins over the stored settings when the tab reloads, so another
 * tab's sign-in never points this tab's work elsewhere; `login` is whose it is, once
 * someone has signed in with it. Paths are the workspace's.
 *
 * The only version read: nothing older is upgraded (nobody had any to keep), and the
 * number stays 8 for whatever else changes before a release. Strict, so work written
 * with a field since dropped (an entry's `bank`) is set aside as unreadable.
 */
export const WorkSchema = z.strictObject({
	version: z.literal(8),
	repo: z.string(),
	login: z.string().optional(),
	nextId: z.int().positive(),
	questions: z.array(QuestionSchema),
	schemes: z.array(SchemeSchema),
	workspace: z.array(WorkspaceEntrySchema),
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
	// Only this version: older work is set aside as unreadable, never upgraded.
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
	/** The bank's folder in the repository; absent for its root (and in older settings). */
	path: z.string().optional(),
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
		const { owner, repo, path, remember } = parsed.data;
		return { owner, repo, path: path ?? "", remember };
	} catch {
		return undefined;
	}
}

export const settingsValue = ({
	owner,
	repo,
	path,
	remember,
}: BankSettings): string =>
	JSON.stringify({
		version: 1,
		owner,
		repo,
		...(path !== "" && { path }),
		remember,
	});

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
	const own = work === undefined ? undefined : parseBank(work.repo);
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
 * What a tab starts with: this tab's work and the stored default settings. Unreadable
 * work is copied to
 * `qretools.work.unreadable` in local storage, so the first save does not destroy it.
 */
export function readStartup(
	local: Storage,
	session: Storage,
): {
	readonly work: Result<Work | undefined, Failure>;
	readonly settings?: BankSettings;
	readonly theme?: "light" | "dark";
} {
	const raw = session.getItem(WORK_KEY);
	const work = readWork(raw);
	if (!work.ok && raw !== null) local.setItem(WORK_UNREADABLE_KEY, raw);
	const settings = readSettings(local.getItem(SETTINGS_KEY));
	const theme = readTheme(local.getItem(THEME_KEY));
	return {
		work,
		...(settings !== undefined && { settings }),
		...(theme !== undefined && { theme }),
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
