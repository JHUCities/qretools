/**
 * `@qretools/core/node`: a workspace read from a directory, for programs and CI. The
 * only part of the library that does I/O; everything it returns is a plain value for the
 * pure entry (`workspaceOf(await readWorkspace(dir))`).
 * `main` is the `qretools` command.
 */
import { glob, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { readsInWorkspace, skippedFolder } from "../index.ts";

/**
 * Every file of the workspace in `dir` (`readsInWorkspace`), by its path relative to
 * `dir` (`/`-separated), with Windows line endings made `\n` so finding ranges match the
 * text: its questions, shared files, settings and instruments, for `workspaceOf` (or
 * `bankOf`, which reads the instruments as nothing). Rejects if `dir` isn't a directory
 * that can be read (a mistyped path would otherwise read as an empty workspace).
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
