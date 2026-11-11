/**
 * A bank in another repository, read at its tag with git: against a repository made
 * here, as GitHub would serve it, so nothing reaches the network.
 */
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { addressOf } from "@qretools/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isNoGit } from "./git.ts";
import { readTagged } from "./remote.ts";

const run = promisify(execFile);
const AUTHOR = {
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.org",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.org",
};
let dir: string;
let origin: string;
let cache: string;

const remote = (address: string) => {
	const a = addressOf(address);
	if (a.kind !== "remote") throw new Error(address);
	return a;
};

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "qretools-remote-"));
	origin = join(dir, "o", "bank");
	cache = join(dir, "cache");
	await mkdir(join(origin, "banks", "hh", "questions", "t"), {
		recursive: true,
	});
	const git = (...args: string[]) =>
		run("git", ["-C", origin, ...args], { env: { ...process.env, ...AUTHOR } });
	await run("git", ["init", "--quiet", "--initial-branch=main", origin]);
	await git("config", "commit.gpgsign", "false");
	await git("config", "tag.gpgsign", "false");
	await writeFile(
		join(origin, "banks", "hh", "workspace.yaml"),
		"agency: org.example\n",
	);
	await writeFile(
		join(origin, "banks", "hh", "questions", "t", "q.yaml"),
		"name: q\n",
	);
	await mkdir(join(origin, "banks", "b"), { recursive: true });
	await writeFile(
		join(origin, "banks", "b", "workspace.yaml"),
		"agency: org.b\n",
	);
	await writeFile(join(origin, "README.md"), "# A bank\n");
	await git("add", ".");
	await git("commit", "--quiet", "-m", "v1");
	await git("tag", "-a", "v1", "-m", "v1");
	await git("tag", "v6");
	// A branch named like a tag that doesn't exist: never read as one.
	await git("branch", "v9");
}, 30000);
afterAll(() => rm(dir, { recursive: true, force: true }));

const options = () => ({
	root: cache,
	urlOf: (owner: string, repo: string) => join(dir, owner, repo),
});

