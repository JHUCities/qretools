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
		here("../../fixtures/households/instruments/households.yaml"),
		"utf8",
	);
	remote = await readFile(
		here("../../fixtures/households/instruments/remote.yaml"),
		"utf8",
	);
});

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

	it("reads each instrument against its own bank, under its own agency, as instrumentOf does", () => {
		const ws = workspaceOf({
			...hh,
			"instruments/households.yaml": households,
			"workspace.yaml": "agency: org.example\n",
			"README.md": "# A workspace\n",
		});
		const read = ws.instruments["instruments/households.yaml"];
		expect(read?.uses).toEqual({ hh: { kind: "local", folder: "" } });
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
			...hh,
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

	it("says nothing anywhere a bank still being read is named", () => {
		const everywhere = `name: x
universe: bas.renters
uses:
  bas: owner/bank@v1
inputs:
  feel:
    responses: bas.agree4
flow:
  - say: "You are {{bas.size}} strong."
  - if: bas.size > 2
    then:
      - ask: bas.consent
`;
		const read = workspaceOf({ "instruments/x.yaml": everywhere }).instruments[
			"instruments/x.yaml"
		];
		expect(read?.uses.bas?.kind).toBe("pending");
		// Only what this instrument itself leaves to fill in: nothing of `bas`.
		expect(
			(read?.instrument.findings ?? []).filter((f) => /bas\./.test(f.message)),
		).toEqual([]);
	});

	it("still says so wherever a given bank has no such name", () => {
		const wrong = `name: x
universe: bas.nope
uses:
  bas: owner/bank@v1
inputs:
  feel:
    responses: bas.nope
flow:
  - say: "You are {{bas.nope}} strong."
  - if: bas.nope = "1"
    then:
      - ask: bas.consent
`;
		const read = workspaceOf(
			{ "instruments/x.yaml": wrong },
			{ remote: { "owner/bank@v1": { kind: "files", files: hh } } },
		).instruments["instruments/x.yaml"];
		expect(read?.uses.bas?.kind).toBe("remote");
		const said = (read?.instrument.findings ?? [])
			.filter((f) => /bas\.nope/.test(f.message))
			.map((f) => f.path)
			.sort();
		// The universe, the input's scale, the placeholder and the condition: each its own.
		expect(said).toEqual(
			expect.arrayContaining([
				"flow.0.say",
				"flow.1.if",
				"inputs.feel.responses",
				"universe",
			]),
		);
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
				{ ...hh, "instruments/x.yaml": source },
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
		// Its own workspace has one spelling; any other local path is refused, saying so.
		expect(said(uses("../"))).toEqual([]);
		for (const other of [
			".././",
			"../.",
			"./",
			"../questions",
			"../banks/x",
			"../../out",
		])
			expect(said(uses(other)), other).toEqual([
				`\`${other}\`: an instrument uses its own workspace as \`../\`, and another workspace as \`owner/repo@v1\`.`,
			]);
		expect(said(uses("../@v1"))).toEqual([
			expect.stringContaining("Write `../`."),
		]);
		expect(said(uses("o/r@v1"), { reason: "GitHub has no tag v1." })).toEqual([
			"GitHub has no tag v1.",
		]);
	});

	it("says a workspace whose root holds no bank has none, on the use", () => {
		const read = workspaceOf({ "instruments/households.yaml": households })
			.instruments["instruments/households.yaml"];
		expect(read?.uses).toEqual({ hh: { kind: "missing", folder: "" } });
		expect(codes(read?.instrument.findings ?? [], "uses.hh")).toHaveLength(1);
	});

	it("takes a bank file in a folder for no bank, and says the folder's files are ignored", () => {
		const nested = {
			"banks/x/bank.yaml": "agency: org.example\n",
			"banks/x/questions/t/q.yaml": "name: q\n",
		};
		// With no bank at the root, the workspace says so.
		const none = workspaceOf({ ...nested, "workspace.yaml": "" });
		expect(none.banks).toEqual({});
		expect(none.ignored).toEqual(Object.keys(nested));
		// With one, they're its files, read as nothing, and said the same way.
		const ws = workspaceOf({ ...hh, ...nested });
		expect(Object.keys(ws.banks)).toEqual([""]);
		expect(ws.ignored).toEqual(Object.keys(nested));
	});

	it("reports YAML that is neither the bank's, an instrument nor its own, and nothing else", () => {
		const ws = workspaceOf({
			...hh,
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
	it("are its own workspace's, written `../` from instruments/, and nothing else local", () => {
		const uses = [{ alias: "a", address: "../" }, { alias: "c" }];
		const root = new Set([""]);
		expect(resolveUses("instruments/x.yaml", uses, root)).toEqual({
			a: { kind: "local", folder: "" },
		});
		expect(resolveUses("instruments/x.yaml", uses, new Set())).toEqual({
			a: { kind: "missing", folder: "" },
		});
		// From anywhere else `../` isn't the workspace.
		expect(resolveUses("instruments/deeper/x.yaml", uses, root).a?.kind).toBe(
			"unreadable",
		);
	});

	it("in other repositories, are each listed once, however they're capitalised", () => {
		const use = (address: string) => `uses:\n  b: ${address}\n`;
		expect(
			remotesOf({
				"instruments/a.yaml": use("O/R@v1"),
				"instruments/b.yaml": use("o/r@v1"),
				"instruments/c.yaml": use("o/r/banks/x@v2"),
				"instruments/d.yaml": use("../"),
				"banks/x/questions/t/q.yaml": use("z/z@v1"),
			}).map((a) => a.key),
		).toEqual(["o/r/banks/x@v2", "o/r@v1"]);
	});
});
