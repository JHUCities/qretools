/**
 * Bank policy: where a question lives in the repository, and how a change to it
 * is described. Pure; the shell only carries the results to GitHub.
 */

import { FOLDER_RULE_TEXT, NAME_RULE_TEXT, SCHEME_NAME } from "./copy.js";
import type { Finding } from "./findings.js";
import { err, ok, type Result } from "./result.js";
import type { SchemeKind } from "./schemes.js";
import type { Draft } from "./surface/draft.js";
import { NAME_PATTERN } from "./surface/schema.js";

/** Folders are directory names, not variable names: hyphens are allowed. */
export const FOLDER_PATTERN = /^[a-z][a-z0-9_-]*$/;

export interface BankLocation {
	readonly folder: string;
	readonly name: string;
	readonly path: string;
}

/**
 * A draft can be saved once it has a valid name; findings never block saving. The
 * name says nothing about where the question goes: no convention of any one bank
 * (such as a topic prefix) is read into it.
 */
export function saveableName(draft: Draft): Result<string, Finding> {
	const name = draft.name;
	if (name === undefined || !NAME_PATTERN.test(name))
		return err({
			code: "hole",
			severity: "hole",
			path: "name",
			message: "A question needs a valid `name` before it can be saved.",
			hint: NAME_RULE_TEXT,
		});
	return ok(name);
}

/**
 * Where a question belongs in the bank: the folder is the author's to choose, never
 * derived from the name. Git creates any missing path, so a folder that does not
 * exist yet is a new one, and that should be a deliberate act.
 */
export function bankLocation(
	draft: Draft,
	folder: string,
): Result<BankLocation, Finding> {
	const name = saveableName(draft);
	if (!name.ok) return name;
	if (folder === "")
		return err({
			code: "hole",
			severity: "hole",
			path: "",
			message: "Choose a folder.",
		});
	if (!FOLDER_PATTERN.test(folder))
		return err({
			code: "wrong-type",
			severity: "error",
			path: "",
			message: `\`${folder}\` isn't a folder name.`,
			hint: FOLDER_RULE_TEXT,
		});
	return ok({
		folder,
		name: name.value,
		path: `questions/${folder}/${name.value}.yaml`,
	});
}

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
	`${op === "add" ? "Add" : op === "update" ? "Update" : "Delete"} ${kind === "missing" ? SCHEME_NAME.missing : `${SCHEME_NAME[kind]} ${name}`}`;

/**
 * The message for a commit of several files: the main file's line as the subject, the
 * others listed in the body, so the history reads by what the author meant to change.
 */
export const describeChangeSet = (
	subject: string,
	others: readonly string[],
): string =>
	others.length === 0
		? subject
		: `${subject}\n\nWith:\n${others.map((o) => `- ${o}`).join("\n")}`;
