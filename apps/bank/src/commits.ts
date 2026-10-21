/**
 * Commit messages: what a save changed, in the surface language's own words. Pure;
 * the app's save flow writes them, so they live with the app, not the library.
 */

import type { Draft, SchemeKind } from "@qretools/core";
import { isRoot, SCHEME_NAME, shortCommit } from "@qretools/core";
import type { WorkspaceEntry } from "./model.js";

const FIELDS = [
	"name",
	"title",
	"text",
	"intent",
	"concept",
	"universe",
	"instruction",
	"source",
	"note",
	"legacy",
] as const;

/** The commit message: what changed, in the surface language's own words. */
export function describeChange(
	before: Draft | undefined,
	after: Draft | undefined,
): string {
	const name = after?.name ?? before?.name ?? "question";
	if (before === undefined && after === undefined) return `Update ${name}`;
	if (before === undefined) return `Add ${name}`;
	if (after === undefined) return `Delete ${name}`;
	const changed = changedFields(before, after);
	return changed.length === 0
		? `Update ${name}`
		: `Update ${name}: ${changed.join(", ")}`;
}

/**
 * A move's commit message: `Move nhd_sat to svy`, and the fields changed with it
 * (`… and update note`), since a move also saves (owner, 2026-09-29).
 */
export function describeMove(
	before: Draft,
	after: Draft,
	name: string,
	folder: string,
	/** The text differs at all: a comment, spacing or a legacy value changes no field. */
	textChanged: boolean,
): string {
	const changed = changedFields(before, after);
	return changed.length > 0
		? `Move ${name} to ${folder} and update ${changed.join(", ")}`
		: textChanged
			? `Move ${name} to ${folder} and update text`
			: `Move ${name} to ${folder}`;
}

/** The surface fields that differ, in the surface language's order; the domain by its kind. */
function changedFields(before: Draft, after: Draft): readonly string[] {
	const changed: string[] = FIELDS.filter(
		(k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
	);
	if (JSON.stringify(before.domain) !== JSON.stringify(after.domain)) {
		changed.push(after.domain?.kind ?? before.domain?.kind ?? "responses");
	}
	return changed;
}

/** A scheme file's commit message: `Add shared scale satisfied5`, `Update missing values`. */
export const describeSchemeChange = (
	kind: SchemeKind,
	name: string,
	op: "add" | "update" | "delete",
): string =>
	`${op === "add" ? "Add" : op === "update" ? "Update" : "Delete"} ${isRoot(kind) ? SCHEME_NAME[kind] : `${SCHEME_NAME[kind]} ${name}`}`;

/** An instrument's commit message: `Add instrument wave1`. */
export const describeWorkspaceChange = (
	e: WorkspaceEntry,
	op: "add" | "update" | "delete",
): string =>
	`${op === "add" ? "Add" : op === "update" ? "Update" : "Delete"} instrument ${e.name}`;

/**
 * The message for a commit of several files: the main file's line as the subject, the
 * others listed in the body, so the history reads by what the author meant to change.
 */
export const describeChangeSet = (
	subject: string,
	others: readonly string[],
	/** Tags this commit re-locks because they were moved: a bad smell, so said first and loudly. */
	moved: readonly TagMove[] = [],
): string => {
	const warnings = moved.map(
		(m) =>
			`[WARNING] The tag \`${m.key}\` was moved: it was locked at \`${shortCommit(m.from)}\` and names \`${shortCommit(m.to)}\` now. This commit locks it at the new commit, so its questions may have changed.`,
	);
	const head = moved.length === 0 ? subject : `[WARNING] ${subject}`;
	return [
		head,
		...(warnings.length === 0 ? [] : [warnings.join("\n")]),
		...(others.length === 0
			? []
			: [`With:\n${others.map((o) => `- ${o}`).join("\n")}`]),
	].join("\n\n");
};

/** A tag locked at one commit that names another now. */
export interface TagMove {
	readonly key: string;
	readonly from: string;
	readonly to: string;
}
