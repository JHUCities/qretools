import { describe, expect, it } from "vitest";
import selectAllTemplate from "../../templates/settings/select_all.yaml?raw";
import workspaceTemplate from "../../templates/settings/workspace.yaml?raw";
import { bankOf } from "../evaluate.ts";
import { bankAgency, schemeEnv } from "../schemes.ts";
import {
	DEFAULT_SELECT_ALL,
	selectAllCodes,
	selectAllText,
} from "../selectAll.ts";
import {
	AGENCY_RULE_TEXT,
	agencyWritten,
	parseSelectAllFile,
	parseSettingsFile,
	withLocks,
} from "./bankfile.ts";
import { EMPTY_ENV, envAt } from "./env.ts";
import { parseSurface } from "./parse.ts";

const found = (source: string) =>
	parseSettingsFile(source).findings.map((f) => [f.severity, f.code, f.path]);

describe("the workspace's settings file", () => {
	it("reads the agency", () => {
		expect(parseSettingsFile("agency: edu.example.dept-1\n")).toEqual({
			agency: "edu.example.dept-1",
			required: [],
			requiredIn: {},
			locked: {},
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
				parseSettingsFile(`agency: "${bad}"\n`).agency,
				found(`agency: "${bad}"\n`),
			]).toEqual([bad, undefined, [["error", "invalid-agency", "agency"]]]);
		expect(
			parseSettingsFile(`agency: ${"a".repeat(63)}.org\n`).agency,
		).toBeDefined();
	});

	it("reads an agency as written, even one YAML reads as a number", () => {
		expect(parseSettingsFile("agency: 2024\n").agency).toBe("2024");
		expect(parseSettingsFile("agency: 1.10\n").agency).toBe("1.10");
		expect(found("agency: true\n")).toEqual([
			["error", "invalid-agency", "agency"],
		]);
	});

	it("names a field it doesn't know", () => {
		expect(found("agency: org.example\nowner: someone\n")).toEqual([
			["error", "unknown-key", "owner"],
		]);
	});

	it("keeps the agency out of the environment: only DDI needs it", () => {
		const workspace = (text: string) => [
			{ kind: "workspace" as const, name: "workspace", text },
		];
		expect(bankAgency(workspace("agency: org.example\n"))).toBe("org.example");
		expect(bankAgency(workspace("agency:\n"))).toBeUndefined();
		expect(bankAgency([])).toBeUndefined();
		expect(schemeEnv(workspace("agency: org.example\n"))).not.toHaveProperty(
			"agency",
		);
	});

	it("reads the fields it requires of its questions, and says what's wrong with the list", () => {
		const head = "agency: org.example\nrequired:\n";
		expect(parseSettingsFile(`${head}  - title\n  - concept\n`)).toMatchObject({
			required: ["title", "concept"],
			findings: [],
		});
		const read = parseSettingsFile(
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

	it("gives the agency as written, valid or not, for an instrument to say what's wrong with it", () => {
		expect(agencyWritten("agency: my org\n")).toBe("my org");
		expect(parseSettingsFile("agency: my org\n").agency).toBeUndefined();
		expect(agencyWritten("agency: org.example\n")).toBe("org.example");
		expect(agencyWritten("agency: 1.10\n")).toBe("1.10");
		expect(agencyWritten("agency:\n")).toBeUndefined();
		expect(agencyWritten("")).toBeUndefined();
		expect(agencyWritten("- not\n- a map\n")).toBeUndefined();
	});

	it("makes a required field to fill in, missing or empty, with what it's for", () => {
		const env = schemeEnv([
			{
				kind: "workspace",
				name: "workspace",
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
			["title", "`title` is required in this workspace.", true],
			["concept", "`concept` is required in this workspace.", true],
		]);
		expect(holes(`${q}title:\nconcept: Housing tenure\n`)).toEqual([
			["title", "`title` is empty.", true],
		]);
		// Elsewhere, an optional field: absent is fine.
		expect(holes(q, EMPTY_ENV)).toEqual([]);
	});
});

describe("the fields a folder's questions must also have", () => {
	const head = "agency: org.example\nrequired:\n  - title\nrequired_in:\n";
	const settings = `${head}  questions/nhd:\n    - universe\n  questions/example: [concept]\n`;
	const env = schemeEnv([
		{ kind: "workspace", name: "workspace", text: settings },
	]);

	it("reads them by folder path, in the order written", () => {
		const read = parseSettingsFile(settings);
		expect(read.findings).toEqual([]);
		expect(Object.entries(read.requiredIn)).toEqual([
			["questions/nhd", ["universe"]],
			["questions/example", ["concept"]],
		]);
	});

	it("says what's wrong at its place: a key that's no folder of questions, a list that isn't one, a field asked twice", () => {
		expect(found("agency: org.example\nrequired_in:\n")).toEqual([
			["hole", "hole", "required_in"],
		]);
		expect(found("agency: org.example\nrequired_in: [title]\n")).toEqual([
			["error", "wrong-type", "required_in"],
		]);
		const source = `${head}  nhd: [note]\n  questions/nhd/: [note]\n  scales/x: [note]\n  questions/a: universe\n  questions/b:\n  questions/c: [title, note, note, colour, name]\n`;
		expect(found(source)).toEqual([
			["error", "wrong-type", "required_in.nhd"],
			["error", "wrong-type", "required_in.questions/nhd/"],
			["error", "wrong-type", "required_in.scales/x"],
			["error", "wrong-type", "required_in.questions/a"],
			["hole", "hole", "required_in.questions/b"],
			// Already required of every question: advice, as a field listed twice is.
			["warning", "ignored-key", "required_in.questions/c.0"],
			["warning", "ignored-key", "required_in.questions/c.2"],
			["error", "wrong-type", "required_in.questions/c.3"],
			["warning", "ignored-key", "required_in.questions/c.4"],
		]);
		// A key that's no folder counts for nothing; a folder keeps what read.
		expect(parseSettingsFile(source).requiredIn).toEqual({
			"questions/a": [],
			"questions/b": [],
			"questions/c": ["note"],
		});
	});

	it("adds to what every question must have, by whole folder names, and never for a draft", () => {
		expect(envAt(env, "questions/nhd/sat.yaml").required).toEqual([
			"title",
			"universe",
		]);
		expect(envAt(env, "questions/example/q.yaml").required).toEqual([
			"title",
			"concept",
		]);
		// `questions/nh` isn't above `questions/nhd`, nor `questions/nhd` above `questions/nhdx`.
		expect(envAt(env, "questions/nhdx/q.yaml")).toBe(env);
		expect(envAt(env, "questions/other/q.yaml")).toBe(env);
		// Not saved yet: no folder, so only what every question must have.
		expect(envAt(env)).toBe(env);
		// A folder asking only for what is asked everywhere adds nothing.
		const same = {
			...env,
			requiredIn: { "questions/nhd": ["title"] as const },
		};
		expect(envAt(same, "questions/nhd/q.yaml")).toBe(same);
	});

	it("keeps the rest of the environment as it is, the usual select-all coding by identity", () => {
		const at = envAt(env, "questions/nhd/sat.yaml");
		expect(at).not.toBe(env);
		expect(at.selectAll).toBe(DEFAULT_SELECT_ALL);
		// Which folder asked is said beside what it added (`requiredBy`), and nothing else.
		const { requiredBy, ...rest } = at;
		expect(requiredBy).toEqual({ universe: "questions/nhd" });
		expect({ ...rest, required: env.required }).toEqual(env);
	});

	const q = (name: string) =>
		`name: ${name}\ntitle: T\ntext: Is it so?\nintent: To see why.\nopen: {}\n`;

	it("is read for each question of a workspace by where its file is", () => {
		const bank = bankOf({
			"workspace.yaml": settings,
			"questions/nhd/a.yaml": q("a"),
			"questions/example/b.yaml": q("b"),
			"questions/other/c.yaml": q("c"),
		});
		const holes = (path: string) =>
			(bank.findings[path] ?? [])
				.filter((f) => f.severity === "hole")
				.map((f) => f.path);
		expect(holes("questions/nhd/a.yaml")).toEqual(["universe"]);
		expect(holes("questions/example/b.yaml")).toEqual(["concept"]);
		expect(holes("questions/other/c.yaml")).toEqual([]);
		expect(bank.findings["workspace.yaml"]).toEqual([]);
	});

	it("says who asks for a field: the question's folder, or the workspace", () => {
		const bank = bankOf({
			"workspace.yaml": settings,
			"questions/nhd/a.yaml":
				"name: a\ntext: Is it so?\nintent: To see why.\nopen: {}\n",
		});
		expect(
			bank.findings["questions/nhd/a.yaml"]
				?.filter((f) => f.severity === "hole")
				.map((f) => f.message),
		).toEqual([
			"`title` is required in this workspace.",
			"`universe` is required in `questions/nhd`.",
		]);
	});

	it("names the folder whose list is empty, and keeps the settings' findings in the order they're written", () => {
		const bank = bankOf({
			"workspace.yaml":
				"required_in:\n  questions/gone: [note]\n  questions/nhd:\nrequired:\nagency: org.example\n",
			"questions/nhd/a.yaml": q("a"),
		});
		expect(
			bank.findings["workspace.yaml"]?.map((f) => [f.code, f.message]),
		).toEqual([
			["unknown-folder", "No questions are saved in `questions/gone`."],
			["hole", "`questions/nhd` lists no fields."],
			["hole", "`required` is empty."],
		]);
	});

	it("warns, on the settings, of a folder it names that holds no question", () => {
		const bank = bankOf({
			"workspace.yaml": `${head}  questions/nhd: [universe]\n  questions/nh: [note]\n  questions/nhd/sub: [note]\n`,
			"questions/nhd/a.yaml": `${q("a")}universe: Everyone asked\n`,
			"scales/s.yaml": "labels:\n  1: Yes\n  2: No\n",
		});
		expect(
			bank.findings["workspace.yaml"]?.map((f) => [
				f.severity,
				f.code,
				f.path,
				f.hint,
			]),
		).toEqual([
			[
				"warning",
				"unknown-folder",
				"required_in.questions/nh",
				"The folders with saved questions are `questions/nhd`. Until this is one of them, it requires nothing.",
			],
			[
				"warning",
				"unknown-folder",
				"required_in.questions/nhd/sub",
				"The folders with saved questions are `questions/nhd`. Until this is one of them, it requires nothing.",
			],
		]);
		expect(
			bank.findings["questions/nhd/a.yaml"]?.filter(
				(f) => f.severity === "hole",
			),
		).toEqual([]);
	});
});

/*
 * The template repository (JHUCities/qretools-template) carries these comments too, in
 * its workspace.yaml, filled in with org.example: change both.
 */
describe("the settings template a new workspace starts from", () => {
	it("leaves only the agency to fill in, and the required list ready to uncomment", () => {
		const holes = (source: string) =>
			parseSettingsFile(source).findings.map((f) => [f.severity, f.path]);
		// The comment says the rule the parser enforces.
		expect(workspaceTemplate.replace(/\n# /g, " ")).toContain(
			"letters, digits and hyphens, in parts joined by dots",
		);
		expect(AGENCY_RULE_TEXT).toContain(
			"Letters, digits and hyphens, up to 63 at a time, in parts joined by dots",
		);
		expect(holes(workspaceTemplate)).toEqual([["hole", "agency"]]);
		const on = workspaceTemplate.replace(
			"#required:\n#  - title",
			"required:\n  - title",
		);
		expect(on).not.toBe(workspaceTemplate);
		expect(parseSettingsFile(on).required).toEqual(["title"]);
		const inFolder = workspaceTemplate.replace(
			"#required_in:\n#  questions/example:\n#    - universe",
			"required_in:\n  questions/example:\n    - universe",
		);
		expect(inFolder).not.toBe(workspaceTemplate);
		expect(parseSettingsFile(inFolder).requiredIn).toEqual({
			"questions/example": ["universe"],
		});
		expect(holes(inFolder)).toEqual([["hole", "agency"]]);
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
		expect(
			parseSettingsFile("agency: org.example\nselect_all:\n").findings.map(
				(f) => f.code,
			),
		).toEqual(["unknown-key"]);
	});
});

describe("the locks in the workspace's settings file", () => {
	const A = "a".repeat(40);
	const B = "b".repeat(40);

	it("reads each tag's commit by its key, and says where an entry isn't one", () => {
		const parsed = parseSettingsFile(
			`agency: org.example\nlocked:\n  Org/Bank@v1: ${A}\n  ../: ${A}\n  org/other@v1: abc\n`,
		);
		expect(parsed.locked).toEqual({ "org/bank@v1": A });
		expect(parsed.findings.map((f) => f.path)).toEqual([
			"locked.../",
			"locked.org/other@v1",
		]);
		expect(parseSettingsFile(workspaceTemplate).locked).toEqual({});
	});

	it("are written under `locked:`, the template's `{}` becoming a list, its explanation kept", () => {
		expect(withLocks("agency: org.example\n", { "o/a@v1": A })).toBe(
			`agency: org.example\nlocked:\n  o/a@v1: ${A}\n`,
		);
		expect(withLocks(workspaceTemplate, { "o/a@v1": A })).toContain(
			`\nlocked:\n  o/a@v1: ${A}\n`,
		);
		expect(withLocks("", { "o/a@v1": A })).toBe(`locked:\n  o/a@v1: ${A}\n`);
		expect(withLocks("# only a comment\n", {})).toBe("# only a comment\n");
	});

	it("keep every other entry, written by hand, valid or not, and set one written with other capitals", () => {
		const source = `locked:\n  o/a@v1: ${A} # checked\n  o/b@v1: oops\n  O/C@v1: ${A}\n`;
		expect(withLocks(source, { "o/c@v1": B, "o/d@v1": B })).toBe(
			`locked:\n  o/a@v1: ${A} # checked\n  o/b@v1: oops\n  O/C@v1: ${B}\n  o/d@v1: ${B}\n`,
		);
	});

	it("write nothing into a file they can't read", () => {
		expect(withLocks("locked: x\n", { "o/c@v1": B })).toBeUndefined();
		expect(withLocks("- a list\n", { "o/c@v1": B })).toBeUndefined();
	});
});
