import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		server: {
			// codemirror-json-schema ships ESM that Node can't load untransformed.
			deps: { inline: ["codemirror-json-schema"] },
		},
	},
});
