import { describe, expect, it } from "vitest";
import bankTemplate from "../../templates/settings/bank.yaml?raw";
import selectAllTemplate from "../../templates/settings/select_all.yaml?raw";
import workspaceTemplate from "../../templates/settings/workspace.yaml?raw";
import { schemeEnv } from "../schemes.ts";
import {
	DEFAULT_SELECT_ALL,
	selectAllCodes,
	selectAllText,
} from "../selectAll.ts";
import {
	AGENCY_RULE_TEXT,
	parseBankFile,
	parseSelectAllFile,
	parseSettingsFile,
} from "./bankfile.ts";
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

/*
 * The template repository (JHUCities/qretools-template) carries these comments too, in
 * its workspace.yaml and bank.yaml, filled in with org.example: change both.
 */
describe("the settings templates a new bank or workspace starts from", () => {
	it("leave only the agency to fill in, and a bank's required list ready to uncomment", () => {
		const holes = (source: string, owner: "bank" | "workspace") =>
			parseSettingsFile(source, owner).findings.map((f) => [
				f.severity,
				f.path,
			]);
		// The comment says the rule the parser enforces.
		for (const t of [bankTemplate, workspaceTemplate])
			expect(t.replace(/\n# /g, " ")).toContain(
				"letters, digits and hyphens, in parts joined by dots",
			);
		expect(AGENCY_RULE_TEXT).toContain(
			"Letters, digits and hyphens, up to 63 at a time, in parts joined by dots",
		);
		expect(holes(bankTemplate, "bank")).toEqual([["hole", "agency"]]);
		expect(holes(workspaceTemplate, "workspace")).toEqual([["hole", "agency"]]);
		const on = bankTemplate.replace(
			"#required:\n#  - title",
			"required:\n  - title",
		);
		expect(on).not.toBe(bankTemplate);
		expect(parseBankFile(on).required).toEqual(["title"]);
	});
});

describe("how a bank stores a select-all option's answer", () => {
	const read = parseSelectAllFile;

	it("is 0 No, 1 Yes when the bank says nothing", () => {
		expect(schemeEnv([]).selectAll).toBe(DEFAULT_SELECT_ALL);
		expect(selectAllCodes(DEFAULT_SELECT_ALL)).toEqual([
			{ code: "0", label: "No" },
			{ code: "1", label: "Yes" },
		]);
	});

	it("starts, from its template, as the usual coding in the usual order", () => {
		// Written the other way round, creating the file would reorder the published list.
		expect(read(selectAllTemplate)).toEqual({
			value: DEFAULT_SELECT_ALL,
			findings: [],
		});
	});

	it("is what the bank writes: each value as spelled, in the order written", () => {
		const { value, findings } = read(
			'chosen: { "01": Selected }\nnot_chosen: { "02": Not selected }\n',
		);
		expect(findings).toEqual([]);
		expect(value).toEqual({
			chosen: { code: "01", label: "Selected" },
			notChosen: { code: "02", label: "Not selected" },
			first: "chosen",
		});
		expect(selectAllCodes(value).map((c) => c.code)).toEqual(["01", "02"]);
		expect(selectAllText(value)).toBe("01 = Selected, 02 = Not selected");
		// Unquoted and in the other order: still the bank's spelling and order.
		const other = read("not_chosen:\n  2: No\nchosen:\n  1: Yes\n");
		expect(other.findings).toEqual([]);
		expect(selectAllCodes(other.value)).toEqual([
			{ code: "2", label: "No" },
			{ code: "1", label: "Yes" },
		]);
		// The environment takes it from the bank's `select_all.yaml`, nowhere else.
		expect(
			schemeEnv([
				{
					kind: "select_all",
					name: "select_all",
					text: "chosen:\n  1: Yes\nnot_chosen:\n  2: No\n",
				},
			]).selectAll.notChosen.code,
		).toBe("2");
	});

	it("is the usual coding, said so, until both parts read whole and differ", () => {
		const cases: [string, [string, string, string][]][] = [
			["", [["hole", "hole", ""]]],
			["yes_no\n", [["error", "not-a-map", ""]]],
			['chosen: { "1": Yes }\n', [["hole", "hole", "not_chosen"]]],
			['chosen:\nnot_chosen: { "0": No }\n', [["hole", "hole", "chosen"]]],
			[
				'chosen: { "1": Yes, "2": Maybe }\nnot_chosen: { "0": No }\n',
				[["error", "wrong-type", "chosen"]],
			],
			[
				'chosen: { "1": }\nnot_chosen: { "0": No }\n',
				[["error", "wrong-type", "chosen"]],
			],
			[
				'chosen: { "1": Yes }\nnot_chosen: { "1": No }\n',
				[["error", "duplicate-code", "not_chosen"]],
			],
			[
				'chosen: { "1": Yes }\nnot_chosen: { "0": No }\nscale: yn\n',
				[["error", "unknown-key", "scale"]],
			],
		];
		for (const [text, expected] of cases) {
			const { value, findings } = read(text);
			expect(
				findings.map((f) => [f.severity, f.code, f.path]),
				text,
			).toEqual(expected);
			// Never half of it.
			expect(value, text).toBe(DEFAULT_SELECT_ALL);
			for (const f of findings)
				expect(f.hint).toContain(
					"Until it reads, the usual coding is used: 0 = No, 1 = Yes.",
				);
		}
	});

	it("isn't a settings file's to say", () => {
		for (const owner of ["bank", "workspace"] as const)
			expect(
				parseSettingsFile(
					"agency: org.example\nselect_all:\n",
					owner,
				).findings.map((f) => f.code),
			).toEqual(["unknown-key"]);
	});
});
