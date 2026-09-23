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
	readonly branch: string;
	/** Keep the token on this device (localStorage) rather than for this tab (sessionStorage). */
	readonly remember: boolean;
}

export interface Store {
	whoAmI(): Promise<Result<{ login: string; canWrite: boolean }, Failure>>;
	loadBank(): Promise<
		Result<{ questions: readonly File[]; scales: readonly File[] }, Failure>
	>;
	read(path: string): Promise<Result<File, Failure>>;
	write(
		path: string,
		text: string,
		message: string,
		sha?: string,
	): Promise<Result<{ sha: string }, Failure>>;
	remove(
		path: string,
		sha: string,
		message: string,
	): Promise<Result<void, Failure>>;
}

export type MakeStore = (settings: BankSettings, token: string) => Store;

/** Where the token lives: never in the Model. */
export interface TokenStore {
	load(): string | null;
	save(token: string, remember: boolean): void;
	clear(): void;
}
