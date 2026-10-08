import { afterEach, describe, expect, it, vi } from "vitest";
import type { Callback, Credentials } from "./auth.ts";
import {
	AUTH_KEY,
	browserCredentialStore,
	createCredentials,
	RENEWAL_LOCK,
} from "./credentials.ts";
import {
	AuthError,
	type CredentialStore,
	type MakeStore,
	type Store,
} from "./storage.ts";

const config = {
	clientId: "id",
	authUrl: "https://auth.example",
	redirectUri: "http://localhost:5199/",
};
const HOUR = 3_600_000;
const REPO = { owner: "o", repo: "r", path: "" };

/** Credentials over an in-memory store, a fake clock and a fake Worker; yields the token getter. */
function harness(opts: {
	credentials: Credentials | null;
	worker: (body: { refresh_token?: string; code?: string }) => {
		status: number;
		body: unknown;
	};
	/** Another tab's credentials, appearing in storage while this one waits for the lock. */
	theirs?: Credentials;
	/** The lock can't be had. */
	lockFails?: boolean;
	returned?: Callback;
}) {
	let saved = opts.credentials;
	const calls: string[] = [];
	const locks: string[] = [];
	const built: { appToken: boolean }[] = [];
	const credentialStore: CredentialStore = {
		load: () =>
			saved === null ? null : { credentials: saved, remember: false },
		save: (c) => {
			saved = c;
		},
		clear: () => {
			saved = null;
		},
	};
	let getter: (() => Promise<string>) | undefined;
	const returned = opts.returned;
	const makeStore: MakeStore = (_repo, token, options) => {
		getter = token;
		built.push(options);
		return {} as Store;
	};
	const holder = createCredentials({
		makeStore,
		credentialStore,
		signIn: returned === undefined ? { config } : { config, returned },
		now: () => 10 * HOUR,
		fetch: (async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			calls.push(body.refresh_token ?? body.code);
			const reply = opts.worker(body);
			return new Response(JSON.stringify(reply.body), { status: reply.status });
		}) as unknown as typeof fetch,
		lock: async (name, f) => {
			locks.push(name);
			if (opts.lockFails) throw new Error("no locks here");
			if (opts.theirs !== undefined) saved = opts.theirs;
			return f();
		},
	});
	// Building the store hands us the getter.
	holder.storeFor(REPO);
	return {
		holder,
		token: () => {
			if (!getter) throw new Error("no store was built");
			return getter();
		},
		calls,
		locks,
		built,
		saved: () => saved,
	};
}

describe("the token getter", () => {
	it("returns a fresh token without asking the Worker", async () => {
		const h = harness({
			credentials: { access: "a", expiresAt: 12 * HOUR, refresh: "r" },
			worker: () => ({ status: 500, body: {} }),
		});
		expect(await h.token()).toBe("a");
		expect(h.calls).toEqual([]);
	});

	it("renews a token about to expire once, however many requests ask at the same time", async () => {
		const h = harness({
			credentials: {
				access: "old",
				expiresAt: 10 * HOUR + 60_000,
				refresh: "r1",
			},
			worker: () => ({
				status: 200,
				body: { access_token: "new", expires_in: 28800, refresh_token: "r2" },
			}),
		});
		expect(await Promise.all([h.token(), h.token(), h.token()])).toEqual([
			"new",
			"new",
			"new",
		]);
		expect(h.calls).toEqual(["r1"]);
		expect(h.saved()).toMatchObject({ access: "new", refresh: "r2" });
	});

	it("takes another tab's renewal instead of spending the single-use refresh token again", async () => {
		const h = harness({
			credentials: {
				access: "old",
				expiresAt: 10 * HOUR + 60_000,
				refresh: "r1",
			},
			theirs: { access: "theirs", expiresAt: 18 * HOUR, refresh: "r9" },
			worker: () => ({ status: 500, body: {} }),
		});
		expect(await h.token()).toBe("theirs");
		expect(h.calls).toEqual([]);
	});

	it("a refused renewal ends the sign-in; a network blip keeps the credentials", async () => {
		const refused = harness({
			credentials: { access: "old", expiresAt: 10 * HOUR, refresh: "r1" },
			worker: () => ({ status: 400, body: { error: "bad_refresh_token" } }),
		});
		await expect(refused.token()).rejects.toBeInstanceOf(AuthError);
		const flaky = harness({
			credentials: { access: "old", expiresAt: 10 * HOUR, refresh: "r1" },
			worker: () => ({ status: 502, body: { error: "upstream" } }),
		});
		const e = await flaky.token().catch((x: unknown) => x);
		expect(e instanceof AuthError && e.failure.kind).toBe("http");
		expect(flaky.saved()).toMatchObject({ access: "old", refresh: "r1" });
	});

	it("with no one signed in, there is no store and no token", () => {
		const holder = createCredentials({
			makeStore: () => ({}) as Store,
			credentialStore: { load: () => null, save: () => {}, clear: () => {} },
		});
		expect(holder.hasToken()).toBe(false);
		expect(holder.storeFor(REPO)).toBeUndefined();
	});

	it("renews under the shared lock, and a lock that can't be had is a network failure, then clears", async () => {
		const h = harness({
			credentials: { access: "old", expiresAt: 10 * HOUR, refresh: "r1" },
			worker: () => ({ status: 500, body: {} }),
			lockFails: true,
		});
		const e = await h.token().catch((x: unknown) => x);
		expect(e instanceof AuthError && e.failure.kind).toBe("network");
		expect(h.locks).toEqual([RENEWAL_LOCK]);
		// Settled on failure too: the next request tries again, rather than waiting forever.
		await h.token().catch(() => {});
		expect(h.locks).toEqual([RENEWAL_LOCK, RENEWAL_LOCK]);
		expect(h.saved()).toMatchObject({ access: "old" });
	});

	it("an expired refresh token ends the sign-in without asking the Worker", async () => {
		const h = harness({
			credentials: {
				access: "old",
				expiresAt: 10 * HOUR,
				refresh: "r1",
				refreshExpiresAt: 9 * HOUR,
			},
			worker: () => ({ status: 500, body: {} }),
		});
		const e = await h.token().catch((x: unknown) => x);
		expect(e instanceof AuthError && e.failure.message).toMatch(/has ended/);
		expect(h.calls).toEqual([]);
	});

	it("redeems a code brought back from GitHub at once, before any request asks", async () => {
		const h = harness({
			credentials: null,
			worker: () => ({
				status: 200,
				body: { access_token: "fresh", expires_in: 28800 },
			}),
			returned: { code: "c1", verifier: "v", remember: false, hash: "" },
		});
		expect(h.calls).toEqual(["c1"]);
		expect(h.holder.hasToken()).toBe(true);
		expect(await h.token()).toBe("fresh");
		expect(h.saved()).toMatchObject({ access: "fresh" });
	});
});

