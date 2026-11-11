/**
 * A bank in another repository, read at its tag with the user's own git: so whatever
 * credentials git already has reach a private repository, and nothing here handles a
 * token. The tag is resolved on every read (`ls-remote`), and only when it names
 * something the cache doesn't hold is `refs/tags/<tag>` fetched, shallow and without
 * blobs it doesn't need (`clone --branch` would prefer a branch of the same name). A
 * tag is immutable by convention, not by guarantee: a moved tag is read again, so the
 * commit read is the one it names now, for its lock to compare with.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Address, RemoteBank } from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { isNoGit, noGit } from "./git.ts";

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
	if (isNoGit(e)) return noGit("to import questions from remote workspaces");
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
 * Fetched when the tag names something new; otherwise, and when the repository can't
 * be reached, read from the cache.
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
	// What the tag names now: the tag object of an annotated tag, else its commit. The
	// entry records the one it was fetched at, so a moved tag, or the same address read
	// from another clone, is fetched again rather than served from the cache.
	let named: string | undefined;
	try {
		const { stdout } = await run("git", [
			"ls-remote",
			"--tags",
			url,
			`refs/tags/${ref}`,
		]);
		named = stdout
			.split("\n")
			.map((line) => line.split("\t"))
			.find(([, name]) => name === `refs/tags/${ref}`)?.[0];
		if (named === undefined)
			return {
				kind: "unavailable",
				reason: `\`${where}\`: ${owner}/${repo} has no tag \`${ref}\`.`,
			};
	} catch (e) {
		// Unreachable (offline, or access lost): the cached entry serves, as it was last
		// read. So a moved tag shows only once the repository can be reached again.
		if (!(await exists(join(clone, ".qretools-commit"))))
			return {
				kind: "unavailable",
				reason: `\`${where}\` can't be read: ${gitSaid(e)}`,
			};
	}
	if (named !== undefined && named !== (await fetchedAt(clone))) {
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
			// What was fetched, not what ls-remote said: the tag may have moved in between.
			const tag = (await git("rev-parse", `refs/tags/${ref}`)).stdout.trim();
			await writeFile(join(work, ".qretools-commit"), `${commit}\n`, "utf8");
			await writeFile(join(work, ".qretools-tag"), `${tag}\n`, "utf8");
			await rm(clone, { recursive: true, force: true });
			await rename(work, clone);
		} catch (e) {
			await rm(work, { recursive: true, force: true });
			// Another run fetched the same tag meanwhile (a CI matrix): theirs serves. An
			// entry fetched at what the tag named before never does.
			if ((await fetchedAt(clone)) !== named)
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
	const files = await readWorkspace(folder);
	// Where each file came from is part of the read: an export without it would publish
	// the questions with no record of their source, so a failure here is the read's.
	try {
		const commit = (
			await readFile(join(clone, ".qretools-commit"), "utf8")
		).trim();
		const message = await tagMessageOf(clone, ref);
		return {
			kind: "files",
			files,
			at: {
				commit,
				blobs: await blobsOf(clone, path, files),
				...(message !== undefined && { message }),
			},
		};
	} catch (e) {
		return {
			kind: "unavailable",
			reason: `\`${where}\` can't be read: ${gitSaid(e)}`,
		};
	}
}

/** What the tag named when the entry at `clone` was fetched; none for an entry cached before this was recorded, or no entry. */
const fetchedAt = (clone: string): Promise<string | undefined> =>
	readFile(join(clone, ".qretools-tag"), "utf8").then(
		(text) => text.trim(),
		() => undefined,
	);

/** An annotated tag's message, signature included as git keeps it; none for a lightweight tag. */
async function tagMessageOf(
	clone: string,
	ref: string,
): Promise<string | undefined> {
	const { stdout } = await run(
		"git",
		[
			"-C",
			clone,
			"for-each-ref",
			"--format=%(objecttype)%00%(contents)",
			`refs/tags/${ref}`,
		],
		{ maxBuffer: 1 << 30 },
	);
	const nul = stdout.indexOf("\0");
	// A lightweight tag's `contents` are its commit's message: not the tag's. The
	// format's own newline after each ref is not the message's.
	return stdout.slice(0, nul) === "tag"
		? stdout.slice(nul + 1).replace(/\n$/, "")
		: undefined;
}

/** Each file's blob, by its path in the bank's folder (`ls-tree` of that tree, so no prefix to strip). */
async function blobsOf(
	clone: string,
	path: string,
	files: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
	const { stdout } = await run(
		"git",
		["-C", clone, "ls-tree", "-r", "-z", path === "" ? "HEAD" : `HEAD:${path}`],
		{ maxBuffer: 1 << 30 },
	);
	const blobs: Record<string, string> = {};
	for (const entry of stdout.split("\0")) {
		// `<mode> <type> <sha>\t<path>`
		const tab = entry.indexOf("\t");
		if (tab < 0) continue;
		const [, type, sha] = entry.slice(0, tab).split(" ");
		const at = entry.slice(tab + 1);
		if (type === "blob" && sha !== undefined && at in files) blobs[at] = sha;
	}
	return blobs;
}
