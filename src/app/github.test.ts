import { describe, expect, it } from "vitest";
import { decode, encode, makeGitHubStore } from "./github.js";
import { DEFAULT_SETTINGS } from "./model.js";

type Canned = (url: string, init: RequestInit) => Response;
const store = (respond: Canned) =>
	makeGitHubStore({ ...DEFAULT_SETTINGS, branch: "sandbox" }, "tok", (async (
		url,
		init,
	) => respond(String(url), init ?? {})) as typeof fetch);
const json = (
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers });

describe("GitHub adapter", () => {
	it("encodes UTF-8 as base64 both ways", () => {
		const text = "text: “Curly” quotes – and an en dash, rôle\n";
		expect(decode(encode(text))).toBe(text);
		expect(
			decode(`${encode(text).slice(0, 10)}\n${encode(text).slice(10)}`),
		).toBe(text);
	});

	it("whoAmI combines the login with the repository permission", async () => {
		const s = store((url) =>
			url.endsWith("/user")
				? json({ login: "iain" })
				: json({ permissions: { push: false, pull: true } }),
		);
		expect(await s.whoAmI()).toEqual({
			ok: true,
			value: { login: "iain", canWrite: false },
		});
	});

	it("sends the token and the API version on every call", async () => {
		let seen: Record<string, string> = {};
		const s = store((_, init) => {
			seen = init.headers as Record<string, string>;
			return json({ login: "x" });
		});
		await s.whoAmI();
		expect(seen.Authorization).toBe("Bearer tok");
		expect(seen["X-GitHub-Api-Version"]).toBe("2022-11-28");
	});

	it("maps a rejected token, a stale write, and a spent rate limit to failures", async () => {
		expect(
			(await store(() => json({ message: "Bad credentials" }, 401)).whoAmI())
				.ok,
		).toBe(false);
		const stale = await store(() =>
			json({ message: "sha mismatch" }, 409),
		).write("questions/a/a.yaml", "x", "m", "old");
		expect(!stale.ok && stale.error.kind).toBe("stale");
		const limited = await store(() =>
			json({ message: "limit" }, 403, {
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": "1700000000",
			}),
		).whoAmI();
		expect(!limited.ok && limited.error.kind).toBe("rateLimited");
		const down = makeGitHubStore(DEFAULT_SETTINGS, "tok", (async () => {
			throw new Error("offline");
		}) as typeof fetch);
		const net = await down.whoAmI();
		expect(!net.ok && net.error.kind).toBe("network");
	});

	it("writes with the sha and branch, and returns the new sha", async () => {
		let body: Record<string, unknown> = {};
		const s = store((url, init) => {
			body = JSON.parse(String(init.body));
			expect(url).toBe(
				"https://api.github.com/repos/JHUCities/bas-question-bank/contents/questions/nhd/nhd_sat.yaml",
			);
			return json({ content: { sha: "new" } });
		});
		expect(
			await s.write(
				"questions/nhd/nhd_sat.yaml",
				"name: nhd_sat\n",
				"Update nhd_sat: text",
				"old",
			),
		).toEqual({ ok: true, value: { sha: "new" } });
		expect(body).toMatchObject({
			message: "Update nhd_sat: text",
			sha: "old",
			branch: "sandbox",
		});
		expect(decode(body.content as string)).toBe("name: nhd_sat\n");
	});

	it("reads the bank from one GraphQL reply, keeping only complete YAML blobs", async () => {
		const blob = (text: string, extra = {}) => ({
			oid: "o",
			text,
			isBinary: false,
			isTruncated: false,
			...extra,
		});
		const s = store(() =>
			json({
				data: {
					repository: {
						questions: {
							entries: [
								{
									name: "nhd",
									type: "tree",
									object: {
										entries: [
											{
												name: "nhd_sat.yaml",
												type: "blob",
												object: blob("name: nhd_sat\n"),
											},
											{ name: "notes.txt", type: "blob", object: blob("x") },
											{
												name: "big.yaml",
												type: "blob",
												object: blob("", { isTruncated: true }),
											},
										],
									},
								},
							],
						},
						scales: {
							entries: [
								{
									name: "agree4.yaml",
									type: "blob",
									object: blob("labels:\n  1: a\n"),
								},
							],
						},
						universes: {
							entries: [
								{
									name: "renters.yaml",
									type: "blob",
									object: blob("text: Renters\n"),
								},
							],
						},
						// A bank without instructions: GitHub answers null.
						instructions: null,
						missing: blob('labels:\n  "-8": NR\n'),
					},
				},
			}),
		);
		const r = await s.loadBank();
		expect(r.ok && r.value.map((f) => f.path)).toEqual([
			"questions/nhd/nhd_sat.yaml",
			"scales/agree4.yaml",
			"universes/renters.yaml",
			"missing.yaml",
		]);
	});

	it("reports a missing repository as unreadable with a hint", async () => {
		const r = await store(() =>
			json({
				data: { repository: null },
				errors: [{ message: "Could not resolve" }],
			}),
		).loadBank();
		expect(!r.ok && r.error.kind).toBe("unreadable");
	});
});
