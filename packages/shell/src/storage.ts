/**
 * The storage port. The shell talks to a bank through this interface; today one
 * adapter implements it (GitHub with a pasted token). A GitHub App login or a
 * "propose a change" adapter implements the same shape later.
 *
 * A Failure is a shell value: HTTP and networks are not the core's vocabulary.
 */
import { err, ok, type Result } from "@qretools/core";
import type { Credentials } from "./auth.ts";

export interface File {
	readonly path: string;
	/** The blob sha the file was read at; a write must present it. */
	readonly sha: string;
	readonly text: string;
}

export interface Failure {
	readonly kind:
		| "network"
		| "http"
		| "auth"
		| "stale"
		| "rateLimited"
		| "unreadable"
		/** The repository exists but has no commits yet: nothing to branch from. */
		| "empty"
		/** The GitHub App signed in with is not installed on the repository: no writes. */
		| "notInstalled"
		/** The app declined before any request was made. */
		| "refused";
	readonly message: string;
	readonly hint?: string;
	/** GitHub's or a library's own words, kept under the plain message. */
	readonly detail?: string;
	readonly status?: number;
}

export interface BankSettings {
	readonly owner: string;
	readonly repo: string;
	/** The bank's folder in the repository, `/`-separated; empty for its root. */
	readonly path: string;
	/** Keep the token on this device (localStorage) rather than for this tab (sessionStorage). */
	readonly remember: boolean;
}

/**
 * A repository as GitHub writes it everywhere, `owner/name`, or pasted as its URL.
 * Parsed once, at the sign-in form; the Model never holds the text. GitHub's rules:
 * an owner is letters, digits and hyphens (up to 39); a name letters, digits, `.`,
 * `_` and `-` (up to 100), never `.` or `..`.
 */
