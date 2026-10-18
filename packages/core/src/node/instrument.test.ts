import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	bankOf,
	documentOf,
	instrumentOf,
	type JsonObject,
	makeValidator,
	questionItems,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { describe, expect, it } from "vitest";
import { type Io, main } from "./cli.ts";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));
const FILE = here("../../fixtures/households/instruments/households.yaml");

type Schema = {
	$defs: Record<
		string,
		{ properties?: Record<string, unknown>; allOf?: { $ref?: string }[] }
	>;
};

/** Every object in a document, however deep. */
function* objects(x: unknown): Generator<JsonObject> {
	if (Array.isArray(x)) for (const v of x) yield* objects(v);
	else if (x !== null && typeof x === "object") {
		yield x as JsonObject;
		for (const v of Object.values(x)) yield* objects(v);
	}
}

describe("the households instrument, whole", async () => {
	const schema = JSON.parse(
		await readFile(
			new URL(import.meta.resolve("@qretools/core/schema.json")),
			"utf8",
		),
	) as Schema;
	const validator = makeValidator(schema);
	const instrument = instrumentOf(await readFile(FILE, "utf8"), {
		banks: {
			hh: bankOf(await readWorkspace(here("../../fixtures/households"))),
		},
		agency: "org.example",
	});
	const allowed = (name: string): Set<string> => {
		const out = new Set<string>();
		const walk = (n: string) => {
			const def = schema.$defs[n];
			for (const k of Object.keys(def?.properties ?? {})) out.add(k);
			for (const a of def?.allOf ?? [])
				if (a.$ref) walk(a.$ref.split("/").at(-1) ?? "");
		};
		walk(name);
		return out;
	};

	it("brings each question's items as its bank exports them, versions and all", async () => {
		const path = "questions/household/size.yaml";
		const bank = bankOf(
			await readWorkspace(here("../../fixtures/households")),
			{
				[path]: { number: "4" },
			},
		);
		const read = instrumentOf(await readFile(FILE, "utf8"), {
			banks: { hh: bank },
			agency: "org.example",
		});
		const ev = bank.questions[path];
		if (ev === undefined) throw new Error(`${path} isn't in the bank`);
		const exported = documentOf(questionItems(ev.draft, bank, path));
		expect(Object.keys(exported.QuestionItem ?? {})).toEqual([
			"org.example.households:size:4",
		]);
		for (const [type, byKey] of Object.entries(exported))
			if (type !== "Variable")
				for (const [key, it] of Object.entries(byKey ?? {}))
					expect(read.ddi[type as "QuestionItem"]?.[key]).toEqual(it);
		expect(read.collisions).toEqual([]);
	});

	it("says once that its own workspace has no agency, and of another's where it is used", async () => {
		const { "workspace.yaml": _, ...files } = await readWorkspace(
			here("../../fixtures/households"),
		);
		const source = await readFile(FILE, "utf8");
		expect(source).toContain("hh: ../\n");
		const agencyFindings = (text: string, agency?: string) =>
			instrumentOf(text, {
				banks: { hh: bankOf(files) },
				...(agency !== undefined && { agency }),
			})
				.findings.filter(
					(f) => f.code === "invalid-agency" || f.message.includes("agency"),
				)
				.map((f) => `${f.code} ${f.path}`);
		// Its own workspace (`../`): the instrument's own finding covers the one cause.
		expect(agencyFindings(source)).toEqual(["hole "]);
		expect(agencyFindings(source, "Not An Agency")).toEqual([
			"invalid-agency ",
		]);
		// A workspace in another repository has its own agency to declare.
		const remote = source.replace("hh: ../\n", "hh: owner/hh@v1\n");
		expect(agencyFindings(remote, "org.example")).toEqual([
			"invalid-agency uses.hh",
		]);
		expect(agencyFindings(remote)).toEqual(["invalid-agency uses.hh", "hole "]);
	});

	it("has every construct, and nothing but advice to say", () => {
		expect(instrument.findings.filter((f) => f.severity !== "info")).toEqual(
			[],
		);
		for (const type of [
			"Loop",
			"RepeatUntil",
			"IfThenElse",
			"ComputationItem",
			"StatementItem",
		])
			expect([
				type,
				Object.keys(instrument.ddi[type as "Loop"] ?? {}).length > 0,
			]).toEqual([type, true]);
	});

	it("is valid, says only what its types declare, and resolves every reference", () => {
		expect(validator.ok && validator.value(instrument.ddi)).toEqual([]);
		expect(instrument.collisions).toEqual([]);
		// A construct also has ControlConstruct's properties, as DDI 4.0 says.
		const constructs = new Set([
			"QuestionConstruct",
			"StatementItem",
			"ComputationItem",
			"IfThenElse",
			"Sequence",
			"Loop",
			"RepeatUntil",
		]);
		const items = new Set<string>();
		const identities = new Set<string>();
		for (const [type, byKey] of Object.entries(instrument.ddi)) {
			const ok = new Set([
				...allowed(type),
				...allowed("Versionable"),
				...(constructs.has(type) ? allowed("ControlConstruct") : []),
			]);
			for (const [key, it] of Object.entries(byKey ?? {})) {
				items.add(`${type} ${key}`);
				for (const k of Object.keys(it))
					expect([type, k, ok.has(k)]).toEqual([type, k, true]);
			}
		}
		for (const o of objects(instrument.ddi))
			if (typeof o.URN === "string") identities.add(o.URN);
		for (const o of objects(instrument.ddi)) {
			if (typeof o.$type === "string" && Array.isArray(o.value)) {
				const [a, id, v] = o.value as string[];
				expect([id, items.has(`${o.$type} ${a}:${id}:${v}`)]).toEqual([
					id,
					true,
				]);
			}
			for (const key of [
				"SourceParameterReference",
				"TargetParameterReference",
			]) {
				const p = o[key] as JsonObject | undefined;
				if (p !== undefined)
					expect([p.URN, identities.has(p.URN as string)]).toEqual([
						p.URN,
						true,
					]);
			}
			if (typeof o.ID === "string")
				expect([o.ID, o.ID.split(".").length <= 2]).toEqual([o.ID, true]);
		}
	});
});

