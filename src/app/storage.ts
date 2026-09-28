/**
 * The storage port. The shell talks to a bank through this interface; today one
 * adapter implements it (GitHub with a pasted token). A GitHub App login or a
 * "propose a change" adapter implements the same shape later.
 *
 * A Failure is a shell value: HTTP and networks are not the core's vocabulary.
 */
import { err, ok, type Result } from "../core/result.js";
import type { Credentials } from "./auth.js";

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
			"Write the repository as owner/name, for example JHUCities/bas-question-bank.",
		);
	return ok({ owner, repo });
}

/** A repository on the forge. */
export interface Repo {
	readonly owner: string;
	readonly repo: string;
}

/**
 * Where a command reads and writes: a repository and a resolved branch, never the
 * unresolved "my branch" of the settings. `defaultBranch` is the bank: a branch that
 * does not exist yet is read from it and created from it.
 */
export interface BranchTarget extends Repo {
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
	/** Whether the author's branch exists yet, or the bank was read instead. */
	readonly from: "branch" | "default";
	/** Commits on the author's branch not in the bank, and the reverse. */
	readonly aheadBy: number;
	readonly behindBy: number;
}

export interface Store {
	whoAmI(): Promise<Result<Who, Failure>>;
	/** Every file the tool reads, from the target branch, or the default branch while it does not exist. */
	loadBank(target: BranchTarget): Promise<Result<Loaded, Failure>>;
	read(target: BranchTarget, path: string): Promise<Result<File, Failure>>;
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

/** A store over one repository; `token` is asked for before every request, so it may renew. */
export type MakeStore = (
	repo: Repo,
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
