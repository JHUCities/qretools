/**
 * Where commands run, and the only place the shell keeps hidden state: the GitHub
 * credentials (and their renewal), the store, the compiled DDI validator, the persist
 * debouncer, and a handle to the editor. `exec` is the interpreter for `Cmd`; every result goes
 * back through `dispatch` as a message. Two things live here and not in `update`,
 * by design: the token (it must never enter Model or Msg) and the editor handle
 * (a DOM object).
 */

import type { DdiDocument } from "../core/ddi/document.js";
import type { Validator } from "../core/ddi/validate.js";
import { makeValidator } from "../core/ddi/validate.js";
import type { Finding } from "../core/findings.js";
import { err, ok, type Result } from "../core/result.js";
import {
	authorizeUrl,
	base64url,
	type Callback,
	type Credentials,
	exchange,
	type PendingSignIn,
	refresh,
	stale,
} from "./auth.js";
import type { SignInConfig } from "./config.js";
import type { Editor } from "./editor.js";
import type { Cmd, Dispatch } from "./model.js";
import { STORAGE_KEY } from "./persist.js";
import {
	AuthError,
	type CredentialStore,
	type Failure,
	type File,
	type MakeStore,
	type Repo,
	type Store,
} from "./storage.js";

export interface Deps {
	readonly makeStore: MakeStore;
	readonly credentialStore: CredentialStore;
	/** Sign-in with GitHub, when this build is configured for it. */
	readonly signIn?: {
		readonly config: SignInConfig;
		/** The author just came back from GitHub with a code to redeem. */
		readonly returned?: Callback;
	};
	readonly now?: () => number;
	readonly fetch?: typeof fetch;
	/**
	 * Run `f` holding a lock shared by this origin's tabs: GitHub's refresh tokens are
	 * single use, so two tabs renewing at once would sign one of them out. Native:
	 * `navigator.locks`.
	 */
	readonly lock?: <T>(name: string, f: () => Promise<T>) => Promise<T>;
	/** Leave for GitHub's sign-in page: `location.assign`. */
	readonly navigate?: (url: string) => void;
}

/** Where a sign-in in progress is kept across the round trip to GitHub. */
export const PENDING_KEY = "qretools.signin";

const nativeLock = <T>(name: string, f: () => Promise<T>): Promise<T> =>
	typeof navigator !== "undefined" && navigator.locks
		? navigator.locks.request(name, f)
		: f();

export interface Effects {
	exec(cmd: Cmd, dispatch: Dispatch): void;
	registerEditor(editor: Editor | undefined): void;
	/** Set the token the next connect uses; also remembers it per the setting. */
	setToken(token: string, remember: boolean): void;
	hasToken(): boolean;
	validate(ddi: DdiDocument): readonly Finding[] | undefined;
}

/** A command that needs the bank when no one is signed in: reported, never swallowed. */
const NO_TOKEN: Failure = {
	kind: "auth",
	message: "Not signed in.",
	hint: "Sign in with GitHub.",
};

const ENDED: Failure = {
	kind: "auth",
	message: "Your GitHub sign-in has ended.",
	hint: "Sign in again.",
};

/**
 * Leave for GitHub with a fresh state and PKCE verifier, kept in session storage for
 * the way back. Randomness is here, in the shell: `update` never touches it.
 */
async function startSignIn(
	config: SignInConfig,
	remember: boolean,
	navigate: (url: string) => void = (url) => location.assign(url),
): Promise<void> {
	const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
	const state = random();
	const verifier = random();
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier),
	);
	const challenge = base64url(new Uint8Array(digest));
	const pendingSignIn: PendingSignIn = {
		state,
		verifier,
		remember,
		hash: location.hash,
		at: Date.now(),
	};
	sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingSignIn));
	navigate(authorizeUrl(config, { state, challenge }));
}

