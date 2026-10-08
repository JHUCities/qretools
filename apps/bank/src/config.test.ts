import { describe, expect, it } from "vitest";
import { bankTemplate, defaultBank, workspaceTemplate } from "./config.js";

const env = (values: Record<string, string>) =>
	values as unknown as ImportMetaEnv;

describe("the template a new bank starts from", () => {
	it("is read as owner/name, or a pasted URL, and links GitHub's Use this template", () => {
		expect(
			bankTemplate(
				env({ VITE_BANK_TEMPLATE: "JHUCities/qretools-bank-template" }),
			),
		).toBe("https://github.com/JHUCities/qretools-bank-template/generate");
		expect(
			bankTemplate(env({ VITE_BANK_TEMPLATE: "https://github.com/a/b" })),
		).toBe("https://github.com/a/b/generate");
	});

	it("is absent when not set, blank or malformed: no link rather than a broken one", () => {
		expect(bankTemplate(env({}))).toBeUndefined();
		expect(bankTemplate(env({ VITE_BANK_TEMPLATE: "  " }))).toBeUndefined();
		expect(
			bankTemplate(env({ VITE_BANK_TEMPLATE: "not a repository" })),
		).toBeUndefined();
	});
});

describe("the template a new workspace starts from", () => {
	it("is its own setting, read as the bank template is", () => {
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
			workspaceTemplate(env({ VITE_BANK_TEMPLATE: "a/b" })),
		).toBeUndefined();
	});
});

describe("the bank the sign-in page offers first", () => {
	it("is read as owner/name, or a pasted URL", () => {
		expect(defaultBank(env({ VITE_DEFAULT_BANK: "a/b" }))).toEqual({
			owner: "a",
			repo: "b",
			path: "",
		});
		expect(
			defaultBank(env({ VITE_DEFAULT_BANK: "https://github.com/a/b" })),
		).toEqual({ owner: "a", repo: "b", path: "" });
		expect(defaultBank(env({ VITE_DEFAULT_BANK: "a/b/banks/main" }))).toEqual({
			owner: "a",
			repo: "b",
			path: "banks/main",
		});
	});

	it("is absent when not set, blank or malformed: an empty field", () => {
		expect(defaultBank(env({}))).toBeUndefined();
		expect(defaultBank(env({ VITE_DEFAULT_BANK: " " }))).toBeUndefined();
		expect(defaultBank(env({ VITE_DEFAULT_BANK: "nope" }))).toBeUndefined();
	});
});
