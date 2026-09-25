import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
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
		setupFiles: ["src/app/ui/test-setup.ts"],
		server: {
			// Primer components import their CSS modules; Node cannot load .css unless Vite transforms them.
			deps: { inline: [/@primer\//] },
		},
	},
});
