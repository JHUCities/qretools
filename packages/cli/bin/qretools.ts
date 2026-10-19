#!/usr/bin/env node
/** The `qretools` command, wired to the process: see src/cli.ts. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { main } from "../src/cli.ts";
import { readTagged } from "../src/remote.ts";

// A reader that stops early (`| head`) closes the pipe: that ends the output, not the command.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
	if (e.code === "EPIPE") process.exit(0);
	throw e;
});

// A failure of the command itself is "couldn't run" (2), never "the workspace has problems" (1).
process.exitCode = await main(process.argv.slice(2), {
	out: (text) => process.stdout.write(text),
	err: (text) => process.stderr.write(text),
	// `init` writes into a folder that may not exist yet.
	writeFile: async (path, text) => {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, text, "utf8");
	},
	readRemote: (address) => readTagged(address),
}).catch((e: unknown) => {
	process.stderr.write(
		`qretools failed: ${e instanceof Error ? e.stack : String(e)}\n`,
	);
	return 2;
});
