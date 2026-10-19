#!/usr/bin/env node
/**
 * Writes one side of the tutorial into a checkout of the published repository:
 * `node scripts/publish.ts <ex|sol> <checkout>`. Everything there but `.git` is
 * replaced, so a lesson deleted here is deleted there too. It writes files only;
 * committing and pushing are yours:
 *
 *   git switch main                    && publish ex  → commit, push
 *   git switch -C solutions main       && publish sol → commit, push --force-with-lease
 *
 * so `solutions` is always main plus one commit: the answers.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Side, sideOf } from "../src/render.ts";
import { readSource } from "../src/source.ts";

const [side, dest] = process.argv.slice(2);
if ((side !== "ex" && side !== "sol") || dest === undefined) {
	process.stderr.write("Usage: node scripts/publish.ts <ex|sol> <checkout>\n");
	process.exit(2);
}
for (const entry of await readdir(dest))
	if (entry !== ".git") await rm(join(dest, entry), { recursive: true, force: true });
const files = sideOf(await readSource(), side as Side);
for (const [path, text] of Object.entries(files)) {
	await mkdir(dirname(join(dest, path)), { recursive: true });
	await writeFile(join(dest, path), text);
}
process.stdout.write(`${Object.keys(files).length} files written to ${dest}.\n`);
