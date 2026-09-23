/**
 * Working copies against GitHub. Storage policy, so it lives in the shell, but pure
 * and tested. Three versions per file, as in git: the working `source`, the `base`
 * it started from, and GitHub's copy in `remote`. Every status is derived from those
 * three; nothing about it is stored.
 */
import { kindAt, schemePath } from "../core/schemes.js";
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
	const claimed = new Set<Path>();
	const settle = <T extends Entry>(
		files: Readonly<Record<Id, T>>,
	): Readonly<Record<Id, T>> => {
		let changed = false;
		const out: Record<Id, T> = {};
		for (const f of Object.values(files)) {
			const path = claimOf(f);
			if (path !== undefined) claimed.add(path);
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
