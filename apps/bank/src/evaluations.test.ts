/**
 * Instruments read live: against the banks they use as those are being edited, the
 * same as the core reads the workspace's files, and re-read only when what they use
 * changes.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ok, remotesOf, workspaceOf } from "@qretools/core";
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

/** Two banks of their own, one in each folder, and an instrument on both. */
const BOTH = `name: both
uses:
  hh: ../households
  t: ../bank
  gone: ../nowhere
  far: owner/bank@v1
flow:
  - ask: hh.consent
  - ask: t.library_visits
`;

let files: Record<string, string>;
beforeAll(async () => {
	files = {
		...(await readWorkspace(
			fileURLToPath(
				new URL("../../../packages/core/fixtures", import.meta.url),
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

describe("an instrument read live", () => {
	it("reads as the core reads the same files, a bank in another repository unavailable", () => {
		const m = loaded(files);
		const whole = workspaceOf(files, {
			remote: Object.fromEntries(
				remotesOf(files).map((a) => [
					a.key,
					{
						kind: "unavailable" as const,
						reason: `\`${a.key}\` is in another repository, which isn't read here yet.`,
					},
				]),
			),
		});
		const evaluations = createEvaluations();
		const names = Object.values(m.local.workspace).flatMap((f) =>
			f.kind === "instrument" ? [f.name] : [],
		);
		expect(names.sort()).toEqual(["both", "households", "remote"]);
		for (const name of names)
			expect(evaluations.instrument(m, instrument(m, name))).toEqual(
				whole.instruments[`instruments/${name}.yaml`],
			);
	});

	it("says a bank in another repository isn't read here yet", () => {
		const m = loaded(files);
		const read = createEvaluations().instrument(m, instrument(m, "remote"));
		expect(read.uses.bas).toEqual({
			kind: "unreadable",
			reason:
				"`owner/bank@v1` is in another repository, which isn't read here yet.",
		});
	});

	it("re-reads only the instruments that use a bank being edited", () => {
		const m = loaded(files);
		const evaluations = createEvaluations();
		const households = evaluations.instrument(m, instrument(m, "households"));
		const both = evaluations.instrument(m, instrument(m, "both"));
		const hhScope = evaluations.scope(m, "households");
		// An edit in the second bank of `both`: it changes, `households` doesn't.
		const q = questionAt(m, "bank/questions/examples/library_visits.yaml");
		const edited = typed(m, q, `${q.source}# edited\n`);
		expect(evaluations.scope(edited, "households")).toBe(hhScope);
		expect(
			evaluations.instrument(edited, instrument(edited, "households")),
		).toBe(households);
		expect(evaluations.instrument(edited, instrument(edited, "both"))).not.toBe(
			both,
		);
		// Typing in one instrument changes no bank and no other instrument.
		const e = instrument(edited, "both");
		const typing = typed(edited, e, `${e.source}# edited\n`);
		expect(evaluations.scope(typing, "households")).toBe(hhScope);
		expect(
			evaluations.instrument(typing, instrument(typing, "households")),
		).toBe(households);
	});

	it("reads a question's unsaved edits", () => {
		const m = loaded(files);
		const evaluations = createEvaluations();
		const q = questionAt(m, "households/questions/household/consent.yaml");
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

	it("takes a few milliseconds per keystroke in a bank it uses", () => {
		const m = loaded(files);
		const evaluations = createEvaluations();
		evaluations.instrument(m, instrument(m, "households"));
		const q = questionAt(m, "households/questions/household/age.yaml");
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
			const big = `name: big\nuses:\n  b: ..\nflow:\n${names.map((n) => `  - ask: b.${n}\n`).join("")}`;
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
