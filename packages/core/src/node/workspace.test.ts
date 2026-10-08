import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	bankOf,
	instrumentOf,
	remotesOf,
	resolveUses,
	workspaceOf,
} from "@qretools/core";
import { readBank } from "@qretools/core/node";
import { beforeAll, describe, expect, it } from "vitest";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

let hh: Readonly<Record<string, string>>;
let households: string;
let remote: string;
beforeAll(async () => {
	hh = await readBank(here("../../fixtures/households"));
	households = await readFile(
		here("../../fixtures/instruments/households.yaml"),
		"utf8",
	);
	remote = await readFile(
		here("../../fixtures/instruments/remote.yaml"),
		"utf8",
	);
});

/** A bank's files placed in a folder of the workspace. */
const at = (folder: string, files: Readonly<Record<string, string>>) =>
	Object.fromEntries(
		Object.entries(files).map(([p, t]) => [`${folder}/${p}`, t]),
	);

const codes = (
	findings: readonly { code: string; path: string }[],
	path: string,
) => findings.filter((f) => f.path === path).map((f) => f.code);

describe("a workspace", () => {
	it("is, for a repository that is one bank, that bank, as bankOf reads it", () => {
		const ws = workspaceOf(hh);
		expect(Object.keys(ws.banks)).toEqual([""]);
		expect(ws.banks[""]).toEqual(bankOf(hh));
		expect(ws.instruments).toEqual({});
		expect(ws.ignored).toEqual([]);
	});

	it("reads each instrument against the banks beside it, under its own agency, as instrumentOf does", () => {
		const ws = workspaceOf({
			...at("households", hh),
			"instruments/households.yaml": households,
			"workspace.yaml": "agency: org.example\n",
			"README.md": "# A workspace\n",
		});
		const read = ws.instruments["instruments/households.yaml"];
		expect(read?.uses).toEqual({ hh: { kind: "local", folder: "households" } });
		const direct = instrumentOf(households, {
			banks: { hh: bankOf(hh) },
			agency: "org.example",
		});
		expect(read?.instrument.findings).toEqual(direct.findings);
		expect(read?.instrument.ddi).toEqual(direct.ddi);
		expect(ws.file?.agency).toBe("org.example");
		expect(ws.ignored).toEqual([]);
	});

	it("publishes under the agency as written, so a wrong one is said on the instrument", () => {
		const ws = workspaceOf({
			...at("households", hh),
			"instruments/households.yaml": households,
			"workspace.yaml": "agency: Not An Agency\n",
		});
		expect(
			codes(
				ws.instruments["instruments/households.yaml"]?.instrument.findings ??
					[],
				"",
			),
		).toContain("invalid-agency");
	});

	it("says nothing of a bank in another repository while it's being read, and reads it once given", () => {
		const files = { "instruments/remote.yaml": remote };
		const pending = workspaceOf(files).instruments["instruments/remote.yaml"];
		expect(pending?.uses).toEqual({
			bas: { kind: "pending", key: "owner/bank@v1" },
		});
		expect(codes(pending?.instrument.findings ?? [], "uses.bas")).toEqual([]);
		// Nor does the question it asks from it: the bank isn't there yet, not unknown.
		expect(
			codes(pending?.instrument.findings ?? [], "flow.0.ask"),
		).not.toContain("unknown-bank");
		const given = workspaceOf(files, {
			remote: { "owner/bank@v1": { kind: "files", files: hh } },
		});
		const read = given.instruments["instruments/remote.yaml"];
		expect(read?.uses.bas).toEqual({ kind: "remote", key: "owner/bank@v1" });
		expect(read?.instrument.findings).toEqual(
			instrumentOf(remote, { banks: { bas: bankOf(hh) } }).findings,
		);
		expect(Object.keys(given.remote)).toEqual(["owner/bank@v1"]);
	});

	it("says once, on the use, why a bank couldn't be had", () => {
		const said = (source: string, remoteBank?: { reason: string }) => {
			const ws = workspaceOf(
				{ ...at("households", hh), "instruments/x.yaml": source },
				remoteBank === undefined
					? {}
					: {
							remote: {
								"o/r@v1": { kind: "unavailable", reason: remoteBank.reason },
							},
						},
			);
			return (ws.instruments["instruments/x.yaml"]?.instrument.findings ?? [])
				.filter((f) => f.path === "uses.b")
				.map((f) => f.message);
		};
		const uses = (address: string) =>
			`name: x\nuses:\n  b: ${address}\nflow:\n  - say: Hi.\n`;
		expect(said(uses("../nowhere"))).toEqual([
			"This workspace has no bank at `nowhere`.",
		]);
		expect(said(uses("../../out"))).toEqual([
			"`../../out` leads out of the workspace.",
		]);
		expect(said(uses("../households@v1"))).toEqual([
			expect.stringContaining("Write `../households`."),
		]);
		expect(said(uses("o/r@v1"), { reason: "GitHub has no tag v1." })).toEqual([
			"GitHub has no tag v1.",
		]);
	});

	it("reports YAML that is neither a bank's, an instrument nor its own, and nothing else", () => {
		const ws = workspaceOf({
			...at("households", hh),
			"instruments/deeper/x.yaml": "name: x\n",
			"stray.yaml": "",
			"notes.yml": "",
			LICENSE: "",
			"docs/a.md": "",
			".github/workflows/check.yml": "",
			"README.md": "",
		});
		expect(ws.ignored).toEqual(["instruments/deeper/x.yaml", "stray.yaml"]);
	});
});

describe("the banks a workspace's instruments use", () => {
	it("are resolved from the instrument's own folder", () => {
		const uses = [
			{ alias: "a", address: "../banks/a" },
			{ alias: "b", address: "./b" },
			{ alias: "c" },
		];
		expect(
			resolveUses("instruments/x.yaml", uses, new Set(["banks/a"])),
		).toEqual({
			a: { kind: "local", folder: "banks/a" },
			b: { kind: "missing", folder: "instruments/b" },
		});
	});

	it("in other repositories, are each listed once, however they're capitalised", () => {
		const use = (address: string) => `uses:\n  b: ${address}\n`;
		expect(
			remotesOf({
				"instruments/a.yaml": use("O/R@v1"),
				"instruments/b.yaml": use("o/r@v1"),
				"instruments/c.yaml": use("o/r/banks/x@v2"),
				"instruments/d.yaml": use("../local"),
				"banks/x/questions/t/q.yaml": use("z/z@v1"),
			}).map((a) => a.key),
		).toEqual(["o/r/banks/x@v2", "o/r@v1"]);
	});
});
