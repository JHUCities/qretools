import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["src/app/ui/test-setup.ts"],
		server: {
			// Primer components import their CSS modules; Node cannot load .css unless Vite transforms them.
			deps: { inline: [/@primer\//] },
		},
	},
});