describe("qretools instrument", () => {
	async function run(...argv: string[]) {
		const out: string[] = [];
		const err: string[] = [];
		const written: Record<string, string> = {};
		const io: Io = {
			out: (t) => out.push(t),
			err: (t) => err.push(t),
			writeFile: async (p, t) => {
				written[p] = t;
			},
			readRemote: async (a) => ({
				kind: "unavailable",
				reason: `\`${a.key}\` isn't reachable from these tests.`,
			}),
		};
		return {
			code: await main(argv, io),
			out: out.join(""),
			err: err.join(""),
			written,
		};
	}

	it("checks an instrument against its own workspace, the folder above it", async () => {
		const r = await run("instrument", "check", FILE, "--agency", "org.example");
		expect(r.code).toBe(0);
		expect(r.out.split("\n").filter((l) => l.includes(": error:"))).toEqual([]);
	});

	it("exports its DDI, and refuses an agency DDI wouldn't register", async () => {
		const r = await run(
			"instrument",
			"export",
			FILE,
			"--agency",
			"org.example",
			"-o",
			"x.json",
		);
		expect(r.code).toBe(0);
		expect(
			Object.keys(JSON.parse(r.written["x.json"] ?? "{}").Instrument),
		).toEqual(["org.example:instrument-households:1"]);
		const bad = await run("instrument", "export", FILE, "--agency", "my org");
		expect(bad.code).toBe(1);
		expect(bad.err).toMatch(/isn't a DDI agency/);
	});

	it("exports it as a Qualtrics survey with `--qsf`, refused while Qualtrics can't run it", async () => {
		// The rent warning pipes the rent on its own page: Qualtrics would show it empty.
		const refused = await run(
			"instrument",
			"export",
			FILE,
			"--qsf",
			"-o",
			"x.qsf",
		);
		expect(refused.code).toBe(1);
		expect(refused.written).toEqual({});
		expect(refused.err).toMatch(
			/households\.yaml:33:17: error: This warning shows the answer it checks/,
		);
		const dir = await mkdtemp(join(tmpdir(), "qretools-"));
		try {
			await cp(here("../../fixtures/households"), dir, { recursive: true });
			const ok = join(dir, "instruments", "short.yaml");
			await writeFile(
				ok,
				"name: short\nuses:\n  hh: ../\nflow:\n  - ask: hh.tenure\n",
			);
			const r = await run("instrument", "export", ok, "--qsf", "-o", "x.qsf");
			expect(r.code).toBe(0);
			expect(
				JSON.parse(r.written["x.qsf"] ?? "{}").SurveyEntry.SurveyName,
			).toBe("short");
		} finally {
			await rm(dir, { recursive: true });
		}
		const check = await run("instrument", "check", FILE, "--qsf");
		expect(check.code).toBe(2);
		expect(check.err).toMatch(/`--qsf` isn't an option of `instrument check`/);
	});

	it("publishes under its own workspace's agency unless another is given", async () => {
		// One agency per workspace: the instrument's is the one its questions have.
		const own = await run("instrument", "export", FILE, "-o", "x.json");
		expect(own.code).toBe(0);
		expect(
			Object.keys(JSON.parse(own.written["x.json"] ?? "{}").Instrument),
		).toEqual(["org.example.households:instrument-households:1"]);
		expect((await run("instrument", "check", FILE)).code).toBe(0);
	});

	it("reads `../` only from a workspace's instruments folder, never whatever sits above a stray file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-"));
		const stray = join(dir, "stray.yaml");
		await writeFile(
			stray,
			"name: stray\nuses:\n  b: ../\nflow:\n  - ask: b.q\n",
		);
		try {
			const r = await run("instrument", "check", stray);
			expect(r.code).toBe(2);
			expect(r.err).toMatch(/isn't in a workspace's `instruments\/` folder/);
		} finally {
			await rm(dir, { recursive: true });
		}
	});

	it("reads a bank in another repository at its tag, or says why it can't", async () => {
		const r = await run(
			"instrument",
			"check",
			here("../../fixtures/households/instruments/remote.yaml"),
		);
		// In another repository: read at its tag, and here it can't be.
		expect(r.code).toBe(2);
		expect(r.err).toMatch(
			/^Can't read `bas`: `owner\/bank@v1` isn't reachable from these tests\./,
		);
		// Offline: the alias written as a remote address is read from a directory instead.
		const offline = await run(
			"instrument",
			"check",
			here("../../fixtures/households/instruments/remote.yaml"),
			"--agency",
			"org.example",
			"--bank",
			`bas=${here("../../fixtures/households")}`,
		);
		expect(offline).toMatchObject({ code: 0, err: "0 findings.\n" });
		// Its own workspace is never read from anywhere else.
		const own = await run(
			"instrument",
			"check",
			FILE,
			"--bank",
			`hh=${here("../../fixtures/households")}`,
		);
		expect(own.code).toBe(2);
		expect(own.err).toMatch(
			/^Can't read `hh`: it's this instrument's own workspace \(`\.\.\/`\)/,
		);
		expect((await run("instrument", "check", FILE, "--bank", "hh")).code).toBe(
			2,
		);
		expect(
			(await run("instrument", "check", FILE, "--bank", "zz=x")).code,
		).toBe(2);
	});

	it("reads its own workspace only as `../`, and no other folder beside it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "qretools-uses-"));
		const file = join(dir, "x.yaml");
		await writeFile(
			file,
			"name: x\nuses:\n  hh: ../households\nflow:\n  - ask: hh.size\n",
		);
		const refused =
			"Can't read `hh`: `../households` isn't valid. To use the questions in this instrument's own workspace, `../` is enough.\n";
		expect(await run("instrument", "check", file)).toMatchObject({
			code: 2,
			err: refused,
		});
		// Nor with a directory given for it: `--bank` is for a remote address.
		expect(
			await run("instrument", "check", file, "--bank", `hh=${dir}`),
		).toMatchObject({ code: 2, err: refused });
	});
});
