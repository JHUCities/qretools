import { describe, expect, it } from "vitest";
import { parseRepo, repoText } from "./storage.js";

describe("a repository as written", () => {
	it("reads owner/name, and a pasted GitHub URL", () => {
		const bank = { owner: "JHUCities", repo: "bas-question-bank" };
		expect(parseRepo(" JHUCities/bas-question-bank ")).toEqual({
			ok: true,
			value: bank,
		});
		expect(
			parseRepo("https://github.com/JHUCities/bas-question-bank.git"),
		).toEqual({
			ok: true,
			value: bank,
		});
		expect(parseRepo("a/b.c_d-e").ok).toBe(true);
	});

	it("refuses anything else, saying how to write it", () => {
		for (const text of ["", "JHUCities", "a/b/c", "a b/c", "a/..", "a/."])
			expect(parseRepo(text).ok).toBe(false);
	});
});

describe("a repository as the field writes it", () => {
	it("is owner/name, or empty when none is set (never a lone slash)", () => {
		expect(repoText({ owner: "a", repo: "b" })).toBe("a/b");
		expect(repoText({ owner: "", repo: "" })).toBe("");
	});
});
