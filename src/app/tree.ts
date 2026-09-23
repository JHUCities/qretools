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
import {
	SCHEME_KINDS,
	type SchemeEvaluation,
	type SchemeKind,
} from "../core/schemes.js";
import { type Index, usedBy } from "../core/symbols.js";
import { isUnsaved } from "./merge.js";
import {
	type Entry,
	type Id,
	isScheme,
	type Model,
	type Question,
	type SchemeEntry,
} from "./model.js";

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
	for (const q of Object.values(model.files)) {
		if (q.kind !== "question") continue;
		const ev = evaluate(q);
		const leaf: Leaf = {
			...marks(q),
			name: ev.draft.name,
			title: ev.draft.title ?? ev.draft.concept,
			status: status(ev.findings),
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

const marks = (e: Entry) => ({
	id: e.id,
	unsaved: isUnsaved(e),
	draft: e.origin.kind === "draft",
	failed: e.activity.kind === "failed",
	busy: e.activity.kind === "saving" || e.activity.kind === "deleting",
});

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

export const SCHEME_LABELS: Readonly<Record<SchemeKind, string>> = {
	scale: "Scales",
	universe: "Universes",
	instruction: "Instructions",
	missing: "Missing values",
};

/**
 * One section per kind of shared element, always shown (even empty) so the kinds are
 * discoverable; while filtering, only sections with a match. A section is open like a
 * folder: toggled by the user, holding the open file, or while filtering.
 */
export function schemeSections(
	model: Model,
	evaluate: (e: SchemeEntry) => SchemeEvaluation,
	index: Index<Id>,
): readonly SchemeSection[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const open = model.screen.kind === "editing" ? model.screen.id : undefined;
	const entries = Object.values(model.files).filter(isScheme);
	return SCHEME_KINDS.flatMap((kind) => {
		const mine = entries.filter((e) => e.kind === kind);
		const leaves = mine
			.filter((e) => filter === "" || e.name.toLowerCase().includes(filter))
			.map(
				(e): SchemeLeaf => ({
					...marks(e),
					name: e.name,
					status: status(evaluate(e).findings),
					...(e.kind !== "missing" && {
						usedBy: usedBy(index, e.kind, e.name).length,
					}),
				}),
			)
			.sort((a, b) => a.name.localeCompare(b.name));
		if (filter !== "" && leaves.length === 0) return [];
		const key = `scheme:${kind}`;
		return [
			{
				kind,
				label: SCHEME_LABELS[kind],
				key,
				leaves,
				expanded:
					filter !== "" ||
					mine.some((e) => e.id === open) ||
					model.browser.expanded.includes(key),
			},
		];
	});
}

/** The topic folders the bank has, for the save dialog. Drafts do not count: they are not filed yet. */
export const bankFolders = (model: Model): readonly string[] =>
	[
		...new Set(
			Object.values(model.files).flatMap((q) =>
				q.kind === "question" && q.origin.kind === "bank"
					? [q.origin.path.split("/")[1] ?? ""]
					: [],
			),
		),
	]
		.filter((f) => f !== "")
		.sort();
