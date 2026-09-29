import { describe, expect, it } from "vitest";
import { makeGitHubStore } from "./github.js";
import { AuthError, type BranchTarget } from "./storage.js";

type Seen = { url: string; method: string; body: Record<string, unknown> };
type Canned = (req: Seen) => Response;

/** A store over a fake fetch that answers with `respond` and records every request. */
function store(respond: Canned, appToken = false) {
	const seen: Seen[] = [];
	const s = makeGitHubStore(
		{ owner: "JHUCities", repo: "bas-question-bank" },
		async () => "tok",
		{ appToken },
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
	branch: "qretools-iain",
	defaultBranch: "main",
};

describe("GitHub adapter (Octokit)", () => {
	it("whoAmI reads the login, the permission and the default branch in one request", async () => {
		const { s, seen } = store(() =>
			json({
				data: {
					viewer: { login: "iain", avatarUrl: "https://a/iain" },
					repository: {
						viewerPermission: "READ",
						defaultBranchRef: { name: "main" },
					},
				},
			}),
		);
		expect(await s.whoAmI()).toEqual({
			ok: true,
			value: {
				login: "iain",
				avatarUrl: "https://a/iain",
				access: { kind: "readOnly" },
				defaultBranch: "main",
			},
		});
		expect(seen).toHaveLength(1);
		const { s: writer } = store(() =>
			json({
				data: {
					viewer: { login: "iain", avatarUrl: "https://a/iain" },
					repository: {
						viewerPermission: "WRITE",
						defaultBranchRef: { name: "trunk" },
					},
				},
			}),
		);
		expect(await writer.whoAmI()).toMatchObject({
			value: { access: { kind: "write" }, defaultBranch: "trunk" },
		});
	});

	it("knows whether the app it signed in with is installed on the repository", async () => {
		const who = (viewerPermission = "WRITE") =>
			json({
				data: {
					viewer: { login: "iain", avatarUrl: "https://a/iain" },
					repository: {
						viewerPermission,
						isEmpty: false,
						defaultBranchRef: { name: "main" },
					},
				},
			});
		const access = async (
			installations: unknown[],
			pages: unknown[][] = [],
			viewerPermission = "WRITE",
		) => {
			const { s, seen } = store((req) => {
				if (req.url.endsWith("/graphql")) return who(viewerPermission);
				if (req.url.includes("/user/installations/7/repositories")) {
					const page = Number(new URL(req.url).searchParams.get("page") ?? "1");
					return json({ repositories: pages[page - 1] ?? [] });
				}
				return json({ installations });
			}, true);
			const r = await s.whoAmI();
			return { access: r.ok ? r.value.access.kind : r.error.kind, seen };
		};
		const org = (selection: string, login = "JHUCities") => ({
			id: 7,
			account: { login },
			repository_selection: selection,
		});
		expect((await access([org("all")])).access).toBe("write");
		// The owner's login differs only in case.
		expect((await access([org("all", "jhucities")])).access).toBe("write");
		expect((await access([])).access).toBe("notInstalled");
		expect((await access([org("all", "someone-else")])).access).toBe(
			"notInstalled",
		);
		const full = (n: number) =>
			Array.from({ length: n }, (_, i) => ({
				full_name: `JHUCities/other-${i}`,
			}));
		// Selected repositories: found on the second page, or not at all.
		expect(
			(
				await access(
					[org("selected")],
					[full(100), [{ full_name: "JHUCities/bas-question-bank" }]],
				)
			).access,
		).toBe("write");
		expect((await access([org("selected")], [full(3)])).access).toBe(
			"notInstalled",
		);
		// Read only wins: installing the app would not help.
		expect((await access([], [], "READ")).access).toBe("readOnly");
	});

	it("a token GitHub says is not an app's has nothing to check, and still signs in", async () => {
		const { s } = store(
			(req) =>
				req.url.endsWith("/graphql")
					? json({
							data: {
								viewer: { login: "iain", avatarUrl: "https://a/iain" },
								repository: {
									viewerPermission: "WRITE",
									isEmpty: false,
									defaultBranchRef: { name: "main" },
								},
							},
						})
					: json(
							{
								message:
									"You must authenticate with an access token authorized to a GitHub App in order to list installations",
							},
							403,
						),
			true,
		);
		expect(await s.whoAmI()).toMatchObject({
			ok: true,
			value: { access: { kind: "write" } },
		});
	});

	it("a pasted token asks nothing about installations", async () => {
		const { s, seen } = store(() =>
			json({
				data: {
					viewer: { login: "iain", avatarUrl: "https://a/iain" },
					repository: {
						viewerPermission: "WRITE",
						isEmpty: false,
						defaultBranchRef: { name: "main" },
					},
				},
			}),
		);
		expect(await s.whoAmI()).toMatchObject({
			ok: true,
			value: { access: { kind: "write" } },
		});
		expect(seen.some((r) => r.url.includes("/user/installations"))).toBe(false);
	});

	it("an empty repository says so, with a hint that fits the permission", async () => {
		const empty = (viewerPermission: string) =>
			store(() =>
				json({
					data: {
						viewer: { login: "iain", avatarUrl: "https://a/iain" },
						repository: {
							viewerPermission,
							isEmpty: true,
							defaultBranchRef: null,
						},
					},
				}),
			).s.whoAmI();
		const own = await empty("ADMIN");
		expect(own).toMatchObject({ ok: false, error: { kind: "empty" } });
		expect(!own.ok && own.error.message).toMatch(/is empty on GitHub/);
		expect(!own.ok && own.error.hint).toMatch(/Add a first file/);
		const other = await empty("READ");
		expect(!other.ok && other.error.hint).toMatch(
			/Ask someone with write access/,
		);
		// A repository that is not there at all still says that.
		const none = await store(() =>
			json({
				data: {
					viewer: { login: "iain", avatarUrl: "https://a/iain" },
					repository: null,
				},
			}),
		).s.whoAmI();
		expect(!none.ok && none.error.message).toMatch(/has no repository/);
	});

	it("maps a rejected token and no network to failures", async () => {
		const auth = await store(() =>
			json({ message: "Bad credentials" }, 401),
		).s.whoAmI();
		expect(!auth.ok && auth.error.kind).toBe("auth");
		const down = makeGitHubStore(
			{ owner: "o", repo: "r" },
			async () => "tok",
			{ appToken: false },
			(async () => {
				throw new TypeError("offline");
			}) as typeof fetch,
			false,
		);
		const net = await down.whoAmI();
		expect(!net.ok && net.error.kind).toBe("network");
	});

	/**
	 * A fake GitHub for commits: the branch head holds `files` (path → sha), or no
	 * branch at all; blobs are named by their text; the ref update answers `patch`
	 * in turn.
	 */
	function github(opts: {
		files: Record<string, string>;
		branch?: boolean;
		patch?: number[];
	}) {
		let exists = opts.branch ?? true;
		const patches = [...(opts.patch ?? [200])];
		return store(({ url, method, body }) => {
			if (url.endsWith("/graphql")) {
				const vars = body.variables as Record<string, string>;
				if (!exists) return json({ data: { repository: { head: null } } });
				const target: Record<string, unknown> = {
					oid: "head",
					tree: { oid: "tree" },
				};
				for (const [k, path] of Object.entries(vars))
					if (/^p\d+$/.test(k))
						target[k] =
							opts.files[path] === undefined
								? null
								: { oid: opts.files[path], object: { text: "old" } };
				return json({ data: { repository: { head: { target } } } });
			}
			if (url.endsWith("/git/ref/heads/main"))
				return json({ object: { sha: "main-head" } });
			if (url.endsWith("/git/refs") && method === "POST") {
				exists = true;
				return json({ ref: "x" }, 201);
			}
			if (url.endsWith("/git/blobs"))
				return json({ sha: `blob:${body.content}` }, 201);
			if (url.endsWith("/git/trees")) return json({ sha: "tree2" }, 201);
			if (url.endsWith("/git/commits")) return json({ sha: "commit2" }, 201);
			if (method === "PATCH") {
				const status = patches.shift() ?? 200;
				return json(
					status === 200
						? { object: { sha: "commit2" } }
						: { message: "Update is not a fast forward" },
					status,
				);
			}
			return json({ message: "unexpected" }, 500);
		});
	}
	const change = (
		path: string,
		expected: string | null,
		text: string | null,
	) => ({
		id: 1,
		path,
		expected,
		text,
	});

	it("commits a change set in one commit on the branch head, never forcing the update", async () => {
		const { s, seen } = github({ files: { "scales/a.yaml": "s1" } });
		const r = await s.commit(
			target,
			[
				change("scales/a.yaml", "s1", "new a"),
				change("questions/q/q.yaml", null, "q"),
			],
			"Update q",
		);
		expect(r).toEqual({
			ok: true,
			value: {
				shas: { "scales/a.yaml": "blob:new a", "questions/q/q.yaml": "blob:q" },
			},
		});
		const tree = seen.find((q) => q.url.endsWith("/git/trees"));
		expect(tree?.body).toMatchObject({ base_tree: "tree" });
		const commit = seen.find((q) => q.url.endsWith("/git/commits"));
		expect(commit?.body).toMatchObject({
			parents: ["head"],
			message: "Update q",
		});
		const patch = seen.find((q) => q.method === "PATCH");
		expect(patch?.url).toMatch(/git\/refs\/heads\/qretools-iain$/);
		expect(patch?.body).toMatchObject({ sha: "commit2", force: false });
	});

	it("refuses a change set when any path moved on GitHub, writing nothing", async () => {
		const { s, seen } = github({ files: { "scales/a.yaml": "s2" } });
		const r = await s.commit(
			target,
			[change("scales/a.yaml", "s1", "mine")],
			"m",
		);
		expect(!r.ok && r.error.failure.kind).toBe("stale");
		expect(!r.ok && r.error.seen).toEqual({
			"scales/a.yaml": { sha: "s2", text: "old" },
		});
		expect(
			seen.filter((q) => q.method !== "POST" || !q.url.endsWith("/graphql")),
		).toEqual([]);
	});

	it("a first save creates the branch from the default branch, then commits on it", async () => {
		const { s, seen } = github({ files: {}, branch: false });
		const r = await s.commit(
			target,
			[change("questions/q/q.yaml", null, "q")],
			"Add q",
		);
		expect(r.ok).toBe(true);
		const made = seen.find(
			(q) => q.url.endsWith("/git/refs") && q.method === "POST",
		);
		expect(made?.body).toEqual({
			ref: "refs/heads/qretools-iain",
			sha: "main-head",
		});
	});

	it("a delete is a tree entry with no sha; a change that changes nothing makes no commit", async () => {
		const del = github({ files: { "questions/q/q.yaml": "s1" } });
		await del.s.commit(
			target,
			[change("questions/q/q.yaml", "s1", null)],
			"Delete q",
		);
		const tree = del.seen.find((q) => q.url.endsWith("/git/trees"));
		expect(tree?.body.tree).toEqual([
			{ path: "questions/q/q.yaml", mode: "100644", type: "blob", sha: null },
		]);
		const same = github({ files: { "scales/a.yaml": "blob:same" } });
		const r = await same.s.commit(
			target,
			[change("scales/a.yaml", "blob:same", "same")],
			"m",
		);
		expect(r).toEqual({
			ok: true,
			value: { shas: { "scales/a.yaml": "blob:same" } },
		});
		expect(same.seen.some((q) => q.url.endsWith("/git/commits"))).toBe(false);
	});

	it("a lost fast-forward starts over from the read once; twice is a failure", async () => {
		const once = github({ files: {}, patch: [422, 200] });
		expect(
			(await once.s.commit(target, [change("a.yaml", null, "a")], "m")).ok,
		).toBe(true);
		expect(once.seen.filter((q) => q.method === "PATCH")).toHaveLength(2);
		const twice = github({ files: {}, patch: [422, 422] });
		const r = await twice.s.commit(target, [change("a.yaml", null, "a")], "m");
		expect(!r.ok && r.error.failure.kind).toBe("stale");
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
		mine: mine ? { name: "qretools-iain" } : null,
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
		concepts: {
			entries: [
				{ name: "trust.yaml", type: "blob", object: blob("label: Trust\n") },
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
			"concepts/trust.yaml",
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
		// Every shared kind's folder is asked for, from the one table.
		const body = seen[0]?.body as
			| { variables: Record<string, string> }
			| undefined;
		const variables = body?.variables ?? {};
		expect(Object.keys(variables)).toEqual(
			expect.arrayContaining([
				"concepts",
				"scales",
				"universes",
				"instructions",
			]),
		);
	});

	it("before the first save, loads the bank instead, keeping the data GitHub sends with its errors", async () => {
		const { s, seen } = store(({ body }) => {
			const variables = body.variables as Record<string, string>;
			return variables.ref === "refs/heads/qretools-iain"
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
		expect(r.ok && r.value.files).toHaveLength(5);
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

	it("reads a file from the branch it is given, and says so when it is not there", async () => {
		const { s, seen } = store(() =>
			json({ data: { repository: { file: null } } }),
		);
		const r = await s.read(target, "questions/a/a.yaml");
		expect(!r.ok && r.error.status).toBe(404);
		expect(seen).toHaveLength(1);
		const variables = seen[0]?.body.variables as
			| Record<string, string>
			| undefined;
		expect(variables?.at).toBe("qretools-iain:questions/a/a.yaml");
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

	it("asks the getter before every request, and reports its refusal as itself", async () => {
		let n = 0;
		const headers: string[] = [];
		const s = makeGitHubStore(
			{ owner: "o", repo: "r" },
			async () => `tok${++n}`,
			{ appToken: false },
			(async (_url: string, init: RequestInit = {}) => {
				headers.push(String(new Headers(init.headers).get("authorization")));
				return new Response(
					JSON.stringify({
						data: {
							viewer: { login: "i", avatarUrl: "https://a/i" },
							repository: {
								viewerPermission: "READ",
								defaultBranchRef: { name: "main" },
							},
						},
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}) as typeof fetch,
			false,
		);
		await s.whoAmI();
		await s.whoAmI();
		expect(headers).toEqual(["token tok1", "token tok2"]);
		const ended = makeGitHubStore(
			{ owner: "o", repo: "r" },
			async () => {
				throw new AuthError({
					kind: "auth",
					message: "Your GitHub sign-in has ended.",
				});
			},
			{ appToken: false },
			(async () => new Response("{}")) as typeof fetch,
			false,
		);
		const r = await ended.whoAmI();
		expect(!r.ok && r.error).toEqual({
			kind: "auth",
			message: "Your GitHub sign-in has ended.",
		});
	});
});
