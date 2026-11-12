/**
 * Each file's DDI version, from the workspace's history: the computation `version.ts`
 * describes, given that history as values. The shell reads it from git (the CLI's
 * `build`); this module only counts.
 *
 * A file's version is how many times its content key has changed, oldest commit first.
 * A shared file's key is its own blob. A question's is its blob and the blobs of every
 * shared file it names, so a question's version moves when its scale (or universe, or
 * `missing.yaml`) does, as a reference carries the referenced item's version; one that
 * names an access level also takes `workspace.yaml`'s list of levels. `workspace.yaml`'s
 * own key is that list, its published code list: it has no version while it lists none. An
 * instrument's is its blob and the commit `workspace.yaml` locks each tag it names at:
 * it is versioned whole, and what it pins is part of it, so a moved and re-locked tag is
 * a new version even when the file is the same.
 */

import { type AddressKey, addressOf } from "./address.ts";
import type { Version, Versions } from "./ddi/version.ts";
import { importsOf } from "./instrument/instrument.ts";
import type { Locks } from "./lock.ts";
import { kindAt, ROOT, schemePath } from "./schemes.ts";
import { locksWritten, parseSettingsFile } from "./surface/bankfile.ts";
import { EMPTY_ENV } from "./surface/env.ts";
import { parseSurface } from "./surface/parse.ts";
import { instrumentAt } from "./workspace.ts";

/** One commit of the workspace: when it was made, and each file's blob, by workspace path. */
export interface Snapshot {
	/** ISO 8601: the commit's date, which becomes VersionDate. */
	readonly date: string;
	readonly blobs: Readonly<Record<string, string>>;
}

/**
 * The workspace's history, oldest first, and the text of every question, instrument and
 * `workspace.yaml` blob in it (shared files' text isn't needed: their key is their blob).
 */
export interface History {
	readonly snapshots: readonly Snapshot[];
	readonly texts: Readonly<Record<string, string>>;
}

/**
 * The shared files a question's text names. Every question also depends on both root
 * files: shortcut: `select_all.yaml` bumps questions that aren't select-all, and
 * `missing.yaml` those without a variable; over-counting a version is safe, and
 * telling them apart needs the env the question was read in. One that writes `access`
 * depends on `workspace.yaml` too, keyed on its levels alone (`levelsOf`): its other
 * lines never change a question's DDI.
 */
const dependencies = (text: string): readonly string[] => {
	const parsed = parseSurface(text, EMPTY_ENV);
	return [
		...new Set([
			...parsed.mentions.map((m) => schemePath(m.scheme, m.name)),
			ROOT.missing,
			ROOT.select_all,
			...(parsed.ranges.access === undefined ? [] : [ROOT.workspace]),
		]),
	];
};

/** Each file's version at the last snapshot, by path; files gone by then have none. */
export function versionsOf(history: History): Versions {
	const deps = new Map<string, readonly string[]>();
	const depsOf = (blob: string): readonly string[] => {
		let d = deps.get(blob);
		if (d === undefined) {
			d = dependencies(history.texts[blob] ?? "");
			deps.set(blob, d);
		}
		return d;
	};
	// The tags an instrument names, and the locks a workspace.yaml records, by blob.
	const pins = new Map<string, readonly AddressKey[]>();
	const pinsOf = (blob: string): readonly AddressKey[] => {
		let p = pins.get(blob);
		if (p === undefined) {
			p = importsOf(history.texts[blob] ?? "").flatMap((u) => {
				const a = u.address === undefined ? undefined : addressOf(u.address);
				return a?.kind === "remote" ? [a.key] : [];
			});
			pins.set(blob, p);
		}
		return p;
	};
	const locks = new Map<string, Locks>();
	const locksAt = (blob: string | undefined): Locks => {
		if (blob === undefined) return {};
		let l = locks.get(blob);
		if (l === undefined) {
			l = locksWritten(history.texts[blob] ?? "");
			locks.set(blob, l);
		}
		return l;
	};
	const levels = new Map<string, string>();
	/** What of `workspace.yaml` a question's DDI reads: its access levels, in order. */
	const levelsOf = (blob: string | undefined): string => {
		if (blob === undefined) return "";
		let l = levels.get(blob);
		if (l === undefined) {
			l = parseSettingsFile(history.texts[blob] ?? "").access.join(",");
			levels.set(blob, l);
		}
		return l;
	};
	const state = new Map<string, { key: string; version: Version }>();
	for (const { date, blobs } of history.snapshots)
		for (const [path, blob] of Object.entries(blobs)) {
			const instrument = instrumentAt(path) !== undefined;
			const at = kindAt(path);
			if (!instrument && at === undefined) continue;
			// `workspace.yaml` is versioned as its access levels, the one item it publishes.
			const workspace = at?.kind === "workspace";
			if (workspace && levelsOf(blob) === "") continue;
			const locked = instrument ? locksAt(blobs[ROOT.workspace]) : {};
			const key = workspace
				? levelsOf(blob)
				: instrument
					? [blob, ...pinsOf(blob).map((k) => `${k}=${locked[k] ?? ""}`)].join(
							" ",
						)
					: at?.kind === "question"
						? [
								blob,
								...depsOf(blob).map(
									(d) =>
										`${d}=${d === ROOT.workspace ? levelsOf(blobs[d]) : (blobs[d] ?? "")}`,
								),
							].join(" ")
						: blob;
			const was = state.get(path);
			if (was?.key === key) continue;
			const n = was === undefined ? 1 : Number(was.version.number) + 1;
			// No blob for `workspace.yaml`: its other lines change it without a new version, so
			// a blob would go stale. A tag's manifest leaves it out (`tagMessage`).
			// shortcut: a workspace read at a tag publishes its levels at version 1, so two tags
			// with different levels give one URN two bodies; give the manifest a blob-free
			// `workspace.yaml` entry when instruments start reading banks at several tags.
			state.set(path, {
				key,
				version: {
					number: String(n),
					date,
					...(!workspace && { blob }),
				},
			});
		}
	const last = history.snapshots.at(-1)?.blobs ?? {};
	return Object.fromEntries(
		[...state].flatMap(([path, { version }]) =>
			path in last && (path !== ROOT.workspace || levelsOf(last[path]) !== "")
				? [[path, version]]
				: [],
		),
	);
}
