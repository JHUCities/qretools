import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	// Pinned: GitHub's registered callback URL and the Worker's origin allowlist name it.
	server: { port: 5199, strictPort: true },
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["src/app/ui/test-setup.ts"],
		server: {
			// Primer components import their CSS modules; Node cannot load .css unless Vite transforms them.
			deps: { inline: [/@primer\//] },
		},
	},
});
