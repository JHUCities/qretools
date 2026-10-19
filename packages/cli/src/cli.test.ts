import { execFile } from "node:child_process";
import {
	cp,
	glob,
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bankOf, questionItems } from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { describe, expect, it } from "vitest";
import { findingLine, type Io, lineCol, main } from "./cli.ts";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));
const SAMPLE = here("../../core/fixtures/bank");

/** `main` with its output kept, as a shell would show it. */
async function run(...argv: string[]) {
	return runWith(unreachable, ...argv);
}
const unreachable: Io["readRemote"] = async (a) => ({
	kind: "unavailable",
	reason: `\`${a.key}\` isn't reachable from these tests.`,
});

/** The same, with banks in other repositories read by `readRemote`. */
async function runWith(readRemote: Io["readRemote"], ...argv: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const written: Record<string, string> = {};
	const io: Io = {
		out: (t) => out.push(t),
		err: (t) => err.push(t),
		writeFile: async (path, text) => {
			written[path] = text;
		},
		readRemote,
	};
	const code = await main(argv, io);
	return { code, out: out.join(""), err: err.join(""), written };
}

describe("a bank in another repository", () => {
	it("is read once, at its tag, and the instrument checked against it", async () => {
		const asked: string[] = [];
		const hh = await readWorkspace(here("../../core/fixtures/households"));
		const r = await runWith(
			async (a) => {
				asked.push(a.key);
				return { kind: "files", files: hh };
			},
			"instrument",
			"check",
			here("../../core/fixtures/households/instruments/remote.yaml"),
			"--agency",
			"org.example",
		);
		expect(asked).toEqual(["owner/bank@v1"]);
		expect(r.err).not.toMatch(/Can't read/);
		expect(r.code).toBe(0);
	});
});

describe("qretools check", () => {
	it("passes a clean bank, saying how many files it read", async () => {
		const r = await run("check", SAMPLE);
		expect(r).toMatchObject({ code: 0, out: "" });
		expect(r.err).toMatch(/^26 files, 0 findings/);
	});

	it("reports findings as compilers do, and fails on anything to fill in", async () => {
		const source = "name: q\ntext: Q?\n";
		const ranges = { "": [0, source.length] as const };
		expect(
			findingLine("questions/a/q.yaml", source, ranges, {
				code: "hole",
				severity: "hole",
				path: "intent",
				message: "`intent` is required.",
			}),
		).toBe("questions/a/q.yaml:3:1: error: `intent` is required. [to fill in]");
		expect(lineCol("ab\ncd", 4)).toEqual({ line: 2, col: 2 });
	});

	it("says it can't read a directory that isn't there, rather than check nothing", async () => {
		const r = await run("check", here("./nope"));
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/Can't read the workspace/);
	});

	it("refuses an unknown command or option, or one of the other command's, with the usage", async () => {
		expect((await run("lint")).code).toBe(2);
		expect((await run("check", "--nope")).code).toBe(2);
		expect((await run("check", SAMPLE, "-o", "x")).code).toBe(2);
		expect((await run("export", SAMPLE, "--strict")).code).toBe(2);
		expect((await run("--help")).code).toBe(0);
	});

	it("checks a workspace: its questions, shared files and instruments", async () => {
		const ws = await mkdtemp(join(tmpdir(), "qretools-ws-"));
		await cp(here("../../core/fixtures/households"), ws, { recursive: true });
		await writeFile(join(ws, "stray.yaml"), "x: 1\n");
		await writeFile(join(ws, "a-stray.yaml"), "x: 1\n");
		// Settings anywhere but the root are read as nothing.
		await mkdir(join(ws, "banks/x"), { recursive: true });
		await writeFile(
			join(ws, "banks/x/workspace.yaml"),
			"agency: org.example\n",
		);
		const r = await run("check", ws);
		const lines = r.out.trimEnd().split("\n");
		// The households instrument reads its own workspace's bank; remote's can't be read here.
		expect(
			lines.filter(
				(l) => l.includes("households.yaml:") && !l.includes(": note: "),
			),
		).toEqual([]);
		expect(lines.find((l) => l.includes("remote.yaml:3:3:"))).toMatch(
			/error: `owner\/bank@v1` isn't reachable from these tests\./,
		);
		// Noted in its place among the others, by path, as compilers report per file.
		expect(lines[0]).toBe(
			`${join(ws, "a-stray.yaml")}:1:1: note: This file is read as nothing: it isn't in questions/<folder>/, a shared folder or instruments/. [ignored]`,
		);
		expect(lines.at(-1)).toMatch(/stray\.yaml:1:1: note: .* \[ignored\]$/);
		expect(
			lines.filter((l) => l.includes("banks/x/workspace.yaml:1:1: note:")),
		).toHaveLength(1);
		// 16 questions and shared files (`workspace.yaml` among them), 2 instruments; the
		// three notes of files read as nothing aren't findings.
		const found = lines.filter((l) => !l.endsWith("[ignored]")).length;
		expect(lines.length - found).toBe(3);
		expect(r.err.startsWith(`18 files, ${found} findings: `)).toBe(true);
		expect(r.code).toBe(1);
	});

	it("asks more of the questions in a folder `required_in` names, and of no others", async () => {
		const ws = await mkdtemp(join(tmpdir(), "qretools-in-"));
		const q = (name: string) =>
			`name: ${name}\ntext: Is it so?\nintent: To see why.\nopen: {}\n`;
		await mkdir(join(ws, "questions/nhd"), { recursive: true });
		await mkdir(join(ws, "questions/other"), { recursive: true });
		await writeFile(
			join(ws, "workspace.yaml"),
			"agency: org.example\nrequired_in:\n  questions/nhd: [universe]\n  questions/gone: [note]\n",
		);
		await writeFile(join(ws, "questions/nhd/a.yaml"), q("a"));
		await writeFile(join(ws, "questions/other/b.yaml"), q("b"));
		const r = await run("check", ws);
		expect(
			r.out
				.trimEnd()
				.split("\n")
				.filter((l) => /\[(to fill in|unknown-folder)\]$/.test(l)),
		).toEqual([
			`${join(ws, "questions/nhd/a.yaml")}:5:1: error: \`universe\` is required in \`questions/nhd\`. [to fill in]`,
			`${join(ws, "workspace.yaml")}:4:3: warning: No questions are saved in \`questions/gone\`. [unknown-folder]`,
		]);
		expect(r.code).toBe(1);
	});

	it("says there's nothing to read in a folder of nothing it reads, empty or not, rather than pass it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-none-"));
		for (const command of ["check", "export"]) {
			const r = await run(command, dir);
			expect(r).toMatchObject({ code: 2, out: "" });
			expect(r.err).toMatch(/^Nothing to read in /);
		}
		// Whatever YAML is there, and however it's laid out.
		await writeFile(join(dir, "stray.yaml"), "x: 1\n");
		await cp(SAMPLE, join(dir, "banks/a"), { recursive: true });
		const r = await run("check", dir);
		expect(r).toMatchObject({ code: 2, out: "" });
		expect(r.err).toMatch(/^Nothing to read in /);
	});

	it("reads a workspace of settings alone", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-one-"));
		await writeFile(join(dir, "workspace.yaml"), "agency: org.example\n");
		expect((await run("check", dir)).err).toMatch(/^1 files, /);
	});

	it("names files as the user named the bank, so editors find them from here", async () => {
		const r = await run("check", here("../../../../bas-question-bank"));
		if (r.err.startsWith("Can't read")) return; // the reference bank isn't checked out here
		expect(r.out.split("\n")[0]).toMatch(
			/bas-question-bank\/.*\.yaml:\d+:\d+: /,
		);
	});
});

