/**
 * The bank browser's tree, derived from the Model: pure and tested without React.
 * Bank files sit in the folder of their path; drafts, which have no path yet, under
 * "(unfiled)", last (named ones first). A folder is open when the user opened
 * it or whenever a filter is active. Opening a file opens its folder once, in
 * `update` (`openFolder`), so the user can still close it.
 */
import {
	bankAt,
	type Evaluation,
	type Index,
	isRoot,
	labelOf,
	relIn,
	SCHEME_KINDS,
	SCHEME_LABELS,
	type SchemeEvaluation,
	type SchemeKind,
	type Status,
	status,
	usedBy,
	WORKSPACE_DETAILS,
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
	/** The key in `browser.expanded`: the name, within its bank (`folderKey`). */
	readonly key: string;
	readonly leaves: readonly Leaf[];
	readonly expanded: boolean;
}

export const folderOfQuestion = (q: Question): string =>
	// A saved question is where its path puts it; a draft is nowhere yet, whatever
	// its name (no convention of one bank, such as a topic prefix, is read into it).
	q.base !== undefined
		? (relIn(q.bank, q.base.path).split("/")[1] ?? UNFILED)
		: UNFILED;

/**
 * A folder's or section's key in `browser.expanded`, within its bank: a root bank's
 * keys are as they always were; another bank's carry its folder in front, so two banks'
 * `nhd` folders open and close apart.
 */
export const folderKey = (bank: string, key: string): string =>
	bank === "" ? key : `${bank}/${key}`;

/** The banks the tree shows: the workspace's, and any a working file names, in order. */
export const banksShown = (
	model: Pick<Model, "banks" | "local">,
): readonly string[] =>
	[
		...new Set([
			...model.banks,
			...Object.values(model.local.questions).map((q) => q.bank),
			...Object.values(model.local.schemes).map((e) => e.bank),
		]),
	].sort();

/** A bank's questions, by folder. */
export function treeOf(
	model: TreeInput,
	evaluate: (q: Question) => Evaluation,
	bank: string,
): readonly Folder[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const byFolder = new Map<string, Leaf[]>();
	for (const q of Object.values(model.local.questions)) {
		if (q.bank !== bank) continue;
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
			key: folderKey(bank, name),
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
			expanded:
				filter !== "" || model.browser.expanded.includes(folderKey(bank, name)),
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
	/** How many questions write this name, resolved or not. Absent for the missing list, which every variable uses. */
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
/** A section's key in `browser.expanded`, within its bank. */
const sectionKey = (bank: string, kind: SchemeKind): string =>
	folderKey(bank, `scheme:${kind}`);

/**
 * The key in `browser.expanded` of the folder or section holding the open file, if
 * one is open: what `update` opens when the open file or its folder changes.
 */
export function openFolder(model: TreeInput): string | undefined {
	if (model.screen.kind !== "editing") return undefined;
	const { id } = model.screen;
	const question = model.local.questions[id];
	if (question !== undefined)
		return folderKey(question.bank, folderOfQuestion(question));
	const scheme = model.local.schemes[id];
	return scheme === undefined
		? undefined
		: sectionKey(scheme.bank, scheme.kind);
}

export function schemeSections(
	model: TreeInput,
	evaluate: (e: SchemeEntry) => SchemeEvaluation,
	/** The bank's symbol table: a file is used by questions of its own bank only. */
	index: Index<Id>,
	bank: string,
	/** The instruments here naming each bank file, by path: they use it too. */
	instruments: InstrumentUses = new Map(),
): readonly SchemeSection[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const entries = Object.values(model.local.schemes).filter(
		(e) => e.bank === bank,
	);
	return SCHEME_KINDS.flatMap((kind) => {
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
		const key = sectionKey(bank, kind);
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
 * The workspace's instruments, flat, by name. Its details (`workspace.yaml`) are about
 * the whole workspace, so they open from beside its name, never from this list.
 */
export function workspaceLeaves(
	model: TreeInput,
	evaluate: (e: WorkspaceEntry) => Status,
): readonly SchemeLeaf[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const leaf = (e: WorkspaceEntry): SchemeLeaf => ({
		...marks(model, e),
		name: e.kind === "instrument" ? e.name : WORKSPACE_DETAILS,
		status: evaluate(e),
	});
	return Object.values(model.local.workspace)
		.filter((e) => e.kind === "instrument")
		.map(leaf)
		.sort((a, b) => a.name.localeCompare(b.name))
		.filter((l) => filter === "" || l.name.toLowerCase().includes(filter));
}

/**
 * What the button for the workspace's details says, now they're out of the tree: its
 * name, and what the tree's marks said (unsaved changes, something to fill in or fix,
 * advice), with whether that calls for its dot. `status` is the details' own, when
 * the workspace has them.
 */
export function detailsButton(
	model: TreeInput,
	status: Status | undefined,
): { readonly label: string; readonly attention: boolean } {
	const details = Object.values(model.local.workspace).find(
		(e) => e.kind === "workspaceFile",
	);
	const said = [
		...(details !== undefined && isUnsaved(details) ? ["unsaved changes"] : []),
		...(status?.kind === "incomplete" ? ["to fill in or fix"] : []),
		...(status?.kind === "advice" ? ["has advice"] : []),
	];
	return {
		label:
			said.length === 0
				? "Workspace details"
				: `Workspace details (${said.join("; ")})`,
		attention: said.length > 0,
	};
}

/** The folders a bank has, for the save and move dialogs. Drafts do not count: they are not filed yet. */
export const bankFolders = (model: Model, bank: string): readonly string[] =>
	[
		...new Set(
			Object.keys(model.remote.questions).flatMap((p) =>
				bankAt(p, model.banks) === bank
					? [relIn(bank, p).split("/")[1] ?? ""]
					: [],
			),
		),
	]
		.filter((f) => f !== "")
		.sort();
