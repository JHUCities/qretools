/**
 * Bank policy: where a question lives in the repository. Pure; the shell only
 * carries the results to GitHub.
 */

import { FOLDER_RULE_TEXT, NAME_RULE_TEXT } from "./copy.js";
import type { Finding } from "./findings.js";
import { err, ok, type Result } from "./result.js";
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
