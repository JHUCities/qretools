import { describe, expect, it } from "vitest";
import type { Credentials } from "./auth.js";
import { createEffects } from "./effects.js";
import {
	AuthError,
	type CredentialStore,
	type MakeStore,
	type Store,
} from "./storage.js";

const config = {
	clientId: "id",
	authUrl: "https://auth.example",
	redirectUri: "http://localhost:5199/",
};
const HOUR = 3_600_000;

/** Effects over an in-memory credential store, a fake clock and a fake Worker; yields the token getter. */
function harness(opts: {
	credentials: Credentials | null;
	worker: (body: { refresh_token?: string }) => {
		status: number;
		body: unknown;
	};
	/** Another tab's credentials, appearing in storage while this one waits for the lock. */
	theirs?: Credentials;
}) {
	let saved = opts.credentials;
	const calls: string[] = [];
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
	const makeStore: MakeStore = (_repo, token) => {
		getter = token;
		// The connect below asks who is signed in; this store never answers.
		return { whoAmI: () => new Promise(() => {}) } as unknown as Store;
	};
	const effects = createEffects({
		makeStore,
		credentialStore,
		signIn: { config },
		now: () => 10 * HOUR,
		fetch: (async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			calls.push(body.refresh_token);
			const reply = opts.worker(body);
			return new Response(JSON.stringify(reply.body), { status: reply.status });
		}) as unknown as typeof fetch,
		lock: async (_name, f) => {
			if (opts.theirs !== undefined) saved = opts.theirs;
			return f();
		},
	});
	// A connect builds the store, which hands us the getter.
	effects.exec(
		{ kind: "connect", repo: { owner: "o", repo: "r", path: "" } },
		() => {},
	);
	return {
		token: () => {
			if (!getter) throw new Error("no store was built");
			return getter();
		},
		calls,
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
		const effects = createEffects({
			makeStore: () => ({}) as Store,
			credentialStore: { load: () => null, save: () => {}, clear: () => {} },
		});
		expect(effects.hasToken()).toBe(false);
	});
});
