import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	bankOf,
	instrumentOf,
	remotesOf,
	resolveUses,
	workspaceOf,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { beforeAll, describe, expect, it } from "vitest";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

let hh: Readonly<Record<string, string>>;
let households: string;
let remote: string;
beforeAll(async () => {
	// The fixture's bank alone: each test adds the instruments it reads.
	hh = Object.fromEntries(
		Object.entries(
			await readWorkspace(here("../../fixtures/households")),
		).filter(([path]) => !path.startsWith("instruments/")),
	);
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
	it("is, with no instruments, its bank, as bankOf reads it", () => {
		const ws = workspaceOf(hh);
		expect(ws.bank).toEqual(bankOf(hh));
		expect(ws.instruments).toEqual({});
		expect(ws.ignored).toEqual([]);
	});

	it("reads each instrument against its own bank, as instrumentOf does, under the one agency `workspace.yaml` gives questions and instruments alike", () => {
		const ws = workspaceOf({
			...hh,
			"instruments/households.yaml": households,
			"workspace.yaml": "agency: org.one\n",
			"README.md": "# A workspace\n",
		});
		const read = ws.instruments["instruments/households.yaml"];
		expect(read?.uses).toEqual({ hh: { kind: "local" } });
		const bank = bankOf({ ...hh, "workspace.yaml": "agency: org.one\n" });
		const direct = instrumentOf(households, {
			banks: { hh: bank },
			agency: "org.one",
		});
		expect(read?.instrument.findings).toEqual(direct.findings);
		expect(read?.instrument.ddi).toEqual(direct.ddi);
		// One agency: the bank's, its questions' and the instrument's.
		expect(ws.bank.agency).toBe("org.one");
		expect(read?.instrument.agency).toBe("org.one");
		const agencies = new Set(
			[
				...JSON.stringify(read?.instrument.ddi).matchAll(/"Agency":"([^"]+)"/g),
			].map((m) => m[1]),
		);
		expect([...agencies]).toEqual(["org.one"]);
		expect(ws.ignored).toEqual([]);
	});

	it("says once that a workspace with no `workspace.yaml` declares no agency, not once per file", () => {
		const { "workspace.yaml": _, ...rest } = hh;
		const { bank } = workspaceOf(rest);
		expect(
			Object.entries(bank.findings)
				.filter(([, fs]) => fs.some((f) => f.path === "agency"))
				.map(([path]) => path),
		).toEqual(["workspace.yaml"]);
	});

	it("reads `bank.yaml` at the root as nothing, and says so", () => {
		const ws = workspaceOf({ ...hh, "bank.yaml": "agency: org.old\n" });
		expect(ws.ignored).toEqual(["bank.yaml"]);
		expect(ws.bank.agency).toBe("org.example.households");
	});

	it("takes a workspace of settings alone for a bank with no questions yet", () => {
		const ws = workspaceOf({
			"workspace.yaml": "agency: org.example\n",
			"instruments/households.yaml": households,
		});
		expect(ws.instruments["instruments/households.yaml"]?.uses).toEqual({
			hh: { kind: "local" },
		});
		expect(ws.bank.questions).toEqual({});
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
		for (const other of [".././", "../.", "./", "../../out"])
			expect(said(uses(other)), other).toEqual([
				`\`${other}\`: an instrument uses its own workspace as \`../\`, and another workspace as \`owner/repo@v1\`.`,
			]);
		// A folder inside it: `../` is no more than that, since only what's asked is taken.
		for (const folder of ["../questions", "../banks/x"])
			expect(said(uses(folder)), folder).toEqual([
				`\`${folder}\` isn't valid. To use the questions in this instrument's own workspace, \`../\` is enough.`,
			]);
		expect(said(uses("../@v1"))).toEqual([
			expect.stringContaining("Write `../`."),
		]);
		expect(said(uses("o/r@v1"), { reason: "GitHub has no tag v1." })).toEqual([
			"GitHub has no tag v1.",
		]);
	});

	it("reads an empty workspace's instrument against its empty bank: the use is found, the question isn't", () => {
		const read = workspaceOf({ "instruments/households.yaml": households })
			.instruments["instruments/households.yaml"];
		expect(read?.uses).toEqual({ hh: { kind: "local" } });
		expect(codes(read?.instrument.findings ?? [], "uses.hh")).toEqual([]);
	});

	it("reads an imported workspace's question against that workspace's own shared files and settings, never this one's", () => {
		const scale = (yes: string) => `labels:\n  1: ${yes}\n  2: No\n`;
		const ws = workspaceOf(
			{
				"workspace.yaml": "agency: org.local\nrequired: [universe]\n",
				"scales/agree4.yaml": scale("Local yes"),
				"instruments/x.yaml":
					"name: x\nuses:\n  far: o/r@v1\nflow:\n  - ask: far.feel\n",
			},
			{
				remote: {
					"o/r@v1": {
						kind: "files",
						files: {
							"workspace.yaml": "agency: org.remote\n",
							"scales/agree4.yaml": scale("Remote yes"),
							"questions/t/feel.yaml":
								"name: feel\ntext: How do you feel?\nintent: Mood.\nresponses: agree4\n",
						},
					},
				},
			},
		);
		const feel = ws.remote["o/r@v1"]?.questions["questions/t/feel.yaml"];
		// Its own scale of that name, and only what its own settings require.
		expect(feel?.respondent).toMatchObject({
			input: { options: [{ label: "Remote yes" }, { label: "No" }] },
		});
		expect(feel?.findings.filter((f) => f.severity === "hole")).toEqual([]);
		const ddi = JSON.stringify(
			ws.instruments["instruments/x.yaml"]?.instrument.ddi,
		);
		expect(ddi).toContain("Remote yes");
		expect(ddi).not.toContain("Local yes");
		// The question keeps its publisher's agency; the instrument has this workspace's.
		expect(ddi).toContain("urn:ddi:org.remote:feel:");
		expect(ddi).toContain("urn:ddi:org.local:");
	});

	it("takes settings in a folder for no bank, and says the folder's files are ignored", () => {
		const nested = {
			"banks/x/questions/t/q.yaml": "name: q\n",
			"banks/x/workspace.yaml": "agency: org.example\n",
		};
		// Alone, the root is an empty bank, and they're read as nothing.
		const none = workspaceOf({ ...nested, "instruments/x.yaml": "name: x\n" });
		expect(none.bank.questions).toEqual({});
		expect(none.ignored).toEqual(Object.keys(nested));
		// Beside the root's own files, the same.
		expect(workspaceOf({ ...hh, ...nested }).ignored).toEqual(
			Object.keys(nested),
		);
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
	it("are its own workspace's, written `../`, and nothing else local", () => {
		expect(
			resolveUses([
				{ alias: "a", address: "../" },
				{ alias: "b", address: "../questions" },
				{ alias: "c" },
			]),
		).toEqual({
			a: { kind: "local" },
			b: { kind: "unreadable", reason: expect.stringContaining("`../`") },
		});
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
