import { describe, expect, it } from "vitest";
import {
	bankText,
	parseBank,
	parseRepo,
	repoText,
	sameBank,
} from "./storage.ts";

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

describe("a bank as written", () => {
	const bank = (owner: string, repo: string, path: string) => ({
		ok: true,
		value: { owner, repo, path },
	});

	it("is a repository's root, or a folder in it, written or pasted", () => {
		expect(parseBank("octo/surveys")).toEqual(bank("octo", "surveys", ""));
		expect(parseBank(" octo/surveys/banks/Main/ ")).toEqual(
			bank("octo", "surveys", "banks/Main"),
		);
		expect(parseBank("https://github.com/octo/surveys")).toEqual(
			bank("octo", "surveys", ""),
		);
		expect(
			parseBank("https://github.com/octo/surveys/tree/main/banks/bas"),
		).toEqual(bank("octo", "surveys", "banks/bas"));
		expect(parseBank("https://github.com/octo/surveys/tree/main")).toEqual(
			bank("octo", "surveys", ""),
		);
		expect(
			parseBank("https://github.com/octo/surveys/tree/main/my%23bank"),
		).toEqual(bank("octo", "surveys", "my#bank"));
		expect(parseBank("octo/surveys.git")).toEqual(bank("octo", "surveys", ""));
		expect(parseBank("octo/surveys/banks/x.git")).toEqual(
			bank("octo", "surveys", "banks/x.git"),
		);
	});

	it("refuses anything else", () => {
		for (const text of [
			"",
			"octo",
			"octo/surveys/../x",
			"octo/surveys/./x",
			"octo/surveys//x",
			"octo/surveys/a b",
			"https://github.com/octo/surveys/blob/main/bank.yaml",
		])
			expect([text, parseBank(text).ok]).toEqual([text, false]);
	});

	it("round-trips through the way it's written", () => {
		for (const text of ["octo/surveys", "octo/surveys/banks/bas"]) {
			const parsed = parseBank(text);
			expect(parsed.ok && bankText(parsed.value)).toBe(text);
		}
		expect(bankText({ owner: "", repo: "", path: "" })).toBe("");
	});

	it("is one bank when GitHub's names match in any case and the folder exactly", () => {
		const a = { owner: "Octo", repo: "Surveys", path: "banks/bas" };
		expect(
			sameBank(a, { owner: "octo", repo: "surveys", path: "banks/bas" }),
		).toBe(true);
		expect(sameBank(a, { ...a, path: "banks/BAS" })).toBe(false);
		expect(sameBank(a, { ...a, path: "" })).toBe(false);
	});
});
