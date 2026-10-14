/**
 * The bank browser's tree, derived from the Model: pure and tested without React.
 * Bank files sit in the folder of their path; drafts, which have no path yet, under
 * "(unfiled)", last (named ones first). A folder is open when the user opened
 * it or whenever a filter is active. Opening a file opens its folder once, in
 * `update` (`openFolder`), so the user can still close it.
 */
import {
	absentRoot,
	DEFAULT_SELECT_ALL,
	type Evaluation,
	type Index,
	isRoot,
	labelOf,
	ROOT,
	type RootKind,
	SCHEME_KINDS,
	SCHEME_LABELS,
	type SchemeEvaluation,
	type SchemeKind,
	type Status,
	selectAllText,
	status,
	usedBy,
} from "@qretools/core";
import type {
	Entry,
	Id,
	Model,
	Question,
	SchemeEntry,
	WorkspaceEntry,
} from "./model.js";

/** What the tree is drawn from. Not the whole Model: a caret move must not redraw it. */
export type TreeInput = Pick<
	Model,
	"local" | "browser" | "screen" | "activity"
>;

import { claimOf, isUnsaved } from "./sync.js";
import { type InstrumentUses, instrumentsUsing } from "./usedBy.js";

export const UNFILED = "(unfiled)";

export interface Leaf {
	readonly id: Id;
	readonly name: string | undefined;
	readonly title: string | undefined;
	readonly status: Status;
	readonly unsaved: boolean;
	readonly draft: boolean;
	readonly failed: boolean;
	readonly busy: boolean;
}

export interface Folder {
	readonly name: string;
	readonly leaves: readonly Leaf[];
	readonly expanded: boolean;
}

export const folderOfQuestion = (q: Question): string =>
	// A saved question is where its path puts it; a draft is nowhere yet, whatever
	// its name (no convention of one bank, such as a topic prefix, is read into it).
	q.base !== undefined ? (q.base.path.split("/")[1] ?? UNFILED) : UNFILED;

/** The questions, by folder. A folder's key in `browser.expanded` is its name. */
export function treeOf(
	model: TreeInput,
	evaluate: (q: Question) => Evaluation,
): readonly Folder[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const byFolder = new Map<string, Leaf[]>();
	for (const q of Object.values(model.local.questions)) {
		const ev = evaluate(q);
		const leaf: Leaf = {
			...marks(model, q),
			name: ev.draft.name,
			title:
				ev.draft.title ??
				(ev.draft.concept === undefined
					? undefined
					: labelOf(ev.draft.concept)),
			status: status(ev.findings),
		};
		const folder = folderOfQuestion(q);
		if (
			filter !== "" &&
			!`${leaf.name ?? ""} ${leaf.title ?? ""}`.toLowerCase().includes(filter)
		)
			continue;
		byFolder.set(folder, [...(byFolder.get(folder) ?? []), leaf]);
	}
	const byName = (a: string, b: string) =>
		a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b);
	return [...byFolder.entries()]
		.sort(([a], [b]) => byName(a, b))
		.map(([name, leaves]) => ({
			name,
			// Named first, by name; an unnamed draft last ("~" sorted first by locale).
			leaves: [...leaves].sort((a, b) =>
				a.name === undefined
					? b.name === undefined
						? 0
						: 1
					: b.name === undefined
						? -1
						: a.name.localeCompare(b.name),
			),
			expanded: filter !== "" || model.browser.expanded.includes(name),
		}));
}

const marks = (model: TreeInput, e: Entry) => {
	const activity = model.activity[e.id];
	return {
		id: e.id,
		unsaved: isUnsaved(e),
		draft: e.base === undefined,
		failed: activity?.kind === "failed",
		busy: activity?.kind === "saving" || activity?.kind === "deleting",
	};
};

export interface SchemeLeaf extends Omit<Leaf, "name" | "title"> {
	readonly name: string;
	/** How many questions write this name, resolved or not. Absent for a Settings row, which nothing names. */
	readonly usedBy?: number;
}

export interface SchemeSection {
	readonly kind: SchemeKind;
	readonly label: string;
	/** The key in `browser.expanded`. */
	readonly key: string;
	readonly leaves: readonly SchemeLeaf[];
	readonly expanded: boolean;
}

/**
 * One section per kind of shared element, always shown (even empty) so the kinds are
 * discoverable; while filtering, only sections with a match. A section is open like a
 * folder: toggled by the user (or opened once with its file), or while filtering.
 */
/** A section's key in `browser.expanded`: no folder's name has a colon. */
const sectionKey = (kind: SchemeKind): string => `scheme:${kind}`;

/**
 * The key in `browser.expanded` of the folder or section holding the open file, if
 * one is open: what `update` opens when the open file or its folder changes.
 */
