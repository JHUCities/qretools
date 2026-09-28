/**
 * The bank browser's tree, derived from the Model: pure and tested without React.
 * Bank files sit in the folder of their path; drafts, which have no path yet, under
 * "(unfiled)", last (named ones first). A folder is open when the user opened
 * it, when it holds the open question, or whenever a filter is active.
 */
import type { Evaluation } from "../core/evaluate.js";
import { type Status, status } from "../core/findings.js";
import {
	SCHEME_KINDS,
	type SchemeEvaluation,
	type SchemeKind,
} from "../core/schemes.js";
import { type Index, usedBy } from "../core/symbols.js";
import type { Entry, Id, Model, Question, SchemeEntry } from "./model.js";

/** What the tree is drawn from. Not the whole Model: a caret move must not redraw it. */
export type TreeInput = Pick<
	Model,
	"local" | "browser" | "screen" | "activity"
>;

import { isUnsaved } from "./sync.js";

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

export function treeOf(
	model: TreeInput,
	evaluate: (q: Question) => Evaluation,
): readonly Folder[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const open = model.screen.kind === "editing" ? model.screen.id : undefined;
	const byFolder = new Map<string, Leaf[]>();
	const holds = new Set<string>();
	for (const q of Object.values(model.local.questions)) {
		const ev = evaluate(q);
		const leaf: Leaf = {
			...marks(model, q),
			name: ev.draft.name,
			title: ev.draft.title ?? ev.draft.concept,
			status: status(ev.findings),
		};
		const folder = folderOfQuestion(q);
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
				filter !== "" ||
				holds.has(name) ||
				model.browser.expanded.includes(name),
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

/** One table for how each kind of shared element is named, singular and plural. */
export const SCHEME_SINGULAR: Readonly<Record<SchemeKind, string>> = {
	scale: "scale",
	universe: "universe",
	instruction: "instruction",
	missing: "missing values",
};

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
	model: TreeInput,
	evaluate: (e: SchemeEntry) => SchemeEvaluation,
	index: Index<Id>,
): readonly SchemeSection[] {
	const filter = model.browser.filter.trim().toLowerCase();
	const open = model.screen.kind === "editing" ? model.screen.id : undefined;
	const entries = Object.values(model.local.schemes);
	return SCHEME_KINDS.flatMap((kind) => {
		const mine = entries.filter((e) => e.kind === kind);
		const leaves = mine
			.filter((e) => filter === "" || e.name.toLowerCase().includes(filter))
			.map(
				(e): SchemeLeaf => ({
					...marks(model, e),
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

/** The folders the bank has, for the save dialog. Drafts do not count: they are not filed yet. */
export const bankFolders = (model: Model): readonly string[] =>
	[
		...new Set(
			Object.keys(model.remote.questions).map((p) => p.split("/")[1] ?? ""),
		),
	]
		.filter((f) => f !== "")
		.sort();