export function parseRepo(
	text: string,
): Result<{ readonly owner: string; readonly repo: string }, string> {
	const bare = text
		.trim()
		.replace(/^https?:\/\/github\.com\//, "")
		.replace(/\.git$/, "")
		.replace(/\/$/, "");
	const [owner, repo, ...rest] = bare.split("/");
	if (
		owner === undefined ||
		repo === undefined ||
		rest.length > 0 ||
		!/^[A-Za-z0-9-]{1,39}$/.test(owner) ||
		!/^[A-Za-z0-9._-]{1,100}$/.test(repo) ||
		repo === "." ||
		repo === ".."
	)
		return err(
			"Write the repository as owner/name, for example octo-org/survey-bank.",
		);
	return ok({ owner, repo });
}

/** A bank as the Repository field writes it, `owner/name`; empty when none is set. */
export const repoText = ({ owner, repo }: Repo): string =>
	owner === "" || repo === "" ? "" : `${owner}/${repo}`;

/** A repository on the forge. */
export interface Repo {
	readonly owner: string;
	readonly repo: string;
}

/**
 * Which bank: a repository, and the folder in it that holds the bank (`banks/bas`),
 * empty for its root. The folder has no leading or trailing slash. Paths inside the
 * bank are relative to it everywhere but the GitHub adapter, which adds it.
 */
export interface BankRef extends Repo {
	readonly path: string;
}

const SEGMENT = /^[^/\s]+$/;

/** A URL segment decoded, or as it is when it isn't valid percent-encoding. */
const safeDecode = (s: string): string => {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
};

/**
 * A bank as written: `owner/name` for one at a repository's root, `owner/name/folder`
 * for one in a folder, or a pasted GitHub URL of either (`…/tree/<branch>/<folder>`; the
 * branch is one segment and is dropped, since a bank is read from the default branch
 * and the author's own). Parsed once, wherever a bank is named: the sign-in form, a
 * link, stored work.
 */
export function parseBank(text: string): Result<BankRef, string> {
	const pasted = /^https?:\/\//.test(text.trim());
	const bare = text
		.trim()
		.replace(/^https?:\/\/github\.com\//, "")
		.replace(/\/+$/, "");
	// A URL's segments are encoded (`my%20bank`); what's written is as is.
	const [owner, repo, ...rest] = bare
		.split("/")
		.map((s) => (pasted ? safeDecode(s) : s));
	const problem =
		"Write the bank as owner/name, or owner/name/folder for a bank in a folder, for example octo-org/surveys/banks/main.";
	const named = parseRepo(
		`${owner ?? ""}/${(repo ?? "").replace(/\.git$/, "")}`,
	);
	if (!named.ok) return err(problem);
	// A pasted URL's `tree/<branch>/`: the folder follows it.
	const folder =
		pasted && rest[0] === "tree"
			? rest.slice(2)
			: pasted && rest.length > 0
				? undefined
				: rest;
	if (
		folder === undefined ||
		folder.some((s) => s === "." || s === ".." || !SEGMENT.test(s))
	)
		return err(problem);
	return ok({ ...named.value, path: folder.join("/") });
}

/** A bank as the field, a link and stored work write it: `owner/name[/folder]`; empty when none. */
export const bankText = (bank: BankRef): string => {
	const repo = repoText(bank);
	return repo === "" || bank.path === "" ? repo : `${repo}/${bank.path}`;
};

/** One bank: owner and name compare as GitHub's do (ignoring case), the folder as git's (exactly). */
export const sameBank = (a: BankRef, b: BankRef): boolean =>
	a.owner.toLowerCase() === b.owner.toLowerCase() &&
	a.repo.toLowerCase() === b.repo.toLowerCase() &&
	a.path === b.path;

/**
 * Where a command reads and writes: a repository and a resolved branch, never the
 * unresolved "my branch" of the settings. `defaultBranch` is the bank: a branch that
 * does not exist yet is read from it and created from it.
 */
export interface BranchTarget extends BankRef {
	readonly branch: string;
	readonly defaultBranch: string;
}

export interface Who {
	readonly login: string;
	/** The account's picture, as GitHub serves it. */
	readonly avatarUrl: string;
	readonly access: Access;
	readonly defaultBranch: string;
}

export interface Loaded {
	readonly files: readonly File[];
	/** Whether the bank's folder is on the branch read: one that isn't is no bank, never an empty one. */
	readonly found: boolean;
	/** Whether the author's branch exists yet, or the bank was read instead. */
	readonly from: "branch" | "default";
	/** Commits on the author's branch not in the bank, and the reverse. */
	readonly aheadBy: number;
	readonly behindBy: number;
}

/** A workspace as read: its files, and the ones GitHub couldn't give as text. */
export interface LoadedWorkspace extends Loaded {
	/** Workspace files read as nothing: binary, or too large for GitHub to send as text. */
	readonly unread: readonly {
		readonly path: string;
		readonly reason: string;
	}[];
}

export interface Store {
	whoAmI(): Promise<Result<Who, Failure>>;
	/** Every file the tool reads, from the target branch, or the default branch while it does not exist. */
	loadBank(target: BranchTarget): Promise<Result<Loaded, Failure>>;
	/**
	 * Every file of the workspace (`readsInWorkspace`), by path in it, from the target
	 * branch, or the default branch while it does not exist: every text from one tree,
	 * so a push during the load can't mix versions.
	 */
	loadWorkspace(
		target: BranchTarget,
	): Promise<Result<LoadedWorkspace, Failure>>;
	read(target: BranchTarget, path: string): Promise<Result<File, Failure>>;
	/**
	 * The `.yaml` files directly in a folder (a path like any other here, under the
	 * store's own folder; `""` is that folder itself), or null when there is no such
	 * folder on the target branch, or no such branch: unlike `loadBank`, it never falls
	 * back to the default branch.
	 */
	readFolder(
		target: BranchTarget,
		dir: string,
	): Promise<Result<readonly File[] | null, Failure>>;
	/**
	 * Another author's file with the scheme files of their branch, in one request, so
	 * their question reads as it does for them, never against the viewer's own edits.
	 */
	readWithSchemes(
		target: BranchTarget,
		path: string,
	): Promise<Result<{ file: File; schemes: readonly File[] }, Failure>>;
	/**
	 * One commit of a change set on the target branch, creating the branch from the
	 * default branch first if it does not exist. Every change states the blob sha it
	 * expects at its path (null: nothing there); if any differs at the branch head,
	 * nothing is written and the failure carries what the head has at each path.
	 */
	commit(
		target: BranchTarget,
		changes: readonly Change[],
		message: string,
	): Promise<Result<Committed, CommitFailure>>;
	/** Create the target branch at the default branch's head; an existing branch is success. */
	ensureBranch(target: BranchTarget): Promise<Result<void, Failure>>;
}

/**
 * One file in a change set. `text: null` deletes it. `id` is the caller's working
 * file, echoed back; a delete without one only removes the path on GitHub (the old
 * path of a move), never a working file.
 */
export interface Change {
	readonly id?: number;
	readonly path: string;
	/** The blob sha the author started from; null for a file that must not exist yet. */
	readonly expected: string | null;
	readonly text: string | null;
}

/** The new blob sha of every written path. Deleted paths are absent. */
export interface Committed {
	readonly shas: Readonly<Record<string, string>>;
}

export interface CommitFailure {
	readonly failure: Failure;
	/** On a stale change set: what the branch head has at each touched path (null: nothing). */
	readonly seen?: Readonly<
		Record<string, { sha: string; text: string } | null>
	>;
}

/** A store over one bank; `token` is asked for before every request, so it may renew. */
export type MakeStore = (
	bank: BankRef,
	token: () => Promise<string>,
	/** A token from the GitHub App's sign-in (its installations can be checked), or pasted. */
	how: { readonly appToken: boolean },
) => Store;

/**
 * What this session may do to the bank. Read only wins over not installed: installing
 * the app would not help someone without write access. Not installed means the person
 * could write but the app they signed in with cannot.
 */
export type Access =
	| { readonly kind: "write" }
	| { readonly kind: "readOnly" }
	| { readonly kind: "notInstalled" };

/**
 * Where the credentials live: never in the Model. Session storage by default, local
 * storage only when the author asked to be remembered.
 */
export interface CredentialStore {
	load(): {
		readonly credentials: Credentials;
		readonly remember: boolean;
	} | null;
	save(credentials: Credentials, remember: boolean): void;
	clear(): void;
}

/**
 * The token getter could not produce a token (none, or the sign-in has ended). Thrown
 * inside Octokit's request hook, where only a throw can stop a request; the adapter
 * turns it back into its Failure.
 */
export class AuthError extends Error {
	constructor(readonly failure: Failure) {
		super(failure.message);
		this.name = "AuthError";
	}
}
