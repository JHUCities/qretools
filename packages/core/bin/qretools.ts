#!/usr/bin/env node
/** The `qretools` command, wired to the process: see src/node/cli.ts. */
import { writeFile } from "node:fs/promises";
import { main } from "../src/node/cli.ts";

// A failure of the command itself is "couldn't run" (2), never "the bank has problems" (1).
process.exitCode = await main(process.argv.slice(2), {
	out: (text) => process.stdout.write(text),
	err: (text) => process.stderr.write(text),
	writeFile: (path, text) => writeFile(path, text, "utf8"),
}).catch((e: unknown) => {
	process.stderr.write(
		`qretools failed: ${e instanceof Error ? e.stack : String(e)}\n`,
	);
	return 2;
});
