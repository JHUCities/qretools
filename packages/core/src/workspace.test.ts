import { describe, expect, it } from "vitest";
import {
	instrumentAt,
	instrumentPath,
	readsInWorkspace,
	remoteScope,
	workspaceOf,
} from "./workspace.ts";

const of = (...paths: string[]) =>
	Object.fromEntries(paths.map((p) => [p, `# ${p}\n`]));

/** The files the workspace's bank read as something, by path. */
const read = (ws: ReturnType<typeof workspaceOf>) =>
	[...Object.keys(ws.bank.questions), ...Object.keys(ws.bank.schemes)].sort();

describe("the bank in a workspace", () => {
	it("is the root, holding everything but the workspace's instruments", () => {
		const ws = workspaceOf(
			of(
				"workspace.yaml",
				"missing.yaml",
				"questions/t/q.yaml",
				"scales/agree.yaml",
				"instruments/x.yaml",
				"README.md",
			),
		);
		expect(read(ws)).toEqual([
			"missing.yaml",
			"questions/t/q.yaml",
			"scales/agree.yaml",
			"workspace.yaml",
		]);
		expect(Object.keys(ws.instruments)).toEqual(["instruments/x.yaml"]);
		expect(ws.ignored).toEqual([]);
	});

	it("is there with nothing in it when the workspace is empty", () => {
		const ws = workspaceOf({});
		expect(read(ws)).toEqual([]);
		expect(ws.instruments).toEqual({});
		expect(ws.ignored).toEqual([]);
	});

	it("takes no other folder for a bank, whatever it holds: its files are read as nothing", () => {
		const ws = workspaceOf(
			of(
				"banks/x/workspace.yaml",
				"banks/x/questions/t/q.yaml",
				"instruments/x.yaml",
				"instruments/workspace.yaml",
				"instruments/deeper/y.yaml",
				"docs/questions/faq.md",
			),
		);
		expect(read(ws)).toEqual([]);
		// A file in `instruments/` is an instrument whatever its name.
		expect(Object.keys(ws.instruments)).toEqual([
			"instruments/workspace.yaml",
			"instruments/x.yaml",
		]);
		// Only YAML is worth saying it's read nowhere.
		expect(ws.ignored).toEqual([
			"banks/x/questions/t/q.yaml",
			"banks/x/workspace.yaml",
			"instruments/deeper/y.yaml",
		]);
	});

	it("doesn't depend on the order the files are given in", () => {
		const paths = [
			"questions/t/q.yaml",
			"workspace.yaml",
			"instruments/b.yaml",
			"instruments/a.yaml",
			"banks/bas/workspace.yaml",
		];
		expect(workspaceOf(of(...[...paths].reverse()))).toEqual(
			workspaceOf(of(...paths)),
		);
	});
});

describe("the files a workspace holds", () => {
	it("are its YAML files, wherever they are, outside hidden folders and installed packages", () => {
		for (const path of [
			"workspace.yaml",
			"instruments/x.yaml",
			"questions/t/q.yaml",
			"archive/v1/old.yaml",
		])
			expect(readsInWorkspace(path), path).toBe(true);
		for (const path of [
			"README.md",
			"notes.yml",
			".github/workflows/x.yaml",
			"questions/.git/config.yaml",
			"migration/node_modules/p/package.yaml",
			".hidden.yaml",
		])
			expect(readsInWorkspace(path), path).toBe(false);
	});
});

describe("an instrument's path", () => {
	it("is instruments/<name>.yaml, there and back", () => {
		expect(instrumentPath("households")).toBe("instruments/households.yaml");
		expect(instrumentAt(instrumentPath("households"))).toBe("households");
	});

	it("is no other path", () => {
		for (const path of [
			"instruments/deeper/x.yaml",
			"instruments/x.yml",
			"instruments/.yaml",
			"notes/x.yaml",
			"workspace.yaml",
		])
			expect(instrumentAt(path), path).toBeUndefined();
	});
});

describe("a bank read from another repository", () => {
	const files = {
		"questions/t/q.yaml": "name: q\ntext: Q?\nintent: i\nopen: {}\n",
		"workspace.yaml": "agency: org.example\n",
	};

	it("says on each file's items the repository, path in it, tag, commit and blob", () => {
		const scope = remoteScope("org/bank/surveys@v1", {
			kind: "files",
			files,
			at: { commit: "c0ffee", blobs: { "questions/t/q.yaml": "b1" } },
		});
		expect(scope.versions?.["questions/t/q.yaml"]).toEqual({
			number: "1",
			blob: "b1",
			origin: {
				repository: "org/bank",
				path: "surveys/questions/t/q.yaml",
				tag: "v1",
				commit: "c0ffee",
			},
		});
		// A file with no blob given has no origin, rather than a made-up one.
		expect(scope.versions?.["workspace.yaml"]).toBeUndefined();
	});

	it("says nothing of where it came from when read from a folder instead", () => {
		expect(
			remoteScope("org/bank@v1", { kind: "files", files }).versions,
		).toBeUndefined();
	});
});
