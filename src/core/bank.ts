/**
 * Bank policy: where a question lives in the repository, and how a change to it
 * is described. Pure; the shell only carries the results to GitHub.
 */

import type { Finding } from "./findings.js";
import { err, ok, type Result } from "./result.js";
import type { SchemeKind } from "./schemes.js";
import type { Draft } from "./surface/draft.js";
import { NAME_PATTERN } from "./surface/schema.js";

/**
 * A new question is filed by the prefix of its name (`nhd_sat` → `nhd`). Only for
 * new drafts: a bank file keeps the path it was opened at, because the bank has
 * questions whose folder is not their prefix.
 */
export const folderOf = (name: string): string => name.split("_")[0] ?? name;

/** A draft can be saved once it has a valid name. Findings never block saving. */
/** Topic folders are directory names, not variable names: hyphens are allowed. */
export const FOLDER_PATTERN = /^[a-z][a-z0-9_-]*$/;

export interface BankLocation {
	readonly folder: string;
	readonly name: string;
	readonly path: string;
}

/**
 * Where a question belongs in the bank. The folder defaults to the name's prefix
 * but is the author's to choose: git creates any missing path, so a folder that
 * does not exist yet is a new topic, and that should be a deliberate act.
 * Findings never block saving; only a missing or malformed name does.
 */
export function bankLocation(
	draft: Draft,
	folder?: string,
): Result<BankLocation, Finding> {
	const name = draft.name;
	if (name === undefined || !NAME_PATTERN.test(name)) {
		return err({
			code: "hole",
			severity: "hole",
			path: "name",
			message:
				"A question needs a valid `name` before it can be saved to the bank.",
			hint: "Lowercase letters, digits and underscores, starting with a letter, e.g. nhd_sat.",
		});
	}
	const where = folder ?? folderOf(name);
	if (!FOLDER_PATTERN.test(where)) {
		return err({
			code: "wrong-type",
			severity: "error",
			path: "",
			message: `\`${where}\` is not a topic folder name.`,
			hint: "Lowercase letters, digits, hyphens and underscores, starting with a letter.",
		});
	}
	return ok({ folder: where, name, path: `questions/${where}/${name}.yaml` });
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
	const changed: string[] = FIELDS.filter(
		(k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
	);
	if (JSON.stringify(before.domain) !== JSON.stringify(after.domain)) {
		changed.push(after.domain?.kind ?? before.domain?.kind ?? "responses");
	}
	return changed.length === 0
		? `Update ${name}`
		: `Update ${name}: ${changed.join(", ")}`;
}

/** A scheme file's commit message: `Add scale agree5`, `Delete universe renters`. */
export const describeSchemeChange = (
	kind: SchemeKind,
	name: string,
	op: "add" | "update" | "delete",
): string =>
	`${op === "add" ? "Add" : op === "update" ? "Update" : "Delete"} ${kind === "missing" ? "missing values" : `${kind} ${name}`}`;
