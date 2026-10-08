/**
 * A bank in another repository, read at its tag with git: against a repository made
 * here, as GitHub would serve it, so nothing reaches the network.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { addressOf } from "@qretools/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTagged } from "./remote.ts";

const run = promisify(execFile);
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
		run("git", ["-C", origin, ...args], {
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "t",
				GIT_AUTHOR_EMAIL: "t@example.org",
				GIT_COMMITTER_NAME: "t",
				GIT_COMMITTER_EMAIL: "t@example.org",
			},
		});
	await run("git", ["init", "--quiet", "--initial-branch=main", origin]);
	await git("config", "commit.gpgsign", "false");
	await git("config", "tag.gpgsign", "false");
	await writeFile(
		join(origin, "banks", "hh", "bank.yaml"),
		"agency: org.example\n",
	);
	await writeFile(
		join(origin, "banks", "hh", "questions", "t", "q.yaml"),
		"name: q\n",
	);
	await mkdir(join(origin, "banks", "b"), { recursive: true });
	await writeFile(join(origin, "banks", "b", "bank.yaml"), "agency: org.b\n");
	await writeFile(join(origin, "README.md"), "# A bank\n");
	await git("add", ".");
	await git("commit", "--quiet", "-m", "v1");
	await git("tag", "-a", "v1", "-m", "v1");
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
		expect(read).toEqual({
			kind: "files",
			files: {
				"bank.yaml": "agency: org.example\n",
				"questions/t/q.yaml": "name: q\n",
			},
		});
		// Read again with the repository unreachable: the cache answers.
		const again = await readTagged(remote("o/bank/banks/hh@v1"), {
			root: cache,
			urlOf: () => join(dir, "nowhere"),
		});
		expect(again).toEqual(read);
	}, 30000);

	it("reads each folder at a tag apart, and tells tags apart by case", async () => {
		const hh = await readTagged(remote("o/bank/banks/hh@v1"), options());
		// Another folder at the same tag, after the first: its own entry, not the first's checkout.
		expect(await readTagged(remote("o/bank/banks/b@v1"), options())).toEqual({
			kind: "files",
			files: { "bank.yaml": "agency: org.b\n" },
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
