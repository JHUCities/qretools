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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { addressOf, bankOf, questionItems, remoteScope } from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { describe, expect, it } from "vitest";
import { findingLine, type Io, lineCol, main } from "./cli.ts";
import { readHistory } from "./history.ts";
import { readTagged } from "./remote.ts";

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
		readHistory,
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

	it("exports its questions saying where each was read: repository, path, tag, commit", async () => {
		const hh = await readWorkspace(here("../../core/fixtures/households"));
		const path = "questions/household/consent.yaml";
		const r = await runWith(
			async () => ({
				kind: "files",
				files: hh,
				at: {
					commit: "c0ffee0000000000000000000000000000000000",
					blobs: { [path]: "b1" },
				},
			}),
			"instrument",
			"export",
			here("../../core/fixtures/households/instruments/remote.yaml"),
			"--agency",
			"org.example",
		);
		expect(r.code).toBe(0);
		expect(r.out).toContain('"StringValue": "b1"');
		expect(r.out).toContain(`"StringValue": "${path}"`);
		expect(r.out).toContain(
			'"StringValue": "c0ffee0000000000000000000000000000000000"',
		);
		expect(r.out).toContain('"StringValue": "https://github.com/owner/bank"');
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

describe("qretools build", () => {
	const git = (cwd: string, ...args: string[]) =>
		promisify(execFile)(
			"git",
			["-c", "user.name=t", "-c", "user.email=t@example.org", ...args],
			{ cwd },
		);
	const QUESTION =
		"name: q\ntext: Do you work?\nintent: Employment\nresponses: yes_no\n";
	const SCALE = (no: string) => `labels:\n  "1": "Yes"\n  "2": ${no}\n`;

	/** A repository whose workspace is in `sub/`, committed three times. */
	async function repo(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), "qretools-build-"));
		const ws = join(root, "sub");
		await mkdir(join(ws, "questions/work"), { recursive: true });
		await mkdir(join(ws, "scales"));
		await git(root, "init", "-q", "-b", "main");
		await writeFile(join(ws, "workspace.yaml"), "agency: org.example\n");
		await writeFile(join(ws, "questions/work/q.yaml"), QUESTION);
		await writeFile(join(ws, "scales/yes_no.yaml"), SCALE('"No"'));
		await git(root, "add", "-A");
		await git(root, "commit", "-q", "-m", "first");
		// Outside the workspace: no version moves.
		await writeFile(join(root, "README.md"), "hi\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-q", "-m", "readme");
		await writeFile(join(ws, "scales/yes_no.yaml"), SCALE("Nope"));
		await git(root, "commit", "-q", "-am", "scale");
		return ws;
	}

	it("writes the last commit's DDI to dist/ddi.json, each item at its history's version", async () => {
		const ws = await repo();
		const r = await run("build", ws);
		expect(r.code).toBe(0);
		const ddi = r.written[join(ws, "dist", "ddi.json")] ?? "";
		// The scale changed once, and the question with it, as it names the scale.
		expect(ddi).toContain('"urn:ddi:org.example:q:2"');
		expect(ddi).toContain("Nope");
		expect(ddi).not.toContain('"urn:ddi:org.example:q:1"');
		expect(ddi).toMatch(/"VersionDate"/);
	});

	it("writes a release's tag message that a reader at the tag takes its versions from", async () => {
		const ws = await repo();
		const file = join(ws, "..", "tag.txt");
		const r = await run("build", ws, "--tag-message", file);
		expect(r.code).toBe(0);
		const message = r.written[file] ?? "";
		expect(message).toMatch(/^Each file's DDI version, by QREtools /);
		// As the release workflow tags: verbatim, so git's cleanup can't alter the manifest.
		await writeFile(file, message);
		const root = dirname(ws);
		await git(
			root,
			"-c",
			"tag.gpgsign=false",
			"tag",
			"-a",
			"--cleanup=verbatim",
			"-F",
			file,
			"v2",
		);
		const address = addressOf("o/r/sub@v2");
		if (address.kind !== "remote") throw new Error("address");
		const read = await readTagged(address, {
			root: await mkdtemp(join(tmpdir(), "qretools-cache-")),
			urlOf: () => root,
		});
		if (read.kind !== "files") throw new Error(read.reason);
		expect(read.at?.message).toBe(message);
		const scope = remoteScope(address.key, read);
		expect(scope.manifest).toBeUndefined();
		// The scale changed once since the first commit, and the question with it.
		expect(scope.versions?.["questions/work/q.yaml"]?.number).toBe("2");
		expect(scope.versions?.["scales/yes_no.yaml"]?.number).toBe("2");
		expect(scope.versions?.["questions/work/q.yaml"]?.date).toMatch(/^\d{4}-/);
	}, 30000);

	it("writes no tag message when the build is refused, and takes the option only for build", async () => {
		const ws = await repo();
		await writeFile(join(ws, "workspace.yaml"), "name: no agency\n");
		await git(dirname(ws), "commit", "-q", "-am", "no agency");
		const file = join(ws, "..", "tag.txt");
		const r = await run("build", ws, "--tag-message", file);
		expect(r.code).toBe(1);
		expect(r.written[file]).toBeUndefined();
		const c = await run("check", ws, "--tag-message", file);
		expect(c.err).toMatch(/`--tag-message` isn't an option of `check`/);
	});

	it("builds the commit, not the working tree, and says so", async () => {
		const ws = await repo();
		await writeFile(join(ws, "scales/yes_no.yaml"), SCALE("Uncommitted"));
		const r = await run("build", ws, "-o", join(ws, "out"));
		expect(r.code).toBe(0);
		expect(r.err).toMatch(/uncommitted changes: they aren't built/);
		const ddi = r.written[join(ws, "out", "ddi.json")] ?? "";
		expect(ddi).toContain("Nope");
		expect(ddi).not.toContain("Uncommitted");
	});

	it("refuses outside git, and a shallow clone whose history is cut short", async () => {
		const plain = await mkdtemp(join(tmpdir(), "qretools-nogit-"));
		await writeFile(join(plain, "workspace.yaml"), "agency: org.example\n");
		const r = await run("build", plain);
		expect(r).toMatchObject({ code: 2, written: {} });
		expect(r.err).toMatch(/isn't in a git repository/);
		const none = await run("build", join(plain, "nowhere"));
		expect(none.err).toMatch(/isn't a directory/);

		const ws = await repo();
		const shallow = await mkdtemp(join(tmpdir(), "qretools-shallow-"));
		await git(
			shallow,
			"clone",
			"-q",
			"--depth",
			"1",
			`file://${dirname(ws)}`,
			"c",
		);
		const s = await run("build", join(shallow, "c", "sub"));
		expect(s).toMatchObject({ code: 2, written: {} });
		expect(s.err).toMatch(/shallow clone/);
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
		// Three real Node processes, each loading the core from source: slower than the
		// default 5s on a CI runner, where it timed out.
	}, 30_000);

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

describe("a tag locked to the commit it named", () => {
	const A = "a".repeat(40);
	const B = "b".repeat(40);
	const at =
		(commit: string): Io["readRemote"] =>
		async () => ({
			kind: "files",
			files: { "workspace.yaml": "agency: org.example\n" },
			at: { commit, blobs: {} },
		});
	const workspace = async (settings: string) => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-lock-"));
		await mkdir(join(dir, "instruments"));
		await writeFile(join(dir, "workspace.yaml"), settings);
		await writeFile(
			join(dir, "instruments", "x.yaml"),
			"name: x\nuses:\n  b: owner/bank@v1\nflow: []\n",
		);
		return dir;
	};
	const exportIn = (dir: string, commit: string) =>
		runWith(
			at(commit),
			"instrument",
			"export",
			join(dir, "instruments", "x.yaml"),
			"--agency",
			"org.example",
		);

	it("is written when the instrument is exported, keeping the file's own lines", async () => {
		const dir = await workspace("# Ours.\nagency: org.example\n");
		const r = await exportIn(dir, A);
		expect(r.code).toBe(0);
		expect(r.written[join(dir, "workspace.yaml")]).toBe(
			`# Ours.\nagency: org.example\nlocked:\n  owner/bank@v1: ${A}\n`,
		);
		expect(r.err).toMatch(/Locked `owner\/bank@v1` at `aaaaaaaaaaaa`/);
		// Nothing to write when the tag still names it; a check never writes.
		await writeFile(
			join(dir, "workspace.yaml"),
			r.written[join(dir, "workspace.yaml")] ?? "",
		);
		expect((await exportIn(dir, A)).written).toEqual({});
		const checked = await runWith(
			at(A),
			"instrument",
			"check",
			join(dir, "instruments", "x.yaml"),
		);
		expect(checked.written).toEqual({});
	});

	it("warns of a moved tag in check, and an export re-locks it, saying so loudly", async () => {
		const dir = await workspace(
			`agency: org.example\nlocked:\n  owner/bank@v1: ${A}\n`,
		);
		const checked = await runWith(at(B), "check", dir);
		expect(checked.code).toBe(0);
		expect(checked.out).toMatch(/warning: .*the tag was moved.*\[moved-tag\]/);
		expect((await runWith(at(B), "check", dir, "--strict")).code).toBe(1);
		const exported = await exportIn(dir, B);
		expect(exported.code).toBe(0);
		expect(exported.err).toMatch(/\[WARNING\] Re-locked `owner\/bank@v1`/);
		expect(exported.written[join(dir, "workspace.yaml")]).toBe(
			`agency: org.example\nlocked:\n  owner/bank@v1: ${B}\n`,
		);
	});

	it("is asked for in check when a tag has none", async () => {
		const dir = await workspace("agency: org.example\n");
		const r = await runWith(at(A), "check", dir);
		expect(r.out).toMatch(/warning: .*isn't locked.*\[unlocked-tag\]/);
		expect(r.written).toEqual({});
	});

	it("isn't written into a workspace that has no workspace.yaml", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-lock-"));
		await mkdir(join(dir, "instruments"));
		await writeFile(
			join(dir, "instruments", "x.yaml"),
			"name: x\nuses:\n  b: owner/bank@v1\nflow: []\n",
		);
		const r = await exportIn(dir, A);
		expect(r.code).toBe(0);
		expect(r.written).toEqual({});
		expect(r.err).toMatch(/Not locked: .* has no readable workspace\.yaml/);
	});

	it("isn't written for an instrument outside a workspace, which still exports", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-lock-"));
		await writeFile(
			join(dir, "x.yaml"),
			"name: x\nuses:\n  b: owner/bank@v1\nflow: []\n",
		);
		const r = await runWith(
			at(A),
			"instrument",
			"export",
			join(dir, "x.yaml"),
			"--agency",
			"org.example",
		);
		expect(r.code).toBe(0);
		expect(r.err).toMatch(/Not locked/);
	});
});

describe("an instrument that reads only other workspaces", () => {
	const at: Io["readRemote"] = async () => ({
		kind: "files",
		files: { "workspace.yaml": "agency: org.bank\n" },
		at: { commit: "a".repeat(40), blobs: {} },
	});
	const file = async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-agency-"));
		await mkdir(join(dir, "instruments"));
		await writeFile(join(dir, "workspace.yaml"), "agency: org.example\n");
		await writeFile(
			join(dir, "instruments", "x.yaml"),
			"name: x\nuses:\n  b: owner/bank@v1\nflow: []\n",
		);
		return join(dir, "instruments", "x.yaml");
	};

	it("is published under its workspace's agency, as check and the app publish it", async () => {
		const x = await file();
		const exported = await runWith(at, "instrument", "export", x);
		expect(exported.code).toBe(0);
		expect(exported.out).toContain('"Agency": "org.example"');
		const checked = await runWith(at, "instrument", "check", x);
		expect(checked.out).not.toMatch(/invalid-agency|no DDI agency/);
	});

	it("is published under `--agency` when one is given", async () => {
		const r = await runWith(
			at,
			"instrument",
			"export",
			await file(),
			"--agency",
			"org.other",
		);
		expect(r.code).toBe(0);
		expect(r.out).toContain('"Agency": "org.other"');
		expect(r.out).not.toContain('"Agency": "org.example"');
	});
});
