/**
 * Links to what is open: the bank, the branch it was read from, and the file,
 * in the URL's hash (`#repo=…&branch=…&file=…`). Pure; encoding by URLSearchParams,
 * since branch names and paths both contain `/`. The browser keeps the history.
 */

import { parseBank } from "./storage.ts";

export interface Link {
	/** The bank: `owner/repo`, or `owner/repo/folder` for a bank in a folder. */
	readonly repo: string;
	readonly branch: string;
	/** A path in the bank; absent for a link to the branch alone. */
	readonly file?: string;
}

export function formatLink(link: Link): string {
	const params = new URLSearchParams({ repo: link.repo, branch: link.branch });
	if (link.file !== undefined) params.set("file", link.file);
	return `#${params.toString()}`;
}

/** A hash the app wrote, or undefined for anything else (including an empty hash). */
export function parseLink(hash: string): Link | undefined {
	const params = new URLSearchParams(hash.replace(/^#/, ""));
	const repo = params.get("repo");
	const branch = params.get("branch");
	const file = params.get("file");
	if (!repo || !branch || !parseBank(repo).ok) return undefined;
	return file ? { repo, branch, file } : { repo, branch };
}
