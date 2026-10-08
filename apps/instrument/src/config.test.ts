import { describe, expect, it } from "vitest";
import { projectTemplate } from "./config.ts";

const env = (values: Record<string, string>) =>
	values as unknown as ImportMetaEnv;

describe("the template a new project starts from", () => {
	it("is read as owner/name, or a pasted URL, and links GitHub's Use this template", () => {
		expect(
			projectTemplate(
				env({
					VITE_PROJECT_TEMPLATE: "JHUCities/qretools-instrument-template",
				}),
			),
		).toBe(
			"https://github.com/JHUCities/qretools-instrument-template/generate",
		);
		expect(
			projectTemplate(env({ VITE_PROJECT_TEMPLATE: "https://github.com/a/b" })),
		).toBe("https://github.com/a/b/generate");
	});

	it("is absent when not set, blank or malformed: no link rather than a broken one", () => {
		expect(projectTemplate(env({}))).toBeUndefined();
		expect(
			projectTemplate(env({ VITE_PROJECT_TEMPLATE: " " })),
		).toBeUndefined();
		expect(
			projectTemplate(env({ VITE_PROJECT_TEMPLATE: "not a repository" })),
		).toBeUndefined();
	});
});