export function openFolder(model: TreeInput): string | undefined {
	if (model.screen.kind !== "editing") return undefined;
	const { id } = model.screen;
	const question = model.local.questions[id];
	if (question !== undefined) return folderOfQuestion(question);
	const scheme = model.local.schemes[id];
	return scheme === undefined || isRoot(scheme.kind)
		? undefined
		: sectionKey(scheme.kind);
}

export function schemeSections(
	model: TreeInput,
	evaluate: (e: SchemeEntry) => SchemeEvaluation,
	/** The bank's symbol table. */
	index: Index<Id>,
	/** The instruments here naming each bank file, by path: they use it too. */
	instruments: InstrumentUses = new Map(),
): readonly SchemeSection[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const entries = Object.values(model.local.schemes);
	return SHARED_KINDS.flatMap((kind) => {
		const mine = entries.filter((e) => e.kind === kind);
		const leaves = mine
			.filter((e) => filter === "" || e.name.toLowerCase().includes(filter))
			.map(
				(e): SchemeLeaf => ({
					...marks(model, e),
					name: e.name,
					status: status(evaluate(e).findings),
					...(!isRoot(e.kind) && {
						usedBy:
							usedBy(index, e.kind, e.name).length +
							instrumentsUsing(instruments, claimOf(e)).length,
					}),
				}),
			)
			.sort((a, b) => a.name.localeCompare(b.name));
		if (filter !== "" && leaves.length === 0) return [];
		const key = sectionKey(kind);
		return [
			{
				kind,
				label: SCHEME_LABELS[kind],
				key,
				leaves,
				expanded: filter !== "" || model.browser.expanded.includes(key),
			},
		];
	});
}

/**
 * The kinds the tree's Shared sections and the New menu list: those a question names.
 * A workspace's one-per-workspace files are its Settings (`settingsRows`).
 */
export const SHARED_KINDS: readonly SchemeKind[] = SCHEME_KINDS.filter(
	(k) => !isRoot(k),
);

/** The Settings section's rows, in order: the details first, the one to fill in. */
const SETTINGS: readonly RootKind[] = ["workspace", "missing", "select_all"];

/**
 * What applies while a workspace has no such file: a word beside its row (the label
 * mustn't lose to its value at the sidebar's width), and in full where it's heard.
 */
const ABSENT: Readonly<
	Record<RootKind, { shown: string; heard: string } | undefined>
> = {
	workspace: undefined, // its status says it: to fill in
	missing: { shown: "none", heard: "none" },
	select_all: {
		shown: "usual",
		heard: `usual coding: ${selectAllText(DEFAULT_SELECT_ALL)}`,
	},
};

export interface SettingsRow {
	readonly kind: RootKind;
	readonly label: string;
	/** The file's own marks, while the workspace has it. */
	readonly leaf?: SchemeLeaf;
	/** Absent: what applies without the file (`absentRoot`), and in words. */
	readonly status: Status;
	readonly absent?: { readonly shown: string; readonly heard: string };
}

/**
 * The workspace's own files, one row each, there or not, by file name: selecting one
 * opens it, or starts it. While filtering, only rows whose name matches.
 */
export function settingsRows(
	model: TreeInput,
	evaluate: (e: SchemeEntry) => SchemeEvaluation,
): readonly SettingsRow[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const entries = Object.values(model.local.schemes);
	return SETTINGS.flatMap((kind): SettingsRow[] => {
		const label = ROOT[kind];
		if (filter !== "" && !label.toLowerCase().includes(filter)) return [];
		const e = entries.find((x) => x.kind === kind);
		if (e === undefined) {
			const absent = ABSENT[kind];
			return [
				{
					kind,
					label,
					status: status(absentRoot(kind)),
					...(absent !== undefined && { absent }),
				},
			];
		}
		const s = status(evaluate(e).findings);
		return [
			{
				kind,
				label,
				leaf: { ...marks(model, e), name: label, status: s },
				status: s,
			},
		];
	});
}

/**
 * The workspace's instruments, flat, by name. Its details (`workspace.yaml`) are about
 * the whole workspace, so they're a Settings row (`settingsRows`), never in this list.
 */
export function workspaceLeaves(
	model: TreeInput,
	evaluate: (e: WorkspaceEntry) => Status,
): readonly SchemeLeaf[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const leaf = (e: WorkspaceEntry): SchemeLeaf => ({
		...marks(model, e),
		name: e.name,
		status: evaluate(e),
	});
	return Object.values(model.local.workspace)
		.map(leaf)
		.sort((a, b) => a.name.localeCompare(b.name))
		.filter((l) => filter === "" || l.name.toLowerCase().includes(filter));
}

/** The folders the bank has, for the save and move dialogs. Drafts do not count: they are not filed yet. */
export const bankFolders = (model: Pick<Model, "remote">): readonly string[] =>
	[
		...new Set(
			Object.keys(model.remote.questions).map((p) => p.split("/")[1] ?? ""),
		),
	]
		.filter((f) => f !== "")
		.sort();
