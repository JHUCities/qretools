/** The tutorial's source files, read from `source/`, by their paths there. */
import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";

export const SOURCE = new URL("../source/", import.meta.url).pathname;

export async function readSource(
	dir: string = SOURCE,
): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	for await (const path of glob("**/*", { cwd: dir, withFileTypes: false }))
		if (/\.(ya?ml|md)$/.test(path))
			files[path.replaceAll("\\", "/")] = await readFile(
				join(dir, path),
				"utf8",
			);
	return files;
}
