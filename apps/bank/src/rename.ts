/**
 * Renaming a shared file (a concept, scale, unit, universe or instruction) and every
 * question and instrument here that names it: a rename refactoring, as an IDE's. One
 * plan says what a rename commits and what it rewrites in the working copies, so the
 * dialog's preview is exactly what the confirm does. Pure: values in, values out.
 *
 * A rename commits only the rename (owner, 2026-11-17): each saved file's GitHub copy
 * (its base) with the name rewritten, never its unsaved edits, which stay unsaved.
 */
import {
	EMPTY_ENV,
	err,
	instrumentAt,
	isRoot,
	kindAt,
	NAME_PATTERN,
	NAME_RULE_TEXT,
	type NamedScheme,
	ok,
	parseSurface,
	type Result,
	SCHEME_NAME,
	schemePath,
} from "@qretools/core";
import { applyEdits, renameEdits } from "@qretools/core/editor";
import type { Change } from "@qretools/shell";
import { createEvaluations, type Evaluations } from "./evaluations.js";
import type {
	Id,
	Model,
	Question,
	Renamed,
	SchemeEntry,
	WorkspaceEntry,
} from "./model.js";
import { blockedReason, claimOf, remoteBlob, syncOf } from "./sync.js";

/**
 * Why `name` can't name a shared file of `kind`: the name rule, or another of the kind
 * with that name. A file being renamed (`self`) does not stand in its own way.
 */
export function schemeNameProblem(
	model: Model,
	kind: NamedScheme,
	name: string,
	self?: Id,
): string | undefined {
	if (name === "") return "Give it a name.";
	if (!NAME_PATTERN.test(name)) return NAME_RULE_TEXT;
	const others = Object.values(model.local.schemes).filter(
		(e) => e.kind === kind && e.id !== self,
	);
	if (others.some((e) => e.name === name))
		return `A ${SCHEME_NAME[kind]} named \`${name}\` already exists.`;
	// Reserved while another is being renamed to it: on success it will have that name.
	const a = (e: SchemeEntry) => model.activity[e.id];
	return others.some((e) => {
		const busy = a(e);
		return busy?.kind === "saving" && busy.renaming === name;
	})
		? `A ${SCHEME_NAME[kind]} is being renamed to \`${name}\`.`
		: undefined;
}

/** What a rename does: the commit, the working copies' new texts, and the questions it fills. */
export interface RenamePlan {
	/** Empty for a draft shared file: nothing on GitHub has its name yet. */
	readonly changes: readonly Change[];
	/** Each working copy that names the file, with its text once renamed (drafts too). */
	readonly local: readonly (readonly [Id, string])[];
	/** Questions here that already name the new name: the rename makes them use this file. */
	readonly fills: readonly Id[];
}

/**
 * The plan for renaming shared file `id` to `to`, or why it can't be. Whether the session
 * may write at all is the session's to say (`blockage`), not the rename's.
 */
export function renamePlan(
	model: Model,
	id: Id,
	to: string,
	/** The view's kept evaluations, so the dialog's preview reads each instrument once. */
	evaluations: Evaluations = createEvaluations(),
): Result<RenamePlan, string> {
	const e = model.local.schemes[id];
	if (e === undefined || isRoot(e.kind))
		return err("There's nothing to rename.");
	if (to === e.name) return err("That's its name already.");
	const kind: NamedScheme = e.kind;
	const named = schemeNameProblem(model, kind, to, e.id);
	if (named !== undefined) return err(named);
	if (model.remote.schemes[schemePath(kind, to)] !== undefined)
		return err(`A ${SCHEME_NAME[kind]} named \`${to}\` is already on GitHub.`);
	const stuck = (f: SchemeEntry | Question | WorkspaceEntry) => {
		const sync = syncOf(f, remoteBlob(model.remote, f));
		return sync === "conflict" || sync === "deletedOnGitHub";
	};
	if (e.base !== undefined && stuck(e))
		return err(blockedReason(model.remote, e).message);

	const local = renameLocal(model, e, to, evaluations);
	const changes: Change[] = [];
	if (e.base !== undefined) {
		changes.push(
			{
				id: e.id,
				path: schemePath(kind, to),
				expected: null,
				text: e.base.text,
			},
			// The old path goes in the same commit, as a move's does.
			{ path: e.base.path, expected: e.base.sha, text: null },
		);
		for (const q of Object.values(model.local.questions)) {
			if (q.base === undefined) continue;
			const text = renamedText(q.base.text, kind, e.name, to);
			if (text === undefined) continue;
			if (stuck(q)) return err(blockedReason(model.remote, q).message);
			changes.push({ id: q.id, path: q.base.path, expected: q.base.sha, text });
		}
		// Read through the kept evaluations, keyed by id and text: an instrument with unsaved
		// edits is read again when its pane next asks (a fresh cache instead would rebuild the
		// bank's scope on every keystroke in the dialog, measured at ~150 ms).
		const saved = Object.values(model.local.workspace).flatMap((i) =>
			i.kind === "instrument" && i.base !== undefined
				? [{ ...i, source: i.base.text }]
				: [],
		);
		for (const [iid, text] of instrumentRenames(
			model,
			e,
			to,
			saved,
			evaluations,
		)) {
			const i = model.local.workspace[iid];
			if (i?.base === undefined) continue;
			if (stuck(i)) return err(blockedReason(model.remote, i).message);
			changes.push({ id: iid, path: i.base.path, expected: i.base.sha, text });
		}
	}
	const fills = Object.values(model.local.questions)
		.filter(
			(q) =>
				// Parsed only where the name appears at all: the dialog asks on every keystroke.
				q.source.includes(to) &&
				parseSurface(q.source, EMPTY_ENV).mentions.some(
					(m) => m.scheme === kind && m.name === to,
				),
		)
		.map((q) => q.id);
	return ok({ changes, local, fills });
}

