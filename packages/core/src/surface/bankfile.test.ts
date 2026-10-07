import { describe, expect, it } from "vitest";
import { schemeEnv } from "../schemes.js";
import { parseBankFile } from "./bankfile.js";

const found = (source: string) =>
	parseBankFile(source).findings.map((f) => [f.severity, f.code, f.path]);

describe("the bank file", () => {
	it("reads the agency", () => {
		expect(parseBankFile("agency: edu.example.dept-1\n")).toEqual({
			agency: "edu.example.dept-1",
			findings: [],
		});
	});

	it("is a hole while the agency is absent or empty", () => {
		expect(found("")).toEqual([["hole", "hole", "agency"]]);
		expect(found("agency:\n")).toEqual([["hole", "hole", "agency"]]);
	});

	it("refuses an agency DDI wouldn't register, whole, not just in part", () => {
		for (const bad of [
			"edu_jhu",
			"a..b",
			`${"a".repeat(64)}.org`,
			".org",
			"org.",
		])
			expect([
				bad,
				parseBankFile(`agency: "${bad}"\n`).agency,
				found(`agency: "${bad}"\n`),
			]).toEqual([bad, undefined, [["error", "invalid-agency", "agency"]]]);
		expect(
			parseBankFile(`agency: ${"a".repeat(63)}.org\n`).agency,
		).toBeDefined();
	});

	it("reads an agency as written, even one YAML reads as a number", () => {
		expect(parseBankFile("agency: 2024\n").agency).toBe("2024");
		expect(parseBankFile("agency: 1.10\n").agency).toBe("1.10");
		expect(found("agency: true\n")).toEqual([
			["error", "invalid-agency", "agency"],
		]);
	});

	it("names a field it doesn't know", () => {
		expect(found("agency: org.example\nowner: someone\n")).toEqual([
			["error", "unknown-key", "owner"],
		]);
	});

	it("puts the agency in the environment, absent when there is none", () => {
		expect(
			schemeEnv([{ kind: "bank", name: "bank", text: "agency: org.example\n" }])
				.agency,
		).toBe("org.example");
		expect(
			schemeEnv([{ kind: "bank", name: "bank", text: "agency:\n" }]),
		).not.toHaveProperty("agency");
	});
});
