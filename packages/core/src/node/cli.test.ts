import { execFile } from "node:child_process";
import { cp, glob, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { documentOf } from "../ddi/document.ts";
import { bankOf } from "../evaluate.ts";
import { findingLine, type Io, lineCol, main } from "./cli.ts";
import { readBank } from "./index.ts";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));
const SAMPLE = here("../../fixtures/bank");

/** `main` with its output kept, as a shell would show it. */
async function run(...argv: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const written: Record<string, string> = {};
	const io: Io = {
		out: (t) => out.push(t),
		err: (t) => err.push(t),
		writeFile: async (path, text) => {
			written[path] = text;
		},
	};
	const code = await main(argv, io);
	return { code, out: out.join(""), err: err.join(""), written };
}

describe("qretools check", () => {
	it("passes a clean bank, saying how many files it read", async () => {
		const r = await run("check", SAMPLE);
		expect(r).toMatchObject({ code: 0, out: "" });
		expect(r.err).toMatch(/^22 files, 0 findings/);
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
		expect(r.err).toMatch(/Can't read the bank/);
	});

	it("refuses an unknown command or option, or one of the other command's, with the usage", async () => {
		expect((await run("lint")).code).toBe(2);
		expect((await run("check", "--nope")).code).toBe(2);
		expect((await run("check", SAMPLE, "-o", "x")).code).toBe(2);
		expect((await run("export", SAMPLE, "--strict")).code).toBe(2);
		expect((await run("--help")).code).toBe(0);
	});

	it("checks a workspace: its banks, its instruments and its own file", async () => {
		const ws = await mkdtemp(join(tmpdir(), "qretools-ws-"));
		await cp(here("../../fixtures/households"), join(ws, "households"), {
			recursive: true,
		});
		await cp(here("../../fixtures/instruments"), join(ws, "instruments"), {
			recursive: true,
		});
		await writeFile(join(ws, "workspace.yaml"), "agency: org.example\n");
		await writeFile(join(ws, "stray.yaml"), "x: 1\n");
		await writeFile(join(ws, "a-stray.yaml"), "x: 1\n");
		const r = await run("check", ws);
		const lines = r.out.trimEnd().split("\n");
		// The households instrument reads its bank beside it; remote's bank isn't read here.
		expect(
			lines.filter(
				(l) => l.includes("households.yaml:") && !l.includes(": note: "),
			),
		).toEqual([]);
		expect(lines.find((l) => l.includes("remote.yaml:3:3:"))).toMatch(
			/error: `owner\/bank@v1` is in another repository, which `qretools check` doesn't read yet\./,
		);
		// Noted in its place among the others, by path, as compilers report per file.
		expect(lines[0]).toBe(
			`${join(ws, "a-stray.yaml")}:1:1: note: This file is read as nothing: it isn't in a bank's folders or instruments/. [ignored]`,
		);
		expect(lines.at(-1)).toMatch(/stray\.yaml:1:1: note: .* \[ignored\]$/);
		// 16 bank files, 2 instruments, the workspace file.
		expect(r.err).toMatch(/^19 files, /);
		expect(r.code).toBe(1);
	});

	it("says a folder of nothing it reads holds no bank, whatever YAML is there", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-none-"));
		await writeFile(join(dir, "stray.yaml"), "x: 1\n");
		const r = await run("check", dir);
		expect(r).toMatchObject({ code: 2, out: "" });
		expect(r.err).toMatch(/^No bank files in /);
	});

	it("names files as the user named the bank, so editors find them from here", async () => {
		const r = await run("check", here("../../../../../bas-question-bank"));
		if (r.err.startsWith("Can't read")) return; // the reference bank isn't checked out here
		expect(r.out.split("\n")[0]).toMatch(
			/bas-question-bank\/.*\.yaml:\d+:\d+: /,
		);
	});
});

describe("qretools export", () => {
	it("says which bank to export from a workspace whose banks are in folders", async () => {
		const ws = await mkdtemp(join(tmpdir(), "qretools-ws-"));
		for (const bank of ["banks/b", "banks/a"])
			await cp(SAMPLE, join(ws, bank), { recursive: true });
		const r = await run("export", ws);
		expect(r.code).toBe(2);
		expect(r.err).toBe(
			`${ws} is a workspace with banks at banks/a, banks/b; export one: qretools export ${join(ws, "banks/a")}\n`,
		);
	});

	it("writes the bank's DDI, valid, with every question's items once", async () => {
		const r = await run("export", SAMPLE, "-o", "out.json");
		expect(r.code).toBe(0);
		const doc = JSON.parse(r.written["out.json"] ?? "{}");
		expect(Object.keys(doc.QuestionItem ?? {})).toHaveLength(6);
		expect(Object.keys(doc.QuestionItem ?? {})[0]).toMatch(/^org\.example:/);
	});

	it("exports each question's items as the bank evaluated them, versions and all", async () => {
		const files = await readBank(SAMPLE);
		const path = "questions/examples/parks_spending.yaml";
		const bank = bankOf(files, { [path]: { number: "3" } });
		expect(
			bank.questions[path]?.items.map((i) => i.identity.Version),
		).toContain("3");
		expect(documentOf(bank.questions[path]?.items ?? [])).toEqual(
			bank.questions[path]?.ddi,
		);
	});
});

describe("the command under real Node", () => {
	it("runs from source with no build or loader", async () => {
		const exec = promisify(execFile);
		const bin = here("../../bin/qretools.ts");
		const { stdout, stderr } = await exec(process.execPath, [
			bin,
			"check",
			SAMPLE,
		]);
		expect(stdout).toBe("");
		expect(stderr).toMatch(/^22 files/);
		const exported = await exec(process.execPath, [bin, "export", SAMPLE]);
		expect(JSON.parse(exported.stdout).QuestionItem).toBeDefined();
	});

	it("imports the core's own modules by their .ts names, which Node can find", async () => {
		const stale: string[] = [];
		for await (const file of glob("**/*.ts", { cwd: here("..") }))
			if (
				/from\s+"\.{1,2}\/[^"]*\.js"/.test(
					await readFile(here(`../${file}`), "utf8"),
				)
			)
				stale.push(file);
		expect(stale).toEqual([]);
	});
});
