import { describe, expect, it } from "vitest";
import { formatLink, parseLink } from "./link.js";

describe("links", () => {
	it("round-trip a repository, a branch with slashes and a path with slashes", () => {
		const link = {
			repo: "JHUCities/bas-question-bank",
			branch: "qretools/imaitland",
			file: "questions/nhd/nhd_sat.yaml",
		};
		expect(parseLink(formatLink(link))).toEqual(link);
		expect(parseLink(formatLink({ repo: "o/r", branch: "main" }))).toEqual({
			repo: "o/r",
			branch: "main",
		});
	});

	it("anything the app did not write is no link", () => {
		for (const hash of ["", "#", "#top", "#repo=o&branch=b", "#repo=o/r"])
			expect(parseLink(hash)).toBeUndefined();
	});
});