/**
 * The working copies' texts once shared file `e` is named `to`: every question that names
 * it (drafts too) and every instrument here that reads it. Computed while the old name
 * still resolves and the file still claims its old path, which instruments are matched by.
 */
export function renameLocal(
	model: Model,
	e: SchemeEntry,
	to: string,
	evaluations: Evaluations = createEvaluations(),
): readonly (readonly [Id, string])[] {
	const kind = e.kind;
	if (isRoot(kind)) return [];
	const questions = Object.values(model.local.questions).flatMap((q) => {
		const text = renamedText(q.source, kind, e.name, to);
		return text === undefined ? [] : [[q.id, text] as const];
	});
	const instruments = Object.values(model.local.workspace).filter(
		(i) => i.kind === "instrument",
	);
	return [
		...questions,
		...instrumentRenames(model, e, to, instruments, evaluations),
	];
}

/** A question's text with every mention of `from` (of `kind`) naming `to`, or undefined if none. */
function renamedText(
	source: string,
	kind: NamedScheme,
	from: string,
	to: string,
): string | undefined {
	const edits = renameEdits(source, kind, from, to);
	const text = edits.length === 0 ? undefined : applyEdits(source, edits);
	return text === source ? undefined : text;
}

/**
 * Each of `instruments` that names the shared file `e`, with its text once every name of
 * it reads `<alias>.<to>`: a universe on a step, a scale an input is on. Read while the
 * old name still resolves. An instrument read at its base text resolves its `uses`
 * through the working workspace details; if those have unsaved changes to `uses`, it is
 * read against them (rare; accepted).
 */
function instrumentRenames(
	model: Model,
	e: SchemeEntry,
	to: string,
	instruments: readonly WorkspaceEntry[],
	evaluations: Evaluations,
): readonly (readonly [Id, string])[] {
	return instrumentHits(model, e, instruments, evaluations).map(([i, hits]) => {
		// From the end, so each range still points where it did.
		const text = [...hits]
			.sort((a, b) => b.range[0] - a.range[0])
			.reduce(
				(src, r) =>
					`${src.slice(0, r.range[0])}${r.alias}.${to}${src.slice(r.range[1])}`,
				i.source,
			);
		return [i.id, text] as const;
	});
}

/** Each of `instruments` that names the shared file `e`, with where it names it. */
function instrumentHits(
	model: Model,
	e: SchemeEntry,
	instruments: readonly WorkspaceEntry[],
	evaluations: Evaluations,
): readonly (readonly [
	WorkspaceEntry,
	readonly {
		readonly alias: string;
		readonly range: readonly [number, number];
	}[],
])[] {
	const path = claimOf(e);
	return instruments.flatMap((i) => {
		if (i.kind !== "instrument") return [];
		const read = evaluations.instrument(model, i);
		const hits = read.instrument.refs.flatMap((r) =>
			r.kind === "bank" &&
			read.uses[r.alias]?.kind === "local" &&
			r.path === path
				? [{ alias: r.alias, range: r.range }]
				: [],
		);
		return hits.length === 0 ? [] : [[i, hits] as const];
	});
}

/**
 * What a rename of shared file `id` changes, whatever the new name: the questions and
 * instruments that name it here or on GitHub. The dialog shows it from the moment it
 * opens, before a new name is typed.
 */
export function renameScope(
	model: Model,
	id: Id,
	evaluations: Evaluations = createEvaluations(),
): { readonly questions: readonly Id[]; readonly instruments: readonly Id[] } {
	const e = model.local.schemes[id];
	if (e === undefined) return { questions: [], instruments: [] };
	const kind = e.kind;
	if (isRoot(kind)) return { questions: [], instruments: [] };
	// Whether a text names it: renaming it to itself finds every place it is named.
	const names = (text: string | undefined) =>
		text !== undefined && renameEdits(text, kind, e.name, e.name).length > 0;
	const questions = Object.values(model.local.questions)
		.filter((q) => names(q.source) || names(q.base?.text))
		.map((q) => q.id);
	const all = Object.values(model.local.workspace);
	const saved = all.flatMap((i) =>
		i.base === undefined ? [] : [{ ...i, source: i.base.text }],
	);
	const instruments = [
		...new Set(
			[
				...instrumentHits(model, e, all, evaluations),
				...instrumentHits(model, e, saved, evaluations),
			].map(([i]) => i.id),
		),
	];
	return { questions, instruments };
}

