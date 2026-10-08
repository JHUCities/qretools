/**
 * `@qretools/core/node`: a bank read from a directory, for programs and CI. The only
 * part of the library that does I/O; everything it returns is a plain value for the
 * pure entry (`bankOf(await readBank(dir))`, `workspaceOf(await readWorkspace(dir))`).
 * `main` is the `qretools` command.
 */
import { glob, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { FOLDERS, ROOT, readsInWorkspace, skippedFolder } from "../index.ts";

/** Where a bank keeps its files, as the GitHub loader reads them: nothing else is walked. */
const PATTERNS: readonly string[] = [
	"questions/*/*.yaml",
	...Object.values(FOLDERS).map((folder) => `${folder}/*.yaml`),
	...Object.values(ROOT),
];

/**
 * Every bank file under `dir`, by its path relative to `dir` (`/`-separated), with
 * Windows line endings made `\n` so finding ranges match the text. Only the bank's own
 * folders are read, so a clone's `.git` and anything else beside the bank are never
 * walked. Rejects if `dir` isn't a directory that can be read (a mistyped path would
 * otherwise read as an empty bank).
 */
export async function readBank(
	dir: string,
): Promise<Readonly<Record<string, string>>> {
	if (!(await stat(dir)).isDirectory())
		throw new Error(`${dir} isn't a directory.`);
	const files: Record<string, string> = {};
	for await (const found of glob(PATTERNS, { cwd: dir })) {
		const path = found.replaceAll("\\", "/");
		const text = await readFile(join(dir, found), "utf8");
		files[path] = text.replaceAll("\r\n", "\n");
	}
	return files;
}

/**
 * Every file of the workspace in `dir` (`readsInWorkspace`), by its path relative to
 * `dir`, as `readBank` gives a bank's: its banks, its instruments and its own file, for
 * `workspaceOf` to sort. Rejects, as `readBank` does, if `dir` isn't a directory.
 */
export async function readWorkspace(
	dir: string,
): Promise<Readonly<Record<string, string>>> {
	if (!(await stat(dir)).isDirectory())
		throw new Error(`${dir} isn't a directory.`);
	// Skipped folders aren't walked at all (a clone's `.git` is large); the rule decides.
	const skipped = (entry: string | { readonly name: string }): boolean =>
		skippedFolder(typeof entry === "string" ? entry : entry.name);
	const files: Record<string, string> = {};
	for await (const found of glob("**/*.yaml", { cwd: dir, exclude: skipped })) {
		const path = found.replaceAll("\\", "/");
		if (!readsInWorkspace(path)) continue;
		const text = await readFile(join(dir, found), "utf8");
		files[path] = text.replaceAll("\r\n", "\n");
	}
	return files;
}

export { type Io, main } from "./cli.ts";
