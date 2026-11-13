import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cp,
	glob,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	addressOf,
	bankOf,
	instrumentOf,
	questionItems,
	remoteScope,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { qsfOf } from "@qretools/qualtrics";
import { describe, expect, it } from "vitest";
import { findingLine, type Io, lineCol, main } from "./cli.ts";
import { ownRepository, readHistory } from "./history.ts";
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
	return runOver({}, readRemote, ...argv);
}

/** `runWith`, over files an earlier run wrote: a second build into the same folder. */
async function runOver(
	files: Readonly<Record<string, string>>,
	readRemote: Io["readRemote"],
	...argv: string[]
) {
	const out: string[] = [];
	const err: string[] = [];
	const written: Record<string, string> = { ...files };
	const io: Io = {
		out: (t) => out.push(t),
		err: (t) => err.push(t),
		writeFile: async (path, text) => {
			written[path] = text;
		},
		removeFile: async (path) => {
			delete written[path];
		},
		readRemote,
		readHistory,
		ownRepository,
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
		// Settings anywhere but the root are ignored.
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
			`${join(ws, "a-stray.yaml")}:1:1: note: QREtools ignores this file: it isn't in questions/<folder>/, a shared folder or instruments/. [ignored]`,
		);
		expect(lines.at(-1)).toMatch(/stray\.yaml:1:1: note: .* \[ignored\]$/);
		expect(
			lines.filter((l) => l.includes("banks/x/workspace.yaml:1:1: note:")),
		).toHaveLength(1);
		// 16 questions and shared files (`workspace.yaml` among them), 2 instruments; the
		// three notes of ignored files aren't findings.
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
	// Not the user's own git: no signing or hooks, which made each commit here 0.3s.
	const git = (cwd: string, ...args: string[]) =>
		promisify(execFile)(
			"git",
			[
				...["-c", "user.name=t", "-c", "user.email=t@example.org"],
				...["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"],
				...["-c", "core.hooksPath=/dev/null"],
				...args,
			],
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
		expect(r.err).toMatch(/uncommitted changes\. They aren't built/);
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

	describe("releasing its instruments", () => {
		const A = "a".repeat(40);
		const OPEN = "name: q\ntext: Q?\nintent: i\nopen: {}\n";
		const instrument = (title: string, use: string) =>
			`name: x\ntitle: ${title}\nuses:\n  b: ${use}\nflow:\n  - ask: b.q\n`;

		/** `repo()` with an instrument committed twice, its repository on GitHub as acme/ws. */
		async function withInstrument(use: string, settings: string) {
			const ws = await repo();
			const root = dirname(ws);
			await git(
				root,
				"remote",
				"add",
				"origin",
				"https://github.com/acme/ws.git",
			);
			await mkdir(join(ws, "instruments"));
			await writeFile(join(ws, "workspace.yaml"), settings);
			await writeFile(join(ws, "instruments/x.yaml"), instrument("One", use));
			await git(root, "add", "-A");
			await git(root, "commit", "-q", "-m", "instrument");
			await writeFile(join(ws, "instruments/x.yaml"), instrument("Two", use));
			await git(root, "commit", "-q", "-am", "retitled");
			return { ws, root };
		}

		it("refuses a draft, which reads this workspace as `../`, and writes nothing", async () => {
			const { ws } = await withInstrument("../", "agency: org.example\n");
			const r = await run("build", ws);
			expect(r.code).toBe(1);
			expect(r.written).toEqual({});
			expect(r.err).toMatch(
				/instruments\/x\.yaml:4:3: error: `b` reads this workspace's questions as they are now, not at a tag, so the instrument can't be released\. \[untagged-use\]/,
			);
			expect(r.err).toMatch(/Not built: an instrument is released only when/);
		});

		it("releases one pinned to its own repository at a locked tag, read from this clone, at its version", async () => {
			const { ws, root } = await withInstrument(
				"acme/ws/sub@v1",
				`agency: org.example\nlocked:\n  acme/ws/sub@v1: ${A}\n`,
			);
			const asked: (string | undefined)[][] = [];
			const r = await runWith(
				async (a, from) => {
					asked.push([a.key, from]);
					return {
						kind: "files",
						files: {
							"workspace.yaml": "agency: org.example\n",
							"questions/t/q.yaml": OPEN,
						},
						at: { commit: A, blobs: { "questions/t/q.yaml": "b1" } },
					};
				},
				"build",
				ws,
			);
			expect(r.code).toBe(0);
			expect(asked).toEqual([["acme/ws/sub@v1", await realpath(root)]]);
			const ddi = JSON.parse(
				r.written[join(ws, "dist", "instruments", "x.json")] ?? "{}",
			);
			// Committed twice: version 2, on the instrument and on every item it makes.
			expect(Object.keys(ddi.Instrument)).toEqual([
				"org.example:instrument-x:2",
			]);
			expect(r.written[join(ws, "dist", "ddi.json")]).toBeDefined();
			// Its Qualtrics survey, and the map of the survey's columns to that DDI.
			const json = r.written[join(ws, "dist", "instruments", "x.json")] ?? "";
			const map = JSON.parse(
				r.written[join(ws, "dist", "instruments", "x-ddi-qsf.columns.json")] ??
					"{}",
			);
			expect(map).toEqual({
				qretools: expect.any(String),
				instrument: "urn:ddi:org.example:instrument-x:2",
				ddi: `sha256:${createHash("sha256").update(json).digest("hex")}`,
				columns: [
					{
						importId: "QID1_TEXT",
						variable: "urn:ddi:org.example:instrument-x.var-q:2",
					},
				],
			});
			const qsf = r.written[join(ws, "dist", "instruments", "x.qsf")] ?? "";
			// Dated when the instrument last changed, never now: a commit builds the same bytes.
			const changed = (
				await git(
					root,
					"log",
					"-1",
					"--format=%cI",
					"--",
					"sub/instruments/x.yaml",
				)
			).stdout.trim();
			expect(JSON.parse(qsf).SurveyEntry.SurveyCreationDate).toBe(
				new Date(changed).toISOString().slice(0, 19).replace("T", " "),
			);
			const again = await runWith(
				async () => ({
					kind: "files",
					files: {
						"workspace.yaml": "agency: org.example\n",
						"questions/t/q.yaml": OPEN,
					},
					at: { commit: A, blobs: { "questions/t/q.yaml": "b1" } },
				}),
				"build",
				ws,
			);
			expect(again.written).toEqual(r.written);
		});

		it("releases one Qualtrics can't run without its survey, and removes the one an earlier build wrote", async () => {
			const { ws } = await withInstrument(
				"acme/ws/sub@v1",
				`agency: org.example\nlocked:\n  acme/ws/sub@v1: ${A}\n`,
			);
			const bank: Io["readRemote"] = async () => ({
				kind: "files",
				files: {
					"workspace.yaml": "agency: org.example\n",
					"questions/t/q.yaml": OPEN,
				},
				at: { commit: A, blobs: { "questions/t/q.yaml": "b1" } },
			});
			const dist = (file: string) => join(ws, "dist", "instruments", file);
			// What an earlier build wrote: that a release writes these is the test above.
			const earlier = Object.fromEntries(
				["x.json", "x.qsf", "x-ddi-qsf.columns.json"].map((f) => [
					dist(f),
					"earlier",
				]),
			);
			// An input named like a field Qualtrics surveys get: a release allows it, a survey can't.
			await writeFile(
				join(ws, "instruments/x.yaml"),
				"name: x\nuses:\n  b: acme/ws/sub@v1\ninputs:\n  qretools_version:\n    number: {}\nflow:\n  - ask: b.q\n",
			);
			await git(dirname(ws), "commit", "-q", "-am", "an input");
			const r = await runOver(earlier, bank, "build", ws);
			expect(r.code).toBe(0);
			expect(
				Object.keys(r.written)
					.map((p) => p.slice(ws.length + 1))
					.sort(),
			).toEqual(["dist/ddi.json", "dist/instruments/x.json"]);
			expect(r.written[dist("x.json")]).not.toBe("earlier");
			expect(r.err).toMatch(
				/\[WARNING\] .*instruments\/x\.yaml: not built as a Qualtrics survey\./,
			);
		});

		it("refuses one whose bank can't be read, rather than release it with questions missing", async () => {
			const { ws } = await withInstrument(
				"acme/ws/sub@v1",
				`agency: org.example\nlocked:\n  acme/ws/sub@v1: ${A}\n`,
			);
			const r = await runWith(
				async () => ({ kind: "unavailable", reason: "GitHub is down." }),
				"build",
				ws,
			);
			expect(r.code).toBe(1);
			expect(r.written).toEqual({});
			expect(r.err).toMatch(/instruments\/x\.yaml:\d+:\d+: (error|to fill in)/);
		});

		it("has check and instrument export read an own pin from this clone too, and another repository's from GitHub", async () => {
			const settings = `agency: org.example\nlocked:\n  acme/ws/sub@v1: ${A}\n  other/bank@v1: ${A}\n`;
			const { ws, root } = await withInstrument("acme/ws/sub@v1", settings);
			await writeFile(
				join(ws, "instruments/x.yaml"),
				"name: x\nuses:\n  b: acme/ws/sub@v1\n  o: other/bank@v1\nflow:\n  - ask: b.q\n  - ask: o.p\n",
			);
			const asked: (string | undefined)[][] = [];
			const at: Io["readRemote"] = async (a, from) => {
				asked.push([a.key, from]);
				// Each bank its own question, so the two don't share a DDI name.
				const name = a.key === "other/bank@v1" ? "p" : "q";
				const path = `questions/t/${name}.yaml`;
				return {
					kind: "files",
					files: {
						"workspace.yaml": "agency: org.example\n",
						[path]: OPEN.replace("name: q", `name: ${name}`),
					},
					at: { commit: A, blobs: { [path]: "b1" } },
				};
			};
			const clone = await realpath(root);
			const own = ["acme/ws/sub@v1", clone];
			const other = ["other/bank@v1", undefined];
			expect((await runWith(at, "check", ws)).code).toBe(0);
			expect(asked.sort()).toEqual([own, other]);
			asked.length = 0;
			const x = join(ws, "instruments/x.yaml");
			expect((await runWith(at, "instrument", "export", x)).code).toBe(0);
			expect(asked.sort()).toEqual([own, other]);
		});

		it("says to fetch the tags when the clone hasn't the own tag a pin names", async () => {
			const { ws } = await withInstrument(
				"acme/ws/sub@v1",
				`agency: org.example\nlocked:\n  acme/ws/sub@v1: ${A}\n`,
			);
			const r = await runWith(
				async () => ({
					kind: "unavailable",
					reason: "acme/ws has no tag `v1`.",
				}),
				"check",
				ws,
			);
			expect(r.out + r.err).toMatch(
				/own tags are read from its clone .*fetch it with `git fetch --tags`, or check out with `fetch-depth: 0` in CI/,
			);
		});

		it("refuses a pinned tag that has moved since it was locked", async () => {
			const { ws } = await withInstrument(
				"acme/ws/sub@v1",
				`agency: org.example\nlocked:\n  acme/ws/sub@v1: ${A}\n`,
			);
			const r = await runWith(
				async () => ({
					kind: "files",
					files: {
						"workspace.yaml": "agency: org.example\n",
						"questions/t/q.yaml": OPEN,
					},
					at: { commit: "b".repeat(40), blobs: { "questions/t/q.yaml": "b1" } },
				}),
				"build",
				ws,
			);
			expect(r.code).toBe(1);
			expect(r.written).toEqual({});
			expect(r.err).toMatch(
				/error: `acme\/ws\/sub@v1` has moved to a new version/,
			);
		});
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

	it("refuses while a question's access level can't be read, saying why once, and writes nothing", async () => {
		// Which lists refuse, and why, is core's (refusal.test.ts); here, how the command says it.
		const ws = await mkdtemp(join(tmpdir(), "qretools-access-"));
		await mkdir(join(ws, "questions/t"), { recursive: true });
		await writeFile(
			join(ws, "workspace.yaml"),
			"agency: org.example\naccess: public\n",
		);
		for (const name of ["zip", "age"])
			await writeFile(
				join(ws, `questions/t/${name}.yaml`),
				`name: ${name}\ntext: Q?\nintent: i\nopen: {}\naccess: restricted\n`,
			);
		const r = await run("export", ws, "-o", "out.json");
		expect([r.code, r.written]).toEqual([1, {}]);
		// The reason once, though both questions say it.
		expect(r.err.split("(`access` must be a list of levels)")).toHaveLength(2);
		expect(r.err).toMatch(
			/Not exported: an access level can't be read, or this workspace doesn't declare one\.\n$/,
		);
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

describe("qretools codebook", () => {
	it("writes the codebook of the DDI export writes: an entry per variable, each with its anchor", async () => {
		const ddi = JSON.parse((await run("export", SAMPLE)).out);
		const r = await run("codebook", SAMPLE, "-o", "codebook.html");
		expect(r).toMatchObject({ code: 0, out: "", err: "" });
		const page = r.written["codebook.html"] ?? "";
		expect(page).toMatch(/^<!doctype html>/);
		const variables = Object.values<{ ID: string }>(ddi.Variable);
		expect(page.match(/<article id="[^"]*:variable-/g)).toHaveLength(
			variables.length,
		);
		for (const v of variables)
			expect(page).toContain(`id="org.example:${v.ID}"`);
		expect((await run("codebook", SAMPLE)).out).toBe(page);
	});

	it("is refused as the export is, and takes only its options", async () => {
		const ws = await mkdtemp(join(tmpdir(), "qretools-cb-"));
		await cp(SAMPLE, ws, { recursive: true });
		await writeFile(join(ws, "workspace.yaml"), "# No agency.\n");
		const r = await run("codebook", ws, "-o", "codebook.html");
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/has no DDI agency/);
		expect(r.written).toEqual({});
		const s = await run("codebook", SAMPLE, "--qsf");
		expect(s.err).toMatch(/`--qsf` isn't an option of `codebook`/);
	});

	/** A DDI document written to a file of its own, for `codebook` to read. */
	const fileOf = async (text: string): Promise<string> => {
		const file = join(
			await mkdtemp(join(tmpdir(), "qretools-cb-")),
			"ddi.json",
		);
		await writeFile(file, text);
		return file;
	};
	const idsOf = (page: string) =>
		[...page.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]).sort();

	it("reads any DDI document from a file, as it reads the workspace's", async () => {
		const file = await fileOf((await run("export", SAMPLE)).out);
		const r = await run("codebook", file);
		expect(r).toMatchObject({ code: 0, err: "" });
		expect(r.out).toBe((await run("codebook", SAMPLE)).out);
	});

	it("keeps every anchor when every version changes", async () => {
		const ddi: unknown = JSON.parse((await run("export", SAMPLE)).out);
		// Every version 1 made 2: Version fields, URNs and the schema's reference values.
		const bump = (j: unknown, key?: string): unknown =>
			typeof j === "string"
				? key === "Version" && j === "1"
					? "2"
					: j.replace(/^(urn:ddi:[^:]+:[^:]+):1$/i, "$1:2")
				: Array.isArray(j)
					? j.map((x, i) =>
							key === "value" && i === 2 && x === "1" ? "2" : bump(x),
						)
					: j !== null && typeof j === "object"
						? Object.fromEntries(
								Object.entries(j).map(([k, v]) => [k, bump(v, k)]),
							)
						: j;
		const text = JSON.stringify(bump(ddi));
		// (A bucket's keys, "agency:id:1", are labels, not versions: left as they are.)
		const one = /"urn:ddi:[^"]*:1"|"Version":"1"|,"1"\]/;
		expect(JSON.stringify(ddi)).toMatch(one);
		expect(text).not.toMatch(one);
		const before = await run("codebook", await fileOf(JSON.stringify(ddi)));
		const after = await run("codebook", await fileOf(text));
		expect(after).toMatchObject({ code: 0, err: "" });
		expect(idsOf(after.out)).toEqual(idsOf(before.out));
		expect(idsOf(after.out).length).toBeGreaterThan(10);
	});

	it("says a reference that leads nowhere as check says a finding, and fails on it only when strict", async () => {
		const file = await fileOf(
			JSON.stringify({
				Variable: {
					v: { URN: "urn:ddi:a:v:1", QuestionReference: ["urn:ddi:a:gone:1"] },
				},
			}),
		);
		const line = `${file}: error: urn:ddi:a:v:1: \`urn:ddi:a:gone:1\` isn't in the document. [codebook-dangling]\n`;
		const r = await run("codebook", file);
		expect(r).toMatchObject({ code: 0, err: line });
		expect(r.out).toMatch(/^<!doctype html>/);
		const strict = await run("codebook", file, "--strict", "-o", "cb.html");
		expect(strict).toMatchObject({ code: 1, err: line });
		expect(strict.written["cb.html"]).toMatch(/^<!doctype html>/);
	});

	it("writes nothing for a file that isn't a DDI document, or isn't there", async () => {
		for (const [text, said] of [
			[
				"[1, 2]",
				/Not written: This isn't a DDI document.*\[codebook-unreadable\]/,
			],
			["{", /Not written: this isn't JSON.*\[codebook-unreadable\]/],
		] as const) {
			const r = await run("codebook", await fileOf(text), "-o", "cb.html");
			expect(r).toMatchObject({ code: 1, out: "", written: {} });
			expect(r.err).toMatch(said);
		}
		const gone = await run(
			"codebook",
			join(tmpdir(), "qretools-no-such-file.json"),
		);
		expect(gone).toMatchObject({ code: 2, out: "" });
		expect(gone.err).toMatch(/^Can't read/);
	});
});

describe("qretools paths", () => {
	it("writes the report of an instrument's paths, and refuses what isn't JSON", async () => {
		const file = join(
			await mkdtemp(join(tmpdir(), "qretools-paths-")),
			"ddi.json",
		);
		await writeFile(
			file,
			(
				await run(
					"instrument",
					"export",
					here("../../core/fixtures/households/instruments/households.yaml"),
				)
			).out,
		);
		const r = await run("paths", file, "-o", "paths.html");
		expect(r).toMatchObject({ code: 0, out: "", err: "" });
		const page = r.written["paths.html"] ?? "";
		expect(page).toContain("<h1>Households and housing: paths and reach</h1>");
		expect((await run("paths", file)).out).toBe(page);
		await writeFile(file, "{");
		const bad = await run("paths", file);
		expect(bad).toMatchObject({ code: 1, out: "" });
		expect(bad.err).toMatch(/this isn't JSON.*\[paths-unreadable\]/);
	});

	it("writes nothing for a file with no instrument, and takes only -o", async () => {
		const file = join(
			await mkdtemp(join(tmpdir(), "qretools-paths-")),
			"ddi.json",
		);
		await writeFile(file, (await run("export", SAMPLE)).out);
		const r = await run("paths", file);
		expect(r).toMatchObject({ code: 1, out: "" });
		expect(r.err).toMatch(/Not written: there's no instrument in this DDI/);
		const none = await run("paths");
		expect(none.code).toBe(2);
		expect(none.err).toMatch(/^Usage:/);
		const s = await run("paths", file, "--strict");
		expect(s.err).toMatch(/`--strict` isn't an option of `paths`/);
	});
});

describe("qretools responses", () => {
	const q = (name: string, rest: string) =>
		`name: ${name}\ntext: ${name}?\nintent: i\n${rest}`;
	const bank = bankOf({
		"workspace.yaml": "agency: org.bank\n",
		"missing.yaml": 'labels:\n  "D": Don\'t know\n',
		"scales/yesno01.yaml": 'labels:\n  "0": No\n  "1": Yes\n',
		"questions/a/tenure.yaml": q(
			"tenure",
			'responses:\n  "1": Own\n  "2": Rent\n',
		),
		"questions/a/modes.yaml": q(
			"modes",
			'select: many\nresponses:\n  "b": Bus\n  "9": None\n',
		),
		"questions/a/rent.yaml": q("rent", "number: {}\n"),
	});
	const v = (name: string) => `urn:ddi:org.example:instrument-t.var-${name}:1`;
	const id = (o: object) => `"${JSON.stringify(o).replaceAll('"', '""')}"`;

	/** What `build` writes for an instrument, and an export of its survey. */
	async function files(digestOf = (ddi: string) => ddi) {
		const dir = await mkdtemp(join(tmpdir(), "qretools-responses-"));
		const { ddi } = instrumentOf(
			"name: t\nuses:\n  b: here\nflow:\n  - ask: b.tenure\n  - ask: b.modes\n  - ask: b.rent\n",
			{ banks: { b: bank }, agency: "org.example" },
		);
		const text = `${JSON.stringify(ddi, null, 2)}\n`;
		const digest = `sha256:${createHash("sha256").update(digestOf(text)).digest("hex")}`;
		const made = qsfOf(ddi, {
			name: "t",
			created: "2026-11-12 00:00:00",
			digest,
			version: "9",
		});
		if (made.kind !== "made") throw new Error("the survey isn't made");
		await writeFile(join(dir, "t.json"), text);
		const map = join(dir, "t-ddi-qsf.columns.json");
		await writeFile(map, JSON.stringify(made.columns));
		const csv = join(dir, "export.csv");
		await writeFile(
			csv,
			[
				"ResponseId,qretools_instrument,qretools_ddi,qretools_version,tenure,modes_1,modes_9,rent",
				"Response ID,qretools_instrument,qretools_ddi,qretools_version,tenure?,modes? - Bus,modes? - None,rent?",
				[
					id({ ImportId: "_recordId" }),
					id({ ImportId: "qretools_instrument" }),
					id({ ImportId: "qretools_ddi" }),
					id({ ImportId: "qretools_version" }),
					id({ ImportId: "QID1" }),
					id({ ImportId: "QID2", choiceId: "1" }),
					id({ ImportId: "QID2", choiceId: "9" }),
					id({ ImportId: "QID3_TEXT" }),
				].join(","),
				`R_1,urn:ddi:org.example:instrument-t:1,${digest},9,2,1,,1200`,
				`R_2,urn:ddi:org.example:instrument-t:1,${digest},9,3,,1,D`,
				"",
			].join("\r\n"),
		);
		return { csv, map };
	}

	it("reads an export with its map and the DDI beside it, into one line per value", async () => {
		const { csv, map } = await files();
		const r = await run("responses", csv, "--map", map);
		expect(r.out).toBe(
			[
				"respondent,variable,row,value",
				`R_1,${v("tenure")},,2`,
				`R_1,${v("modes_b")},,1`,
				`R_1,${v("rent")},,1200`,
				`R_2,${v("modes_9")},,1`,
				`R_2,${v("rent")},,D`,
				"",
			].join("\n"),
		);
		// R_2's tenure isn't one of its codes: placed, never shown.
		expect(r.err).toBe(
			`${csv}:5: error: column \`tenure\`: This value isn't one \`${v("tenure")}\` can hold, so it isn't read. [responses-not-a-code]\n`,
		);
		expect(r.code).toBe(1);
		expect(
			(await run("responses", csv, "--map", map, "-o", "a.csv")).written,
		).toEqual({ "a.csv": r.out });
	});

	it("refuses a DDI the map wasn't made from, and needs --map", async () => {
		const { csv, map } = await files((ddi) => `${ddi} `);
		const r = await run("responses", csv, "--map", map);
		expect(r).toMatchObject({ code: 1, out: "" });
		expect(r.err).toMatch(
			/isn't the DDI the map was made from.*\[responses-provenance\]/,
		);
		expect((await run("responses", csv)).code).toBe(2);
		expect((await run("check", ".", "--map", map)).err).toMatch(
			/`--map` isn't an option of `check`/,
		);
	});

	it("reads a data file with a map that names its columns by header, beside the DDI or with --ddi", async () => {
		const { map: qsfMap } = await files();
		const dir = dirname(qsfMap);
		const ddi = join(dir, "t.json");
		const digest = `sha256:${createHash("sha256")
			.update(await readFile(ddi, "utf8"))
			.digest("hex")}`;
		const data = join(dir, "data.csv");
		await writeFile(
			data,
			"ID,TENURE,RENT,OTHER\n7,2,-98,x\n8,-100,-100,y\n9,5,1200,z\n",
		);
		const json = JSON.stringify({
			ddi: digest,
			respondent: "ID",
			values: { "-98": "D", "-100": null },
			columns: [
				{ column: "TENURE", variable: v("tenure") },
				{ column: "RENT", variable: v("rent") },
			],
		});
		const beside = join(dir, "t-ddi-survey.columns.json");
		await writeFile(beside, json);
		const r = await run("responses", data, "--map", beside);
		expect(r.out).toBe(
			[
				"respondent,variable,row,value",
				`7,${v("tenure")},,2`,
				`7,${v("rent")},,D`,
				`9,${v("rent")},,1200`,
				"",
			].join("\n"),
		);
		expect(r.err).toBe(
			[
				`${data}: note: column \`OTHER\`: The map names no variable for this column, so it isn't read. [responses-unmapped-column]`,
				`${data}:4: error: column \`TENURE\`: This value isn't one \`${v("tenure")}\` can hold, so it isn't read. [responses-not-a-code]`,
				"",
			].join("\n"),
		);
		expect(r.code).toBe(1);

		// A map kept elsewhere reads the DDI --ddi names, still by its digest.
		const elsewhere = join(dir, "maps");
		await mkdir(elsewhere);
		const apart = join(elsewhere, "t-ddi-survey.columns.json");
		await writeFile(apart, json);
		expect((await run("responses", data, "--map", apart)).code).toBe(2);
		expect(
			(await run("responses", data, "--map", apart, "--ddi", ddi)).out,
		).toBe(r.out);
		await writeFile(ddi, " ");
		expect(
			(await run("responses", data, "--map", apart, "--ddi", ddi)).err,
		).toMatch(/isn't the DDI the map was made from.*\[responses-provenance\]/);

		// Each kind of map is read only under its own name.
		await writeFile(join(dir, "t-ddi-qsf.columns.json"), json);
		expect(
			(
				await run(
					"responses",
					data,
					"--map",
					join(dir, "t-ddi-qsf.columns.json"),
				)
			).err,
		).toMatch(/isn't a QSF column map/);
		expect((await run("responses", data, "--map", ddi)).code).toBe(2);
	});
});

describe("access levels, through the commands", () => {
	it("checks, exports and refuses as the core decides", async () => {
		const root = await mkdtemp(join(tmpdir(), "qretools-access-"));
		const q = (name: string, line = "") =>
			`name: ${name}\ntext: ${name}?\nintent: i\nopen: {}\n${line}`;
		const put = async (path: string, text: string) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), text);
		};
		await put(
			"bank/workspace.yaml",
			"agency: org.bank\naccess: [public, restricted, secret]\n",
		);
		await put("bank/questions/a/zip.yaml", q("zip", "access: restricted\n"));
		await put("bank/questions/a/age.yaml", q("age"));
		await put("bank/missing.yaml", 'labels:\n  "D": Don\x27t know\n');
		await put("host/workspace.yaml", "agency: org.host\naccess: [public]\n");
		await put("host/questions/a/own.yaml", q("own", "access: public\n"));
		await put(
			"host/instruments/x.yaml",
			"name: x\nuses:\n  b: acme/b@v1\nflow:\n  - ask: b.zip\n",
		);
		const bank = join(root, "bank");

		// check: the missing line is to fill in; a level no question names is a warning.
		const checked = await run("check", bank);
		expect(checked.code).toBe(1);
		expect(checked.out).toMatch(
			/age\.yaml.*`access` is required.*\[to fill in\]/,
		);
		expect(checked.out).toMatch(
			/workspace\.yaml.*warning: No question names the access level `secret`\. \[unused-level\]/,
		);
		// export: the missing level is held at the most closed one, never refused for it.
		const exported = await run("export", bank);
		expect(exported.code).toBe(0);
		expect(exported.out).toContain("access-public-restricted-secret.codes");

		// An instrument whose workspace doesn't declare a level it asks at.
		const instrument = join(root, "host/instruments/x.yaml");
		const undeclared = await run(
			"instrument",
			"check",
			instrument,
			"--bank",
			`b=${bank}`,
		);
		expect(undeclared.code).toBe(1);
		expect(undeclared.out).toMatch(
			// At the ask's own line (5), naming the question as written.
			/x\.yaml:5:\d+: error: `b\.zip` is asked at `restricted`, which this workspace doesn't declare\. \[access-undeclared\]/,
		);
		// Missing values coded otherwise than this workspace's: one warning, on the bank's use.
		expect(undeclared.out).toMatch(
			/x\.yaml:3:\d+: warning: `b` codes missing values as `D`, and this workspace declares none\. It affects the one question this instrument asks from `b`\. \[missing-differs\]/,
		);
		expect(undeclared.out).not.toMatch(/x\.yaml:5:\d+: warning/);
		const refused = await run(
			"instrument",
			"export",
			instrument,
			"--bank",
			`b=${bank}`,
			"--qsf",
		);
		expect(refused).toMatchObject({ code: 1, out: "" });
		expect(refused.err).toMatch(/Not exported/);
	});
});

describe("qretools filter", () => {
	it("keeps a level and the more open ones, names what it removed, lists levels, and writes nothing when refused", async () => {
		const q = (name: string, rest = "") =>
			`name: ${name}\ntext: ${name}?\nintent: i\nopen: {}\n${rest}`;
		const { ddi } = instrumentOf(
			"name: t\nuses:\n  b: here\nflow:\n  - ask: b.tenure\n  - ask: b.zip\n",
			{
				banks: {
					b: bankOf({
						"workspace.yaml":
							"agency: org.bank\naccess: [public, restricted]\n",
						"questions/a/tenure.yaml": q("tenure", "access: public\n"),
						"questions/a/zip.yaml": q("zip", "access: restricted\n"),
					}),
				},
				agency: "org.example",
			},
		);
		const dir = await mkdtemp(join(tmpdir(), "qretools-filter-"));
		const file = join(dir, "t.json");
		await writeFile(file, JSON.stringify(ddi));
		const v = (name: string) =>
			`urn:ddi:org.example:instrument-t.var-${name}:1`;
		const answers = join(dir, "answers.csv");
		await writeFile(
			answers,
			`respondent,variable,row,value\nr1,${v("tenure")},,own\nr1,${v("zip")},,21218\n`,
		);

		const r = await run("filter", answers, "--ddi", file, "--access", "public");
		expect(r.out).toBe(
			`respondent,variable,row,value\nr1,${v("tenure")},,own\n`,
		);
		expect(r.err).toBe(
			`${answers}: note: removed \`zip\` (${v("zip")}), at \`restricted\`. [filter-removed]\n`,
		);
		expect(r.code).toBe(0);
		expect(
			(await run("filter", answers, "--ddi", file, "--access", "restricted"))
				.out,
		).toMatch(/21218/);
		// The policy, then each level with how many variables stand at it.
		expect(await run("filter", "--ddi", file)).toMatchObject({
			code: 0,
			out: "urn:ddi:org.bank:access-public-restricted.codes:1\n  public 1\n  restricted 1\n",
		});

		// Refused: nothing written, and no value said.
		const unknown = await run(
			"filter",
			answers,
			"--ddi",
			file,
			"--access",
			"secret",
			"-o",
			"kept.csv",
		);
		expect(unknown).toMatchObject({ code: 1, out: "", written: {} });
		expect(unknown.err).toMatch(
			/has no level `secret`.*\[filter-unknown-level\]/,
		);
		// A DDI with no levels: `--access` means nothing there, so it's refused.
		const plain = join(dir, "plain.json");
		await writeFile(
			plain,
			JSON.stringify(
				instrumentOf("name: p\nuses:\n  b: here\nflow:\n  - ask: b.tenure\n", {
					banks: {
						b: bankOf({
							"workspace.yaml": "agency: org.bank\n",
							"questions/a/tenure.yaml": q("tenure"),
						}),
					},
					agency: "org.example",
				}).ddi,
			),
		);
		const none = await run(
			"filter",
			answers,
			"--ddi",
			plain,
			"--access",
			"public",
		);
		expect(none).toMatchObject({ code: 1, out: "" });
		expect(none.err).toMatch(/\[filter-no-levels\]/);
		await writeFile(
			answers,
			"respondent,variable,row,value\nr1,urn:ddi:org.example:gone:1,,21218\n",
		);
		const gone = await run(
			"filter",
			answers,
			"--ddi",
			file,
			"--access",
			"public",
		);
		expect(gone).toMatchObject({ code: 1, out: "" });
		expect(gone.err).toMatch(/\[filter-unknown-variable\]/);
		expect(gone.err).not.toMatch(/21218/);
		expect((await run("filter", answers, "--access", "public")).code).toBe(2);
		expect((await run("check", ".", "--access", "public")).err).toMatch(
			/`--access` isn't an option of `check`/,
		);
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
		// The codebook package too.
		const codebook = await exec(process.execPath, [bin, "codebook", SAMPLE]);
		expect(codebook.stdout).toMatch(/^<!doctype html>/);
		// The Qualtrics export package too, reached through the workspace's link to its source.
		const qsf = await exec(process.execPath, [
			bin,
			"instrument",
			"export",
			here("../../core/fixtures/households/instruments/households.yaml"),
			"--qsf",
		]);
		expect(JSON.parse(qsf.stdout).SurveyEntry.SurveyName).toBe("households");
		// The paths package too.
		const ddi = join(
			await mkdtemp(join(tmpdir(), "qretools-paths-")),
			"ddi.json",
		);
		await writeFile(
			ddi,
			(
				await exec(process.execPath, [
					bin,
					"instrument",
					"export",
					here("../../core/fixtures/households/instruments/households.yaml"),
				])
			).stdout,
		);
		const paths = await exec(process.execPath, [bin, "paths", ddi]);
		expect(paths.stdout).toContain("paths and reach");
		// Six real Node processes, each loading the core from source: slower than the
		// default 5s on a CI runner, where it timed out.
	}, 30_000);

	it("imports the core's own modules by their .ts names, which Node can find", async () => {
		const stale: string[] = [];
		// The command runs the packages it uses from their source too.
		for (const root of [
			"../../core/src",
			"../../qualtrics/src",
			"../../codebook/src",
			"../../paths/src",
			".",
		])
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
		expect(checked.out).toMatch(
			/warning: .*has moved to a new version.*\[moved-tag\]/,
		);
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
		expect(r.out).toMatch(
			/warning: .*hasn't recorded which version.*\[unlocked-tag\]/,
		);
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
		expect(r.err).toMatch(
			/Not locked: .* has no workspace\.yaml that QREtools can read/,
		);
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

describe("qretools provenance", () => {
	const sha = (text: string) => createHash("sha256").update(text).digest("hex");

	/** An instrument's DDI as `build` writes it, a dataset beside it, and facts naming both. */
	async function files(answers = "respondent,variable,row,value\n") {
		const dir = await mkdtemp(join(tmpdir(), "qretools-provenance-"));
		const bank = bankOf({
			"workspace.yaml": "agency: org.bank\n",
			"questions/a/tenure.yaml":
				'name: tenure\ntext: Own or rent?\nintent: i\nresponses:\n  "1": Own\n  "2": Rent\n',
		});
		const { ddi } = instrumentOf(
			"name: t\nuses:\n  b: here\nflow:\n  - ask: b.tenure\n",
			{ banks: { b: bank }, agency: "org.example" },
		);
		const text = `${JSON.stringify(ddi, null, 2)}\n`;
		const urnOf = (type: string) =>
			Object.values(
				(ddi as Record<string, Record<string, { URN: string }>>)[type] ?? {},
			)[0]?.URN ?? "";
		await writeFile(join(dir, "t.json"), text);
		await writeFile(
			join(dir, "answers.csv"),
			"respondent,variable,row,value\n",
		);
		const facts = {
			qretools_provenance: 1,
			name: "run1",
			instrument: {
				urn: urnOf("Instrument"),
				ddi: { path: "t.json", sha256: sha(text) },
				workspace: "example/survey@v1",
			},
			asked_by: ["Simulation"],
			answered_by: { source: { other: "Synthetic, language model" } },
			dataset: {
				path: "answers.csv",
				sha256: sha(answers),
				present: [urnOf("Variable")],
			},
			prompts: [{ question: urnOf("QuestionItem"), text: "Answer briefly." }],
			attributes: { respondents: "10" },
		};
		const path = join(dir, "provenance.json");
		await writeFile(path, JSON.stringify(facts));
		return path;
	}

	it("writes the provenance's DDI, its files' digests checked and its URNs found", async () => {
		const r = await run("provenance", await files(), "-o", "out.json");
		expect(r.err).toBe("");
		expect(r.code).toBe(0);
		const doc = JSON.parse(r.written["out.json"] ?? "{}");
		expect(Object.keys(doc).sort()).toEqual([
			"DataCollection",
			"Methodology",
			"OtherMaterial",
			"PhysicalInstance",
			"StudyUnit",
			"VariableGroup",
		]);
	});

	it("refuses a dataset whose digest differs from the facts'", async () => {
		const r = await run("provenance", await files("other\n"));
		expect(r.code).toBe(1);
		expect(r.out).toBe("");
		expect(r.err).toContain(
			"dataset: `answers.csv` has another SHA-256 digest",
		);
	});

	it("writes the JSON Schema of the facts", async () => {
		const r = await run("provenance", "--schema");
		expect(r.code).toBe(0);
		expect(JSON.parse(r.out).properties.qretools_provenance.const).toBe(1);
	});
});
