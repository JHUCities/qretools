import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SPECIFIER = /\bfrom\s+"([^"]+)"|\bimport\s+"([^"]+)"/g;

/** Every package a module and the modules it imports from this package name, transitively. */
async function packagesOf(entry: URL): Promise<Set<string>> {
	const seen = new Set<string>();
	const packages = new Set<string>();
	const visit = async (url: URL) => {
		if (seen.has(url.href)) return;
		seen.add(url.href);
		const text = await readFile(fileURLToPath(url), "utf8");
		for (const m of text.matchAll(SPECIFIER)) {
			const spec = m[1] ?? m[2] ?? "";
			if (spec.startsWith(".")) await visit(new URL(spec, url));
			else packages.add(spec);
		}
	};
	await visit(entry);
	return packages;
}

describe("the shell's main entry", () => {
	it("imports no React and no Primer: those are its `ui` entry's", async () => {
		const packages = await packagesOf(new URL("./index.ts", import.meta.url));
		expect(
			[...packages].filter((p) => /^(react|react-dom|@primer\/)/.test(p)),
		).toEqual([]);
		// The walk did reach the modules (a broken walk would pass vacuously).
		expect(packages.has("@octokit/core")).toBe(true);
	});
});
