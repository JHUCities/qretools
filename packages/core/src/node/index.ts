/**
 * `@qretools/core/node`: a bank read from a directory, for programs and CI. The only
 * part of the library that does I/O; everything it returns is a plain value for the
 * pure entry (`bankOf(await readBank(dir))`). `main` is the `qretools` command.
 */
import { glob, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { FOLDERS, ROOT } from "../index.ts";

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

export { type Io, main } from "./cli.ts";
