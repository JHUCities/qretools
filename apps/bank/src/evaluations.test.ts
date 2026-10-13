/**
 * Instruments read live: against the banks they use as those are being edited, the
 * same as the core reads the workspace's files, and re-read only when what they use
 * changes.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Evaluation, ok, workspaceOf } from "@qretools/core";
import { instrumentCompletion } from "@qretools/core/editor";
import { readBank, readWorkspace } from "@qretools/core/node";
import { beforeAll, describe, expect, it } from "vitest";
import { createEvaluations } from "./evaluations.js";
import {
	type InstrumentEntry,
	init,
	type Model,
	type Question,
} from "./model.js";
import { update } from "./update.js";

/** An instrument on its own workspace's bank, one in another repository, and a folder that is neither. */
const BOTH = `name: both
uses:
  hh: ../
  gone: ../nowhere
  far: owner/bank@v1
flow:
  - ask: hh.consent
  - ask: far.consent
`;

let files: Record<string, string>;
/** The households bank, as another repository would hold it: no instruments. */
const hhFiles = () =>
	Object.fromEntries(
		Object.entries(files).filter(([path]) => !path.startsWith("instruments/")),
	);
beforeAll(async () => {
	files = {
		...(await readWorkspace(
			fileURLToPath(
				new URL("../../../packages/core/fixtures/households", import.meta.url),
			),
		)),
		"instruments/both.yaml": BOTH,
		"workspace.yaml": "agency: org.example\n",
	};
});

/** Signed in, with these files loaded from the author's branch. */
function loaded(from: Record<string, string>): Model {
	const [start] = init({
		work: ok(undefined),
		hasToken: true,
		settings: { owner: "o", repo: "r", path: "", remember: false },
	});
	const [connected] = update(start, {
		kind: "connected",
		result: ok({
			login: "iain",
			avatarUrl: "https://a/iain",
			access: { kind: "write" },
			defaultBranch: "main",
		}),
	});
	return update(connected, {
		kind: "workspaceLoaded",
		result: ok({
			files: Object.entries(from).map(([path, text]) => ({
				path,
				sha: `sha-${path}`,
				text,
			})),
			found: true,
			from: "branch" as const,
			aheadBy: 0,
			behindBy: 0,
			unread: [],
		}),
	})[0];
}

const instrument = (m: Model, name: string): InstrumentEntry => {
	const e = Object.values(m.local.workspace).find(
		(f): f is InstrumentEntry => f.kind === "instrument" && f.name === name,
	);
	if (e === undefined) throw new Error(`no instrument ${name}`);
	return e;
};
const questionAt = (m: Model, path: string): Question => {
	const q = Object.values(m.local.questions).find((f) => f.base?.path === path);
	if (q === undefined) throw new Error(`no question at ${path}`);
	return q;
};
/** The model with one working copy's text replaced, as typing does. */
const typed = (m: Model, f: Question | InstrumentEntry, text: string): Model =>
	f.kind === "question"
		? {
				...m,
				local: {
					...m.local,
					questions: { ...m.local.questions, [f.id]: { ...f, source: text } },
				},
			}
		: {
				...m,
				local: {
					...m.local,
					workspace: { ...m.local.workspace, [f.id]: { ...f, source: text } },
				},
			};

