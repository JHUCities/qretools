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

describe("the banks in a workspace", () => {
	it("is the root alone in a repository that is one bank", () => {
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

	it("takes any folder holding a bank file for a bank, whatever it's called", () => {
		expect(
			Object.keys(
				banksIn(of("banks/units/bank.yaml", "surveys/concepts/bank.yaml"))
					.banks,
			).sort(),
		).toEqual(["banks/units", "surveys/concepts"]);
	});

	it("gives each bank folder its files by path within it, and leaves the workspace's own outside", () => {
		const { banks, outside } = banksIn(
			of(
				"workspace.yaml",
				"instruments/x.yaml",
				"README.md",
				"banks/hh/bank.yaml",
				"banks/hh/questions/t/q.yaml",
				"banks/bas/bank.yaml",
				"banks/bas/questions/u/r.yaml",
				"banks/bas/scales/yesno.yaml",
			),
		);
		expect(banks["banks/hh"]).toEqual({
			"bank.yaml": "# banks/hh/bank.yaml\n",
			"questions/t/q.yaml": "# banks/hh/questions/t/q.yaml\n",
		});
		expect(Object.keys(banks).sort()).toEqual(["banks/bas", "banks/hh"]);
		expect(Object.keys(banks["banks/bas"] ?? {})).toEqual([
			"bank.yaml",
			"questions/u/r.yaml",
			"scales/yesno.yaml",
		]);
		expect(Object.keys(outside)).toEqual([
			"README.md",
			"instruments/x.yaml",
			"workspace.yaml",
		]);
	});

	it("gives a file to the deepest bank above it", () => {
		const { banks } = banksIn(
			of("bank.yaml", "questions/t/q.yaml", "hh/bank.yaml", "hh/scales/a.yaml"),
		);
		expect(Object.keys(banks[""] ?? {})).toEqual([
			"bank.yaml",
			"questions/t/q.yaml",
		]);
		expect(Object.keys(banks.hh ?? {})).toEqual(["bank.yaml", "scales/a.yaml"]);
	});

	it("never takes another bank's own folders, or the workspace's instruments, for a bank", () => {
		const { banks, outside } = banksIn(
			of(
				"instruments/bank.yaml",
				"bank.yaml",
				"questions/t/bank.yaml",
				"scales/questions/q.yaml",
				"hh/bank.yaml",
				"hh/scales/x/bank.yaml",
			),
		);
		expect(Object.keys(banks).sort()).toEqual(["", "hh"]);
		expect(Object.keys(banks.hh ?? {})).toContain("scales/x/bank.yaml");
		// In the root bank, where it reads it as no bank file (its own `ignored`).
		expect(Object.keys(banks[""] ?? {})).toContain("questions/t/bank.yaml");
		expect(Object.keys(outside)).toEqual(["instruments/bank.yaml"]);
		expect(Object.keys(banksIn(of("instruments/bank.yaml")).banks)).toEqual([]);
	});

	it("leaves the workspace's own files outside a bank at its root", () => {
		const { banks, outside } = banksIn(
			of("bank.yaml", "workspace.yaml", "instruments/x.yaml", "README.md"),
		);
		expect(Object.keys(banks[""] ?? {})).toEqual(["README.md", "bank.yaml"]);
		expect(Object.keys(outside)).toEqual([
			"instruments/x.yaml",
			"workspace.yaml",
		]);
	});

	it("doesn't depend on the order the files are given in", () => {
		const paths = [
			"banks/hh/questions/t/q.yaml",
			"banks/hh/bank.yaml",
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
			"banks/hh/questions/t/q.yaml",
			"archive/v1/old.yaml",
		])
			expect(readsInWorkspace(path), path).toBe(true);
		for (const path of [
			"README.md",
			"notes.yml",
			".github/workflows/x.yaml",
			"banks/.git/config.yaml",
			"migration/node_modules/p/package.yaml",
			".hidden.yaml",
		])
			expect(readsInWorkspace(path), path).toBe(false);
	});
});

describe("where a workspace path is", () => {
	const banks = ["", "banks/hh", "banks/hh/sub"];

	it("is in the deepest bank above it, as a path in that bank", () => {
		expect(placeOf("banks/hh/questions/t/q.yaml", banks)).toEqual({
			bank: "banks/hh",
			rel: "questions/t/q.yaml",
			at: { kind: "question" },
		});
		expect(placeOf("banks/hh/sub/scales/agree.yaml", banks)).toEqual({
			bank: "banks/hh/sub",
			rel: "scales/agree.yaml",
			at: { kind: "scale", name: "agree" },
		});
		expect(placeOf("missing.yaml", banks)).toEqual({
			bank: "",
			rel: "missing.yaml",
			at: { kind: "missing", name: "missing" },
		});
	});

	it("is nowhere when no bank holds or reads it, or it's the workspace's own", () => {
		expect(placeOf("banks/hh/notes/x.yaml", banks)).toBeUndefined();
		expect(placeOf("instruments/x.yaml", banks)).toBeUndefined();
		expect(placeOf("workspace.yaml", banks)).toBeUndefined();
		expect(placeOf("other/questions/t/q.yaml", ["banks/hh"])).toBeUndefined();
		expect(bankAt("banks/hhh/bank.yaml", ["banks/hh"])).toBeUndefined();
	});

	it("goes there and back by one pair of rules", () => {
		for (const bank of ["", "banks/hh"])
			expect(relIn(bank, inBank(bank, "questions/t/q.yaml"))).toBe(
				"questions/t/q.yaml",
			);
		expect(inBank("", "bank.yaml")).toBe("bank.yaml");
		expect(inBank("banks/hh", "bank.yaml")).toBe("banks/hh/bank.yaml");
	});

	it("agrees with how banksIn partitions the same files", () => {
		const files = Object.fromEntries(
			[
				"bank.yaml",
				"questions/t/q.yaml",
				"banks/hh/bank.yaml",
				"banks/hh/scales/a.yaml",
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
	const banks = ["", "banks/hh"];
	it("is a bank's file, an instrument, or the workspace's own file", () => {
		expect(fileAt("banks/hh/questions/t/q.yaml", banks)).toMatchObject({
			kind: "bank",
			bank: "banks/hh",
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
		])
			expect(fileAt(path, ["banks/hh"]), path).toBeUndefined();
	});
});
