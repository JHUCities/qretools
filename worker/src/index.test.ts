import { describe, expect, it } from "vitest";
import { type Env, handle } from "./index.js";

const env: Env = {
	CLIENT_ID: "Iv23.id",
	CLIENT_SECRET: "the-secret",
	ALLOWED_ORIGINS: "http://localhost:5199, https://jhucities.github.io",
};
const ORIGIN = "http://localhost:5199";
const verifier = "a".repeat(43);
const exchange = {
	code: "c0de",
	code_verifier: verifier,
	redirect_uri: `${ORIGIN}/`,
};

/** A stub GitHub that records what it was sent and answers `body` (or throws). */
function github(body: unknown, status = 200) {
	const sent: URLSearchParams[] = [];
	const upstream = (async (_url: string, init: RequestInit) => {
		sent.push(new URLSearchParams(String(init.body)));
		if (body instanceof Error) throw body;
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof fetch;
	return { sent, upstream };
}
const post = (path: string, body: unknown, origin = ORIGIN) =>
	new Request(`https://auth.example${path}`, {
		method: "POST",
		headers: { Origin: origin, "Content-Type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

describe("the token exchange Worker", () => {
	it("answers only the app's own origins", async () => {
		const { upstream } = github({});
		const r = await handle(
			post("/exchange", exchange, "https://evil.example"),
			env,
			upstream,
		);
		expect(r.status).toBe(403);
		expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("answers a preflight for an allowed origin", async () => {
		const r = await handle(
			new Request("https://auth.example/exchange", {
				method: "OPTIONS",
				headers: { Origin: ORIGIN },
			}),
			env,
			github({}).upstream,
		);
		expect(r.status).toBe(204);
		expect(r.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
		expect(r.headers.get("Access-Control-Allow-Methods")).toBe("POST");
	});

	it("exchanges a code with the secret, the verifier and the redirect, returning only known fields", async () => {
		const { sent, upstream } = github({
			access_token: "ghu_x",
			token_type: "bearer",
			expires_in: 28800,
			refresh_token: "ghr_y",
			refresh_token_expires_in: 15724800,
			scope: "",
			extra: "never passed on",
		});
		const r = await handle(post("/exchange", exchange), env, upstream);
		expect(r.status).toBe(200);
		expect(r.headers.get("Cache-Control")).toBe("no-store");
		expect(await r.json()).toEqual({
			access_token: "ghu_x",
			token_type: "bearer",
			expires_in: 28800,
			refresh_token: "ghr_y",
			refresh_token_expires_in: 15724800,
		});
		expect(Object.fromEntries(sent[0] ?? [])).toEqual({
			client_id: "Iv23.id",
			client_secret: "the-secret",
			code: "c0de",
			code_verifier: verifier,
			redirect_uri: `${ORIGIN}/`,
		});
	});

	it("refreshes with the refresh grant", async () => {
		const { sent, upstream } = github({ access_token: "ghu_2" });
		const r = await handle(
			post("/refresh", { refresh_token: "ghr_y" }),
			env,
			upstream,
		);
		expect(r.status).toBe(200);
		expect(sent[0]?.get("grant_type")).toBe("refresh_token");
		expect(sent[0]?.get("refresh_token")).toBe("ghr_y");
	});

	it("refuses malformed requests before calling GitHub", async () => {
		const { sent, upstream } = github({});
		for (const body of [
			"not json",
			{ ...exchange, code: "" },
			{ ...exchange, code_verifier: "short" },
			{ ...exchange, redirect_uri: "https://elsewhere.example/" },
			{ ...exchange, redirect_uri: "not a url" },
		]) {
			const r = await handle(post("/exchange", body), env, upstream);
			expect(r.status).toBe(400);
		}
		expect((await handle(post("/refresh", {}), env, upstream)).status).toBe(
			400,
		);
		expect(sent).toHaveLength(0);
	});

	it("passes GitHub's own errors on, but hides its own misconfiguration and never the secret", async () => {
		const denied = await handle(
			post("/exchange", exchange),
			env,
			github({
				error: "bad_verification_code",
				error_description: "The code is wrong.",
			}).upstream,
		);
		expect(denied.status).toBe(400);
		expect(await denied.json()).toEqual({
			error: "bad_verification_code",
			error_description: "The code is wrong.",
		});
		const ours = await handle(
			post("/exchange", exchange),
			env,
			github({
				error: "incorrect_client_credentials",
				error_description: "the-secret is wrong",
			}).upstream,
		);
		expect(ours.status).toBe(502);
		expect(await ours.text()).not.toMatch(/secret/);
	});

	it("reports GitHub being unreachable or failing as upstream", async () => {
		expect(
			(
				await handle(
					post("/exchange", exchange),
					env,
					github(new Error("down")).upstream,
				)
			).status,
		).toBe(502);
		expect(
			(await handle(post("/exchange", exchange), env, github({}, 500).upstream))
				.status,
		).toBe(502);
	});

	it("knows two paths and one method", async () => {
		const { upstream } = github({});
		expect((await handle(post("/other", exchange), env, upstream)).status).toBe(
			404,
		);
		const get = new Request("https://auth.example/exchange", {
			headers: { Origin: ORIGIN },
		});
		expect((await handle(get, env, upstream)).status).toBe(405);
	});
});
