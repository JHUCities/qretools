/**
 * Working copies against GitHub. Storage policy, so it lives in the shell, but pure
 * and tested. Three versions per file, as in git: the working `source`, the `base`
 * it started from, and GitHub's copy in `remote`. Every status is derived from those
 * three; nothing about it is stored.
 */
import { kindAt, schemePath } from "../core/schemes.js";
import type { Mention } from "../core/surface/env.js";
import { type Index, usedBy } from "../core/symbols.js";
import type {
	Blob,
	Entry,
	Id,
	Local,
	Path,
	Question,
	Remote,
	SchemeEntry,
} from "./model.js";
import type { File } from "./storage.js";

export type Sync =
	/** Never saved, and nothing on GitHub where it would go. */
	| "draft"
	| "inSync"
	/** Changed here; GitHub has not moved. */
	| "unsaved"
	/** GitHub moved and this copy did not: taken silently, never resting in the Model. */
	| "behind"
	/** Both moved, or both added the same path. */
	| "conflict"
	/** Gone from GitHub while this copy has it. */
	| "deletedOnGitHub";

/** The path a file lives at, or will: its base, or for a scheme file the one its kind and name give. */
export const claimOf = (f: Entry): Path | undefined =>
	f.base?.path ??
	(f.kind === "question" ? undefined : schemePath(f.kind, f.name));

export const isUnsaved = (f: Entry): boolean =>
	f.base === undefined || f.source !== f.base.text;

/** `remote` is GitHub's copy at `claimOf(file)`, if any. */
export function syncOf(
	file: Pick<Entry, "source" | "base">,
	remote: Blob | undefined,
): Sync {
	const { base, source } = file;
	if (base === undefined) return remote === undefined ? "draft" : "conflict";
	if (remote === undefined) return "deletedOnGitHub";
	if (remote.sha === base.sha)
		return source === base.text ? "inSync" : "unsaved";
	return source === base.text || source === remote.text ? "behind" : "conflict";
}

/** Which remote slice a path belongs to; undefined for a file the tool does not read. */
export function sliceOf(path: Path): keyof Remote | undefined {
	const at = kindAt(path);
	return at === undefined
		? undefined
		: at.kind === "question"
			? "questions"
			: "schemes";
}

export const remoteBlob = (remote: Remote, f: Entry): Blob | undefined => {
	const path = claimOf(f);
	return path === undefined
		? undefined
		: remote[f.kind === "question" ? "questions" : "schemes"][path];
};

/**
 * GitHub's state after a full load. A slice whose shas all match keeps its old
 * reference, so a reload that brings nothing new does not rebuild the environment.
 */
export function remoteOf(previous: Remote, files: readonly File[]): Remote {
	const next: { questions: Record<Path, Blob>; schemes: Record<Path, Blob> } = {
		questions: {},
		schemes: {},
	};
	for (const f of files) {
		const slice = sliceOf(f.path);
		if (slice !== undefined) next[slice][f.path] = { sha: f.sha, text: f.text };
	}
	return {
		questions: sameShas(previous.questions, next.questions)
			? previous.questions
			: next.questions,
		schemes: sameShas(previous.schemes, next.schemes)
			? previous.schemes
			: next.schemes,
	};
}

function sameShas(
	a: Readonly<Record<Path, Blob>>,
	b: Readonly<Record<Path, Blob>>,
): boolean {
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every((k) => a[k]?.sha === b[k]?.sha)
	);
}

/**
 * Bring the working copies in line with GitHub, taking nothing of the author's:
 * - behind (GitHub moved, this copy did not) → fast-forward to GitHub's copy;
 * - unmodified and deleted on GitHub → dropped;
 * - modified, or in conflict → kept with its base, for the author to resolve;
 * - a path on GitHub no working file claims → a new working file.
 * A slice with no change keeps its reference.
 */
