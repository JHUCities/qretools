/**
 * The published command: one file, `dist/qretools.js`, with the core, the Qualtrics
 * export and their dependencies inside it, since Node won't strip types from a package
 * under node_modules. Node's own modules stay imports. The DDI schema is a separate
 * chunk, loaded only when something is exported.
 */
import { defineConfig } from "rolldown";

export default defineConfig({
	input: { qretools: "bin/qretools.ts" },
	platform: "node",
	output: { dir: "dist", format: "esm", entryFileNames: "[name].js" },
});
