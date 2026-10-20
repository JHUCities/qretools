/**
 * The two readers of a workspace at a tag agree: the command's, with git, and the app's,
 * through GitHub's API, here answered from the same repository with git's own plumbing
 * in the shapes GitHub documents. What one reads and the other doesn't would make an
 * instrument's DDI depend on where it was exported.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { addressOf, remoteScope, tagMessage } from "@qretools/core";
import { makeGitHubStore, remoteBankOf } from "@qretools/shell";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTagged } from "./remote.ts";

const run = promisify(execFile);
let dir: string;
let repo: string;
const git = async (...args: string[]) =>
	(
		await run(
			"git",
			[
				"-C",
				repo,
				"-c",
				"user.name=t",
				"-c",
				"user.email=t@example.org",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"tag.gpgsign=false",
				...args,
			],
			{ maxBuffer: 1 << 30 },
		)
	).stdout;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "qretools-contract-"));
	repo = join(dir, "o", "bank");
	const ws = join(repo, "surveys");
	await mkdir(join(ws, "questions", "t"), { recursive: true });
	await mkdir(join(ws, "scales"));
	await run("git", ["init", "--quiet", "--initial-branch=main", repo]);
	await writeFile(join(ws, "workspace.yaml"), "agency: org.example\n");
	await writeFile(
		join(ws, "questions", "t", "q.yaml"),
		"name: q\ntext: Q?\nintent: i\nresponses: yn\n",
	);
	await writeFile(join(ws, "scales", "yn.yaml"), 'labels:\n  "1": Yes\n');
	await writeFile(join(repo, "README.md"), "# A bank\n");
	await git("add", ".");
	await git("commit", "--quiet", "-m", "one");
	await writeFile(
		join(ws, "scales", "yn.yaml"),
		'labels:\n  "1": Yes\n  "2": No\n',
	);
	await git("commit", "--quiet", "-am", "two");
	// A release's tag, its message as `build --tag-message` writes one; and a plain tag.
	const blob = async (p: string) =>
		(await git("rev-parse", `HEAD:surveys/${p}`)).trim();
	const message = tagMessage(
		{
			"questions/t/q.yaml": {
				number: "2",
				date: "2026-10-20T12:00:00Z",
				blob: await blob("questions/t/q.yaml"),
			},
			"scales/yn.yaml": {
				number: "2",
				date: "2026-10-20T12:00:00Z",
				blob: await blob("scales/yn.yaml"),
			},
		},
		"2.0.0",
	);
	await writeFile(join(dir, "message.txt"), message);
	await git(
		"tag",
		"-a",
		"--cleanup=verbatim",
		"-F",
		join(dir, "message.txt"),
		"v2",
	);
	await git("tag", "v3");
}, 30000);
afterAll(() => rm(dir, { recursive: true, force: true }));

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

/** GitHub's API for the requests a read at a tag makes, answered from the repository. */
const github = (async (url: string | URL | Request, init: RequestInit = {}) => {
	const href = String(url);
	const tree = /\/git\/trees\/([0-9a-f]+)/.exec(href)?.[1];
	if (tree !== undefined) {
		const listed = await git("ls-tree", "-r", "-l", "-z", tree);
		return json({
			truncated: false,
			tree: listed
				.split("\0")
				.filter((e) => e !== "")
				.map((e) => {
					const tab = e.indexOf("\t");
					const [, type, sha, size] = e.slice(0, tab).split(/ +/);
					return { path: e.slice(tab + 1), type, sha, size: Number(size) };
				}),
		});
	}
	const { query, variables } = JSON.parse(String(init.body)) as {
		query: string;
		variables: Record<string, string>;
	};
	if (query.startsWith("query Tagged")) {
		const ref = variables.tag ?? "";
		const type = (
			await git("cat-file", "-t", ref).catch(() => "missing")
		).trim();
		const target =
			type === "tag"
				? {
						oid: (await git("rev-parse", ref)).trim(),
						// GitHub's `Tag.message`. Unverified against GitHub, and decided here as the
						// command reads it: whether it ends in a newline, and whether a signature
						// stays (these tags are unsigned). `manifestVersions` reads either way, so
						// this test proves the readers agree here, not byte for byte on GitHub.
						message: await git(
							"for-each-ref",
							"--format=%(contents)",
							ref,
						).then((m) => m.replace(/\n$/, "")),
						// One level, as GitHub's `Tag.target`: the object the tag object names.
						target: {
							oid: (await git("cat-file", "tag", ref))
								.split("\n")[0]
								?.slice("object ".length),
						},
					}
				: { oid: (await git("rev-parse", ref)).trim() };
		const dirOid = (
			await git("rev-parse", variables.dir ?? "").catch(() => "")
		).trim();
		return json({
			data: {
				repository: {
					tag: type === "missing" ? null : { name: ref, target },
					dir: dirOid === "" ? null : { __typename: "Tree", oid: dirOid },
				},
			},
		});
	}
	if (query.startsWith("query Blobs")) {
		const out: Record<string, unknown> = {};
		for (const [k, sha] of Object.entries(variables))
			if (/^b\d+$/.test(k))
				out[k] = {
					text: await git("cat-file", "-p", sha),
					isBinary: false,
					isTruncated: false,
				};
		return json({ data: { repository: out } });
	}
	throw new Error(`Not a request a read at a tag makes: ${href}`);
}) as typeof fetch;

describe("a workspace read at a tag, by the command and by the app", () => {
	it.each(["v2", "v3"])(
		"is the same read at %s, with the same versions",
		async (tag) => {
			const address = addressOf(`o/bank/surveys@${tag}`);
			if (address.kind !== "remote") throw new Error("address");
			const cli = await readTagged(address, {
				root: join(dir, `cache-${tag}`),
				urlOf: () => repo,
			});
			const store = makeGitHubStore(
				{ owner: "o", repo: "bank", path: "surveys" },
				async () => "token",
				{ appToken: true },
				github,
				false,
			);
			const app = remoteBankOf(await store.loadBankAt(tag));
			expect(app).toEqual(cli);
			if (cli.kind !== "files") throw new Error(cli.reason);
			const versions = remoteScope(address.key, cli).versions;
			expect(versions?.["scales/yn.yaml"]?.number).toBe(
				tag === "v2" ? "2" : "1",
			);
		},
		30000,
	);
});
