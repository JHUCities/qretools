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
import { codebookOf, parse as parseDdi } from "@qretools/codebook";
import {
	addressOf,
	bankOf,
	csvView,
	instrumentOf,
	makeValidator,
	questionItems,
	readDataset,
	remoteScope,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import schema from "@qretools/core/schema.json" with { type: "json" };
import { qsfOf } from "@qretools/qualtrics";
import { describe, expect, it } from "vitest";
import { exportOfSurvey } from "../../qualtrics/src/testing.ts";
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

/** What a run reads on standard input. */
let stdin = "";

/** What a run fetches: each URL's body, by URL (any other is a 404), and each URL asked. */
let served: Record<string, string> = {};
let fetched: string[] = [];
/** Where a run's fetch says it was redirected, if anywhere. */
let redirectedTo: string | undefined;

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
		readStdin: async () => stdin,
		fetch: async (url) => {
			fetched.push(url);
			const body = served[url];
			return body === undefined
				? new Response("", { status: 404, statusText: "Not Found" })
				: redirectedTo === undefined
					? new Response(body)
					: Object.defineProperties(new Response(body), {
							redirected: { value: true },
							url: { value: redirectedTo },
						});
		},
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
			// Its Qualtrics survey, and never a column map: `qsf-map` makes that.
			expect(
				Object.keys(r.written)
					.map((p) => p.slice(ws.length + 1))
					.sort(),
			).toEqual([
				"dist/ddi.json",
				"dist/instruments/x.json",
				"dist/instruments/x.qsf",
			]);
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
				["x.json", "x.qsf"].map((f) => [dist(f), "earlier"]),
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

		describe("with column maps in maps/", () => {
			const pinned = `agency: org.example\nlocked:\n  acme/ws/sub@v1: ${A}\n`;
			const bank: Io["readRemote"] = async () => ({
				kind: "files",
				files: {
					"workspace.yaml": "agency: org.example\n",
					"questions/t/q.yaml": OPEN,
				},
				at: { commit: A, blobs: { "questions/t/q.yaml": "b1" } },
			});
			const qsf = (ddi?: string) =>
				`${JSON.stringify({ source: "qsf", ...(ddi !== undefined && { ddi }), columns: [] }, null, 2)}\n`;
			const data = (ddi: string) =>
				JSON.stringify({
					source: "gss",
					ddi,
					answered_by: "ResearchData.Published",
					respondent: "id",
					columns: [],
				});

			/** An instrument `x` built once (its DDI's digest), then maps committed beside it. */
			async function withMaps(
				maps: (digest: string) => Readonly<Record<string, string>>,
			) {
				const { ws } = await withInstrument("acme/ws/sub@v1", pinned);
				const before = await runWith(bank, "build", ws);
				const built = before.written[join(ws, "dist/instruments/x.json")] ?? "";
				const digest = `sha256:${createHash("sha256").update(built).digest("hex")}`;
				await mkdir(join(ws, "maps"));
				for (const [name, text] of Object.entries(maps(digest)))
					await writeFile(join(ws, "maps", name), text);
				await git(dirname(ws), "add", "-A");
				await git(dirname(ws), "commit", "-q", "-m", "maps");
				return { ws, before };
			}

			it("copies each map beside its instrument's DDI, as committed, and versions nothing by it", async () => {
				let map = "";
				const { ws, before } = await withMaps((digest) => {
					map = qsf(digest);
					return { "x-ddi-qsf.columns.json": map, "README.md": "not a map\n" };
				});
				// Not committed: not copied.
				await writeFile(join(ws, "maps/x-ddi-gss.columns.json"), data(""));
				const r = await runWith(bank, "build", ws);
				expect(r.code).toBe(0);
				expect(
					r.written[join(ws, "dist/instruments/x-ddi-qsf.columns.json")],
				).toBe(map);
				expect(r.err).not.toMatch(/build-map/);
				// A commit to maps/ moves no version, so the DDI is the one the map was made from.
				const {
					[join(ws, "dist/instruments/x-ddi-qsf.columns.json")]: _,
					...rest
				} = r.written;
				expect(rest).toEqual(before.written);
			});

			it("warns of a map made from another DDI, naming it and how to make it again, and copies it", async () => {
				const old = `sha256:${"0".repeat(64)}`;
				const { ws } = await withMaps(() => ({
					"x-ddi-qsf.columns.json": qsf(old),
					"x-ddi-gss.columns.json": data(old),
				}));
				const r = await runWith(bank, "build", ws);
				expect(r.code).toBe(0);
				expect(r.err).toMatch(
					new RegExp(
						`maps/x-ddi-qsf\\.columns\\.json: warning: made from the DDI ${old}.*\`qretools qsf-map\`.*\\[build-map-ddi\\]`,
					),
				);
				expect(r.err).toMatch(
					/maps\/x-ddi-gss\.columns\.json: warning: .*tools\/.*\[build-map-ddi\]/,
				);
				expect(
					r.written[join(ws, "dist/instruments/x-ddi-gss.columns.json")],
				).toBe(data(old));
			});

			it.each([
				[
					"names no instrument it builds",
					"y-ddi-qsf.columns.json",
					qsf(),
					/no instrument `y`/,
				],
				[
					"isn't named as a map",
					"x.columns.json",
					qsf(),
					/named `<instrument>-ddi-<source>\.columns\.json`/,
				],
				["has no source", "x-ddi-gss.columns.json", "{}", /no `source` field/],
				[
					"gives another source than its name",
					"x-ddi-gss.columns.json",
					qsf(),
					/name says the source `gss`, but its `source` field says `qsf`/,
				],
				["isn't JSON", "x-ddi-qsf.columns.json", "{", /this isn.t JSON \(/],
				[
					"isn't a map of its source",
					"x-ddi-qsf.columns.json",
					'{"source":"qsf"}',
					/isn't a QSF column map/,
				],
			])(
				"refuses a map that %s, and writes nothing",
				async (_, name, text, message) => {
					const { ws } = await withMaps(() => ({ [name]: text }));
					const r = await runWith(bank, "build", ws);
					expect(r.code).toBe(1);
					expect(r.written).toEqual({});
					expect(r.err).toMatch(message);
					expect(r.err).toMatch(/\[build-map\]/);
					expect(r.err).toMatch(/Not built: every file in maps\//);
				},
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

	describe("a tag reference to an instrument in a release", () => {
		/**
		 * `repo()` released as `v2`, as a workspace's release workflow tags it: an instrument
		 * reading the workspace's own questions at `v1`, built with `--tag-message`.
		 */
		async function released() {
			const ws = await repo();
			const root = dirname(ws);
			await git(
				root,
				"remote",
				"add",
				"origin",
				"https://github.com/acme/ws.git",
			);
			await git(root, "tag", "v1");
			const v1 = (await git(root, "rev-parse", "HEAD")).stdout.trim();
			await mkdir(join(ws, "instruments"));
			await writeFile(
				join(ws, "workspace.yaml"),
				`agency: org.example\nlocked:\n  acme/ws/sub@v1: ${v1}\n`,
			);
			await writeFile(
				join(ws, "instruments/x.yaml"),
				"name: x\nuses:\n  b: acme/ws/sub@v1\nflow:\n  - ask: b.q\n",
			);
			await git(root, "add", "-A");
			await git(root, "commit", "-q", "-m", "instrument");
			const cache = await mkdtemp(join(tmpdir(), "qretools-cache-"));
			let url = root;
			const readRemote: Io["readRemote"] = (a) =>
				readTagged(a, { root: cache, urlOf: () => url });
			const file = join(root, "tag.txt");
			const built = await runWith(
				readRemote,
				"build",
				ws,
				"--tag-message",
				file,
			);
			expect(built.code).toBe(0);
			const message = built.written[file] ?? "";
			const tag = async (name: string, text: string) => {
				await writeFile(file, text);
				await git(root, "tag", "-a", "--cleanup=verbatim", "-F", file, name);
			};
			await tag("v2", message);
			return {
				ws,
				message,
				tag,
				readRemote,
				offline: () => {
					url = join(root, "nowhere");
				},
				ddi: built.written[join(ws, "dist", "instruments", "x.json")] ?? "",
			};
		}
		const sha = (text: string) =>
			`sha256:${createHash("sha256").update(text).digest("hex")}`;

		it("rebuilds the DDI the release built, makes its map, and records the release", async () => {
			const { ws, readRemote, offline, ddi } = await released();
			const out = join(ws, "maps");
			const r = await runWith(
				readRemote,
				"qsf-map",
				"acme/ws/sub@v2:x",
				"-o",
				out,
			);
			expect(r.err).toBe("");
			expect(r.code).toBe(0);
			const map = JSON.parse(
				r.written[join(out, "x-ddi-qsf.columns.json")] ?? "{}",
			);
			expect(map).toMatchObject({ ddi: sha(ddi), release: "acme/ws/sub@v2:x" });
			// The release's DDI as its site publishes it: the same map, named by the URL.
			const url = "https://acme.example/ws/v2/instruments/x.json";
			served = { [url]: ddi };
			const byUrl = await run("qsf-map", url, "-o", out);
			expect(byUrl).toMatchObject({ code: 0, err: "" });
			const { release: _, ...unreleased } = map;
			expect(
				JSON.parse(byUrl.written[join(out, "x-ddi-qsf.columns.json")] ?? "{}"),
			).toEqual(unreleased);
			served = {};
			// Offline, the tag read once is served from the cache.
			offline();
			const again = await runWith(
				readRemote,
				"qsf-map",
				"acme/ws/sub@v2:x",
				"-o",
				out,
			);
			expect(again.code).toBe(0);
			expect(again.written).toEqual(r.written);
			const lost = await runWith(
				readRemote,
				"qsf-map",
				"acme/ws/sub@v9:x",
				"-o",
				out,
			);
			expect(lost).toMatchObject({ code: 1, written: {} });
			expect(lost.err).toMatch(
				/acme\/ws\/sub@v9.*can't be read.*\[qsf-map-release\]/,
			);
		}, 30000);

		it("makes the same map from an export with the release as --ddi", async () => {
			const { ws, readRemote, ddi } = await released();
			const out = join(ws, "maps");
			const made = qsfOf(JSON.parse(ddi), {
				name: "",
				created: "",
				digest: sha(ddi),
				version: "0",
			});
			if (made.kind !== "made") throw new Error("the survey isn't made");
			const csv = join(ws, "export.csv");
			await writeFile(csv, exportOfSurvey(made));
			const fromRelease = await runWith(
				readRemote,
				"qsf-map",
				"acme/ws/sub@v2:x",
				"-o",
				out,
			);
			const fromExport = await runWith(
				readRemote,
				"qsf-map",
				"--export",
				csv,
				"--ddi",
				"acme/ws/sub@v2:x",
				"-o",
				out,
			);
			expect(fromExport.code).toBe(0);
			expect(fromExport.written).toEqual(fromRelease.written);
			expect(
				JSON.parse(
					fromExport.written[join(out, "x-ddi-qsf.columns.json")] ?? "{}",
				),
			).toMatchObject({ release: "acme/ws/sub@v2:x" });
		}, 30000);

		it("reads responses with the release a map names, and asks for --ddi when there's none", async () => {
			const { ws, readRemote, ddi } = await released();
			const out = join(ws, "maps");
			const made = await runWith(
				readRemote,
				"qsf-map",
				"acme/ws/sub@v2:x",
				"-o",
				out,
			);
			const mapFile = join(out, "x-ddi-qsf.columns.json");
			const map = made.written[mapFile] ?? "";
			await mkdir(out);
			await writeFile(mapFile, map);
			// An export of the survey, its `qretools_*` fields as the map expects them.
			const m = JSON.parse(map);
			const fields = [
				"qretools_instrument",
				"qretools_ddi",
				"qretools_version",
			];
			const head = ["ResponseId", ...fields, "q"];
			const ids = ["_recordId", ...fields, m.columns[0].importId].map(
				(i) => `"${JSON.stringify({ ImportId: i }).replaceAll('"', '""')}"`,
			);
			const csv = join(ws, "export.csv");
			await writeFile(
				csv,
				[
					head.join(","),
					head.join(","),
					ids.join(","),
					`R_1,${m.instrument},${m.ddi},${m.qretools},1`,
					"",
				].join("\r\n"),
			);
			// The export says neither fact: the options give them.
			const facts = [
				"--asked-by",
				"SelfAdministeredQuestionnaire.CAWI",
				"--answered-by",
				"PopulationGroup",
			];
			const r = await runWith(
				readRemote,
				"responses",
				csv,
				"--map",
				mapFile,
				...facts,
			);
			expect(r.err).toBe("");
			const read = readDataset(JSON.parse(r.out));
			expect(read.ok && csvView(read.value)).toBe(
				`respondent,variable,row,value\nR_1,${m.columns[0].variable},,1\n`,
			);
			const { release: _, ...unreleased } = JSON.parse(map);
			await writeFile(mapFile, JSON.stringify(unreleased));
			const none = await runWith(
				readRemote,
				"responses",
				csv,
				"--map",
				mapFile,
			);
			expect(none.code).toBe(2);
			const given = await runWith(
				readRemote,
				"responses",
				csv,
				"--map",
				mapFile,
				"--ddi",
				"acme/ws/sub@v2:x",
				...facts,
			);
			// The same values; the map differs (no release), so its digest does too.
			const back = readDataset(JSON.parse(given.out));
			expect(back.ok && csvView(back.value)).toBe(
				read.ok && csvView(read.value),
			);
			// The DDI from the release is named by its tag reference.
			expect(r.out).toContain('"Value": "acme/ws/sub@v2:x"');
			// The same DDI by URL: the same values, and the URL recorded.
			const url = "https://acme.example/ws/v2/instruments/x.json";
			served = { [url]: ddi };
			const byUrl = await run(
				"responses",
				csv,
				"--map",
				mapFile,
				"--ddi",
				url,
				...facts,
			);
			expect(byUrl.err).toBe("");
			const fetchedBack = readDataset(JSON.parse(byUrl.out));
			expect(fetchedBack.ok && csvView(fetchedBack.value)).toBe(
				read.ok && csvView(read.value),
			);
			expect(byUrl.out).toContain(
				`"ExternalURLReference": [\n        "${url}"`,
			);
			served = {};
			await writeFile(
				mapFile,
				JSON.stringify({ ...unreleased, release: "x.json" }),
			);
			const bad = await runWith(readRemote, "responses", csv, "--map", mapFile);
			expect(bad.err).toMatch(/release `x\.json` isn't a tag reference/);
			expect(none.err).toMatch(
				/no DDI .*x\.json beside the map, and the map names no release\. Give the DDI it was made from with `--ddi`/,
			);
		}, 30000);

		it("refuses a DDI that rebuilds differently, naming the version that built the release", async () => {
			const { ws, message, tag, readRemote } = await released();
			await tag(
				"v3",
				message
					.replace(/"qretools": "[^"]*"/, '"qretools": "2.0.0-alpha.1"')
					.replace(/"ddi": "sha256:[0-9a-f]+"/, `"ddi": "${sha("other")}"`),
			);
			const r = await runWith(
				readRemote,
				"qsf-map",
				"acme/ws/sub@v3:x",
				"-o",
				join(ws, "maps"),
			);
			expect(r).toMatchObject({ code: 1, written: {} });
			expect(r.err).toMatch(
				/QREtools 2\.0\.0-alpha\.1 built this release.*`npx qretools@2\.0\.0-alpha\.1`.*\[qsf-map-release\]/,
			);
		}, 30000);

		it("refuses a release made before tag references, and an instrument it doesn't have", async () => {
			const { ws, message, tag, readRemote } = await released();
			const old = message.replace(
				/,\n {2}"instruments": \{[\s\S]*\n {2}\}\n\}/,
				"\n}",
			);
			expect(old).not.toContain('"instruments"');
			await tag("v4", old);
			const r = await runWith(
				readRemote,
				"qsf-map",
				"acme/ws/sub@v4:x",
				"-o",
				join(ws, "maps"),
			);
			expect(r).toMatchObject({ code: 1, written: {} });
			expect(r.err).toMatch(
				/made before tag references\. Release the workspace again/,
			);
			const y = await runWith(
				readRemote,
				"qsf-map",
				"acme/ws/sub@v2:y",
				"-o",
				join(ws, "maps"),
			);
			expect(y.err).toMatch(/no instrument `instruments\/y\.yaml`/);
		}, 30000);
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

describe("qretools next", () => {
	it("says the next step from an instrument's DDI and a state, and refuses a state that isn't one", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-next-"));
		const file = join(dir, "ddi.json");
		const ddi = (
			await run(
				"instrument",
				"export",
				here("../../core/fixtures/households/instruments/households.yaml"),
			)
		).out;
		await writeFile(file, ddi);
		const state = join(dir, "state.json");
		await writeFile(state, JSON.stringify({ inputs: { county: "2" } }));
		const r = await run("next", file, state);
		expect(r).toMatchObject({ code: 0, err: "" });
		const reply = JSON.parse(r.out);
		expect(reply).toMatchObject({ kind: "ask", question: "consent" });
		// The missing codes are the codebook's, read from the same DDI.
		const index = parseDdi(JSON.parse(ddi));
		if (!index.ok) throw new Error("not DDI");
		const consent = codebookOf(index.value).entries.find(
			(e) => e.urn === reply.domain.variable,
		);
		expect(reply.domain.missing.map((m: { code: string }) => m.code)).toEqual(
			consent?.responses?.rows.filter((x) => x.missing).map((x) => x.code),
		);
		// The state on standard input, as `-` or with no file named.
		stdin = JSON.stringify({ inputs: { county: "2" } });
		expect((await run("next", file, "-")).out).toBe(r.out);
		expect((await run("next", file)).out).toBe(r.out);
		stdin = "";
		// The reply's schema is open, so a field added later doesn't fail a caller's validation.
		const open = JSON.parse((await run("next", "--schema")).out).reply;
		expect(JSON.stringify(open)).not.toContain('"additionalProperties":false');
		await writeFile(state, JSON.stringify({ answers: "none" }));
		const bad = await run("next", file, state);
		expect(bad).toMatchObject({ code: 1, out: "" });
		expect(bad.err).toMatch(/this isn't a state: .*answers.*\[next-state\]/s);
		const schemas = JSON.parse((await run("next", "--schema")).out);
		expect(Object.keys(schemas)).toEqual(["state", "reply"]);
		expect((await run("check", "--schema")).code).toBe(2);
	});

	it("reads the DDI from an https URL, fetched once, and refuses http and a reply that isn't 200", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-next-"));
		const file = join(dir, "ddi.json");
		const ddi = (
			await run(
				"instrument",
				"export",
				here("../../core/fixtures/households/instruments/households.yaml"),
			)
		).out;
		await writeFile(file, ddi);
		const url = "https://example.org/survey/v1/instruments/households.json";
		served = { [url]: ddi };
		fetched = [];
		stdin = JSON.stringify({ inputs: { county: "2" } });
		const byUrl = await run("next", url);
		expect(byUrl).toMatchObject({ code: 0, err: "" });
		expect(byUrl.out).toBe((await run("next", file)).out);
		expect(fetched).toEqual([url]);
		const http = await run("next", url.replace("https", "http"));
		expect(http).toMatchObject({ code: 2, out: "" });
		expect(http.err).toMatch(
			/^Can't read http:\/\/example\.org\S+: .*https:\/\/ URL only/,
		);
		redirectedTo = "http://example.org/elsewhere.json";
		const downgraded = await run("next", url);
		redirectedTo = undefined;
		expect(downgraded).toMatchObject({ code: 2, out: "" });
		expect(downgraded.err).toMatch(
			/redirects to http:\/\/example\.org\/elsewhere\.json, which isn't https/,
		);
		const gone = await run("next", `${url}x`);
		expect(gone).toMatchObject({ code: 2, out: "" });
		expect(gone.err).toBe(`Can't read ${url}x: HTTP 404 Not Found\n`);
		stdin = "";
		served = {};
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

describe("qretools qsf-map", () => {
	it("writes the QSF column map of an instrument's DDI, with its source and the file's digest", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-qsf-map-"));
		const file = join(dir, "households.json");
		const ddi = (
			await run(
				"instrument",
				"export",
				here("../../core/fixtures/households/instruments/households.yaml"),
			)
		).out;
		await writeFile(file, ddi);
		const r = await run("qsf-map", file, "-o", "maps");
		expect(r).toMatchObject({ code: 0, out: "" });
		expect(Object.keys(r.written)).toEqual([
			join("maps", "households-ddi-qsf.columns.json"),
		]);
		const map = JSON.parse(Object.values(r.written)[0] ?? "{}");
		expect(map).toMatchObject({
			source: "qsf",
			instrument: "urn:ddi:org.example.households:instrument-households:1",
			ddi: `sha256:${createHash("sha256").update(ddi).digest("hex")}`,
		});
		expect(map.columns.length).toBeGreaterThan(0);
	});

	it("writes nothing for a file that isn't an instrument's DDI, and needs -o", async () => {
		const file = join(
			await mkdtemp(join(tmpdir(), "qretools-qsf-map-")),
			"ddi.json",
		);
		await writeFile(file, (await run("export", SAMPLE)).out);
		const none = await run("qsf-map", file, "-o", "maps");
		expect(none).toMatchObject({ code: 1, written: {} });
		expect(none.err).toMatch(
			/The DDI has no instrument\. \[qsf-unread\]\n.*Not written:/,
		);
		await writeFile(file, "{");
		const bad = await run("qsf-map", file, "-o", "maps");
		expect(bad).toMatchObject({ code: 1, written: {} });
		expect(bad.err).toMatch(
			/isn't DDI-Lifecycle 4.0 JSON.*\[qsf-map-unreadable\]/,
		);
		expect((await run("qsf-map", file)).code).toBe(2);
		expect((await run("qsf-map", "-o", "maps")).code).toBe(2);
	});

	it("makes the same map from a Qualtrics export and the DDI, byte for byte, saying no answer", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-qsf-map-"));
		const file = join(dir, "households.json");
		const ddi = (
			await run(
				"instrument",
				"export",
				here("../../core/fixtures/households/instruments/households.yaml"),
			)
		).out;
		await writeFile(file, ddi);
		const made = qsfOf(JSON.parse(ddi), {
			name: "",
			created: "",
			digest: `sha256:${createHash("sha256").update(ddi).digest("hex")}`,
			version: "0",
		});
		if (made.kind !== "made") throw new Error("the survey isn't made");
		const csv = join(dir, "export.csv");
		await writeFile(csv, exportOfSurvey(made));
		const fromDdi = await run("qsf-map", file, "-o", "maps");
		const fromExport = await run(
			"qsf-map",
			"--export",
			csv,
			"--ddi",
			file,
			"-o",
			"maps",
		);
		expect(fromExport).toMatchObject({ code: 0, out: "" });
		expect(fromExport.written).toEqual(fromDdi.written);
		expect(fromExport.err).not.toContain("SECRET");

		// An answer column no question of the DDI has: nothing written, the column named.
		await writeFile(
			csv,
			exportOfSurvey(made, {
				extra: [["Q99", "Another?", { ImportId: "QID99" }]],
			}),
		);
		const refused = await run(
			"qsf-map",
			"--export",
			csv,
			"--ddi",
			file,
			"-o",
			"maps",
		);
		expect(refused).toMatchObject({ code: 1, written: {} });
		expect(refused.err).toMatch(
			/export\.csv: error: column `Q99`: No question of the DDI matches.*\[qsf-map-unmatched\]/,
		);
		expect(refused.err).not.toContain("SECRET");

		// One DDI: by `--ddi` with `--export`, else as the positional.
		expect((await run("qsf-map", "--export", csv, "-o", "m")).code).toBe(2);
		expect(
			(await run("qsf-map", file, "--export", csv, "--ddi", file, "-o", "m"))
				.code,
		).toBe(2);
		expect((await run("qsf-map", file, "--ddi", file, "-o", "m")).code).toBe(2);
		expect((await run("check", "--export", csv)).err).toMatch(
			/`--export` isn't an option of `check`/,
		);
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

	/** An instrument's DDI and its QSF column map, as `build` and `qsf-map` write them, and an export of its survey. */
	async function files(
		digestOf = (ddi: string) => ddi,
		kind = { status: "2", channel: "test" },
	) {
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
				"StartDate,EndDate,Status,DistributionChannel,ResponseId,qretools_instrument,qretools_ddi,qretools_version,tenure,modes_1,modes_9,rent",
				"Start Date,End Date,Response Type,Distribution Channel,Response ID,qretools_instrument,qretools_ddi,qretools_version,tenure?,modes? - Bus,modes? - None,rent?",
				[
					id({ ImportId: "startDate", timeZone: "Z" }),
					id({ ImportId: "endDate", timeZone: "Z" }),
					id({ ImportId: "status" }),
					id({ ImportId: "distributionChannel" }),
					id({ ImportId: "_recordId" }),
					id({ ImportId: "qretools_instrument" }),
					id({ ImportId: "qretools_ddi" }),
					id({ ImportId: "qretools_version" }),
					id({ ImportId: "QID1" }),
					id({ ImportId: "QID2", choiceId: "1" }),
					id({ ImportId: "QID2", choiceId: "9" }),
					id({ ImportId: "QID3_TEXT" }),
				].join(","),
				`2026-11-12 23:14:02,2026-11-12 23:16:02,${kind.status},${kind.channel},R_1,urn:ddi:org.example:instrument-t:1,${digest},9,2,1,,1200`,
				`2026-11-12 23:15:41,2026-11-12 23:15:50,${kind.status},${kind.channel},R_2,urn:ddi:org.example:instrument-t:1,${digest},9,3,,1,D`,
				"",
			].join("\r\n"),
		);
		return { csv, map };
	}

	/** The CSV view of a dataset `responses` wrote to stdout. */
	async function csvOf(datasetText: string, ddi: string) {
		const file = join(
			await mkdtemp(join(tmpdir(), "qretools-dataset-")),
			"d.json",
		);
		await writeFile(file, datasetText);
		return run("dataset", "export", file, "--csv", "--ddi", ddi);
	}

	it("reads an export with its map and the DDI beside it, into a dataset of one value per answer", async () => {
		const { csv, map } = await files();
		const r = await run("responses", csv, "--map", map);
		// Sorted by respondent, then variable URN.
		expect((await csvOf(r.out, join(dirname(csv), "t.json"))).out).toBe(
			[
				"respondent,variable,row,value",
				`R_1,${v("modes_b")},,1`,
				`R_1,${v("rent")},,1200`,
				`R_1,${v("tenure")},,2`,
				`R_2,${v("modes_9")},,1`,
				`R_2,${v("rent")},,D`,
				"",
			].join("\n"),
		);
		// Each interview's times, in the zone the export names, on the dataset's own variables.
		const document = JSON.parse(r.out);
		expect(Object.keys(document.DataSet)).toEqual(["org.example:dataset-t:1"]);
		const values = document.DataSet["org.example:dataset-t:1"].ItemSet
			.ItemValue as {
			VariableReference: { value: string[] };
			Value: unknown;
		}[];
		expect(
			values
				.filter((x) => x.VariableReference.value[1] === "dataset-t.start")
				.map((x) => x.Value),
		).toEqual([
			[{ StringValue: "2026-11-12T23:14:02Z" }],
			[{ StringValue: "2026-11-12T23:15:41Z" }],
		]);
		// R_2's tenure isn't one of its codes: placed, never shown.
		expect(r.err).toBe(
			`${csv}:5: error: column \`tenure\`: This value isn't one \`${v("tenure")}\` can hold, so it isn't read. [responses-not-a-code]\n`,
		);
		expect(r.code).toBe(1);
		// Named by -o, without `.json`.
		const named = await run("responses", csv, "--map", map, "-o", "wave1.json");
		expect(
			Object.keys(JSON.parse(named.written["wave1.json"] ?? "{}").DataSet),
		).toEqual(["org.example:dataset-wave1:1"]);
	});

	it("never replaces a different file, and says when the dataset is unchanged", async () => {
		const { csv, map } = await files();
		const out = join(dirname(csv), "d.json");
		const first = await run("responses", csv, "--map", map, "-o", out);
		await writeFile(out, first.written[out] ?? "");
		const same = await run("responses", csv, "--map", map, "-o", out);
		expect(same).toMatchObject({ code: 1, written: {} });
		expect(same.err).toContain(`${out}: unchanged\n`);
		await writeFile(out, "{}\n");
		const refused = await run("responses", csv, "--map", map, "-o", out);
		expect(refused).toMatchObject({ code: 1, written: {} });
		expect(refused.err).toMatch(
			/a dataset never replaces it.*\[responses-exists\]/,
		);
		// A file name that can't name a dataset is a usage error.
		expect(
			(await run("responses", csv, "--map", map, "-o", "a.b.json")).code,
		).toBe(2);
	});

	it("exports only a dataset, and only as --csv", async () => {
		const { csv, map } = await files();
		const file = join(dirname(csv), "d.json");
		await writeFile(file, (await run("responses", csv, "--map", map)).out);
		expect((await run("dataset", "export", file)).code).toBe(2);
		expect(
			(await run("dataset", "export", file, "--csv", "--map", map)).err,
		).toMatch(/`--map` isn't an option of `dataset export`/);
		expect((await run("responses", csv, "--map", map, "--csv")).err).toMatch(
			/`--csv` isn't an option of `responses`/,
		);
		const refused = await run(
			"dataset",
			"export",
			map,
			"--csv",
			"--ddi",
			join(dirname(csv), "t.json"),
		);
		expect(refused).toMatchObject({ code: 1, out: "" });
		expect(refused.err).toMatch(/\[dataset-unreadable\]/);
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
			source: "survey",
			ddi: digest,
			answered_by: "ResearchData.Published",
			respondent: "ID",
			values: { "-98": "D", "-100": null },
			columns: [
				{ column: "TENURE", variable: v("tenure") },
				{ column: "RENT", variable: v("rent") },
			],
		});
		const beside = join(dir, "t-ddi-survey.columns.json");
		await writeFile(beside, json);
		// The map says who answered, so only how they were asked needs an option, and the map's fact no option.
		const missing = await run("responses", data, "--map", beside);
		expect(missing).toMatchObject({ code: 2, out: "" });
		expect(missing.err).toMatch(
			`${data}: error: the data file doesn't say how its respondents were asked: give \`--asked-by <term>\`, a term of DDI's ModeOfCollection vocabulary. Nothing is written. [responses-facts]\n`,
		);
		const repeated = await run(
			"responses",
			data,
			"--map",
			beside,
			"--asked-by",
			"Interview",
			"--answered-by",
			"ResearchData.Published",
		);
		expect(repeated).toMatchObject({ code: 2, out: "" });
		expect(repeated.err).toMatch(
			`${beside}: error: the map already says who answered, so \`--answered-by\` isn't taken. Nothing is written. [responses-facts]\n`,
		);
		const facts = ["--asked-by", "Interview"];
		const r = await run("responses", data, "--map", beside, ...facts);
		expect((await csvOf(r.out, ddi)).out).toBe(
			[
				"respondent,variable,row,value",
				`7,${v("rent")},,D`,
				`7,${v("tenure")},,2`,
				`9,${v("rent")},,1200`,
				"",
			].join("\n"),
		);
		// A data file gives no times: the dataset has no start or end variable.
		expect(r.out).not.toMatch(/dataset-t\.(start|end)/);
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
		expect((await run("responses", data, "--map", apart, ...facts)).code).toBe(
			2,
		);
		const kept = await run(
			"responses",
			data,
			"--map",
			apart,
			"--ddi",
			ddi,
			...facts,
		);
		// The same files give the same dataset: only the map's name differs, and the map isn't its path.
		expect(kept.out).toBe(r.out);
		// Another DDI than the map's: a warning, and the dataset records both digests.
		const other = `${await readFile(ddi, "utf8")}\n`;
		await writeFile(ddi, other);
		const differs = await run(
			"responses",
			data,
			"--map",
			apart,
			"--ddi",
			ddi,
			...facts,
		);
		expect(differs.err).toMatch(
			/warning: this isn't the DDI the map was made from.*\[responses-provenance\]/,
		);
		expect(differs.out).toContain(digest.slice(7));
		expect(differs.out).toContain(
			createHash("sha256").update(other).digest("hex"),
		);

		// Its `source` says what kind of map it is, and must agree with its name.
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
		).toMatch(
			/its name says the source `qsf`, but its `source` field says `survey`/,
		);
		await writeFile(
			join(dir, "t-ddi-qsf.columns.json"),
			JSON.stringify({ ...JSON.parse(json), source: "qsf" }),
		);
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
		const { source: _, ...unsourced } = JSON.parse(json);
		await writeFile(beside, JSON.stringify(unsourced));
		expect((await run("responses", data, "--map", beside)).err).toMatch(
			/this map has no `source` field.*Add `"source": "survey"`/,
		);
		expect((await run("responses", data, "--map", ddi)).code).toBe(2);
	});

	it("takes the facts the export gives, refuses an option that repeats one, and needs one for the rest", async () => {
		const { csv, map } = await files(undefined, {
			status: "0",
			channel: "anonymous",
		});
		const missing = await run("responses", csv, "--map", map);
		expect(missing).toMatchObject({ code: 2, out: "" });
		expect(missing.err).toMatch(
			/doesn't say who answered: give `--answered-by <term>`/,
		);
		const repeated = await run(
			"responses",
			csv,
			"--map",
			map,
			"--asked-by",
			"SelfAdministeredQuestionnaire.CAWI",
			"--answered-by",
			"PopulationGroup",
		);
		expect(repeated).toMatchObject({ code: 2, out: "" });
		expect(repeated.err).toMatch(/`--asked-by` isn't taken/);
		const r = await run(
			"responses",
			csv,
			"--map",
			map,
			"--answered-by",
			"PopulationGroup",
		);
		const event = Object.values(
			JSON.parse(r.out).DataCollection as Record<
				string,
				{ CollectionEvent: unknown[] }
			>,
		)[0]?.CollectionEvent[0];
		expect(event).toMatchObject({
			DataCollectionDate: {
				StartDate: { DateTime: "2026-11-12T23:14:02Z" },
				EndDate: { DateTime: "2026-11-12T23:16:02Z" },
			},
			ModeOfCollection: [
				{
					TypeOfModeOfCollection: {
						StringValue: "SelfAdministeredQuestionnaire.CAWI",
					},
				},
			],
			DataSource: [{ SourceType: [{ StringValue: "PopulationGroup" }] }],
		});
		expect(r.out).toContain('"Qualtrics"');
		expect((await run("check", ".", "--asked-by", "Interview")).err).toMatch(
			/`--asked-by` isn't an option of `check`/,
		);
	});

	it("exports a dataset's provenance: valid DDI, without a value or a respondent", async () => {
		const { csv, map } = await files();
		const dataset = join(dirname(csv), "d.json");
		await writeFile(dataset, (await run("responses", csv, "--map", map)).out);
		const ddi = join(dirname(csv), "t.json");
		const r = await run(
			"dataset",
			"export",
			dataset,
			"--provenance",
			"--ddi",
			ddi,
		);
		expect(r.code).toBe(0);
		const view = JSON.parse(r.out);
		const validator = makeValidator(schema);
		expect(validator.ok && validator.value(view)).toEqual([]);
		expect(r.out).not.toMatch(/ItemSet|R_1|R_2|1200/);
		expect(Object.keys(view.DataSet)).toEqual(["org.example:dataset-t:1"]);
		expect(Object.keys(view.StudyUnit)).toEqual([
			"org.example:dataset-t.study:1",
		]);
		// The fingerprint covers the whole DataSet: an interview's time changes it.
		const fingerprint = (doc: string) =>
			Object.values(
				JSON.parse(doc).PhysicalInstance as Record<
					string,
					{
						DataFingerprint: {
							Type: string;
							DigitalFingerprintValue: string;
						}[];
					}
				>,
			)
				.flatMap((p) => p.DataFingerprint)
				.find((f) => f.Type === "data")?.DigitalFingerprintValue;
		await writeFile(
			csv,
			(await readFile(csv, "utf8")).replace("23:16:02", "23:16:03"),
		);
		const later = await run("responses", csv, "--map", map);
		expect(fingerprint(later.out)).toMatch(/^[0-9a-f]{64}$/);
		expect(fingerprint(later.out)).not.toBe(fingerprint(r.out));
		// The provenance is no dataset, and one view at a time.
		const file = join(dirname(csv), "p.json");
		await writeFile(file, r.out);
		expect(
			(await run("dataset", "export", file, "--csv", "--ddi", ddi)).err,
		).toMatch(/holds no values.*\[dataset-unreadable\]/);
		expect(
			(await run("dataset", "export", dataset, "--csv", "--provenance")).code,
		).toBe(2);
	});

	/** Answers as a model harness writes them, beside the DDI `build` writes. */
	async function answers(...lines: string[]) {
		const { csv } = await files();
		const dir = dirname(csv);
		const file = join(dir, "answers.csv");
		await writeFile(
			file,
			[
				"respondent,variable,row,value",
				"s1,start,,2026-11-12T23:14:02Z",
				"s1,end,,2026-11-12T23:16:02Z",
				`s1,${v("tenure")},,2`,
				`s1,${v("modes_b")},,1`,
				`s1,${v("rent")},,D`,
				"s2,start,,2026-11-13T00:10:00+01:00",
				"s2,end,,2026-11-13T00:20:00+01:00",
				// A missing code of a coded variable.
				`s2,${v("tenure")},,D`,
				...lines,
				"",
			].join("\n"),
		);
		const traces = join(dir, "traces.jsonl");
		await writeFile(traces, '{"call":1}\n');
		return { file, ddi: join(dir, "t.json"), traces, dir };
	}
	const synthetic = [
		"--synthetic",
		"--runtime",
		"model:Q8",
		"--runtime-version",
		"b1",
	];

	it("reads a model's answers into a dataset, with its runtime and files, and exports both views", async () => {
		const { file, ddi, traces, dir } = await answers();
		const out = join(dir, "run1.json");
		const r = await run(
			"responses",
			file,
			"--ddi",
			ddi,
			...synthetic,
			"--file",
			traces,
			"-o",
			out,
		);
		expect(r).toMatchObject({ code: 0, err: "" });
		const text = r.written[out] ?? "";
		const validator = makeValidator(schema);
		expect(validator.ok && validator.value(JSON.parse(text))).toEqual([]);
		const doc = JSON.parse(text);
		const event = Object.values(
			doc.DataCollection as Record<
				string,
				{
					CollectionEvent: {
						DataCollectionDate: unknown;
						ModeOfCollection: unknown;
						DataSource: unknown;
					}[];
				}
			>,
		)[0]?.CollectionEvent[0];
		expect(event?.DataCollectionDate).toEqual({
			// Compared as instants: 00:10 at +01:00 is before 23:14 UTC the day before.
			StartDate: { DateTime: "2026-11-13T00:10:00+01:00" },
			EndDate: { DateTime: "2026-11-13T00:20:00+01:00" },
		});
		expect(JSON.stringify(event?.ModeOfCollection)).toMatch(
			/"StringValue":"Simulation"/,
		);
		expect(JSON.stringify(event?.DataSource)).toMatch(
			/"StringValue":"Other","OtherValue":"synthetic"/,
		);
		expect(JSON.stringify(doc.Methodology)).toMatch(
			/"Value":"model:Q8".*"SoftwareVersion":"b1"/,
		);
		const traced = createHash("sha256").update('{"call":1}\n').digest("hex");
		expect(Object.values(doc.OtherMaterial)).toContainEqual(
			expect.objectContaining({
				TypeOfMaterial: { StringValue: "supporting file" },
				UserID: [
					{ StringValue: traced, TypeOfUserID: { StringValue: "SHA-256" } },
				],
				SizeInBytes: 11,
			}),
		);
		// No map: no column map cited, and no variable called "not in source".
		expect(text).not.toMatch(/column map|not-in-source/);
		await writeFile(out, text);
		expect(
			(
				await run(
					"responses",
					file,
					"--ddi",
					ddi,
					...synthetic,
					"--file",
					traces,
					"-o",
					out,
				)
			).err,
		).toBe(`${out}: unchanged\n`);
		expect(
			(await run("dataset", "export", out, "--csv", "--ddi", ddi)).out,
		).toBe(
			[
				"respondent,variable,row,value",
				`s1,${v("modes_b")},,1`,
				`s1,${v("rent")},,D`,
				`s1,${v("tenure")},,2`,
				`s2,${v("tenure")},,D`,
				"",
			].join("\n"),
		);
		const provenance = await run(
			"dataset",
			"export",
			out,
			"--provenance",
			"--ddi",
			ddi,
		);
		expect(provenance.code).toBe(0);
		expect(provenance.out).not.toMatch(/ItemSet|s1|s2/);
	});

	it("reads the DDI from an https URL: names the dataset by it, records it, and checks it by its digest", async () => {
		const { file, ddi, dir } = await answers();
		const url = "https://example.org/survey/v2/instruments/t.json?download=1";
		served = { [url]: await readFile(ddi, "utf8") };
		const made = await run("responses", file, "--ddi", url, ...synthetic);
		expect(made).toMatchObject({ code: 0, err: "" });
		// Named by the URL's last path segment, as a file would be.
		expect(made.out).toMatch(/"dataset-t\./);
		const out = join(dir, "by-url.json");
		const r = await run(
			"responses",
			file,
			"--ddi",
			url,
			...synthetic,
			"-o",
			out,
		);
		const text = r.written[out] ?? "";
		const validator = makeValidator(schema);
		expect(validator.ok && validator.value(JSON.parse(text))).toEqual([]);
		const sha = createHash("sha256")
			.update(served[url] ?? "")
			.digest("hex");
		expect(Object.values(JSON.parse(text).OtherMaterial)).toContainEqual(
			expect.objectContaining({
				TypeOfMaterial: { StringValue: "instrument DDI" },
				Citation: {
					Title: {
						String: [
							{
								MultilingualStringValue: { LanguageTag: "en", Value: "t.json" },
							},
						],
					},
				},
				ExternalURLReference: [url],
				UserID: [
					{ StringValue: sha, TypeOfUserID: { StringValue: "SHA-256" } },
				],
			}),
		);
		await writeFile(out, text);
		expect(
			(await run("responses", file, "--ddi", url, ...synthetic, "-o", out)).err,
		).toBe(`${out}: unchanged\n`);
		// The same bytes by file or by URL: the digest is what's checked.
		for (const given of [url, ddi])
			expect(
				(await run("dataset", "export", out, "--provenance", "--ddi", given))
					.code,
			).toBe(0);
		served = { [url]: `${served[url]}\n` };
		const other = await run("dataset", "export", out, "--csv", "--ddi", url);
		expect(other).toMatchObject({ code: 1, out: "" });
		expect(other.err).toMatch(/^https:\S+: error: .*\[dataset-ddi\]/);
		served = {};
		const gone = await run(
			"responses",
			file,
			"--ddi",
			url,
			...synthetic,
			"-o",
			join(dir, "gone.json"),
		);
		expect(gone).toMatchObject({ code: 2, written: {} });
		// A malformed URL can't be read, as a missing file can't.
		const malformed = await run(
			"responses",
			file,
			"--ddi",
			"https://[x/t.json",
			...synthetic,
		);
		expect(malformed).toMatchObject({ code: 2, out: "" });
		expect(malformed.err).toMatch(/^Can't read https:\/\/\[x\/t\.json: /);
	});

	it("refuses answers it can't check, and options that don't fit", async () => {
		const { file, ddi, traces } = await answers(
			`s2,${v("rent")},,lots`,
			"s2,urn:ddi:org.example:instrument-t.var-gone:1,,1",
			"s3,start,,2026-11-13 09:00:00",
		);
		const bad = await run("responses", file, "--ddi", ddi, ...synthetic);
		expect(bad).toMatchObject({ code: 1, out: "", written: {} });
		expect(bad.err).toMatch(
			/answers.csv:10: error: .*\[responses-not-a-code\]/,
		);
		expect(bad.err).toMatch(
			/answers.csv:11: error: .*\[responses-unknown-variable\]/,
		);
		expect(bad.err).toMatch(
			/answers.csv:12: error: .*isn't a date and time with its zone.*\[responses-time\]/,
		);
		expect(bad.err).toMatch(/nothing is written/);
		const { file: good } = await answers();
		const usage = async (...argv: string[]) => {
			const r = await run("responses", good, ...argv);
			expect(r.code).toBe(2);
			return r.err.split("\n")[0];
		};
		expect(await usage("--ddi", ddi)).toMatch(
			/need `--synthetic`.*or `--answered-by/,
		);
		expect(await usage("--ddi", ddi, "--synthetic")).toMatch(
			/needs `--runtime/,
		);
		expect(await usage("--synthetic", "--runtime", "m")).toMatch(/need `--ddi/);
		expect(
			await usage("--ddi", ddi, "--answered-by", "x", "--runtime-version", "1"),
		).toMatch(/needs `--runtime`/);
		expect(
			await usage("--map", "t-ddi-qsf.columns.json", "--file", traces),
		).toMatch(/are for answers read without `--map`/);
		expect(
			await usage("--ddi", ddi, ...synthetic, "--asked-by", "Interview"),
		).toMatch(/`--synthetic` already says how.*`--asked-by` isn't taken/);
		expect(
			await usage("--ddi", ddi, "--answered-by", "PopulationGroup"),
		).toMatch(/give `--asked-by <term>`/);
		expect((await run("check", ".", "--file", traces)).code).toBe(2);
		// Real answers from elsewhere: who answered, and how they were asked.
		const real = await run(
			"responses",
			good,
			"--ddi",
			ddi,
			"--answered-by",
			"PopulationGroup",
			"--asked-by",
			"SelfAdministeredQuestionnaire.CAWI",
		);
		expect(real).toMatchObject({ code: 0, err: "" });
		expect(real.out).not.toMatch(/Methodology/);
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

describe("qretools dataset export at an access level", () => {
	const q = (name: string, rest = "") =>
		`name: ${name}\ntext: ${name}?\nintent: i\nopen: {}\n${rest}`;
	const v = (name: string) => `urn:ddi:org.example:instrument-t.var-${name}:1`;
	const facts = ["--asked-by", "Interview"];

	/** A dataset `responses` writes from a data file, and the DDI it was made from. */
	async function made(levels: boolean) {
		const dir = await mkdtemp(join(tmpdir(), "qretools-access-"));
		const { ddi } = instrumentOf(
			"name: t\nuses:\n  b: here\nflow:\n  - ask: b.tenure\n  - ask: b.zip\n",
			{
				banks: {
					b: bankOf({
						"workspace.yaml": `agency: org.bank\n${levels ? "access: [public, restricted]\n" : ""}`,
						"questions/a/tenure.yaml": q(
							"tenure",
							levels ? "access: public\n" : "",
						),
						"questions/a/zip.yaml": q(
							"zip",
							levels ? "access: restricted\n" : "",
						),
					}),
				},
				agency: "org.example",
			},
		);
		const file = join(dir, "t.json");
		await writeFile(file, JSON.stringify(ddi));
		const map = join(dir, "t-ddi-survey.columns.json");
		await writeFile(
			map,
			JSON.stringify({
				source: "survey",
				answered_by: "ResearchData.Published",
				respondent: "ID",
				columns: [
					{ column: "TENURE", variable: v("tenure") },
					{ column: "ZIP", variable: v("zip") },
				],
				metadata: [
					{
						column: "W",
						number: true,
						weight: true,
						...(levels && { access: "public" }),
					},
					{
						column: "SHIFT",
						codes: { "1": "Day", "2": "Night" },
						modes: { "1": "Interview.Telephone" },
					},
				],
				weighting: {
					advice: "Use W.",
					source: { title: "A codebook" },
					read: "2026-11-12",
				},
				interview_date: { column: "DAY", form: "MMDD", year: "YR" },
			}),
		);
		const data = join(dir, "data.csv");
		await writeFile(
			data,
			"ID,TENURE,ZIP,W,SHIFT,DAY,YR\nR_7,own,21218,0.5,1,315,2010\nR_9,rent,21201,0.25,1,315,2010\n",
		);
		const dataset = join(dir, "d.json");
		// The map's mode column says how the respondent was asked: no option may.
		const asked = await run("responses", data, "--map", map, ...facts);
		expect(asked.err).toMatch(
			/the map already says how its respondents were asked/,
		);
		const written = await run("responses", data, "--map", map);
		expect(written.err).toMatch(/^[^\n]*\[responses-provenance\]\n$/);
		expect(written.out).toContain('"Date": "2010-03-15"');
		await writeFile(dataset, written.out);
		// A reserved code for the date: that interview has no time, with a warning, and the run doesn't fail.
		await writeFile(
			join(dir, "late.csv"),
			"ID,TENURE,ZIP,W,SHIFT,DAY,YR\nR_7,own,21218,0.5,1,-1,2010\n",
		);
		const late = await run("responses", join(dir, "late.csv"), "--map", map);
		expect(late.code).toBe(0);
		expect(late.err).toMatch(/warning: column `DAY`: .*\[responses-date\]/);
		expect(late.out).not.toContain('"Date"');
		return { dir, ddi: file, dataset };
	}

	it("needs a level where the DDI defines them, keeps that level and the more open ones, and names what it removed", async () => {
		const { ddi, dataset } = await made(true);
		const view = (...more: string[]) =>
			run("dataset", "export", dataset, "--ddi", ddi, ...more);

		const required = await view("--csv", "-o", "kept.csv");
		expect(required).toMatchObject({ code: 1, out: "", written: {} });
		expect(required.err).toMatch(
			/give `--access <level>`.*`public`, `restricted`, most open first.*\[dataset-access-level-required\]/,
		);

		// Below the most closed level: no zip, and the respondents numbered, never named,
		// in the order of the SHA-256 of their identifiers: R_9 (217d…) before R_7 (a147…).
		const open = await view("--csv", "--access", "public");
		// The weight the map puts at `public` stays; the mode, at no stated level, goes with the respondent.
		const w = "urn:ddi:org.example:dataset-t.var-W:1";
		expect(open.out).toBe(
			`respondent,variable,row,value\n1,${w},,0.25\n1,${v("tenure")},,rent\n2,${w},,0.5\n2,${v("tenure")},,own\n`,
		);
		expect(open.err).toBe(
			[
				`${dataset}: note: removed \`zip\` (${v("zip")}), at \`restricted\`. [dataset-access-removed]`,
				...["respondent", "start", "end", "var-SHIFT"].map(
					(part) =>
						`${dataset}: note: removed \`${part.replace("var-", "")}\` (urn:ddi:org.example:dataset-t.${part}:1), at \`restricted\`. [dataset-access-removed]`,
				),
				"",
			].join("\n"),
		);
		expect(open.code).toBe(0);
		const closed = await view("--csv", "--access", "restricted");
		expect(closed).toMatchObject({ code: 0, err: "" });
		expect(closed.out).toMatch(/R_7,.*21218/);

		// The provenance view records the level and what it removed.
		const provenance = await view("--provenance", "--access", "public");
		const doc = JSON.parse(provenance.out);
		const validator = makeValidator(schema);
		expect(validator.ok && validator.value(doc)).toEqual([]);
		expect(provenance.out).toContain('"LevelOfInformationClassification"');
		expect(provenance.out).toContain("removed-by-access");
		expect(provenance.out).not.toMatch(/R_7|21218|"own"/);

		// Refused: nothing written, and no value said.
		const unknown = await view("--csv", "--access", "secret", "-o", "k.csv");
		expect(unknown).toMatchObject({ code: 1, out: "", written: {} });
		expect(unknown.err).toMatch(
			/has no level `secret`.*\[dataset-access-unknown-level\]/,
		);
		expect(unknown.err).not.toMatch(/21218|R_7/);
	});

	it("reads levels only from the DDI the dataset was made from", async () => {
		const { ddi, dataset } = await made(true);
		await writeFile(ddi, `${await readFile(ddi, "utf8")}\n`);
		const r = await run(
			"dataset",
			"export",
			dataset,
			"--csv",
			"--ddi",
			ddi,
			"--access",
			"restricted",
		);
		expect(r).toMatchObject({ code: 1, out: "" });
		expect(r.err).toMatch(/\[dataset-ddi\]/);
		expect((await run("dataset", "export", dataset, "--csv")).code).toBe(2);
	});

	it("refuses a level where the DDI defines none, and gives the whole view", async () => {
		const { ddi, dataset } = await made(false);
		const whole = await run(
			"dataset",
			"export",
			dataset,
			"--csv",
			"--ddi",
			ddi,
		);
		expect(whole).toMatchObject({ code: 0, err: "" });
		expect(whole.out).toMatch(/R_7,/);
		const refused = await run(
			"dataset",
			"export",
			dataset,
			"--csv",
			"--ddi",
			ddi,
			"--access",
			"public",
		);
		expect(refused).toMatchObject({ code: 1, out: "" });
		expect(refused.err).toMatch(/\[dataset-access-no-levels\]/);
		// The dataset is never filtered, and `filter` is gone.
		expect((await run("responses", "x.csv", "--access", "public")).err).toMatch(
			/`--access` isn't an option of `responses`/,
		);
		expect((await run("filter", "--ddi", ddi)).err).toMatch(
			/Unknown command `filter`/,
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
