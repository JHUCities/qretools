import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** The one piece of Node this config reads (the project has no Node type definitions). */
declare const process: {
	readonly env: Readonly<Record<string, string | undefined>>;
};

export default defineConfig({
	plugins: [react()],
	base: process.env.BASE_PATH || "/",
	// As the bank's: Lightning CSS compiles the shared stylesheet's `@custom-media`, or
	// its breakpoints silently stop applying.
	css: {
		transformer: "lightningcss",
		lightningcss: { drafts: { customMedia: true } },
	},
	// Its own origin, beside the bank's 5199: storage and sign-in are per origin.
	server: { port: 5201, strictPort: true },
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["@qretools/shell/test-setup"],
		server: {
			// Primer components import their CSS modules; Node cannot load .css unless Vite transforms them.
			deps: { inline: [/@primer\//] },
		},
	},
});
