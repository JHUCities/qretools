/**
 * A bank in another repository, read at its tag with the user's own git: so whatever
 * credentials git already has reach a private repository, and nothing here handles a
 * token. The tag is resolved first (`ls-remote`), and then only `refs/tags/<tag>` is
 * fetched, shallow and without blobs it doesn't need (`clone --branch` would prefer a
 * branch of the same name), into a cache kept by tag. A tag is immutable by convention, not by guarantee: the commit it
 * resolved to is written beside the clone, for a lock to compare with one day.
 */
import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Address } from "../address.ts";
import type { RemoteBank } from "../workspace.ts";
import { readBank } from "./index.ts";

type RemoteAddress = Extract<Address, { kind: "remote" }>;

const run = promisify(execFile);

/** Where git reads a repository from: GitHub, unless a test gives its own. */
export type UrlOf = (owner: string, repo: string) => string;
const GITHUB: UrlOf = (owner, repo) =>
	`https://github.com/${owner}/${repo}.git`;

/** The cache's root: `$XDG_CACHE_HOME/qretools`, else `~/.cache/qretools`. */
export const cacheRoot = (env: NodeJS.ProcessEnv = process.env): string =>
	join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "qretools");

const exists = (path: string): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);

/** What git said, without its own prefix: its last line is the reason. */
const gitSaid = (e: unknown): string => {
	const text =
		typeof e === "object" && e !== null && "stderr" in e
			? String((e as { stderr: unknown }).stderr)
			: String(e);
	return (
		text
			.trim()
			.split("\n")
			.at(-1)
			?.replace(/^fatal: /, "") ?? text
	);
};

/**
 * The bank at `address`, read at its tag: its files by path in its folder, or why not.
 * Read once per tag; later reads come from the cache.
 */
export async function readTagged(
	address: RemoteAddress,
	{ root = cacheRoot(), urlOf = GITHUB }: { root?: string; urlOf?: UrlOf } = {},
): Promise<RemoteBank> {
	const { owner, repo, path, ref } = address;
	const where = `${owner}/${repo}${path === "" ? "" : `/${path}`}@${ref}`;
	const url = urlOf(owner, repo);
	// One entry per folder at a tag, each written once: a sparse checkout holds only its
	// own folder. Owner and repository compare without case, as GitHub's do; the tag and
	// the folder are exact (`v1` and `V1` are two tags).
	const clone = join(
		root,
		owner.toLowerCase(),
		`${repo.toLowerCase()}@${encodeURIComponent(ref)}`,
		path === "" ? "whole" : `folder-${encodeURIComponent(path)}`,
	);
	if (!(await exists(join(clone, ".qretools-commit")))) {
		let listed: string;
		try {
			listed = (
				await run("git", ["ls-remote", "--tags", url, `refs/tags/${ref}`])
			).stdout;
		} catch (e) {
			return {
				kind: "unavailable",
				reason: `\`${where}\` can't be read: ${gitSaid(e)}`,
			};
		}
		if (listed.trim() === "")
			return {
				kind: "unavailable",
				reason: `\`${where}\`: ${owner}/${repo} has no tag \`${ref}\`.`,
			};
		// Cloned beside, then moved into place: a clone stopped halfway is never read, and
		// beside the cache the move stays on one filesystem.
		const parent = dirname(clone);
		await mkdir(parent, { recursive: true });
		const work = join(parent, `.partial-${process.pid}-${Date.now()}`);
		const git = (...args: string[]) => run("git", ["-C", work, ...args]);
		try {
			await run("git", ["init", "--quiet", work]);
			await git("remote", "add", "origin", url);
			if (path !== "") await git("sparse-checkout", "set", path);
			await git(
				"fetch",
				"--quiet",
				"--depth",
				"1",
				"--filter=blob:none",
				"origin",
				`refs/tags/${ref}:refs/tags/${ref}`,
			);
			await git("checkout", "--quiet", `refs/tags/${ref}`);
			const commit = (await git("rev-parse", "HEAD")).stdout.trim();
			await writeFile(join(work, ".qretools-commit"), `${commit}\n`, "utf8");
			await rm(clone, { recursive: true, force: true });
			await rename(work, clone);
		} catch (e) {
			await rm(work, { recursive: true, force: true });
			// Another run fetched the same tag meanwhile (a CI matrix): theirs serves.
			if (!(await exists(join(clone, ".qretools-commit"))))
				return {
					kind: "unavailable",
					reason: `\`${where}\` can't be read: ${gitSaid(e)}`,
				};
		}
	}
	const folder = path === "" ? clone : join(clone, path);
	if (!(await exists(folder)))
		return {
			kind: "unavailable",
			reason: `\`${where}\`: there's no folder \`${path}\` at \`${ref}\`.`,
		};
	return { kind: "files", files: await readBank(folder) };
}
