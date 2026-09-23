/**
 * The bank browser's tree, derived from the Model: pure and tested without React.
 * Bank files sit in the folder of their path (the bank has questions whose folder
 * is not their name prefix); named drafts in the folder their name implies;
 * unnamed drafts under "(unfiled)", last. A folder is open when the user opened
 * it, when it holds the open question, or whenever a filter is active.
 */
import { folderOf } from "../core/bank.js";
import type { Evaluation } from "../core/evaluate.js";
import { type Status, status } from "../core/findings.js";
import { isUnsaved } from "./merge.js";
import type { Id, Model, Question } from "./model.js";

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

export const folderOfQuestion = (
	q: Question,
	name: string | undefined,
): string =>
	q.origin.kind === "bank"
		? (q.origin.path.split("/")[1] ?? UNFILED)
		: name === undefined
			? UNFILED
			: folderOf(name);

export function treeOf(
	model: Model,
	evaluate: (q: Question) => Evaluation,
): readonly Folder[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const open = model.screen.kind === "editing" ? model.screen.id : undefined;
	const byFolder = new Map<string, Leaf[]>();
	const holds = new Set<string>();
	for (const q of Object.values(model.questions)) {
		const ev = evaluate(q);
		const leaf: Leaf = {
			id: q.id,
			name: ev.draft.name,
			title: ev.draft.title ?? ev.draft.concept,
			status: status(ev.findings),
			unsaved: isUnsaved(q),
			draft: q.origin.kind === "draft",
			failed: q.activity.kind === "failed",
			busy: q.activity.kind === "saving" || q.activity.kind === "deleting",
		};
		const folder = folderOfQuestion(q, leaf.name);
		if (q.id === open) holds.add(folder);
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
			leaves: [...leaves].sort((a, b) =>
				(a.name ?? "~").localeCompare(b.name ?? "~"),
			),
			expanded:
				filter !== "" ||
				holds.has(name) ||
				model.browser.expanded.includes(name),
		}));
}

/** The topic folders the bank has, for the save dialog. Drafts do not count: they are not filed yet. */
export const bankFolders = (model: Model): readonly string[] =>
	[
		...new Set(
			Object.values(model.questions).flatMap((q) =>
				q.origin.kind === "bank" ? [q.origin.path.split("/")[1] ?? ""] : [],
			),
		),
	]
		.filter((f) => f !== "")
		.sort();
