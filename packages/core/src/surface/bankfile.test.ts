import { describe, expect, it } from "vitest";
import { schemeEnv } from "../schemes.ts";
import { parseBankFile, parseSettingsFile } from "./bankfile.ts";
import { EMPTY_ENV } from "./env.ts";
import { parseSurface } from "./parse.ts";

const found = (source: string) =>
	parseBankFile(source).findings.map((f) => [f.severity, f.code, f.path]);

describe("the bank file", () => {
	it("reads the agency", () => {
		expect(parseBankFile("agency: edu.example.dept-1\n")).toEqual({
			agency: "edu.example.dept-1",
			required: [],
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

	it("reads the fields it requires of its questions, and says what's wrong with the list", () => {
		const head = "agency: org.example\nrequired:\n";
		expect(parseBankFile(`${head}  - title\n  - concept\n`)).toMatchObject({
			required: ["title", "concept"],
			findings: [],
		});
		const read = parseBankFile(
			`${head}  - title\n  - responses\n  - intent\n  - title\n  - colour\n`,
		);
		expect(read.required).toEqual(["title"]);
		expect(
			found(
				`${head}  - title\n  - responses\n  - intent\n  - title\n  - colour\n`,
			),
		).toEqual([
			["error", "wrong-type", "required.1"],
			["warning", "ignored-key", "required.2"],
			["warning", "ignored-key", "required.3"],
			["error", "wrong-type", "required.4"],
		]);
		expect(found("agency: org.example\nrequired:\n")).toEqual([
			["hole", "hole", "required"],
		]);
		expect(found("agency: org.example\nrequired: title\n")).toEqual([
			["error", "wrong-type", "required"],
		]);
	});

	it("is a bank's alone: a workspace's file has no `required`", () => {
		expect(
			parseSettingsFile(
				"agency: org.example\nrequired: [title]\n",
				"workspace",
			).findings.map((f) => [f.code, f.path]),
		).toEqual([["unknown-key", "required"]]);
	});

	it("makes a required field to fill in, missing or empty, with what it's for", () => {
		const env = schemeEnv([
			{
				kind: "bank",
				name: "bank",
				text: "agency: org.example\nrequired: [title, concept]\n",
			},
		]);
		expect(env.required).toEqual(["title", "concept"]);
		const q = "name: q\ntext: Is it so?\nintent: To see why.\nopen: {}\n";
		const holes = (text: string, e = env) =>
			parseSurface(text, e)
				.findings.filter((f) => f.severity === "hole")
				.map((f) => [
					f.path,
					f.message,
					f.hint !== undefined && !f.hint.includes("remove the line"),
				]);
		expect(holes(q)).toEqual([
			["title", "`title` is required in this bank.", true],
			["concept", "`concept` is required in this bank.", true],
		]);
		expect(holes(`${q}title:\nconcept: Housing tenure\n`)).toEqual([
			["title", "`title` is empty.", true],
		]);
		// Elsewhere, an optional field: absent is fine.
		expect(holes(q, EMPTY_ENV)).toEqual([]);
	});
});
