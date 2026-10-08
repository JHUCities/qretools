import { describe, expect, it } from "vitest";
import { banksIn } from "./workspace.ts";

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