describe("qretools export", () => {
	it("finds nothing to export where the only questions are in folders of their own", async () => {
		const ws = await mkdtemp(join(tmpdir(), "qretools-ws-"));
		await cp(SAMPLE, join(ws, "banks/a"), { recursive: true });
		const r = await run("export", ws);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/^Nothing to read in /);
	});

	it("writes the bank's DDI, valid, with every question's items once", async () => {
		const r = await run("export", SAMPLE, "-o", "out.json");
		expect(r.code).toBe(0);
		const doc = JSON.parse(r.written["out.json"] ?? "{}");
		expect(Object.keys(doc.QuestionItem ?? {})).toHaveLength(9);
		expect(Object.keys(doc.QuestionItem ?? {})[0]).toMatch(/^org\.example:/);
	});

	it("exports each question's items as the bank evaluated them, versions and all", async () => {
		const files = await readWorkspace(SAMPLE);
		const path = "questions/example/parks_spending.yaml";
		const bank = bankOf(files, { [path]: { number: "3" } });
		const ev = bank.questions[path];
		if (ev === undefined) throw new Error(`${path} isn't in the bank`);
		expect(
			questionItems(ev.draft, bank, path).map((i) => i.identity.Version),
		).toContain("3");
	});
});

describe("the command under real Node", () => {
	it("runs from source with no build or loader", async () => {
		const exec = promisify(execFile);
		const bin = here("../bin/qretools.ts");
		const { stdout, stderr } = await exec(process.execPath, [
			bin,
			"check",
			SAMPLE,
		]);
		expect(stdout).toBe("");
		expect(stderr).toMatch(/^26 files/);
		const exported = await exec(process.execPath, [bin, "export", SAMPLE]);
		expect(JSON.parse(exported.stdout).QuestionItem).toBeDefined();
		// The export package too, reached through the workspace's link to its source.
		const qsf = await exec(process.execPath, [
			bin,
			"instrument",
			"export",
			here("../../core/fixtures/households/instruments/households.yaml"),
			"--qsf",
		]);
		expect(JSON.parse(qsf.stdout).SurveyEntry.SurveyName).toBe("households");
	});

	it("imports the core's own modules by their .ts names, which Node can find", async () => {
		const stale: string[] = [];
		// The command runs the packages it uses from their source too.
		for (const root of ["../../core/src", "../../qsf/src", "."])
			for await (const file of glob("**/*.ts", { cwd: here(root) }))
				if (
					/from\s+"\.{1,2}\/[^"]*\.js"/.test(
						await readFile(here(`${root}/${file}`), "utf8"),
					)
				)
					stale.push(`${root}/${file}`);
		expect(stale).toEqual([]);
	});
});
