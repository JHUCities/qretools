/**
 * Each bank of a workspace reads its own shared files: its names mean nothing in
 * another, and editing one bank never re-evaluates another.
 */
import { type Mention, ok } from "@qretools/core";
import { formatLink } from "@qretools/shell";
import { describe, expect, it } from "vitest";
import { createEvaluations } from "./evaluations.js";
import {
	type Cmd,
	init,
	type Model,
	type Question,
	type SchemeEntry,
	schemeFileNamed,
} from "./model.js";
import { dependencies } from "./sync.js";
import { schemeNameProblem, update } from "./update.js";

const scale = (
	id: number,
	bank: string,
	labels: string,
	saved = true,
): SchemeEntry => {
	const source = `labels:\n${labels}`;
	const path = `${bank}/scales/yn.yaml`;
	return {
		kind: "scale",
		name: "yn",
		id,
		bank,
		source,
		...(saved && { base: { path, sha: `s${id}`, text: source } }),
	};
};
const question = (id: number, bank: string): Question => ({
	kind: "question",
	id,
	bank,
	source: "name: q\ntext: Q?\nintent: To see.\nresponses: yn\n",
});

/** Two banks, each with a scale `yn` of its own and a question on it. */
function twoBanks(): Model {
	const [start] = init({ work: ok(undefined), hasToken: false });
	const a = scale(1, "banks/a", '  "1": Yes\n  "2": No\n');
	const b = scale(2, "banks/b", '  "1": Oui\n  "2": Non\n');
	return {
		...start,
		banks: ["banks/a", "banks/b"],
		local: {
			questions: { 3: question(3, "banks/a"), 4: question(4, "banks/b") },
			schemes: { 1: a, 2: b },
		},
		remote: {
			questions: {},
			schemes: {
				"banks/a/scales/yn.yaml": { sha: "s1", text: a.source },
				"banks/b/scales/yn.yaml": { sha: "s2", text: b.source },
			},
		},
	};
}

describe("a workspace of banks", () => {
	it("reads each bank's questions against that bank's own scales", () => {
		const m = twoBanks();
		const evaluations = createEvaluations();
		const label = (id: number, bank: string) => {
			const q = m.local.questions[id] as Question;
			const ev = evaluations.get(q, evaluations.env(m, bank));
			return ev.draft.domain?.kind === "responses"
				? ev.draft.domain.codes.map((c) => c.label)
				: undefined;
		};
		expect(label(3, "banks/a")).toEqual(["Yes", "No"]);
		expect(label(4, "banks/b")).toEqual(["Oui", "Non"]);
	});

	it("keeps another bank's environment and evaluations when one bank's scale changes", () => {
		const m = twoBanks();
		const evaluations = createEvaluations();
		const envB = evaluations.env(m, "banks/b");
		const evB = evaluations.get(m.local.questions[4] as Question, envB);
		const envA = evaluations.env(m, "banks/a");
		const edited: Model = {
			...m,
			local: {
				...m.local,
				schemes: {
					...m.local.schemes,
					1: scale(1, "banks/a", '  "1": Yes\n  "2": No\n  "3": Maybe\n'),
				},
			},
		};
		expect(evaluations.env(edited, "banks/a")).not.toBe(envA);
		expect(evaluations.env(edited, "banks/b")).toBe(envB);
		expect(
			evaluations.get(
				edited.local.questions[4] as Question,
				evaluations.env(edited, "banks/b"),
			),
		).toBe(evB);
	});

	it("finds a name, checks a new one, and gathers what a save takes, within one bank", () => {
		const m = twoBanks();
		expect(schemeFileNamed(m.local.schemes, "scale", "yn", "banks/b")?.id).toBe(
			2,
		);
		expect(
			schemeFileNamed(m.local.schemes, "scale", "yn", "banks/c"),
		).toBeUndefined();
		expect(schemeNameProblem(m, "scale", "yn", "banks/a")).toMatch(/exists/);
		expect(schemeNameProblem(m, "scale", "yn", "banks/c")).toBeUndefined();
		// An unsaved scale in another bank is never taken along (GitHub has neither yet).
		const unsaved: Model = {
			...m,
			remote: { questions: {}, schemes: {} },
			local: {
				...m.local,
				schemes: {
					1: scale(1, "banks/a", '  "1": Y\n', false),
					2: scale(2, "banks/b", '  "1": O\n', false),
				},
			},
		};
		const mentions: readonly Mention[] = [
			{ scheme: "scale", name: "yn", path: "responses" },
		];
		expect(
			dependencies(
				unsaved.local,
				unsaved.remote,
				mentions,
				"banks/a",
			).include.map((e) => e.id),
		).toEqual([1]);
	});
});

