import { describe, expect, it } from "vitest";
import { formatLink, parseLink } from "./link.ts";

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

	it("carry a place in the file, and only with a file; links without one still read", () => {
		const link = {
			repo: "o/r",
			branch: "main",
			file: "instruments/wave1.yaml",
			at: "flow.3.ask",
		};
		expect(parseLink(formatLink(link))).toEqual(link);
		expect(formatLink({ repo: "o/r", branch: "main", at: "flow.1" })).toBe(
			"#repo=o%2Fr&branch=main",
		);
		expect(parseLink("#repo=o%2Fr&branch=main&at=flow.1")).toEqual({
			repo: "o/r",
			branch: "main",
		});
		expect(
			parseLink("#repo=o%2Fr&branch=main&file=instruments%2Fwave1.yaml"),
		).toEqual({ repo: "o/r", branch: "main", file: "instruments/wave1.yaml" });
	});

	it("anything the app did not write is no link", () => {
		for (const hash of ["", "#", "#top", "#repo=o&branch=b", "#repo=o"])
			expect(parseLink(hash)).toBeUndefined();
	});

	it("a bank alone is a link to it, however often its name was encoded", () => {
		for (const hash of ["#repo=o/r", "#repo=o%2Fr", "#repo=o%252Fr"])
			expect(parseLink(hash)).toEqual({ repo: "o/r" });
		expect(formatLink({ repo: "o/r" })).toBe("#repo=o%2Fr");
	});
});