export function rebase(
	local: Local,
	remote: Remote,
	nextId: Id,
): { local: Local; nextId: Id } {
	// Every path a working file holds or will hold, computed first as a value. A file
	// dropped below as a clean deletion still counts; its path is not on GitHub anyway.
	const claimed = new Set(
		[
			...Object.values(local.questions),
			...Object.values(local.schemes),
		].flatMap((f) => claimOf(f) ?? []),
	);
	/** Settle each file against GitHub; a slice with no change keeps its reference. */
	const settle = <T extends Entry>(
		files: Readonly<Record<Id, T>>,
	): Readonly<Record<Id, T>> => {
		let changed = false;
		const out: Record<Id, T> = {};
		for (const f of Object.values(files)) {
			const blob = remoteBlob(remote, f);
			const sync = syncOf(f, blob);
			if (sync === "behind" && blob && f.base) {
				out[f.id] = {
					...f,
					source: blob.text,
					base: { path: f.base.path, ...blob },
				};
				changed = true;
			} else if (sync === "deletedOnGitHub" && !isUnsaved(f)) {
				changed = true;
			} else out[f.id] = f;
		}
		return changed ? out : files;
	};
	let questions = settle(local.questions);
	let schemes = settle(local.schemes);
	let id = nextId;
	const added = <T extends Entry>(
		slice: Readonly<Record<Id, T>>,
		make: (path: Path, blob: Blob, id: Id) => T | undefined,
		blobs: Readonly<Record<Path, Blob>>,
	): Readonly<Record<Id, T>> => {
		let out: Record<Id, T> | undefined;
		for (const [path, blob] of Object.entries(blobs)) {
			if (claimed.has(path)) continue;
			const f = make(path, blob, id);
			if (f === undefined) continue;
			out ??= { ...slice };
			out[id] = f;
			id += 1;
		}
		return out ?? slice;
	};
	questions = added(
		questions,
		(path, blob, fid): Question => ({
			kind: "question",
			id: fid,
			source: blob.text,
			base: { path, ...blob },
		}),
		remote.questions,
	);
	schemes = added(
		schemes,
		(path, blob, fid): SchemeEntry | undefined => {
			const at = kindAt(path);
			return at === undefined || at.kind === "question"
				? undefined
				: {
						kind: at.kind,
						name: at.name,
						id: fid,
						source: blob.text,
						base: { path, ...blob },
					};
		},
		remote.schemes,
	);
	return {
		local:
			questions === local.questions && schemes === local.schemes
				? local
				: { questions, schemes },
		nextId: id,
	};
}

/**
 * The scheme files a question names that are not in sync with the author's branch.
 * Saving the question includes the unsaved ones (`include`: drafts and local edits), so
 * the question never lands on the branch reading differently from how it reads here;
 * one that GitHub also changed (`blocked`) stops the save until it is reloaded.
 */
export function dependencies(
	local: Local,
	remote: Remote,
	mentions: readonly Mention[],
): { include: readonly SchemeEntry[]; blocked: readonly SchemeEntry[] } {
	const named = new Set<SchemeEntry>();
	for (const m of mentions)
		for (const e of Object.values(local.schemes))
			if (e.kind === m.scheme && e.name === m.name) named.add(e);
	const include: SchemeEntry[] = [];
	const blocked: SchemeEntry[] = [];
	for (const e of named) {
		const sync = syncOf(e, remoteBlob(remote, e));
		if (sync === "draft" || sync === "unsaved") include.push(e);
		else if (sync === "conflict" || sync === "deletedOnGitHub") blocked.push(e);
	}
	return { include, blocked };
}

/** The questions naming a scheme file, for `alsoSaves` (nothing names the missing list). */
export const usersIn =
	(index: Index<Id>) =>
	(e: SchemeEntry): readonly Id[] =>
		e.kind === "missing"
			? []
			: // Once per question, however many times it names the file.
				[...new Set(usedBy(index, e.kind, e.name).map((s) => s.key))];

/**
 * What saving a question also saves, as the author should see it: each unsaved scheme
 * file it names, and how many questions already on the branch read differently once
 * that file is saved there. `usersOf` gives the ids of questions naming a file.
 */
export function alsoSaves(
	local: Local,
	remote: Remote,
	mentions: readonly Mention[],
	usersOf: (e: SchemeEntry) => readonly Id[],
): readonly string[] {
	return dependencies(local, remote, mentions).include.map((e) => {
		const saved = usersOf(e).filter((id) => {
			const q = local.questions[id];
			return q !== undefined && syncOf(q, remoteBlob(remote, q)) === "inSync";
		}).length;
		return saved === 0
			? `${e.kind} ${e.name}`
			: `${e.kind} ${e.name} (changes ${saved} saved question${saved === 1 ? "" : "s"})`;
	});
}
