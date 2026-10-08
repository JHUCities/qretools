/**
 * Working copies against GitHub. Storage policy, so it lives in the shell, but pure
 * and tested. Three versions per file, as in git: the working `source`, the `base`
 * it started from, and GitHub's copy in `remote`. Every status is derived from those
 * three; nothing about it is stored.
 */
import {
	fileAt,
	type Index,
	inBank,
	instrumentPath,
	isRoot,
	type Mention,
	placeOf,
	schemePath,
	usedBy,
	WORKSPACE,
} from "@qretools/core";
import type { File } from "@qretools/shell";
import type {
	Blob,
	Entry,
	Id,
	Local,
	Path,
	Question,
	Remote,
	SchemeEntry,
	WorkspaceEntry,
} from "./model.js";

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

/**
 * The path a file lives at, or will: its base, or the one its kind and name give (a
 * shared file in its bank, an instrument in `instruments/`, the workspace's own file).
 * A question's is chosen when it is first saved.
 */
export function claimOf(f: Entry): Path | undefined {
	if (f.base !== undefined) return f.base.path;
	switch (f.kind) {
		case "question":
			return undefined;
		case "instrument":
			return instrumentPath(f.name);
		case "workspaceFile":
			return WORKSPACE.file;
		default:
			return inBank(f.bank, schemePath(f.kind, f.name));
	}
}

/** The slice of `local` and `remote` a working file is in. */
export const sliceFor = (f: Entry): keyof Remote =>
	f.kind === "question"
		? "questions"
		: f.kind === "instrument" || f.kind === "workspaceFile"
			? "workspace"
			: "schemes";

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

/**
 * Which remote slice a workspace path belongs to, among the workspace's `banks`;
 * undefined for a file the workspace does not read (`fileAt`).
 */
export function sliceOf(
	path: Path,
	banks: readonly string[],
): keyof Remote | undefined {
	const place = fileAt(path, banks);
	return place === undefined
		? undefined
		: place.kind !== "bank"
			? "workspace"
			: place.at.kind === "question"
				? "questions"
				: "schemes";
}

export const remoteBlob = (remote: Remote, f: Entry): Blob | undefined => {
	const path = claimOf(f);
	return path === undefined ? undefined : remote[sliceFor(f)][path];
};

/**
 * GitHub's state after a full load. A slice whose shas all match keeps its old
 * reference, so a reload that brings nothing new does not rebuild the environment.
 */
export function remoteOf(
	previous: Remote,
	files: readonly File[],
	banks: readonly string[],
): Remote {
	const next: Record<keyof Remote, Record<Path, Blob>> = {
		questions: {},
		schemes: {},
		workspace: {},
	};
	for (const f of files) {
		const slice = sliceOf(f.path, banks);
		if (slice !== undefined) next[slice][f.path] = { sha: f.sha, text: f.text };
	}
	return {
		questions: sameShas(previous.questions, next.questions)
			? previous.questions
			: next.questions,
		schemes: sameShas(previous.schemes, next.schemes)
			? previous.schemes
			: next.schemes,
		workspace: sameShas(previous.workspace, next.workspace)
			? previous.workspace
			: next.workspace,
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
	banks: readonly string[],
): { local: Local; nextId: Id } {
	// Every path a working file holds or will hold, computed first as a value. A file
	// dropped below as a clean deletion still counts; its path is not on GitHub anyway.
	const claimed = new Set(
		[
			...Object.values(local.questions),
			...Object.values(local.schemes),
			...Object.values(local.workspace),
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
	let workspace = settle(local.workspace);
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
		(path, blob, fid): Question | undefined => {
			const place = placeOf(path, banks);
			return place === undefined
				? undefined
				: {
						kind: "question",
						id: fid,
						bank: place.bank,
						source: blob.text,
						base: { path, ...blob },
					};
		},
		remote.questions,
	);
	schemes = added(
		schemes,
		(path, blob, fid): SchemeEntry | undefined => {
			const place = placeOf(path, banks);
			return place === undefined || place.at.kind === "question"
				? undefined
				: {
						kind: place.at.kind,
						name: place.at.name,
						id: fid,
						bank: place.bank,
						source: blob.text,
						base: { path, ...blob },
					};
		},
		remote.schemes,
	);
	workspace = added(
		workspace,
		(path, blob, fid): WorkspaceEntry | undefined => {
			const place = fileAt(path, banks);
			const base = { path, ...blob };
			return place?.kind === "instrument"
				? {
						kind: "instrument",
						name: place.name,
						id: fid,
						source: blob.text,
						base,
					}
				: place?.kind === "workspaceFile"
					? { kind: "workspaceFile", id: fid, source: blob.text, base }
					: undefined;
		},
		remote.workspace,
	);
	return {
		local:
			questions === local.questions &&
			schemes === local.schemes &&
			workspace === local.workspace
				? local
				: { questions, schemes, workspace },
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
	/** The question's bank: the only one whose names it reads. */
	bank: string,
): { include: readonly SchemeEntry[]; blocked: readonly SchemeEntry[] } {
	const named = new Set<SchemeEntry>();
	for (const m of mentions)
		for (const e of Object.values(local.schemes))
			if (e.bank === bank && e.kind === m.scheme && e.name === m.name)
				named.add(e);
	const include: SchemeEntry[] = [];
	const blocked: SchemeEntry[] = [];
	for (const e of named) {
		const sync = syncOf(e, remoteBlob(remote, e));
		if (sync === "draft" || sync === "unsaved") include.push(e);
		else if (sync === "conflict" || sync === "deletedOnGitHub") blocked.push(e);
	}
	return { include, blocked };
}

/** The questions naming a scheme file, for `alsoSaves` (nothing names a root file). */
export const usersIn =
	(index: Index<Id>) =>
	(e: SchemeEntry): readonly Id[] =>
		isRoot(e.kind)
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
	bank: string,
): readonly string[] {
	return dependencies(local, remote, mentions, bank).include.map((e) => {
		const saved = usersOf(e).filter((id) => {
			const q = local.questions[id];
			return q !== undefined && syncOf(q, remoteBlob(remote, q)) === "inSync";
		}).length;
		return saved === 0
			? `${e.kind} ${e.name}`
			: `${e.kind} ${e.name} (changes ${saved} saved question${saved === 1 ? "" : "s"})`;
	});
}
