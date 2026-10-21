/**
 * Locks: the commit each tag a workspace's instruments use named when it was locked,
 * written in `workspace.yaml` under `locked:`. A tag can be moved and a commit can't, so
 * a lock shows when a tag names another commit than it did. Saving or exporting an
 * instrument locks the tags it reads at the commits read, as a build writes its lockfile
 * (Cargo, npm): a tag that moved is a warning until then, and its new lock is a change
 * to `workspace.yaml` that review sees. Git's own guarantee, so it holds on any forge. Pure.
 */
import type { AddressKey } from "./address.ts";
import type { Finding } from "./findings.ts";
import type { RemoteBank } from "./workspace.ts";

/** A commit by the key of the tag that named it (`AddressKey`). */
export type Locks = Readonly<Record<AddressKey, string>>;

/** A commit as git names it: the full sha, SHA-1 or SHA-256. */
export const COMMIT_PATTERN = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** A commit as people read it, as git abbreviates one: enough to tell it apart. */
export const shortCommit = (sha: string): string => sha.slice(0, 12);

/** The commit a bank was read at, when it was read at a tag. */
const commitOf = (read: RemoteBank | undefined): string | undefined =>
	read?.kind === "files" ? read.at?.commit : undefined;

/**
 * What saving or exporting an instrument locks: each tag among `keys` (the ones it
 * reads) at the commit it was read at, where that isn't the lock already. A tag not
 * read at a tag yet locks nothing.
 */
export function locksFor(
	keys: readonly AddressKey[],
	reads: Readonly<Record<AddressKey, RemoteBank>>,
	locks: Locks,
): Locks {
	const out: Record<AddressKey, string> = {};
	for (const key of keys) {
		const commit = commitOf(reads[key]);
		if (commit !== undefined && locks[key] !== commit) out[key] = commit;
	}
	return out;
}

/**
 * A warning on each `uses` line whose tag names another commit than its lock: the tag
 * was moved, so its questions may have changed. By alias, each with the key it reads.
 */
export function movedTags(
	uses: Readonly<Record<string, AddressKey>>,
	reads: Readonly<Record<AddressKey, RemoteBank>>,
	locks: Locks,
): readonly Finding[] {
	return Object.entries(uses).flatMap(([alias, key]): Finding[] => {
		const locked = locks[key];
		const commit = commitOf(reads[key]);
		return locked === undefined || commit === undefined || locked === commit
			? []
			: [
					{
						code: "moved-tag",
						severity: "warning",
						path: `uses.${alias}`,
						message: `\`${key}\` names commit \`${shortCommit(commit)}\` now, but this workspace locked it at \`${shortCommit(locked)}\`: the tag was moved, so its questions may have changed.`,
						hint: "Saving or exporting the instrument locks it at the new commit, under `locked:` in `workspace.yaml`, for review to see.",
					},
				];
	});
}

/**
 * A warning on each `uses` line read at a tag no lock holds: the instrument reached the
 * workspace some way that didn't lock it (written by hand, never saved in the app or
 * exported), so a moved tag would go unnoticed. For `check`: the app locks on save, so
 * it doesn't say this of a `uses` line still being written.
 */
export function unlockedTags(
	uses: Readonly<Record<string, AddressKey>>,
	reads: Readonly<Record<AddressKey, RemoteBank>>,
	locks: Locks,
): readonly Finding[] {
	return Object.entries(uses).flatMap(([alias, key]): Finding[] =>
		locks[key] !== undefined || commitOf(reads[key]) === undefined
			? []
			: [
					{
						code: "unlocked-tag",
						severity: "warning",
						path: `uses.${alias}`,
						message: `\`${key}\` isn't locked to the commit it names, so if the tag were moved its questions would change unnoticed.`,
						hint: "Saving the instrument in QREtools, or `qretools instrument export`, locks it under `locked:` in `workspace.yaml`.",
					},
				],
	);
}
