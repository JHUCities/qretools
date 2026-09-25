import { describe, expect, it } from "vitest";
import {
	authorizeUrl,
	base64url,
	callbackOf,
	credentialsOf,
	exchange,
	MARGIN,
	refresh,
	stale,
} from "./auth.js";
import type { SignInConfig } from "./config.js";

const config: SignInConfig = {
	clientId: "Iv23.id",
	authUrl: "https://auth.example",
	redirectUri: "http://localhost:5199/",
};
const pending = {
	state: "s1",
	verifier: "v".repeat(43),
	remember: true,
	hash: "#repo=o/r&branch=b",
	at: 1_000_000,
};

describe("sign-in", () => {
	it("asks GitHub for a code with PKCE, the state and the registered redirect", () => {
		const url = new URL(authorizeUrl(config, { state: "s1", challenge: "c" }));
		expect(url.origin + url.pathname).toBe(
			"https://github.com/login/oauth/authorize",
		);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: "Iv23.id",
			redirect_uri: "http://localhost:5199/",
			state: "s1",
			code_challenge: "c",
			code_challenge_method: "S256",
		});
		expect(base64url(new Uint8Array([251, 255]))).toBe("-_8");
	});

	it("accepts only its own state, once, and in time; a cancel is said plainly", () => {
		expect(callbackOf("?q=1", pending, 1_000_000)).toBeUndefined();
		expect(callbackOf("?code=c&state=s1", pending, 1_000_000 + 60_000)).toEqual(
			{
				ok: true,
				value: {
					code: "c",
					verifier: pending.verifier,
					remember: true,
					hash: pending.hash,
				},
			},
		);
		const refused = (search: string, p = pending, now = 1_000_000) => {
			const r = callbackOf(search, p, now);
			return r !== undefined && !r.ok ? r.error.message : "accepted";
		};
		expect(refused("?code=c&state=other")).toMatch(/did not start here/);
		// No sign-in stored in this tab (another tab, or already used).
		const none = callbackOf("?code=c&state=s1", undefined, 1_000_000);
		expect(none !== undefined && !none.ok && none.error.message).toMatch(
			/did not start here/,
		);
		expect(
			refused("?code=c&state=s1", pending, 1_000_000 + 11 * 60_000),
		).toMatch(/too long/);
		expect(refused("?error=access_denied&state=s1")).toMatch(/cancelled/);
	});

	it("makes lifetimes absolute on arrival, and treats a token with no expiry as lasting", () => {
		expect(
			credentialsOf(
				{
					access_token: "a",
					expires_in: 60,
					refresh_token: "r",
					refresh_token_expires_in: 120,
				},
				1000,
			),
		).toEqual({
			access: "a",
			expiresAt: 61_000,
			refresh: "r",
			refreshExpiresAt: 121_000,
		});
		expect(credentialsOf({ access_token: "a" }, 0)).toEqual({ access: "a" });
		expect(credentialsOf({ nope: 1 }, 0)).toBeUndefined();
		expect(stale({ access: "a" }, 0)).toBe(false);
		expect(stale({ access: "a", expiresAt: 10 * MARGIN }, 9 * MARGIN + 1)).toBe(
			true,
		);
		expect(stale({ access: "a", expiresAt: 10 * MARGIN }, 8 * MARGIN)).toBe(
			false,
		);
	});

	it("redeems through the Worker; only a refused grant ends the sign-in", async () => {
		const replying = (status: number, body: unknown) =>
			(async (url: string, init: RequestInit) => {
				expect(url).toMatch(/^https:\/\/auth\.example\/(exchange|refresh)$/);
				expect(JSON.parse(String(init.body))).toBeDefined();
				return new Response(JSON.stringify(body), { status });
			}) as unknown as typeof fetch;
		const now = () => 0;
		expect(
			await exchange(
				config,
				{ code: "c", verifier: pending.verifier },
				now,
				replying(200, { access_token: "a" }),
			),
		).toEqual({ ok: true, value: { access: "a" } });
		const ended = await refresh(
			config,
			"r",
			now,
			replying(400, { error: "bad_refresh_token" }),
		);
		expect(!ended.ok && ended.error.kind).toBe("auth");
		const flaky = await refresh(
			config,
			"r",
			now,
			replying(502, { error: "upstream" }),
		);
		expect(!flaky.ok && flaky.error.kind).toBe("http");
		const down = await refresh(config, "r", now, (async () => {
			throw new TypeError("offline");
		}) as unknown as typeof fetch);
		expect(!down.ok && down.error.kind).toBe("network");
	});
});
