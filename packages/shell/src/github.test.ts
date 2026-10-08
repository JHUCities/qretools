import { describe, expect, it } from "vitest";
import { batchesOf, makeGitHubStore } from "./github.ts";
import { AuthError, type BranchTarget } from "./storage.ts";

type Seen = { url: string; method: string; body: Record<string, unknown> };
type Canned = (req: Seen) => Response;

/** A store over a fake fetch that answers with `respond` and records every request. */
function store(respond: Canned, appToken = false, path = "") {
	const seen: Seen[] = [];
	const s = makeGitHubStore(
		{ owner: "JHUCities", repo: "bas-question-bank", path },
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
	path: "",
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

	it("refuses a bank folder the default branch doesn't have, rather than load an empty bank", async () => {
		const who = (dir: unknown) =>
			store(
				() =>
					json({
						data: {
							viewer: { login: "iain", avatarUrl: "https://a/iain" },
							repository: {
								viewerPermission: "WRITE",
								defaultBranchRef: { name: "main" },
								dir,
							},
						},
					}),
				false,
				"banks/bsa",
			);
		const missing = await who(null).s.whoAmI();
		expect(!missing.ok && missing.error).toMatchObject({
			kind: "unreadable",
			message:
				"GitHub has no folder `banks/bsa` in JHUCities/bas-question-bank.",
		});
		const present = who({ __typename: "Tree" });
		expect((await present.s.whoAmI()).ok).toBe(true);
		const body = present.seen[0]?.body as { variables: Record<string, string> };
		expect(body.variables.dir).toBe("HEAD:banks/bsa");
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
			{ owner: "o", repo: "r", path: "" },
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
		/** The bank's folder in the repository; `files` are keyed by repository path. */
		folder?: string;
		branch?: boolean;
		patch?: number[];
	}) {
		let exists = opts.branch ?? true;
		const patches = [...(opts.patch ?? [200])];
		return store(
			({ url, method, body }) => {
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
			},
			false,
			opts.folder ?? "",
		);
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

	it("in a bank's folder, reads and writes the repository's paths and answers in the bank's", async () => {
		const { s, seen } = github({
			files: { "banks/bas/scales/a.yaml": "s1" },
			folder: "banks/bas",
		});
		const r = await s.commit(
			target,
			[change("scales/a.yaml", "s1", "new a")],
			"Update a",
		);
		expect(r).toEqual({
			ok: true,
			value: { shas: { "scales/a.yaml": "blob:new a" } },
		});
		const tree = seen.find((q) => q.url.endsWith("/git/trees"));
		expect(tree?.body).toMatchObject({
			tree: [{ path: "banks/bas/scales/a.yaml", sha: "blob:new a" }],
		});
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
	it("reads one folder's YAML files, or null when there is no folder", async () => {
		const { s, seen } = store(
			() =>
				json({
					data: {
						repository: {
							dir: {
								entries: [
									{ name: "a.yaml", type: "blob", object: blob("name: a\n") },
									{ name: "notes.md", type: "blob", object: blob("# x\n") },
									{ name: "old", type: "tree", object: { entries: [] } },
								],
							},
						},
					},
				}),
			false,
			"projects/p",
		);
		const r = await s.readFolder(target, "instruments");
		expect(r.ok && r.value?.map((f) => [f.path, f.text])).toEqual([
			["instruments/a.yaml", "name: a\n"],
		]);
		const variables = seen[0]?.body.variables as Record<string, string>;
		expect(variables.dir).toBe("qretools-iain:projects/p/instruments");
		const none = await store(() =>
			json({ data: { repository: { dir: null } } }),
		).s.readFolder(target, "instruments");
		expect(none).toEqual({ ok: true, value: null });
		const empty = await store(() =>
			json({ data: { repository: { dir: { entries: [] } } } }),
		).s.readFolder(target, "instruments");
		expect(empty).toEqual({ ok: true, value: [] });
		// The store's own folder: paths without a leading slash.
		const own = await store(() =>
			json({
				data: {
					repository: {
						dir: {
							entries: [
								{ name: "workspace.yaml", type: "blob", object: blob("x\n") },
							],
						},
					},
				},
			}),
		).s.readFolder(target, "");
		expect(own.ok && own.value?.map((f) => f.path)).toEqual(["workspace.yaml"]);
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
			{ owner: "o", repo: "r", path: "" },
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
			{ owner: "o", repo: "r", path: "" },
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

describe("loading a workspace", () => {
	/** A repository with one branch per entry: each a folder tree of path to text. */
	function workspaceRepo({
		branches,
		truncated = false,
		odd = {},
	}: {
		branches: Record<string, Record<string, string> | null>;
		truncated?: boolean;
		/** Blobs GitHub won't give as text, by path. */
		odd?: Record<string, "binary" | "truncated">;
	}) {
		const sha = (branch: string, path: string, text: string) =>
			odd[path] === undefined ? `t:${text}` : `o:${branch}:${path}`;
		return (req: Seen): Response => {
			// What the repository holds now: a test may push between loads.
			const blobs = new Map<string, { text: string; path: string }>();
			for (const [branch, tree] of Object.entries(branches))
				for (const [path, text] of Object.entries(tree ?? {}))
					blobs.set(sha(branch, path, text), { text, path });
			if (req.url.includes("/git/trees/")) {
				const branch = decodeURIComponent(
					/\/git\/trees\/tree-([^?]+)/.exec(req.url)?.[1] ?? "",
				);
				return json({
					truncated,
					tree: [
						{ path: "banks", type: "tree", sha: "d" },
						...Object.entries(branches[branch] ?? {}).map(([path, text]) => ({
							path,
							type: "blob",
							sha: sha(branch, path, text),
						})),
					],
				});
			}
			const query = String(req.body.query);
			const v = req.body.variables as Record<string, string>;
			if (query.startsWith("query Tagged")) {
				// A tag reads like a branch here: the same trees, by its name.
				const tag = (v.tag ?? "").replace("refs/tags/", "");
				const tree = branches[tag];
				return json({
					data: {
						repository: {
							tag: tag in branches ? { name: tag } : null,
							dir:
								tree === null || tree === undefined
									? null
									: { __typename: "Tree", oid: `tree-${tag}` },
						},
					},
				});
			}
			if (query.startsWith("query Head")) {
				// A folder on a branch, as `branch:folder` names it: its tree, if there.
				const folderOn = (expression = "") => {
					const branch = expression.slice(0, expression.indexOf(":"));
					const tree = branches[branch];
					return tree === null || tree === undefined
						? null
						: { oid: `tree-${branch}` };
				};
				const branch = (v.ref ?? "").replace("refs/heads/", "");
				return json({
					data: {
						repository: {
							mine: branch in branches ? { name: branch } : null,
							bankRef: { compare: { aheadBy: 2, behindBy: 1 } },
							folder: folderOn(v.folder),
							bankFolder: folderOn(v.bankFolder),
						},
					},
				});
			}
			const repository: Record<string, unknown> = {};
			for (const [k, oid] of Object.entries(v))
				if (/^b\d+$/.test(k)) {
					const b = blobs.get(oid);
					const how = b === undefined ? undefined : odd[b.path];
					repository[k] =
						b === undefined
							? null
							: how === "binary"
								? { text: null, isBinary: true, isTruncated: false }
								: how === "truncated"
									? { text: "", isBinary: false, isTruncated: true }
									: { text: b.text, isBinary: false, isTruncated: false };
				}
			return json({ data: { repository } });
		};
	}
	const blobQueries = (seen: Seen[]) =>
		seen.filter((r) => String(r.body.query ?? "").startsWith("query Blobs"));

	it("reads every workspace file from the author's branch, from its folder's one tree", async () => {
		const { s, seen } = store(
			workspaceRepo({
				branches: {
					"qretools-iain": {
						"workspace.yaml": "agency: org.example\n",
						"instruments/x.yaml": "name: x\n",
						"banks/hh/bank.yaml": "agency: org.example\n",
						"README.md": "# hi\n",
						".github/workflows/check.yaml": "on: push\n",
						"node_modules/p/x.yaml": "x\n",
					},
				},
			}),
		);
		const r = await s.loadWorkspace(target);
		expect(r).toEqual({
			ok: true,
			value: {
				files: [
					{
						path: "workspace.yaml",
						sha: "t:agency: org.example\n",
						text: "agency: org.example\n",
					},
					{ path: "instruments/x.yaml", sha: "t:name: x\n", text: "name: x\n" },
					{
						path: "banks/hh/bank.yaml",
						sha: "t:agency: org.example\n",
						text: "agency: org.example\n",
					},
				],
				unread: [],
				found: true,
				from: "branch",
				aheadBy: 2,
				behindBy: 1,
			},
		});
		// The head, the tree, and one batch of texts, the same text fetched once.
		expect(seen).toHaveLength(3);
		expect(Object.keys(blobQueries(seen)[0]?.body.variables as object)).toEqual(
			["owner", "repo", "b0", "b1"],
		);
	});

	it("reads a bank at a tag, pinned to it, and says why when it isn't there", async () => {
		const { s, seen } = store(
			workspaceRepo({
				branches: { v1: { "bank.yaml": "agency: org.example\n" }, v2: null },
			}),
		);
		expect(await s.loadBankAt("v1")).toEqual({
			ok: true,
			value: {
				found: true,
				files: [
					{
						path: "bank.yaml",
						sha: "t:agency: org.example\n",
						text: "agency: org.example\n",
					},
				],
				unread: [],
			},
		});
		expect(seen[0]?.body.variables).toMatchObject({
			tag: "refs/tags/v1",
			dir: "refs/tags/v1:",
		});
		expect(await s.loadBankAt("v3")).toMatchObject({
			ok: true,
			value: { found: false, reason: expect.stringMatching(/no tag `v3`/) },
		});
		expect(await s.loadBankAt("v2")).toMatchObject({
			ok: true,
			value: { found: false, reason: expect.stringMatching(/no folder/) },
		});
	});

	it("reports a missing repository as unreadable", async () => {
		const r = await store(() =>
			json({
				data: { repository: null },
				errors: [{ message: "Could not resolve" }],
			}),
		).s.loadWorkspace(target);
		expect(!r.ok && r.error.kind).toBe("unreadable");
	});

	it("takes an error on any other field as a failure, never a missing folder", async () => {
		const r = await store(() =>
			json({
				data: { repository: { mine: { name: "qretools-iain" }, folder: null } },
				errors: [{ message: "timeout", path: ["repository", "folder"] }],
			}),
		).s.loadWorkspace(target);
		expect(!r.ok && r.error.kind).toBe("unreadable");
	});

	it("keeps the data GitHub sends with an error about comparing a branch not made yet", async () => {
		const repo = workspaceRepo({
			branches: { main: { "instruments/x.yaml": "name: x\n" } },
		});
		const { s } = store((req) => {
			const answer = repo(req);
			if (!String(req.body.query ?? "").startsWith("query Head")) return answer;
			return new Response(
				JSON.stringify({
					data: {
						repository: {
							mine: null,
							folder: null,
							bankFolder: { oid: "tree-main" },
						},
					},
					errors: [
						{
							message: "Could not resolve head ref",
							path: ["repository", "bankRef", "compare"],
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		expect(await s.loadWorkspace(target)).toMatchObject({
			ok: true,
			value: { from: "default", files: [{ path: "instruments/x.yaml" }] },
		});
	});

	it("reads the bank's default branch while the author's branch doesn't exist, in the same request", async () => {
		const { s, seen } = store(
			workspaceRepo({
				branches: { main: { "instruments/x.yaml": "name: x\n" } },
			}),
		);
		expect(await s.loadWorkspace(target)).toMatchObject({
			ok: true,
			value: {
				from: "default",
				aheadBy: 0,
				behindBy: 0,
				found: true,
				files: [{ path: "instruments/x.yaml" }],
			},
		});
		// One head (both branches), the tree, one batch.
		expect(seen).toHaveLength(3);
	});

	it("is no workspace where its folder isn't, never an empty one", async () => {
		const { s } = store(workspaceRepo({ branches: { "qretools-iain": null } }));
		expect(await s.loadWorkspace(target)).toMatchObject({
			ok: true,
			value: { found: false, files: [] },
		});
	});

	it("refuses a tree GitHub cut short, rather than read the rest as deleted", async () => {
		const { s } = store(
			workspaceRepo({
				branches: { "qretools-iain": { "x.yaml": "x\n" } },
				truncated: true,
			}),
		);
		expect(await s.loadWorkspace(target)).toMatchObject({
			ok: false,
			error: {
				kind: "unreadable",
				message: expect.stringMatching(/too large/),
			},
		});
	});

	it("lists the files GitHub won't give as text, and reads the rest", async () => {
		const { s } = store(
			workspaceRepo({
				branches: {
					"qretools-iain": {
						"a.yaml": "a\n",
						"b.yaml": "b\n",
						"c.yaml": "c\n",
					},
				},
				odd: { "a.yaml": "binary", "b.yaml": "truncated" },
			}),
		);
		expect(await s.loadWorkspace(target)).toMatchObject({
			ok: true,
			value: {
				files: [{ path: "c.yaml" }],
				unread: [
					{ path: "a.yaml", reason: "It isn't text." },
					{
						path: "b.yaml",
						reason: "It's too large for GitHub to send as text.",
					},
				],
			},
		});
	});

	it("asks for texts in batches, and on a reload only for those that changed", async () => {
		const many = Object.fromEntries(
			Array.from({ length: 300 }, (_, i) => [`q/${i}.yaml`, `n: ${i}\n`]),
		);
		const branches: Record<string, Record<string, string>> = {
			"qretools-iain": many,
		};
		const { s, seen } = store(workspaceRepo({ branches }));
		await s.loadWorkspace(target);
		expect(blobQueries(seen)).toHaveLength(2);
		branches["qretools-iain"] = { ...many, "q/0.yaml": "n: changed\n" };
		seen.length = 0;
		const again = await s.loadWorkspace(target);
		expect(blobQueries(seen)).toHaveLength(1);
		expect(
			Object.values(blobQueries(seen)[0]?.body.variables as object),
		).toContain("t:n: changed\n");
		expect(again.ok && again.value.files.length).toBe(300);
	});

	it("reads paths within the workspace's folder, and asks for that folder's tree", async () => {
		const { s, seen } = store(
			workspaceRepo({ branches: { "qretools-iain": { "w.yaml": "w\n" } } }),
			false,
			"teams/a",
		);
		const r = await s.loadWorkspace(target);
		expect(r.ok && r.value.files.map((f) => f.path)).toEqual(["w.yaml"]);
		expect(seen[0]?.body.variables).toMatchObject({
			folder: "qretools-iain:teams/a",
		});
	});
});

describe("batches of blobs", () => {
	const ids = (n: number) => Array.from({ length: n }, (_, i) => i);
	it("hold at most 250, in order", () => {
		expect(batchesOf(ids(600), () => 1).map((b) => b.length)).toEqual([
			250, 250, 100,
		]);
	});

	it("hold at most a megabyte, a larger file alone", () => {
		const size = (i: number) => [600_000, 600_000, 2_000_000, 10][i] ?? 0;
		expect(batchesOf(ids(4), size)).toEqual([[0], [1], [2], [3]]);
		expect(batchesOf(ids(3), () => 400_000)).toEqual([[0, 1], [2]]);
	});
});
