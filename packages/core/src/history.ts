/**
 * Each file's DDI version, from the workspace's history: the computation `version.ts`
 * describes, given that history as values. The shell reads it from git (the CLI's
 * `build`); this module only counts.
 *
 * A file's version is how many times its content key has changed, oldest commit first.
 * A shared file's key is its own blob. A question's is its blob and the blobs of every
 * shared file it names, so a question's version moves when its scale (or universe, or
 * `missing.yaml`) does, as a reference carries the referenced item's version.
 */

import type { Version, Versions } from "./ddi/version.ts";
import { kindAt, ROOT, schemePath } from "./schemes.ts";
import { EMPTY_ENV } from "./surface/env.ts";
import { parseSurface } from "./surface/parse.ts";

/** One commit of the workspace: when it was made, and each file's blob, by workspace path. */
export interface Snapshot {
	/** ISO 8601: the commit's date, which becomes VersionDate. */
	readonly date: string;
	readonly blobs: Readonly<Record<string, string>>;
}

/**
 * The workspace's history, oldest first, and the text of every question blob in it
 * (shared files' text isn't needed: their key is their blob).
 */
export interface History {
	readonly snapshots: readonly Snapshot[];
	readonly texts: Readonly<Record<string, string>>;
}

/**
 * The shared files a question's text names. Every question also depends on both root
 * files: shortcut: `select_all.yaml` bumps questions that aren't select-all, and
 * `missing.yaml` those without a variable; over-counting a version is safe, and
 * telling them apart needs the env the question was read in.
 */
const dependencies = (text: string): readonly string[] => [
	...new Set([
		...parseSurface(text, EMPTY_ENV).mentions.map((m) =>
			schemePath(m.scheme, m.name),
		),
		ROOT.missing,
		ROOT.select_all,
	]),
];

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
	const state = new Map<string, { key: string; version: Version }>();
	for (const { date, blobs } of history.snapshots)
		for (const [path, blob] of Object.entries(blobs)) {
			const at = kindAt(path);
			if (at === undefined || at.kind === "workspace") continue;
			const key =
				at.kind === "question"
					? [blob, ...depsOf(blob).map((d) => `${d}=${blobs[d] ?? ""}`)].join(
							" ",
						)
					: blob;
			const was = state.get(path);
			if (was?.key === key) continue;
			const n = was === undefined ? 1 : Number(was.version.number) + 1;
			state.set(path, { key, version: { number: String(n), date, blob } });
		}
	const last = history.snapshots.at(-1)?.blobs ?? {};
	return Object.fromEntries(
		[...state].flatMap(([path, { version }]) =>
			path in last ? [[path, version]] : [],
		),
	);
}
