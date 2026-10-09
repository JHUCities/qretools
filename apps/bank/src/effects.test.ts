import { ok } from "@qretools/core";
import type { Editor } from "@qretools/editor";
import type {
	CredentialStore,
	Credentials,
	MakeStore,
	Store,
} from "@qretools/shell";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEffects } from "./effects.js";
import type { Msg, RemoteAddress } from "./model.js";

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

describe("reading the banks in other repositories that instruments use", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const at = (repo: string): RemoteAddress => ({
		kind: "remote",
		owner: "o",
		repo,
		path: "",
		ref: "v1",
		key: `o/${repo}@v1`,
	});
	function reading() {
		const read: string[] = [];
		const effects = createEffects({
			makeStore: (bank) =>
				({
					loadBankAt: (tag: string) => {
						read.push(`${bank.repo}@${tag}`);
						return Promise.resolve(ok({ found: true, files: [], unread: [] }));
					},
				}) as unknown as Store,
			credentialStore: {
				load: () => ({ credentials: { access: "t" }, remember: false }),
				save: () => {},
				clear: () => {},
			},
		});
		const got: Msg[] = [];
		return { effects, read, got, dispatch: (m: Msg) => got.push(m) };
	}

	it("waits while an address is typed, reads only the latest, and marks it read only then", async () => {
		const { effects, read, got, dispatch } = reading();
		for (const repo of ["b", "ba", "bank"])
			effects.exec(
				{ kind: "loadRemoteBanks", addresses: [at(repo)], now: false },
				dispatch,
			);
		await vi.advanceTimersByTimeAsync(499);
		expect(read).toEqual([]);
		expect(got).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);
		expect(read).toEqual(["bank@v1"]);
		expect(got.map((m) => `${m.kind} ${"key" in m ? m.key : ""}`)).toEqual([
			"remoteBankStarted o/bank@v1",
			"remoteBankLoaded o/bank@v1",
		]);
	});

	it("reads at once when nothing is being typed, and never one twice at once", async () => {
		const { effects, read, dispatch } = reading();
		effects.exec(
			{ kind: "loadRemoteBanks", addresses: [at("bank")], now: true },
			dispatch,
		);
		effects.exec(
			{ kind: "loadRemoteBanks", addresses: [at("bank")], now: true },
			dispatch,
		);
		expect(read).toEqual(["bank@v1"]);
	});
});

describe("a reveal in a file only now opening", () => {
	/** Effects with an editor that records what it was asked to reveal. */
	function revealing() {
		const effects = createEffects({
			makeStore: () => ({}) as Store,
			credentialStore: { load: () => null, save: () => {}, clear: () => {} },
		});
		const revealed: (readonly [number, number])[] = [];
		effects.registerEditor({
			reveal: (range: readonly [number, number]) => {
				revealed.push(range);
			},
		} as unknown as Editor);
		return { effects, revealed };
	}
	const none = () => {};

	it("waits for that file's editor, then is applied once", () => {
		const { effects, revealed } = revealing();
		effects.editorSynced(1);
		effects.exec({ kind: "revealRange", range: [5, 9], id: 2 }, none);
		expect(revealed).toEqual([]);
		effects.editorSynced(2);
		expect(revealed).toEqual([[5, 9]]);
		// A later sync of the same file (typing) doesn't jump back there.
		effects.editorSynced(2);
		expect(revealed).toEqual([[5, 9]]);
	});

	it("is dropped when another file opens first, and runs at once in the file shown", () => {
		const { effects, revealed } = revealing();
		effects.editorSynced(1);
		effects.exec({ kind: "revealRange", range: [5, 9], id: 2 }, none);
		effects.editorSynced(3);
		effects.editorSynced(2);
		expect(revealed).toEqual([]);
		// The editor shows file 2 now: a reveal in it, or naming no file, runs at once.
		effects.exec({ kind: "revealRange", range: [1, 2], id: 2 }, none);
		effects.exec({ kind: "revealRange", range: [3, 4] }, none);
		expect(revealed).toEqual([
			[1, 2],
			[3, 4],
		]);
	});
});
