/**
 * The storage port. The shell talks to a bank through this interface; today one
 * adapter implements it (GitHub with a pasted token). A GitHub App login or a
 * "propose a change" adapter implements the same shape later.
 *
 * A Failure is a shell value: HTTP and networks are not the core's vocabulary.
 */
import type { Result } from "../core/result.js";

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
		/** The app declined before any request was made. */
		| "refused";
	readonly message: string;
	readonly hint?: string;
	readonly status?: number;
}

export interface BankSettings {
	readonly owner: string;
	readonly repo: string;
	/**
	 * Where saves go. Empty means the author's own branch, `qretools/<login>`, resolved
	 * when connecting; a name is for development (`sandbox`). Never the default branch:
	 * the bank changes only through a pull request.
	 */
	readonly branch: string;
	/** Keep the token on this device (localStorage) rather than for this tab (sessionStorage). */
	readonly remember: boolean;
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
	readonly canWrite: boolean;
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
	/** Writes create the target branch from the default branch when it does not exist yet. */
	write(
		target: BranchTarget,
		path: string,
		text: string,
		message: string,
		sha?: string,
	): Promise<Result<{ sha: string }, Failure>>;
	remove(
		target: BranchTarget,
		path: string,
		sha: string,
		message: string,
	): Promise<Result<void, Failure>>;
	/** Create the target branch at the default branch's head; an existing branch is success. */
	ensureBranch(target: BranchTarget): Promise<Result<void, Failure>>;
}

export type MakeStore = (repo: Repo, token: string) => Store;

/** Where the token lives: never in the Model. */
export interface TokenStore {
	load(): string | null;
	save(token: string, remember: boolean): void;
	clear(): void;
}
