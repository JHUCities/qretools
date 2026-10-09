import { describe, expect, it } from "vitest";
import { defaultBank, template } from "./config.js";

const env = (values: Record<string, string>) =>
	values as unknown as ImportMetaEnv;

describe("the template a new workspace starts from", () => {
	it("is read as owner/name, or a pasted URL, and links GitHub's Use this template", () => {
		expect(
			template(env({ VITE_TEMPLATE: "JHUCities/qretools-template" })),
		).toBe("https://github.com/JHUCities/qretools-template/generate");
		expect(template(env({ VITE_TEMPLATE: "https://github.com/a/b" }))).toBe(
			"https://github.com/a/b/generate",
		);
	});

	it("is absent when not set, blank or malformed: no link rather than a broken one", () => {
		expect(template(env({}))).toBeUndefined();
		expect(template(env({ VITE_TEMPLATE: "  " }))).toBeUndefined();
		expect(
			template(env({ VITE_TEMPLATE: "not a repository" })),
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
