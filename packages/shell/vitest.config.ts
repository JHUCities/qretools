import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
		// Guarded for Node: it only fills jsdom's gaps in files that ask for jsdom.
		setupFiles: ["src/ui/test-setup.ts"],
		server: {
			// Primer components import their CSS modules; Node cannot load .css unless Vite transforms them.
			deps: { inline: [/@primer\//] },
		},
	},
});