describe("a question read as its folder has it", () => {
	const q = (name: string) =>
		`name: ${name}\ntext: Is it so?\nintent: To see why.\nopen: {}\n`;
	const m = () =>
		loaded({
			"workspace.yaml":
				"agency: org.example\nrequired_in:\n  questions/nhd: [universe]\n",
			"questions/nhd/a.yaml": q("a"),
			"questions/nhd/a2.yaml": q("a2"),
			"questions/other/b.yaml": q("b"),
		});
	const holes = (ev: Evaluation) =>
		ev.findings.filter((f) => f.severity === "hole").map((f) => f.path);

	it("keeps an unchanged question's evaluation, and one environment per folder", () => {
		const model = m();
		const evaluations = createEvaluations();
		const env = evaluations.env(model, "");
		const a = questionAt(model, "questions/nhd/a.yaml");
		const b = questionAt(model, "questions/other/b.yaml");
		const first = evaluations.get(a, env);
		expect(holes(first)).toEqual(["universe"]);
		expect(holes(evaluations.get(b, env))).toEqual([]);
		// The other folder's question between them didn't cost this one its evaluation.
		expect(evaluations.get(a, env)).toBe(first);
		expect(
			evaluations.at(questionAt(model, "questions/nhd/a2.yaml"), env),
		).toBe(evaluations.at(a, env));
		// A folder that asks nothing more is read against the bank's own.
		expect(evaluations.at(b, env)).toBe(env);
	});

	it("reads a question again when it is saved from a draft or moved to another folder", () => {
		const model = m();
		const evaluations = createEvaluations();
		const env = evaluations.env(model, "");
		const b = questionAt(model, "questions/other/b.yaml");
		if (b.base === undefined) throw new Error("not saved");
		const { base: _, ...draft } = b;
		const asDraft = evaluations.get(draft, env);
		expect(holes(asDraft)).toEqual([]);
		// Saved into the folder that asks for a universe: the same text, read again.
		const saved = {
			...b,
			base: { ...b.base, path: "questions/nhd/b.yaml" },
		};
		expect(holes(evaluations.get(saved, env))).toEqual(["universe"]);
		// And moved back out of it.
		expect(holes(evaluations.get(b, env))).toEqual([]);
	});
});

describe("an instrument read live", () => {
	it("reads as the core reads the same files, whatever has come of a bank in another repository", () => {
		const m = loaded(files);
		const key = "owner/bank@v1";
		const hh = hhFiles();
		const cases: [Model["remoteBanks"], Parameters<typeof workspaceOf>[1]][] = [
			// Not asked for yet, and being read: both pending.
			[{}, {}],
			[{ [key]: { kind: "loading" } }, {}],
			[
				{ [key]: { kind: "files", files: hh } },
				{ remote: { [key]: { kind: "files", files: hh } } },
			],
			[
				{ [key]: { kind: "unavailable", reason: "It's gone." } },
				{ remote: { [key]: { kind: "unavailable", reason: "It's gone." } } },
			],
		];
		for (const [remoteBanks, options] of cases) {
			const model = { ...m, remoteBanks };
			const whole = workspaceOf(files, options);
			const evaluations = createEvaluations();
			const names = Object.values(model.local.workspace).flatMap((f) =>
				f.kind === "instrument" ? [f.name] : [],
			);
			expect(names.sort()).toEqual(["both", "households", "remote"]);
			for (const name of names)
				expect(evaluations.instrument(model, instrument(model, name))).toEqual(
					whole.instruments[`instruments/${name}.yaml`],
				);
		}
	});

	it("reads a bank in another repository once per read, and completes from it", () => {
		const m = loaded(files);
		const hh = hhFiles();
		const read = {
			...m,
			remoteBanks: { "owner/bank@v1": { kind: "files" as const, files: hh } },
		};
		const evaluations = createEvaluations();
		const e = instrument(read, "remote");
		const scopes = evaluations.usedScopes(read, e);
		expect(Object.keys(scopes)).toEqual(["bas"]);
		// Typing in the instrument re-reads it, never the bank it reads from.
		const typing = typed(read, e, `${e.source}# edited\n`);
		expect(
			evaluations.usedScopes(typing, instrument(typing, "remote")).bas,
		).toBe(scopes.bas);
	});

	it("re-reads only the instruments that use the bank being edited", () => {
		const m: Model = {
			...loaded(files),
			remoteBanks: { "owner/bank@v1": { kind: "files", files: hhFiles() } },
		};
		const evaluations = createEvaluations();
		const households = evaluations.instrument(m, instrument(m, "households"));
		const remote = evaluations.instrument(m, instrument(m, "remote"));
		// An edit in this workspace's bank: `households` changes, `remote` doesn't.
		const q = questionAt(m, "questions/household/consent.yaml");
		const edited = typed(m, q, `${q.source}# edited\n`);
		expect(evaluations.instrument(edited, instrument(edited, "remote"))).toBe(
			remote,
		);
		const reread = evaluations.instrument(
			edited,
			instrument(edited, "households"),
		);
		expect(reread).not.toBe(households);
		// Typing in one instrument changes no bank and no other instrument.
		const scope = evaluations.scope(edited, "");
		const e = instrument(edited, "both");
		const typing = typed(edited, e, `${e.source}# edited\n`);
		expect(evaluations.scope(typing, "")).toBe(scope);
		expect(
			evaluations.instrument(typing, instrument(typing, "households")),
		).toBe(reread);
	});

	it("reads a question's unsaved edits", () => {
		const m = loaded(files);
		const evaluations = createEvaluations();
		const q = questionAt(m, "questions/household/consent.yaml");
		const renamed = typed(
			m,
			q,
			q.source.replace(/^name: consent$/m, "name: agreed"),
		);
		const holes = (model: Model) =>
			evaluations
				.instrument(model, instrument(model, "households"))
				.instrument.findings.filter((f) => /consent/.test(f.message)).length;
		expect(holes(m)).toBe(0);
		expect(holes(renamed)).toBeGreaterThan(0);
	});

	it("completes with the questions of its banks as they are now", () => {
		const ASKING = "uses:\n  hh: ../\nflow:\n  - ask: hh.";
		const m = loaded(files);
		const evaluations = createEvaluations();
		const e = instrument(m, "households");
		const offered = (model: Model) =>
			instrumentCompletion(
				ASKING,
				ASKING.length,
				evaluations.usedScopes(model, e),
			)?.options.map((o) => o.label) ?? [];
		expect(offered(m)).toContain("hh.consent");
		const q = questionAt(m, "questions/household/consent.yaml");
		const renamed = typed(
			m,
			q,
			q.source.replace(/^name: consent$/m, "name: agreed"),
		);
		expect(offered(renamed)).toContain("hh.agreed");
		expect(offered(renamed)).not.toContain("hh.consent");
	});

	it("takes a few milliseconds per keystroke in a bank it uses", () => {
		const m = loaded(files);
		const evaluations = createEvaluations();
		evaluations.instrument(m, instrument(m, "households"));
		const q = questionAt(m, "questions/household/age.yaml");
		const start = performance.now();
		for (let i = 0; i < 20; i++) {
			const edited = typed(m, q, `${q.source}# ${i}\n`);
			evaluations.instrument(edited, instrument(edited, "households"));
		}
		expect((performance.now() - start) / 20).toBeLessThan(20);
	});
});

