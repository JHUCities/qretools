import { describe, expect, it } from "vitest";
import {
	bankAt,
	banksIn,
	fileAt,
	inBank,
	placeOf,
	readsInWorkspace,
	relIn,
} from "./workspace.ts";

const of = (...paths: string[]) =>
	Object.fromEntries(paths.map((p) => [p, `# ${p}\n`]));

describe("the bank in a workspace", () => {
	it("is the root, holding everything but the workspace's own files", () => {
		const files = of(
			"bank.yaml",
			"missing.yaml",
			"questions/t/q.yaml",
			"scales/agree.yaml",
			"README.md",
		);
		expect(banksIn(files)).toEqual({ banks: { "": files }, outside: {} });
	});

	it("knows a bank by its questions when it has no bank file yet", () => {
		expect(Object.keys(banksIn(of("questions/t/q.yaml")).banks)).toEqual([""]);
	});

	it("knows the root as a bank by its questions or shared files, and only the root", () => {
		expect(Object.keys(banksIn(of("scales/yn.yaml")).banks)).toEqual([""]);
		const { banks, outside } = banksIn(of("docs/questions/faq.md"));
		expect(banks).toEqual({});
		expect(Object.keys(outside)).toEqual(["docs/questions/faq.md"]);
		expect(Object.keys(banksIn(of("banks/a/scales/yn.yaml")).banks)).toEqual(
			[],
		);
		// What a bank doesn't read at its root makes no bank of it.
		expect(
			Object.keys(banksIn(of("docs/notes.yaml", "workspace.yaml")).banks),
		).toEqual([]);
	});

	it("takes no other folder for a bank, whatever bank file it holds", () => {
		const nested = of(
			"banks/x/bank.yaml",
			"banks/x/questions/t/q.yaml",
			"workspace.yaml",
		);
		// With no bank at the root, they're outside any: the workspace says they're ignored.
		expect(banksIn(nested)).toEqual({ banks: {}, outside: nested });
		// With one, they're the root's files, which it reads as nothing (its own `ignored`).
		const { banks } = banksIn({ ...nested, ...of("bank.yaml") });
		expect(Object.keys(banks)).toEqual([""]);
		expect(Object.keys(banks[""] ?? {})).toEqual([
			"bank.yaml",
			"banks/x/bank.yaml",
			"banks/x/questions/t/q.yaml",
		]);
	});

	it("leaves the workspace's own files outside the bank at its root", () => {
		const { banks, outside } = banksIn(
			of(
				"bank.yaml",
				"workspace.yaml",
				"instruments/x.yaml",
				"instruments/bank.yaml",
				"README.md",
			),
		);
		expect(Object.keys(banks[""] ?? {})).toEqual(["README.md", "bank.yaml"]);
		expect(Object.keys(outside)).toEqual([
			"instruments/bank.yaml",
			"instruments/x.yaml",
			"workspace.yaml",
		]);
		expect(Object.keys(banksIn(of("instruments/bank.yaml")).banks)).toEqual([]);
	});

	it("doesn't depend on the order the files are given in", () => {
		const paths = [
			"questions/t/q.yaml",
			"bank.yaml",
			"workspace.yaml",
			"banks/bas/bank.yaml",
		];
		expect(banksIn(of(...[...paths].reverse()))).toEqual(banksIn(of(...paths)));
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

describe("where a workspace path is", () => {
	const banks = [""];

	it("is in the root's bank, by the same path", () => {
		expect(placeOf("questions/t/q.yaml", banks)).toEqual({
			bank: "",
			rel: "questions/t/q.yaml",
			at: { kind: "question" },
		});
		expect(placeOf("missing.yaml", banks)).toEqual({
			bank: "",
			rel: "missing.yaml",
			at: { kind: "missing", name: "missing" },
		});
	});

	it("is nowhere when the bank doesn't read it, there is none, or it's the workspace's own", () => {
		expect(placeOf("banks/hh/questions/t/q.yaml", banks)).toBeUndefined();
		expect(placeOf("notes/x.yaml", banks)).toBeUndefined();
		expect(placeOf("instruments/x.yaml", banks)).toBeUndefined();
		expect(placeOf("workspace.yaml", banks)).toBeUndefined();
		expect(placeOf("questions/t/q.yaml", [])).toBeUndefined();
		expect(bankAt("questions/t/q.yaml", [])).toBeUndefined();
	});

	it("goes there and back by one pair of rules", () => {
		expect(relIn("", inBank("", "questions/t/q.yaml"))).toBe(
			"questions/t/q.yaml",
		);
		expect(inBank("", "bank.yaml")).toBe("bank.yaml");
	});

	it("agrees with how banksIn partitions the same files", () => {
		const files = Object.fromEntries(
			[
				"bank.yaml",
				"questions/t/q.yaml",
				"scales/a.yaml",
				"instruments/x.yaml",
			].map((p) => [p, ""]),
		);
		const { banks: found } = banksIn(files);
		for (const [folder, held] of Object.entries(found))
			for (const rel of Object.keys(held))
				expect(placeOf(inBank(folder, rel), Object.keys(found))?.bank).toBe(
					folder,
				);
	});
});

describe("what a workspace reads a file as", () => {
	const banks = [""];
	it("is the bank's file, an instrument, or the workspace's own file", () => {
		expect(fileAt("questions/t/q.yaml", banks)).toMatchObject({
			kind: "bank",
			bank: "",
			rel: "questions/t/q.yaml",
		});
		expect(fileAt("instruments/households.yaml", banks)).toEqual({
			kind: "instrument",
			name: "households",
		});
		expect(fileAt("workspace.yaml", banks)).toEqual({ kind: "workspaceFile" });
	});

	it("is nothing for what the workspace doesn't read", () => {
		for (const path of [
			"instruments/deeper/x.yaml",
			"instruments/x.yml",
			"notes/x.yaml",
			"banks/hh/bank.yaml",
		])
			expect(fileAt(path, banks), path).toBeUndefined();
	});
});
