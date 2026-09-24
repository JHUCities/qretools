import { describe, expect, it } from "vitest";
import { decode, encode, makeGitHubStore } from "./github.js";
import type { BranchTarget } from "./storage.js";

type Seen = { url: string; method: string; body: Record<string, unknown> };
type Canned = (req: Seen) => Response;

/** A store over a fake fetch that answers with `respond` and records every request. */
function store(respond: Canned) {
	const seen: Seen[] = [];
	const s = makeGitHubStore(
		{ owner: "JHUCities", repo: "bas-question-bank" },
		"tok",
		(async (url: string, init: RequestInit = {}) => {
			const req = {
				url: String(url),
				method: init.method ?? "GET",
				body: init.body ? JSON.parse(String(init.body)) : {},
			};
			seen.push(req);
			return respond(req);
		}) as typeof fetch,
		false,
	);
	return { s, seen };
}
const json = (
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
) =>
	new Response(status === 204 ? null : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

const target: BranchTarget = {
	owner: "JHUCities",
	repo: "bas-question-bank",
	branch: "qretools/iain",
	defaultBranch: "main",
};

describe("GitHub adapter (Octokit)", () => {
	it("encodes UTF-8 as base64 both ways", () => {
		const text = "text: “Curly” quotes – and an en dash, rôle\n";
		expect(decode(encode(text))).toBe(text);
		expect(
			decode(`${encode(text).slice(0, 10)}\n${encode(text).slice(10)}`),
		).toBe(text);
	});

	it("whoAmI reads the login, the permission and the default branch in one request", async () => {
		const { s, seen } = store(() =>
			json({
				data: {
					viewer: { login: "iain" },
					repository: {
						viewerPermission: "READ",
						defaultBranchRef: { name: "main" },
					},
				},
			}),
		);
		expect(await s.whoAmI()).toEqual({
			ok: true,
			value: { login: "iain", canWrite: false, defaultBranch: "main" },
		});
		expect(seen).toHaveLength(1);
		const { s: writer } = store(() =>
			json({
				data: {
					viewer: { login: "iain" },
					repository: {
						viewerPermission: "WRITE",
						defaultBranchRef: { name: "trunk" },
					},
				},
			}),
		);
		expect(await writer.whoAmI()).toMatchObject({
			value: { canWrite: true, defaultBranch: "trunk" },
		});
	});

	it("maps a rejected token, a stale write and no network to failures", async () => {
		const auth = await store(() =>
			json({ message: "Bad credentials" }, 401),
		).s.whoAmI();
		expect(!auth.ok && auth.error.kind).toBe("auth");
		const stale = await store(() =>
			json({ message: "sha mismatch" }, 409),
		).s.write(target, "questions/a/a.yaml", "x", "m", "old");
		expect(!stale.ok && stale.error.kind).toBe("stale");
		const down = makeGitHubStore(
			{ owner: "o", repo: "r" },
			"tok",
			(async () => {
				throw new TypeError("offline");
			}) as typeof fetch,
			false,
		);
		const net = await down.whoAmI();
		expect(!net.ok && net.error.kind).toBe("network");
	});

	it("writes to the author's branch with the sha, keeping the path's slashes, and returns the new sha", async () => {
		const { s, seen } = store(() => json({ content: { sha: "new" } }));
		expect(
			await s.write(
				target,
				"questions/nhd/nhd_sat.yaml",
				"name: nhd_sat\n",
				"Update nhd_sat: text",
				"old",
			),
		).toEqual({ ok: true, value: { sha: "new" } });
		expect(seen[0]?.url).toBe(
			"https://api.github.com/repos/JHUCities/bas-question-bank/contents/questions/nhd/nhd_sat.yaml",
		);
		expect(seen[0]?.body).toMatchObject({
			message: "Update nhd_sat: text",
			sha: "old",
			branch: "qretools/iain",
		});
		expect(decode(seen[0]?.body.content as string)).toBe("name: nhd_sat\n");
	});

	it("a first save creates the author's branch from the default branch, then writes", async () => {
		let puts = 0;
		const { s, seen } = store(({ url, method }) => {
			if (method === "PUT")
				return puts++ === 0
					? json({ message: "Branch qretools/iain not found" }, 404)
					: json({ content: { sha: "new" } });
			if (url.endsWith("/git/ref/heads/main"))
				return json({ object: { sha: "head-of-main" } });
			if (url.endsWith("/git/refs")) return json({ ref: "x" }, 201);
			return json({}, 500);
		});
		const r = await s.write(target, "questions/a/a.yaml", "x", "Add a");
		expect(r).toEqual({ ok: true, value: { sha: "new" } });
		expect(seen.map((q) => q.method)).toEqual(["PUT", "GET", "POST", "PUT"]);
		expect(seen[2]?.body).toEqual({
			ref: "refs/heads/qretools/iain",
			sha: "head-of-main",
		});
	});

	it("a branch another tab created meanwhile counts as created", async () => {
		const { s } = store(({ url }) =>
			url.endsWith("/git/refs")
				? json({ message: "Reference already exists" }, 422)
				: json({ object: { sha: "h" } }),
		);
		expect(await s.ensureBranch(target)).toEqual({
			ok: true,
			value: undefined,
		});
	});

	const blob = (text: string, extra = {}) => ({
		oid: "o",
		text,
		isBinary: false,
		isTruncated: false,
		...extra,
	});
	const repository = (mine: boolean) => ({
		mine: mine ? { name: "qretools/iain" } : null,
		bankRef: { compare: mine ? { aheadBy: 2, behindBy: 1 } : null },
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
				{ name: "renters.yaml", type: "blob", object: blob("text: Renters\n") },
			],
		},
		// A bank without instructions: GitHub answers null.
		instructions: null,
		missing: blob('labels:\n  "-8": NR\n'),
	});

	it("loads the author's branch in one request: complete YAML blobs, and how it compares with the bank", async () => {
		const { s, seen } = store(() =>
			json({ data: { repository: repository(true) } }),
		);
		const r = await s.loadBank(target);
		expect(r.ok && r.value.files.map((f) => f.path)).toEqual([
			"questions/nhd/nhd_sat.yaml",
			"scales/agree4.yaml",
			"universes/renters.yaml",
			"missing.yaml",
		]);
		expect(r.ok && [r.value.from, r.value.aheadBy, r.value.behindBy]).toEqual([
			"branch",
			2,
			1,
		]);
		expect(seen).toHaveLength(1);
	});

	it("before the first save, loads the bank instead, keeping the data GitHub sends with its errors", async () => {
		const { s, seen } = store(({ body }) => {
			const variables = body.variables as Record<string, string>;
			return variables.ref === "refs/heads/qretools/iain"
				? json({
						data: { repository: repository(false) },
						errors: [
							{
								message: "Could not resolve head ref",
								path: ["repository", "bankRef", "compare"],
							},
						],
					})
				: json({ data: { repository: repository(true) } });
		});
		const r = await s.loadBank(target);
		expect(r.ok && r.value.from).toBe("default");
		expect(r.ok && r.value.files).toHaveLength(4);
		expect(seen).toHaveLength(2);
	});

	it("reports a missing repository as unreadable", async () => {
		const r = await store(() =>
			json({
				data: { repository: null },
				errors: [{ message: "Could not resolve" }],
			}),
		).s.loadBank(target);
		expect(!r.ok && r.error.kind).toBe("unreadable");
	});

	it("any other error in the reply is a failure, not an empty folder", async () => {
		const r = await store(() =>
			json({
				data: { repository: { ...repository(true), questions: null } },
				errors: [{ message: "timeout", path: ["repository", "questions"] }],
			}),
		).s.loadBank(target);
		expect(!r.ok && r.error.kind).toBe("unreadable");
	});

	it("reads only the branch it is given: a 404 is not answered from the bank", async () => {
		const { s, seen } = store(() => json({ message: "Not Found" }, 404));
		const r = await s.read(target, "questions/a/a.yaml");
		expect(!r.ok && r.error.status).toBe(404);
		expect(seen).toHaveLength(1);
	});

	it("a secondary rate limit is a rate limit, and a bug is not an outage", async () => {
		const limited = await store(() =>
			json({ message: "You have exceeded a secondary rate limit" }, 403, {
				"retry-after": "60",
			}),
		).s.read(target, "questions/a/a.yaml");
		expect(!limited.ok && limited.error.kind).toBe("rateLimited");
		const odd = await store(() => json({ unexpected: true })).s.ensureBranch(
			target,
		);
		expect(!odd.ok && odd.error.kind).toBe("unreadable");
	});
});
