/**
 * A workspace's history, read with the user's git, for `build`: the files at HEAD and
 * every first-parent commit that touched the workspace's folder, oldest first. What is
 * built is the last commit, never the working tree, so the versions describe exactly
 * the content they are stamped on.
 */
import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import {
	type History,
	instrumentAt,
	ROOT,
	readsInWorkspace,
	type Snapshot,
	WORKSPACE,
} from "@qretools/core";
import { isNoGit, noGit } from "./git.ts";

const run = promisify(execFile);

const MAPS = `${WORKSPACE.maps}/`;
/** A map is JSON at the top of `maps/`; anything else there isn't read. */
const MAP = new RegExp(`^${MAPS}[^/]+\\.json$`);

export type HistoryRead =
	| {
			readonly kind: "read";
			/** The workspace's files at HEAD, by path in it, as `readWorkspace` gives them. */
			readonly files: Readonly<Record<string, string>>;
			readonly history: History;
			/** The column maps at HEAD, `maps/*.json`, by file name: copied by `build`, never versioned. */
			readonly maps: Readonly<Record<string, string>>;
			/** Whether the folder has changes not committed, which the build leaves out. */
			readonly uncommitted: boolean;
	  }
	| { readonly kind: "unavailable"; readonly reason: string };

const git = async (cwd: string, ...args: string[]): Promise<string> =>
	(await run("git", args, { cwd, maxBuffer: 1 << 30 })).stdout;

/** Each blob's text, by sha, from one `git cat-file --batch`. */
function catBlobs(
	cwd: string,
	shas: readonly string[],
): Promise<Record<string, string>> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["cat-file", "--batch"], { cwd });
		const chunks: Buffer[] = [];
		child.stdout.on("data", (c: Buffer) => chunks.push(c));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) return reject(new Error(`git cat-file exited ${code}`));
			const out = Buffer.concat(chunks);
			const texts: Record<string, string> = {};
			let at = 0;
			// Each entry: `<sha> blob <size>\n<content>\n`.
			while (at < out.length) {
				const eol = out.indexOf(10, at);
				const [sha, , size] = out.toString("utf8", at, eol).split(" ");
				const start = eol + 1;
				const end = start + Number(size);
				if (sha !== undefined)
					texts[sha] = out
						.toString("utf8", start, end)
						.replaceAll("\r\n", "\n");
				at = end + 1;
			}
			resolve(texts);
		});
		child.stdin.end(`${shas.join("\n")}\n`);
	});
}

/** The workspace's blobs at a commit, by path in the workspace (`prefix` is its folder in the repository). */
async function blobsAt(
	top: string,
	commit: string,
	prefix: string,
	keep: (path: string) => boolean = readsInWorkspace,
): Promise<Record<string, string>> {
	const listed = await git(
		top,
		"ls-tree",
		"-r",
		"-z",
		commit,
		"--",
		prefix === "" ? "." : prefix,
	);
	const blobs: Record<string, string> = {};
	for (const entry of listed.split("\0")) {
		// `<mode> <type> <sha>\t<path>`
		const tab = entry.indexOf("\t");
		if (tab < 0) continue;
		const [, type, sha] = entry.slice(0, tab).split(" ");
		const path = entry.slice(tab + 1).slice(prefix.length);
		if (type === "blob" && sha !== undefined && keep(path)) blobs[path] = sha;
	}
	return blobs;
}

/** The workspace in `dir`, at HEAD, with its history; or why it can't be read. */
export async function readHistory(dir: string): Promise<HistoryRead> {
	if (
		!(await stat(dir).then(
			(s) => s.isDirectory(),
			() => false,
		))
	)
		return { kind: "unavailable", reason: `${dir} isn't a directory.` };
	let top: string;
	let prefix: string;
	try {
		top = (await git(dir, "rev-parse", "--show-toplevel")).trim();
		prefix = (await git(dir, "rev-parse", "--show-prefix")).trim();
	} catch (e) {
		return {
			kind: "unavailable",
			reason: isNoGit(e)
				? noGit("to build versions from history")
				: `${dir} isn't in a git repository: versions are counted from its history.`,
		};
	}
	if (
		(await git(top, "rev-parse", "--is-shallow-repository")).trim() === "true"
	)
		return {
			kind: "unavailable",
			reason:
				"the repository is a shallow clone, so its versions would be too low. Fetch its whole history (`git fetch --unshallow`, or `fetch-depth: 0` in CI).",
		};
	const log = await git(
		top,
		"log",
		"--first-parent",
		"--reverse",
		"--format=%H %cI",
		"HEAD",
		"--",
		prefix === "" ? "." : prefix,
	).catch(() => "");
	const commits = log
		.split("\n")
		.filter((l) => l !== "")
		.map((l) => {
			const [sha = "", date = ""] = l.split(" ");
			return { sha, date };
		});
	if (commits.length === 0)
		return {
			kind: "unavailable",
			reason: `nothing in ${dir} is committed yet, and the build uses the last commit.`,
		};
	const snapshots: Snapshot[] = [];
	for (const { sha, date } of commits)
		snapshots.push({ date, blobs: await blobsAt(top, sha, prefix) });
	const head = await blobsAt(top, "HEAD", prefix);
	const maps = await blobsAt(top, "HEAD", prefix, (p) => MAP.test(p));
	// Text for every file at HEAD, and in history for what its version depends on: each
	// question's (what it names), each instrument's (the tags it pins) and each
	// workspace.yaml's (the commits it locks them at).
	const wanted = new Set([...Object.values(head), ...Object.values(maps)]);
	for (const { blobs } of snapshots)
		for (const [path, blob] of Object.entries(blobs))
			if (
				path.startsWith("questions/") ||
				instrumentAt(path) !== undefined ||
				path === ROOT.workspace
			)
				wanted.add(blob);
	const texts = await catBlobs(top, [...wanted]);
	const files = Object.fromEntries(
		Object.entries(head).map(([path, blob]) => [path, texts[blob] ?? ""]),
	);
	const status = await git(dir, "status", "--porcelain", "--", ".");
	return {
		kind: "read",
		files,
		history: { snapshots, texts },
		// shortcut: read as text with CRLF made LF, as every file is; byte-exact copies would need the raw blob.
		maps: Object.fromEntries(
			Object.entries(maps).map(([path, blob]) => [
				path.slice(MAPS.length),
				texts[blob] ?? "",
			]),
		),
		uncommitted: status.trim() !== "",
	};
}

/** The GitHub repository a clone is of, and the clone's folder. */
export interface OwnRepository {
	/** `owner/repo`, lowercased, as GitHub compares them. */
	readonly repository: string;
	readonly path: string;
}

/**
 * The repository the folder `dir` is a clone of, from its `origin` on GitHub, so a tag of
 * it is read from this clone rather than fetched; absent outside git or without one.
 */
export async function ownRepository(
	dir: string,
): Promise<OwnRepository | undefined> {
	try {
		const top = (await git(dir, "rev-parse", "--show-toplevel")).trim();
		const origin = (await git(top, "remote", "get-url", "origin")).trim();
		const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(origin);
		return m?.[1] === undefined || m[2] === undefined
			? undefined
			: { repository: `${m[1]}/${m[2]}`.toLowerCase(), path: top };
	} catch {
		return undefined;
	}
}
