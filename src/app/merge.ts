/**
 * Merging a freshly loaded bank into the questions already in the Model. Storage
 * policy, so it lives in the shell, but pure and tested:
 *
 * - same path, unmodified locally → take the bank's text and sha;
 * - same path, modified locally → keep the local text (a later save is refused as
 *   stale by GitHub, which is the honest outcome, and the user can reload);
 * - new path → a new question;
 * - gone from the bank, unmodified locally → dropped; modified → kept as a draft.
 */
import type { Id, Question } from "./model.js";
import type { File } from "./storage.js";

export const isUnsaved = (q: Question): boolean =>
	q.origin.kind === "draft" || q.source !== q.origin.original;

export function mergeBank(
	questions: Readonly<Record<Id, Question>>,
	files: readonly File[],
	nextId: Id,
): { questions: Record<Id, Question>; nextId: Id } {
	const byPath = new Map<string, File>(files.map((f) => [f.path, f]));
	const out: Record<Id, Question> = {};
	const seen = new Set<string>();
	for (const q of Object.values(questions)) {
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
		if (seen.has(f.path)) continue;
		out[id] = {
			id,
			source: f.text,
			origin: { kind: "bank", path: f.path, sha: f.sha, original: f.text },
			activity: { kind: "idle" },
		};
		id += 1;
	}
	return { questions: out, nextId: id };
}