/**
 * Why the last rename can't be undone exactly now, or undefined when it can: every file
 * it changed is still what it committed (so the reverse commit restores exactly what was
 * there), and the old name is still free. Otherwise renaming back is the way.
 */
export function undoProblem(model: Model): string | undefined {
	const r = model.browser.renamed;
	if (r === undefined) return "There's no rename to undo.";
	const e = model.local.schemes[r.id];
	if (e === undefined || e.name !== r.to || isRoot(e.kind))
		return "It was renamed or deleted since.";
	const taken = schemeNameProblem(model, e.kind, r.from, e.id);
	if (taken !== undefined) return taken;
	const changed = r.reverse.some((c) => {
		// The file at its new path: its base must still be what the rename committed.
		if (c.text === null)
			return e.base?.path !== c.path || e.base.sha !== c.expected;
		if (c.id === undefined) return false;
		const f =
			model.local.questions[c.id] ??
			model.local.workspace[c.id] ??
			model.local.schemes[c.id];
		if (f === undefined) return true;
		// Changed both here and on GitHub, or deleted there: GitHub would refuse it again.
		const sync = syncOf(f, remoteBlob(model.remote, f));
		if (sync === "conflict" || sync === "deletedOnGitHub") return true;
		// At the path the rename committed it to, too: a file moved since (the same text,
		// so the same sha) is no longer where the reverse commit would write.
		return (
			c.id !== e.id && (f.base?.sha !== c.expected || f.base.path !== c.path)
		);
	});
	return changed ? "Something it changed was changed again since." : undefined;
}

/**
 * The reverse of a rename that landed, from the model as GitHub's answer arrives (before
 * any base moves) and the shas it committed: for the undo.
 */
export function renamedFrom(
	model: Model,
	e: SchemeEntry,
	to: string,
	changes: readonly Change[],
	shas: Readonly<Record<string, string>>,
	local: readonly (readonly [Id, string])[],
	startedIn?: Id,
): Renamed | undefined {
	if (e.base === undefined) return undefined;
	const oldPath = e.base.path;
	const reverse = changes.flatMap((c): Change[] => {
		if (c.text === null) return [];
		const sha = shas[c.path];
		if (sha === undefined) return [];
		if (c.id === e.id)
			return [
				{ id: e.id, path: oldPath, expected: null, text: c.text },
				{ path: c.path, expected: sha, text: null },
			];
		const f =
			c.id === undefined
				? undefined
				: (model.local.questions[c.id] ?? model.local.workspace[c.id]);
		return f?.base === undefined
			? []
			: [{ id: f.id, path: c.path, expected: sha, text: f.base.text }];
	});
	// A file the rename saved whose working copy then differs from what it saved: its
	// own edits stayed unsaved. Recorded now, as a fact of this rename.
	const committed = new Map(changes.map((c) => [c.id, c.text]));
	const othersUnsaved = local.some(
		([id, after]) =>
			id !== e.id && committed.has(id) && committed.get(id) !== after,
	);
	return {
		id: e.id,
		...(startedIn !== undefined && { startedIn }),
		from: e.name,
		to,
		reverse,
		othersUnsaved,
		local: local.flatMap(([id, after]) => {
			const before =
				model.local.questions[id]?.source ?? model.local.workspace[id]?.source;
			return before === undefined ? [] : [[id, { before, after }] as const];
		}),
	};
}

/**
 * Whether file `id` offers the last rename's undo: the renamed file, and the file the
 * author started it from (F2 in a question). Not every file it rewrote.
 */
export const showsRenameNotice = (
	renamed: Renamed | undefined,
	id: Id,
): boolean =>
	renamed !== undefined && (renamed.id === id || renamed.startedIn === id);

/**
 * What the last rename saved besides the shared file, from its own reverse change set
 * (by path, so a file deleted since still counts): "3 questions and 1 instrument were
 * updated and saved.", and, when any of them had edits of its own as the rename landed
 * (`othersUnsaved`, recorded then, so the notice never changes as the author types),
 * that those are still unsaved. Undefined when it changed nothing else.
 */
export function renameSaved(renamed: Renamed): string | undefined {
	const paths = renamed.reverse.flatMap((c) =>
		c.id === undefined || c.id === renamed.id ? [] : [c.path],
	);
	const questions = paths.filter((p) => kindAt(p)?.kind === "question").length;
	const instruments = paths.filter((p) => instrumentAt(p) !== undefined).length;
	const total = questions + instruments;
	if (total === 0) return undefined;
	const counted = (n: number, one: string) =>
		`${n} ${one}${n === 1 ? "" : "s"}`;
	const what = [
		...(questions === 0 ? [] : [counted(questions, "question")]),
		...(instruments === 0 ? [] : [counted(instruments, "instrument")]),
	].join(" and ");
	const saved = `${what} ${total === 1 ? "was" : "were"} updated and saved.`;
	return renamed.othersUnsaved
		? `${saved} ${total === 1 ? "Its" : "Their"} other changes are still unsaved.`
		: saved;
}
