/**
 * The GitHub credentials, and the only hidden state they need: the token for the next
 * request (renewed once for every caller and every tab), the redemption of a code just
 * brought back from GitHub, and the store built on them. The token never leaves this
 * closure except through the getter handed to `makeStore`: it never enters a Model or a Msg.
 *
 * The storage keys and the lock name are constants shared by every QREtools app: each
 * app is served from an origin of its own, and storage and Web Locks are per origin.
 */

import { compact, err, ok, type Result } from "@qretools/core";
import { z } from "zod";
import {
	authorizeUrl,
	base64url,
	type Callback,
	type Credentials,
	callbackOf,
	exchange,
	PendingSchema,
	type PendingSignIn,
	refresh,
	stale,
} from "./auth.ts";
import type { SignInConfig } from "./signin.ts";
import {
	AuthError,
	type BankRef,
	bankText,
	type CredentialStore,
	type Failure,
	type MakeStore,
	type Store,
} from "./storage.ts";

/** Where a sign-in in progress is kept across the round trip to GitHub (session storage). */
export const PENDING_KEY = "qretools.signin";
/** Where the credentials are kept: session storage, or local when asked to remember. */
export const AUTH_KEY = "qretools.auth";
/** Before sign-in, a pasted token was kept as a bare string under this key; read once. */
const OLD_TOKEN_KEY = "qretools.token";
/** The Web Lock a renewal runs under, shared by this origin's tabs. */
export const RENEWAL_LOCK = "qretools.auth";

export interface CredentialsDeps {
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

export interface CredentialsHolder {
	/** The store for this bank, built on the token getter; none while no one is signed in. */
	storeFor(repo: BankRef): Store | undefined;
	/** Set the token the next connect uses; also remembers it per the setting. */
	setToken(token: string, remember: boolean): void;
	hasToken(): boolean;
	/** Whether this build is set up for "Sign in with GitHub". */
	readonly canSignIn: boolean;
	/** Forget the credentials, here and in storage, and the store built on them. */
	forget(): void;
	/**
	 * Leave for GitHub's sign-in page. Rejects when this build has no sign-in set up, or
	 * it couldn't start.
	 */
	startSignIn(remember: boolean): Promise<void>;
}

/** A command that needs the bank when no one is signed in: reported, never swallowed. */
export const NO_TOKEN: Failure = {
	kind: "auth",
	message: "Not signed in.",
	hint: "Sign in with GitHub.",
};

const ENDED: Failure = {
	kind: "auth",
	message: "Your GitHub sign-in has ended.",
	hint: "Sign in again.",
};

const nativeLock = <T>(name: string, f: () => Promise<T>): Promise<T> =>
	typeof navigator !== "undefined" && navigator.locks
		? navigator.locks.request(name, f)
		: f();

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

export function createCredentials(deps: CredentialsDeps): CredentialsHolder {
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
	const loaded = deps.credentialStore.load();
	let credentials = loaded?.credentials ?? null;
	let remember = loaded?.remember ?? false;
	/** A redemption or renewal in flight; every request waits for it. */
	let pending: Promise<Result<Credentials, Failure>> | undefined;
	let store: Store | undefined;
	let repoInUse: string | undefined;

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

	// Back from GitHub: constructing the credentials starts this I/O. The code is redeemed
	// at once (it is single use and short-lived); the first request waits for it.
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
			lockSafely(RENEWAL_LOCK, async () => {
				// Another tab may have renewed while this one waited for the lock.
				const theirs = deps.credentialStore.load()?.credentials;
				if (theirs && !stale(theirs, now())) return ok(theirs);
				return refresh(config, c.refresh ?? "", now, fetcher);
			}),
		);
		if (!renewed.ok) throw new AuthError(renewed.error);
		return renewed.value.access;
	};

	return {
		storeFor: (repo) => {
			if (credentials === null && pending === undefined) return undefined;
			const appToken = credentials?.pasted !== true;
			// The folder too: two banks in one repository are two stores.
			const key = `${bankText(repo)}:${appToken}`;
			if (!store || key !== repoInUse) {
				store = deps.makeStore(repo, token, { appToken });
				repoInUse = key;
			}
			return store;
		},
		setToken: (t, r) => keep({ access: t, pasted: true }, r),
		hasToken: () => credentials !== null || pending !== undefined,
		canSignIn: deps.signIn !== undefined,
		forget: () => {
			deps.credentialStore.clear();
			credentials = null;
			pending = undefined;
			store = undefined;
		},
		startSignIn: (r) => {
			const config = deps.signIn?.config;
			if (config === undefined)
				return Promise.reject(
					new Error("Sign-in isn't set up for this build."),
				);
			return startSignIn(config, r, deps.navigate);
		},
	};
}