describe("a bank in another repository, read at its tag with git", () => {
	it("reads its folder at the tag, then from the cache once read", async () => {
		const read = await readTagged(remote("o/bank/banks/hh@v1"), options());
		const at = async (expression: string) =>
			(await run("git", ["-C", origin, "rev-parse", expression])).stdout.trim();
		expect(read).toEqual({
			kind: "files",
			files: {
				"workspace.yaml": "agency: org.example\n",
				"questions/t/q.yaml": "name: q\n",
			},
			// The commit an annotated tag names, never the tag object; blobs by path in the folder.
			at: {
				commit: await at("v1^{commit}"),
				blobs: {
					"workspace.yaml": await at("v1:banks/hh/workspace.yaml"),
					"questions/t/q.yaml": await at("v1:banks/hh/questions/t/q.yaml"),
				},
				// An annotated tag's message, here prose: no manifest, so no versions from it.
				message: "v1\n",
			},
		});
		// Read again with the repository unreachable: the cache answers.
		const again = await readTagged(remote("o/bank/banks/hh@v1"), {
			root: cache,
			urlOf: () => join(dir, "nowhere"),
		});
		expect(again).toEqual(read);
	}, 30000);

	it("reads a tag again when it names something new, and keeps the last read offline", async () => {
		const git = (...args: string[]) =>
			run("git", ["-C", origin, ...args], {
				env: { ...process.env, ...AUTHOR },
			});
		await git("tag", "-a", "v7", "-m", "first");
		const first = await readTagged(remote("o/bank/banks/hh@v7"), options());
		await writeFile(
			join(origin, "banks", "hh", "questions", "t", "q.yaml"),
			"name: q2\n",
		);
		await git("commit", "--quiet", "-am", "moved");
		await git("tag", "-f", "-a", "v7", "-m", "second");
		const moved = await readTagged(remote("o/bank/banks/hh@v7"), options());
		const commit = (await git("rev-parse", "v7^{commit}")).stdout.trim();
		expect(moved).toMatchObject({
			kind: "files",
			files: { "questions/t/q.yaml": "name: q2\n" },
			at: { commit, message: "second\n" },
		});
		expect(first.kind === "files" && first.at?.commit).not.toBe(commit);
		// Unreachable: the last read serves.
		expect(
			await readTagged(remote("o/bank/banks/hh@v7"), {
				root: cache,
				urlOf: () => join(dir, "nowhere"),
			}),
		).toEqual(moved);
		// Deleted: said, never served from the cache.
		await git("tag", "-d", "v7");
		expect(await readTagged(remote("o/bank/banks/hh@v7"), options())).toEqual({
			kind: "unavailable",
			reason: "`o/bank/banks/hh@v7`: o/bank has no tag `v7`.",
		});
	}, 30000);

	it("reads the same address from another clone as that clone has it", async () => {
		const other = join(dir, "other");
		await run("git", ["clone", "--quiet", origin, other]);
		const git = (...args: string[]) =>
			run("git", ["-C", other, ...args], {
				env: { ...process.env, ...AUTHOR },
			});
		await git("config", "commit.gpgsign", "false");
		await git("config", "tag.gpgsign", "false");
		await writeFile(
			join(other, "banks", "hh", "questions", "t", "q.yaml"),
			"name: elsewhere\n",
		);
		await git("commit", "--quiet", "-am", "elsewhere");
		await git("tag", "-f", "-a", "v1", "-m", "elsewhere");
		const here = await readTagged(remote("o/bank/banks/hh@v1"), options());
		const there = await readTagged(remote("o/bank/banks/hh@v1"), {
			root: cache,
			urlOf: () => other,
		});
		expect(there).toMatchObject({
			files: { "questions/t/q.yaml": "name: elsewhere\n" },
			at: { commit: (await git("rev-parse", "v1^{commit}")).stdout.trim() },
		});
		expect(await readTagged(remote("o/bank/banks/hh@v1"), options())).toEqual(
			here,
		);
	}, 30000);

	it("fetches again over an entry cached before it recorded its tag", async () => {
		const entry = join(cache, "o", "bank@v6", "whole");
		const read = await readTagged(remote("o/bank@v6"), options());
		await rm(join(entry, ".qretools-tag"));
		await writeFile(join(entry, "workspace.yaml"), "agency: stale\n");
		expect(await readTagged(remote("o/bank@v6"), options())).toEqual(read);
	}, 30000);

	it("never serves the entry of a tag that moved when fetching it again fails", async () => {
		const git = (...args: string[]) =>
			run("git", ["-C", origin, ...args], {
				env: { ...process.env, ...AUTHOR },
			});
		await git("tag", "-a", "v8", "-m", "first");
		expect(await readTagged(remote("o/bank@v8"), options())).toMatchObject({
			kind: "files",
		});
		await git("commit", "--quiet", "--allow-empty", "-m", "moved");
		await git("tag", "-f", "-a", "v8", "-m", "second");
		// The fetch fails: no new entry can be made beside the old one.
		const parent = join(cache, "o", "bank@v8");
		await chmod(parent, 0o555);
		try {
			expect(await readTagged(remote("o/bank@v8"), options())).toMatchObject({
				kind: "unavailable",
				reason: expect.stringMatching(/^`o\/bank@v8` can't be read: /),
			});
		} finally {
			await chmod(parent, 0o755);
		}
	}, 30000);

	it("gives no message for a lightweight tag, never its commit's", async () => {
		const read = await readTagged(remote("o/bank/banks/hh@v6"), options());
		expect(read.kind === "files" && read.at).toMatchObject({
			commit: expect.any(String),
		});
		expect(read.kind === "files" && read.at?.message).toBeUndefined();
	}, 30000);

	it("reads each folder at a tag apart, and tells tags apart by case", async () => {
		const hh = await readTagged(remote("o/bank/banks/hh@v1"), options());
		// Another folder at the same tag, after the first: its own entry, not the first's checkout.
		expect(
			await readTagged(remote("o/bank/banks/b@v1"), options()),
		).toMatchObject({
			kind: "files",
			files: { "workspace.yaml": "agency: org.b\n" },
		});
		expect(await readTagged(remote("o/bank/banks/hh@v1"), options())).toEqual(
			hh,
		);
		expect(await readTagged(remote("o/bank@V1"), options())).toEqual({
			kind: "unavailable",
			reason: "`o/bank@V1`: o/bank has no tag `V1`.",
		});
	}, 30000);

	it("says why when the tag or the folder isn't there, and never reads a branch as a tag", async () => {
		expect(await readTagged(remote("o/bank@v2"), options())).toEqual({
			kind: "unavailable",
			reason: "`o/bank@v2`: o/bank has no tag `v2`.",
		});
		expect(await readTagged(remote("o/bank@v9"), options())).toMatchObject({
			kind: "unavailable",
			reason: "`o/bank@v9`: o/bank has no tag `v9`.",
		});
		expect(await readTagged(remote("o/bank/banks/xx@v1"), options())).toEqual({
			kind: "unavailable",
			reason: "`o/bank/banks/xx@v1`: there's no folder `banks/xx` at `v1`.",
		});
		expect(await readTagged(remote("o/missing@v1"), options())).toMatchObject({
			kind: "unavailable",
			reason: expect.stringMatching(/^`o\/missing@v1` can't be read: /),
		});
	}, 30000);
});

describe("without git", () => {
	it("tells a program not found from one that failed", async () => {
		const missing = await run("qretools-no-such-program").catch((e) => e);
		expect(isNoGit(missing)).toBe(true);
		const failed = await run("git", ["no-such-command"]).catch((e) => e);
		expect(isNoGit(failed)).toBe(false);
	});
});
