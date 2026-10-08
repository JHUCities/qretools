import type {
	CredentialStore,
	Credentials,
	MakeStore,
	Store,
} from "@qretools/shell";
import { describe, expect, it } from "vitest";
import { createEffects } from "./effects.js";

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

// The token getter's own cases are the shell's (credentials.test.ts); these check that
// the effects reach it: a connect builds the store on the shell's credentials.
describe("the token getter, through the effects", () => {
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

	it("with no one signed in, there is no store and no token", () => {
		const effects = createEffects({
			makeStore: () => ({}) as Store,
			credentialStore: { load: () => null, save: () => {}, clear: () => {} },
		});
		expect(effects.hasToken()).toBe(false);
	});
});