/**
 * Back from GitHub's sign-in page (`?code&state`, or `?error&state`)? Check the state
 * against the one this tab stored when it left (used once), then take the code out of
 * the address with the one `history.replaceState` (a `location.replace` would reload),
 * restoring the link that was open before the round trip.
 */
export function cameBackFromGitHub(): Result<Callback, Failure> | undefined {
	if (!/[?&](code|error)=/.test(location.search)) return undefined;
	let raw: string | null = null;
	try {
		raw = sessionStorage.getItem(PENDING_KEY);
		sessionStorage.removeItem(PENDING_KEY);
	} catch {
		// no storage: the state cannot be checked, so the sign-in is refused below
	}
	let pending: ReturnType<typeof PendingSchema.parse> | undefined;
	try {
		const parsed = PendingSchema.safeParse(
			raw === null ? undefined : JSON.parse(raw),
		);
		if (parsed.success) pending = parsed.data;
	} catch {
		pending = undefined;
	}
	const returned = callbackOf(location.search, pending, Date.now());
	history.replaceState(
		null,
		"",
		`${location.pathname}${pending?.hash ?? location.hash}`,
	);
	return returned;
}

const safe = <T>(f: () => T, fallback: T): T => {
	try {
		return f();
	} catch {
		return fallback;
	}
};

const CredentialsSchema = z.strictObject({
	access: z.string(),
	expiresAt: z.number().optional(),
	refresh: z.string().optional(),
	refreshExpiresAt: z.number().optional(),
	pasted: z.literal(true).optional(),
});

function readCredentials(storage: Storage): Credentials | null {
	const raw = storage.getItem(AUTH_KEY);
	if (raw !== null) {
		try {
			const parsed = CredentialsSchema.safeParse(JSON.parse(raw));
			if (parsed.success) return compact(parsed.data) as Credentials;
		} catch {
			// unreadable: treat as none
		}
		return null;
	}
	const old = storage.getItem(OLD_TOKEN_KEY);
	return old === null ? null : { access: old, pasted: true };
}

/** Session storage by default: gone when the tab closes. Local storage only when asked to remember. */
export const browserCredentialStore: CredentialStore = {
	load: () =>
		safe(() => {
			const session = readCredentials(sessionStorage);
			if (session !== null) return { credentials: session, remember: false };
			const local = readCredentials(localStorage);
			return local === null ? null : { credentials: local, remember: true };
		}, null),
	save: (credentials, remember) =>
		safe(() => {
			(remember ? localStorage : sessionStorage).setItem(
				AUTH_KEY,
				JSON.stringify(credentials),
			);
			for (const s of [sessionStorage, localStorage])
				s.removeItem(OLD_TOKEN_KEY);
			(remember ? sessionStorage : localStorage).removeItem(AUTH_KEY);
		}, undefined),
	clear: () =>
		safe(() => {
			for (const s of [sessionStorage, localStorage]) {
				s.removeItem(AUTH_KEY);
				s.removeItem(OLD_TOKEN_KEY);
			}
		}, undefined),
};
