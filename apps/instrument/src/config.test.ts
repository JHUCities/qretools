import { describe, expect, it } from "vitest";
import { workspaceTemplate } from "./config.ts";

const env = (values: Record<string, string>) =>
	values as unknown as ImportMetaEnv;

describe("the template a new workspace starts from", () => {
	it("is read as owner/name, or a pasted URL, and links GitHub's Use this template", () => {
		expect(
			workspaceTemplate(
				env({
					VITE_WORKSPACE_TEMPLATE: "JHUCities/qretools-instrument-template",
				}),
			),
		).toBe(
			"https://github.com/JHUCities/qretools-instrument-template/generate",
		);
		expect(
			workspaceTemplate(
				env({ VITE_WORKSPACE_TEMPLATE: "https://github.com/a/b" }),
			),
		).toBe("https://github.com/a/b/generate");
	});

	it("is absent when not set, blank or malformed: no link rather than a broken one", () => {
		expect(workspaceTemplate(env({}))).toBeUndefined();
		expect(
			workspaceTemplate(env({ VITE_WORKSPACE_TEMPLATE: " " })),
		).toBeUndefined();
		expect(
			workspaceTemplate(env({ VITE_WORKSPACE_TEMPLATE: "not a repository" })),
		).toBeUndefined();
	});
});