describe("the store", () => {
	it("is one per bank and kind of token, and gone once the credentials are forgotten", () => {
		const h = harness({
			credentials: { access: "a", expiresAt: 12 * HOUR },
			worker: () => ({ status: 500, body: {} }),
		});
		const first = h.holder.storeFor(REPO);
		expect(h.holder.storeFor(REPO)).toBe(first);
		h.holder.storeFor({ ...REPO, path: "other" });
		h.holder.setToken("pasted", false);
		h.holder.storeFor({ ...REPO, path: "other" });
		expect(h.built).toEqual([
			{ appToken: true },
			{ appToken: true },
			{ appToken: false },
		]);
		// Alternating banks keep their stores: back to the first, nothing is built.
		h.holder.setToken("a", false);
		const before = h.built.length;
		const x = h.holder.storeFor({ ...REPO, path: "x" });
		h.holder.storeFor({ ...REPO, path: "y" });
		expect(h.holder.storeFor({ ...REPO, path: "x" })).toBe(x);
		expect(h.built.length - before).toBe(2);
		h.holder.forget();
		expect(h.saved()).toBeNull();
		expect(h.holder.storeFor(REPO)).toBeUndefined();
	});
});

/** A `Storage` in memory: the shell's tests run in Node, without a DOM. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
	const m = new Map(Object.entries(entries));
	return {
		get length() {
			return m.size;
		},
		clear: () => m.clear(),
		getItem: (k) => m.get(k) ?? null,
		key: (i) => [...m.keys()][i] ?? null,
		removeItem: (k) => {
			m.delete(k);
		},
		setItem: (k, v) => {
			m.set(k, v);
		},
	};
}

describe("the browser's credential store", () => {
	const use = (session: Storage, local: Storage) => {
		vi.stubGlobal("sessionStorage", session);
		vi.stubGlobal("localStorage", local);
	};
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps the credentials in this tab, or on this device when asked to remember", () => {
		const session = memoryStorage();
		const local = memoryStorage();
		use(session, local);
		browserCredentialStore.save({ access: "a" }, false);
		expect(browserCredentialStore.load()).toEqual({
			credentials: { access: "a" },
			remember: false,
		});
		expect(local.getItem(AUTH_KEY)).toBeNull();
		browserCredentialStore.save({ access: "b" }, true);
		expect(session.getItem(AUTH_KEY)).toBeNull();
		expect(browserCredentialStore.load()).toEqual({
			credentials: { access: "b" },
			remember: true,
		});
		browserCredentialStore.clear();
		expect(browserCredentialStore.load()).toBeNull();
	});

	it("reads an old pasted token once, and drops it on the next save", () => {
		const local = memoryStorage({ "qretools.token": "old" });
		use(memoryStorage(), local);
		expect(browserCredentialStore.load()).toEqual({
			credentials: { access: "old", pasted: true },
			remember: true,
		});
		browserCredentialStore.save({ access: "old", pasted: true }, true);
		expect(local.getItem("qretools.token")).toBeNull();
	});

	it("treats what it can't read as no sign-in, and storage that throws as none", () => {
		use(memoryStorage({ [AUTH_KEY]: "{not json" }), memoryStorage());
		expect(browserCredentialStore.load()).toBeNull();
		use(
			memoryStorage({ [AUTH_KEY]: '{"access":"a","extra":1}' }),
			memoryStorage(),
		);
		expect(browserCredentialStore.load()).toBeNull();
		vi.stubGlobal("sessionStorage", undefined);
		expect(browserCredentialStore.load()).toBeNull();
		expect(() => browserCredentialStore.clear()).not.toThrow();
	});
});