/**
 * The reference bank, where a clone sits beside this repository: read there, skipped
 * where it isn't; never copied in.
 */
const REFERENCE = fileURLToPath(
	new URL("../../../../bas-question-bank", import.meta.url),
);

describe.skipIf(!existsSync(REFERENCE))(
	"the reference bank, when present",
	() => {
		it("re-reads an instrument of 150 questions within a keystroke's budget", async () => {
			const bank = await readBank(REFERENCE);
			const names = Object.entries(bank)
				.filter(([path]) => path.startsWith("questions/"))
				.flatMap(([, text]) => /^name: (\w+)$/m.exec(text)?.[1] ?? [])
				.slice(0, 150);
			const big = `name: big\nuses:\n  b: ../\nflow:\n${names.map((n) => `  - ask: b.${n}\n`).join("")}`;
			const m = loaded({ ...bank, "instruments/big.yaml": big });
			const evaluations = createEvaluations();
			evaluations.instrument(m, instrument(m, "big"));
			const q = Object.values(m.local.questions).find((f) =>
				f.source.includes(`name: ${names[0]}\n`),
			) as Question;
			const runs = 10;
			const start = performance.now();
			for (let i = 0; i < runs; i++) {
				const edited = typed(m, q, `${q.source}# ${i}\n`);
				evaluations.instrument(edited, instrument(edited, "big"));
			}
			const each = (performance.now() - start) / runs;
			expect(each).toBeLessThan(20);
			const read = evaluations.instrument(m, instrument(m, "big"));
			expect(names).toHaveLength(150);
			// Every ask found its question: none is a hole or an unknown name.
			expect(
				read.instrument.findings.filter((f) => f.path.startsWith("flow")),
			).toEqual([]);
			process.stdout.write(
				`reference bank: ${each.toFixed(1)} ms a keystroke\n`,
			);
		});
	},
);