export function createEffects(deps: Deps): Effects {
	const now = deps.now ?? Date.now;
	const fetcher =
		deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
	const lock = deps.lock ?? nativeLock;
	/** A lock that could not be had is a transient failure, never a thrown error. */
	const lockSafely = (
		name: string,
		f: () => Promise<Result<Credentials, Failure>>,
	): Promise<Result<Credentials, Failure>> =>
		lock(name, f).catch((e: unknown) =>
			err({
				kind: "network",
				message: "Couldn't renew your sign-in.",
				hint: "Try again.",
				detail: e instanceof Error ? e.message : String(e),
			}),
		);
	let validator: Validator | undefined;
	const loaded = deps.credentialStore.load();
	let credentials = loaded?.credentials ?? null;
	let remember = loaded?.remember ?? false;
	/** A redemption or renewal in flight; every request waits for it. */
	let pending: Promise<Result<Credentials, Failure>> | undefined;
	let store: Store | undefined;
	let repoInUse: string | undefined;
	let editor: Editor | undefined;
	const persist = debouncedPersist();

	const keep = (c: Credentials, r: boolean) => {
		credentials = c;
		remember = r;
		deps.credentialStore.save(c, r);
	};

	/** Settle a redemption or renewal: keep what it gave, and let the next one start. */
	const settle = (
		work: Promise<Result<Credentials, Failure>>,
	): Promise<Result<Credentials, Failure>> => {
		pending = work.then((r) => {
			if (r.ok) keep(r.value, remember);
			return r;
		});
		const settled = pending;
		// Clear on either outcome, never leaving an unhandled rejection behind.
		const clear = () => {
			if (pending === settled) pending = undefined;
		};
		settled.then(clear, clear);
		return settled;
	};

	// Back from GitHub: constructing the effects starts this I/O. The code is redeemed at
	// once (it is single use and short-lived); the first request waits for it.
	const returned = deps.signIn?.returned;
	if (returned !== undefined && deps.signIn !== undefined) {
		remember = returned.remember;
		settle(exchange(deps.signIn.config, returned, now, fetcher));
	}

	/**
	 * The token for the next request, renewed when within minutes of expiry, once for all
	 * callers and all tabs. Throws an AuthError when there is none, or it cannot be renewed.
	 */
	const token = async (): Promise<string> => {
		if (pending !== undefined) {
			const r = await pending;
			if (!r.ok) throw new AuthError(r.error);
		}
		const c = credentials;
		if (c === null) throw new AuthError(NO_TOKEN);
		if (!stale(c, now())) return c.access;
		const config = deps.signIn?.config;
		if (config === undefined || c.refresh === undefined)
			throw new AuthError(ENDED);
		if (c.refreshExpiresAt !== undefined && c.refreshExpiresAt < now())
			throw new AuthError(ENDED);
		const renewed = await settle(
			lockSafely("qretools.auth", async () => {
				// Another tab may have renewed while this one waited for the lock.
				const theirs = deps.credentialStore.load()?.credentials;
				if (theirs && !stale(theirs, now())) return ok(theirs);
				return refresh(config, c.refresh ?? "", now, fetcher);
			}),
		);
		if (!renewed.ok) throw new AuthError(renewed.error);
		return renewed.value.access;
	};

	const storeFor = (repo: Repo): Store | undefined => {
		if (credentials === null && pending === undefined) return undefined;
		const appToken = credentials?.pasted !== true;
		const key = `${repo.owner}/${repo.repo}:${appToken}`;
		if (!store || key !== repoInUse) {
			store = deps.makeStore(repo, token, { appToken });
			repoInUse = key;
		}
		return store;
	};

	return {
		registerEditor: (e) => {
			editor = e;
		},
		setToken: (t, r) => keep({ access: t, pasted: true }, r),
		hasToken: () => credentials !== null || pending !== undefined,
		validate: (ddi) => validator?.(ddi),

		exec(cmd, dispatch) {
			switch (cmd.kind) {
				case "revealRange":
					editor?.reveal(cmd.range);
					return;
				case "loadDdiSchema":
					import("../ddi/ddi-lifecycle-4.0-beta4.schema.json?raw")
						.then((m) => makeValidator(JSON.parse(m.default)))
						.then((compiled) => {
							if (compiled.ok) validator = compiled.value;
							dispatch({
								kind: "ddiSchemaLoaded",
								result: compiled.ok
									? { kind: "ready" }
									: { kind: "failed", finding: compiled.error },
							});
						})
						.catch((e: unknown) =>
							dispatch({
								kind: "ddiSchemaLoaded",
								result: {
									kind: "failed",
									finding: {
										code: "ddi-invalid",
										severity: "error",
										path: "",
										message:
											"The DDI schema couldn't be loaded, so the export can't be checked.",
										detail: e instanceof Error ? e.message : String(e),
									},
								},
							}),
						);
					return;
				case "persist":
					persist(JSON.stringify(cmd.data));
					return;
				case "connect": {
					const s = storeFor(cmd.repo);
					if (!s) return dispatch({ kind: "connected", result: err(NO_TOKEN) });
					s.whoAmI().then((result) => dispatch({ kind: "connected", result }));
					return;
				}
				case "loadBank": {
					const s = storeFor(cmd.target);
					if (!s)
						return dispatch({ kind: "bankLoaded", result: err(NO_TOKEN) });
					s.loadBank(cmd.target).then((result) =>
						dispatch({ kind: "bankLoaded", result }),
					);
					return;
				}
				case "readFile": {
					const s = storeFor(cmd.target);
					if (!s)
						return dispatch({
							kind: "fileReloaded",
							id: cmd.id,
							result: err(NO_TOKEN),
						});
					s.read(cmd.target, cmd.path).then((result) =>
						dispatch({ kind: "fileReloaded", id: cmd.id, result }),
					);
					return;
				}
				case "commit": {
					const s = storeFor(cmd.target);
					if (!s)
						return dispatch({
							kind: "committed",
							changes: cmd.changes,
							result: err({ failure: NO_TOKEN }),
						});
					s.commit(cmd.target, cmd.changes, cmd.message).then((result) =>
						dispatch({ kind: "committed", changes: cmd.changes, result }),
					);
					return;
				}
				case "forgetToken":
					deps.credentialStore.clear();
					credentials = null;
					pending = undefined;
					store = undefined;
					return;
				case "signIn": {
					const config = deps.signIn?.config;
					if (config === undefined)
						return dispatch({
							kind: "connected",
							result: err({
								kind: "auth",
								message: "Sign-in isn't set up for this build.",
							}),
						});
					// Leaving the page: write what should survive first.
					persist.flush();
					void startSignIn(config, cmd.remember, deps.navigate).catch(
						(e: unknown) =>
							dispatch({
								kind: "connected",
								result: err({
									kind: "auth",
									message: "Sign-in couldn't start.",
									detail: e instanceof Error ? e.message : String(e),
								}),
							}),
					);
					return;
				}
				case "setLink":
					// The browser keeps the history: setting the hash adds an entry, replace()
					// does not. Writing the address it already shows would add a duplicate.
					if (location.hash === cmd.hash) return;
					if (cmd.push) location.hash = cmd.hash;
					else
						location.replace(
							`${location.pathname}${location.search}${cmd.hash}`,
						);
					return;
				case "readAt": {
					const s = storeFor(cmd.target);
					const reply = (
						result: Result<{ file: File; schemes: readonly File[] }, Failure>,
					) =>
						dispatch({
							kind: "foreignLoaded",
							branch: cmd.target.branch,
							path: cmd.path,
							result,
						});
					if (!s) return reply(err(NO_TOKEN));
					s.readWithSchemes(cmd.target, cmd.path).then(reply);
					return;
				}
				default:
					return cmd satisfies never;
			}
		},
	};
}

/** Persist at most every 300 ms, and flush when the page is hidden, or on demand. */
function debouncedPersist(): ((json: string) => void) & { flush(): void } {
	let pending: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const flush = () => {
		if (pending === undefined) return;
		try {
			localStorage.setItem(STORAGE_KEY, pending);
		} catch {
			// Storage unavailable (private window, quota): the Model is still correct; drafts are just not kept.
		}
		pending = undefined;
	};
	if (typeof window !== "undefined") window.addEventListener("pagehide", flush);
	const write = (json: string) => {
		pending = json;
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(flush, 300);
	};
	return Object.assign(write, { flush });
}
