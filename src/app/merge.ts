/**
 * Merging a freshly loaded bank into the questions already in the Model. Storage
 * policy, so it lives in the shell, but pure and tested:
 *
 * - same path, unmodified locally → take the bank's text and sha;
 * - same path, modified locally → keep the local text (a later save is refused as
 *   stale by GitHub, which is the honest outcome, and the user can reload);
 * - new path → a new entry, of the kind its path says (a path the tool does not
 *   read is ignored);
 * - gone from the bank, unmodified locally → dropped; modified → kept as a draft.
 */
import { kindAt } from "../core/schemes.js";
import type { Entry, Id } from "./model.js";
import type { File } from "./storage.js";

export const isUnsaved = (q: Entry): boolean =>
	q.origin.kind === "draft" || q.source !== q.origin.original;

export function mergeBank(
	entries: Readonly<Record<Id, Entry>>,
	files: readonly File[],
	nextId: Id,
): { files: Record<Id, Entry>; nextId: Id } {
	const byPath = new Map<string, File>(files.map((f) => [f.path, f]));
	const out: Record<Id, Entry> = {};
	const seen = new Set<string>();
	for (const q of Object.values(entries)) {
		if (q.origin.kind === "draft") {
			out[q.id] = q;
			continue;
		}
		const remote = byPath.get(q.origin.path);
		seen.add(q.origin.path);
		if (remote === undefined) {
			if (isUnsaved(q)) out[q.id] = { ...q, origin: { kind: "draft" } };
			continue;
		}
		out[q.id] = isUnsaved(q)
			? q
			: {
					...q,
					source: remote.text,
					origin: {
						kind: "bank",
						path: remote.path,
						sha: remote.sha,
						original: remote.text,
					},
				};
	}
	let id = nextId;
	for (const f of files) {
		const at = kindAt(f.path);
		if (seen.has(f.path) || at === undefined) continue;
		const state = {
			id,
			source: f.text,
			origin: {
				kind: "bank",
				path: f.path,
				sha: f.sha,
				original: f.text,
			} as const,
			activity: { kind: "idle" } as const,
		};
		out[id] =
			at.kind === "question"
				? { ...state, kind: "question" }
				: { ...state, kind: at.kind, name: at.name };
		id += 1;
	}
	return { files: out, nextId: id };
}