describe("loading a workspace", () => {
	const file = (path: string, text = "x: 1\n") => ({
		path,
		sha: `sha-${path}`,
		text,
	});
	/** Signed in, with this workspace loaded from the author's branch. */
	function loaded(
		files: ReturnType<typeof file>[],
		unread: { path: string; reason: string }[] = [],
	): Model {
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
				files,
				found: true,
				from: "branch" as const,
				aheadBy: 0,
				behindBy: 0,
				unread,
			}),
		})[0];
	}
	const WORKSPACE = [
		file("workspace.yaml", "agency: org.example\n"),
		file("instruments/x.yaml", "name: x\n"),
		file("banks/a/bank.yaml", "agency: org.example\n"),
		file("banks/a/questions/t/q.yaml", "name: q\n"),
		file("banks/b/bank.yaml", "agency: org.example\n"),
		file("banks/b/scales/yn.yaml", 'labels:\n  "1": Yes\n'),
	];

	it("holds every bank's files, each in its bank, and nothing of the workspace's own", () => {
		const m = loaded(WORKSPACE);
		expect(m.banks).toEqual(["banks/a", "banks/b"]);
		expect(
			[...Object.values(m.local.questions), ...Object.values(m.local.schemes)]
				.map((f) => `${f.bank} ${f.base?.path}`)
				.sort(),
		).toEqual([
			"banks/a banks/a/bank.yaml",
			"banks/a banks/a/questions/t/q.yaml",
			"banks/b banks/b/bank.yaml",
			"banks/b banks/b/scales/yn.yaml",
		]);
	});

	it("names the files GitHub wouldn't give as text, once however often it loads", () => {
		const unread = [
			{ path: "banks/a/scales/big.yaml", reason: "It's too large." },
		];
		const m = loaded(WORKSPACE, unread);
		expect(m.failures).toEqual([
			expect.objectContaining({
				message:
					"`banks/a/scales/big.yaml` couldn't be read, so it's left out.",
			}),
		]);
		const load = (model: Model, again: typeof unread) =>
			update(model, {
				kind: "workspaceLoaded",
				result: ok({
					files: WORKSPACE,
					found: true,
					from: "branch" as const,
					aheadBy: 0,
					behindBy: 0,
					unread: again,
				}),
			})[0];
		expect(load(m, unread).failures).toHaveLength(1);
		expect(load(m, []).failures).toEqual([]);
	});

	it("saves a new question and a new shared file under the bank they were made in", () => {
		const commitOf = (cmds: readonly Cmd[]) =>
			cmds.find(
				(c): c is Extract<Cmd, { kind: "commit" }> => c.kind === "commit",
			);
		let [m] = update(loaded(WORKSPACE), {
			kind: "questionCreated",
			text: "name: brand_new\ntext: New?\nintent: To see.\nopen: {}\n",
			bank: "banks/a",
		});
		const draft = Math.max(...Object.keys(m.local.questions).map(Number));
		[m] = update(m, { kind: "saveRequested", id: draft });
		[m] = update(m, { kind: "saveFolderChanged", folder: "fresh" });
		const [, saved] = update(m, { kind: "saveConfirmed" });
		expect(commitOf(saved)?.changes.map((c) => c.path)).toEqual([
			"banks/a/questions/fresh/brand_new.yaml",
		]);
		let [n] = update(loaded(WORKSPACE), {
			kind: "schemeCreateOpened",
			scheme: "universe",
			bank: "banks/b",
		});
		[n] = update(n, { kind: "schemeNameChanged", name: "renters" });
		[n] = update(n, { kind: "schemeTextChanged", text: "Renters" });
		[n] = update(n, { kind: "schemeNamingConfirmed" });
		const universe = Math.max(...Object.keys(n.local.schemes).map(Number));
		const [, made] = update(n, { kind: "saveRequested", id: universe });
		expect(commitOf(made)?.changes.map((c) => c.path)).toEqual([
			"banks/b/universes/renters.yaml",
		]);
	});

	it("reads another author's file through its own bank, with that bank's shared files", () => {
		const m = loaded(WORKSPACE);
		const path = "banks/b/scales/yn.yaml";
		const [opened, cmds] = update(m, {
			kind: "hashChanged",
			hash: formatLink({ repo: "o/r", branch: "qretools-ann", file: path }),
		});
		expect(cmds).toContainEqual(
			expect.objectContaining({
				kind: "readAt",
				target: expect.objectContaining({
					path: "banks/b",
					branch: "qretools-ann",
				}),
				path,
				rel: "scales/yn.yaml",
			}),
		);
		// Their reply names the file within the bank; the screen keeps the workspace's path.
		const [shown] = update(opened, {
			kind: "foreignLoaded",
			branch: "qretools-ann",
			path,
			result: ok({
				file: { path: "scales/yn.yaml", sha: "theirs", text: "labels: {}\n" },
				schemes: [],
			}),
		});
		expect(shown.screen).toMatchObject({
			kind: "foreign",
			path,
			file: { path, sha: "theirs" },
		});
	});
});
