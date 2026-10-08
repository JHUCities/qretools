import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** The one piece of Node this config reads (the project has no Node type definitions). */
declare const process: {
	readonly env: Readonly<Record<string, string | undefined>>;
};

export default defineConfig({
	plugins: [react()],
	// Where the site is served: GitHub Pages gives its path to the build (the workflow's
	// BASE_PATH); development and a local build serve from the root.
	base: process.env.BASE_PATH || "/",
	// Lightning CSS (Vite's own CSS engine) compiles `@custom-media`, so breakpoints come
	// from Primer's published viewport tokens instead of numbers copied into our CSS.
	css: {
		transformer: "lightningcss",
		lightningcss: { drafts: { customMedia: true } },
	},
	// Pinned: GitHub's registered callback URL and the Worker's origin allowlist name it.
	server: { port: 5199, strictPort: true },
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
		// The shell's: the same jsdom gaps for every app's interface tests.
		setupFiles: ["@qretools/shell/test-setup"],
		server: {
			// Primer components import their CSS modules; Node cannot load .css unless Vite transforms them.
			deps: { inline: [/@primer\//, "codemirror-json-schema"] },
		},
	},
});
