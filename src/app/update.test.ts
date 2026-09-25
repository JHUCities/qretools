import { describe, expect, it } from "vitest";
import { evaluate } from "../core/evaluate.js";
import { locate } from "../core/findings.js";
import { ok } from "../core/result.js";
import { EMPTY_ENV } from "../core/surface/env.js";
import { toDiagnostics } from "./diagnostics.js";
import { createEvaluations } from "./evaluations.js";
import { formatLink } from "./link.js";
import {
	DEFAULT_SETTINGS,
	envOf,
	fileOf,
	type Id,
	init,
	type Model,
	type Msg,
	type Question,
	remoteOfBases,
	type SchemeEntry,
} from "./model.js";
import type { File } from "./storage.js";
import { remoteBlob, syncOf } from "./sync.js";
import {
	movedPath,
	moveProblem,
	schemeNameProblem,
	update,
	writeBlocked,
} from "./update.js";

const fresh = (): Model => init({ stored: ok(undefined), hasToken: false })[0];
const run = (model: Model, ...msgs: Msg[]) =>
	msgs.reduce<ReturnType<typeof update>>(
		([m], msg) => update(m, msg),
		[model, []],
	);
const LOADED = {
	kind: "loaded",
	from: "branch",
	proposable: false,
	behindBy: 0,
} as const;
/** A load of these files from the author's branch. */
const loadOf = (files: readonly File[]) =>
	ok({ files, from: "branch" as const, aheadBy: 0, behindBy: 0 });
/** Connected, with this session's load done: the state in which writing is allowed. */
const connected = (model: Model, canWrite = true): Model => ({
	...model,
	session: {
		kind: "connected",
		login: "iain",
		canWrite,
		branch: "qretools/iain",
		defaultBranch: "main",
	},
	loading: LOADED,
});
const firstId = (model: Model): Id =>
	Number(
		Object.keys(model.local.questions)[0] ??
			Object.keys(model.local.schemes)[0],
	);
const bankQuestion = (
	id: number,
	path: string,
	text: string,
	source = text,
	sha = "s",
): Question => ({
	kind: "question",
	id,
	source,
	base: { path, sha, text },
});
/** A model holding these bank questions, with GitHub's copy as their bases record it. */
const withBank = (model: Model, questions: readonly Question[]): Model => {
	const local = {
		...model.local,
		questions: {
			...model.local.questions,
			...Object.fromEntries(questions.map((q) => [q.id, q])),
		},
	};
	const remote = remoteOfBases(local);
	return { ...model, local, remote };
};

describe("init", () => {
	it("starts with an empty list on first run, and asks for the DDI schema", () => {
		const [model, cmds] = init({ stored: ok(undefined), hasToken: false });
		expect(Object.keys(model.local.questions)).toHaveLength(0);
		expect(model.screen).toEqual({ kind: "blank" });
		expect(cmds).toEqual([{ kind: "loadDdiSchema" }]);
	});

	it("restores saved work, and starts connecting when a token is on hand", () => {
		const stored = {
			version: 3 as const,
			nextId: 9,
			questions: [
				{
					id: 3,
					kind: "question" as const,
					source: "name: q\n",
					base: { path: "questions/q/q.yaml", sha: "abc", text: "name: q\n" },
				},
			],
			schemes: [],
			settings: { ...DEFAULT_SETTINGS, branch: "sandbox" },
		};
		const [model, cmds] = init({ stored: ok(stored), hasToken: true });
		expect(model.local.questions[3]?.base).toEqual(stored.questions[0]?.base);
		// GitHub as this browser last knew it is what the bases record.
		expect(model.remote.questions["questions/q/q.yaml"]?.sha).toBe("abc");
		expect(model.nextId).toBe(9);
		expect(model.session.kind).toBe("connecting");
		expect(cmds.at(-1)).toEqual({
			kind: "connect",
			repo: { owner: "JHUCities", repo: "bas-question-bank" },
		});
	});

	it("keeps an unreadable store as a failure, not a crash", () => {
		const [model] = init({
			stored: { ok: false, error: { kind: "unreadable", message: "bad" } },
			hasToken: false,
		});
		expect(model.failures).toEqual([{ kind: "unreadable", message: "bad" }]);
		expect(Object.keys(model.local.questions)).toHaveLength(0);
	});
});

describe("editing", () => {
	it("creating opens the editor and persists; edits change only the open question", () => {
		const [m1, c1] = update(fresh(), {
			kind: "questionCreated",
			text: "name: q\n",
		});
		expect(m1.screen).toEqual({ kind: "editing", id: 1 });
		expect(c1.at(-1)?.kind).toBe("persist");
		const [m2] = update(m1, { kind: "edited", text: "name: q2\n" });
		expect(m2.local.questions[1]?.source).toBe("name: q2\n");
	});

	it("a click names a place; update resolves it against the open question's text", () => {
		const [m] = update(fresh(), {
			kind: "questionCreated",
			text: "name: q\ntext:\nintent: i\nopen:\n",
		});
		const [, cmds] = update(m, {
			kind: "locationClicked",
			target: { path: "text", severity: "hole" },
		});
		const cmd = cmds[0];
		expect(
			cmd?.kind === "revealRange" &&
				"name: q\ntext:\nintent: i\nopen:\n".slice(cmd.range[0], cmd.range[1]),
		).toBe("text:");
	});

	it("upload adds drafts with their text and returns to the list", () => {
		const [m] = update(fresh(), {
			kind: "filesUploaded",
			files: [
				{ name: "a.yaml", text: "name: a\n" },
				{ name: "b.yaml", text: "name: b\n" },
			],
		});
		expect(Object.keys(m.local.questions)).toHaveLength(2);
		expect(m.screen.kind).toBe("blank");
	});
});

describe("saving", () => {
	const draftModel = () =>
		update(fresh(), {
			kind: "questionCreated",
			text: "name: nhd_new\ntext: Q?\nintent: Prevalence of a thing\nopen:\n",
		})[0];

	it("does nothing without write access", () => {
		expect(update(draftModel(), { kind: "saveRequested", id: 1 })[1]).toEqual(
			[],
		);
		expect(
			update(connected(draftModel(), false), {
				kind: "saveRequested",
				id: 1,
			})[1],
		).toEqual([]);
	});

	it("asks where a new draft goes, with the folder its name implies, and writes nothing yet", () => {
		const [m, cmds] = update(connected(draftModel()), {
			kind: "saveRequested",
			id: 1,
		});
		expect(cmds).toEqual([]);
		expect(m.browser.saving).toEqual({ id: 1, folder: "nhd" });
		expect(m.activity[1]).toBeUndefined();
	});

	it("writes to the chosen folder on confirm, with a core commit message", () => {
		const [asked] = update(connected(draftModel()), {
			kind: "saveRequested",
			id: 1,
		});
		const [chosen] = update(asked, {
			kind: "saveFolderChanged",
			folder: "svy",
		});
		const [m, cmds] = update(chosen, { kind: "saveConfirmed" });
		expect(m.browser.saving).toBeUndefined();
		expect(m.activity[1]).toEqual({ kind: "saving" });
		expect(cmds).toEqual([
			{
				kind: "commit",
				target: {
					...{ owner: "JHUCities", repo: "bas-question-bank" },
					branch: "qretools/iain",
					defaultBranch: "main",
				},
				changes: [
					{
						id: 1,
						path: "questions/svy/nhd_new.yaml",
						expected: null,
						text: m.local.questions[1]?.source,
					},
				],
				message: "Add nhd_new",
			},
		]);
	});

	it("cancelling the save writes nothing", () => {
		const [asked] = update(connected(draftModel()), {
			kind: "saveRequested",
			id: 1,
		});
		const [m, cmds] = update(asked, { kind: "saveCancelled" });
		expect(m.browser.saving).toBeUndefined();
		expect(cmds).toEqual([]);
	});

	it("refuses to save a draft over a bank question at the same path", () => {
		const base = draftModel();
		const m0 = withBank(connected(base), [
			bankQuestion(
				9,
				"questions/nhd/nhd_new.yaml",
				"name: nhd_new\n",
				"name: nhd_new\n",
				"s",
			),
		]);
		const [asked] = update(m0, { kind: "saveRequested", id: 1 });
		const [m, cmds] = update(asked, { kind: "saveConfirmed" });
		expect(cmds).toEqual([]);
		expect(
			m.activity[1]?.kind === "failed" && m.activity[1].failure.message,
		).toMatch(/already exists/);
	});

	it("refuses a draft without a valid name, as a failure on the question", () => {
		const [m0] = update(fresh(), {
			kind: "questionCreated",
			text: "text: Q?\n",
		});
		const [m, cmds] = update(connected(m0), { kind: "saveRequested", id: 1 });
		expect(cmds).toEqual([]);
		expect(m.activity[1]?.kind).toBe("failed");
	});

	it("a finished save makes the question a bank file at the text that was written", () => {
		const [m1] = update(connected(draftModel()), {
			kind: "saveRequested",
			id: 1,
		});
		const [m2, cmds] = update(m1, {
			kind: "committed",
			changes: [
				{
					id: 1,
					path: "questions/nhd/nhd_new.yaml",
					expected: null,
					text: m1.local.questions[1]?.source ?? "",
				},
			],
			result: ok({ shas: { "questions/nhd/nhd_new.yaml": "new" } }),
		});
		expect(m2.local.questions[1]?.base).toEqual({
			path: "questions/nhd/nhd_new.yaml",
			sha: "new",
			text: m1.local.questions[1]?.source,
		});
		// GitHub's copy of the author's branch is what was written.
		expect(m2.remote.questions["questions/nhd/nhd_new.yaml"]?.sha).toBe("new");
		expect(cmds.map((c) => c.kind)).toContain("persist");
		// The draft now has a path, so its link gains the file, in place.
		expect(cmds.at(-1)).toMatchObject({ kind: "setLink", push: false });
	});

	it("a bank question saves to its opened path with its sha, and a stale answer is a failure with the reload path", () => {
		const bank = withBank(connected(fresh()), [
			bankQuestion(
				1,
				"questions/svy/nhd_sat.yaml",
				"name: nhd_sat\ntext: Old?\n",
				"name: nhd_sat\ntext: New?\n",
				"s1",
			),
		]);
		const [, cmds] = update(bank, { kind: "saveRequested", id: 1 });
		expect(cmds[0]).toMatchObject({
			kind: "commit",
			changes: [{ path: "questions/svy/nhd_sat.yaml", expected: "s1" }],
			message: "Update nhd_sat: text",
		});
		// GitHub moved the file meanwhile: take what it has, and say so on the file.
		const [m2] = update(bank, {
			kind: "committed",
			changes: [
				{
					id: 1,
					path: "questions/svy/nhd_sat.yaml",
					expected: "s1",
					text: "x",
				},
			],
			result: {
				ok: false,
				error: {
					failure: { kind: "stale", message: "changed" },
					seen: { "questions/svy/nhd_sat.yaml": { sha: "s2", text: "theirs" } },
				},
			},
		});
		expect(m2.activity[1]).toEqual({
			kind: "failed",
			failure: { kind: "stale", message: "changed" },
		});
		expect(m2.remote.questions["questions/svy/nhd_sat.yaml"]?.sha).toBe("s2");
		// The author's text stays; it now shows as a conflict to resolve by reloading.
		expect(m2.local.questions[1]?.source).toBe("name: nhd_sat\ntext: New?\n");
		const [, reload] = update(m2, { kind: "reloadRequested", id: 1 });
		expect(reload[0]).toMatchObject({
			kind: "readFile",
			path: "questions/svy/nhd_sat.yaml",
		});
	});
});

describe("deleting", () => {
	it("asks first, then deletes a draft locally or a bank file through the store", () => {
		const m = connected(
			update(fresh(), { kind: "questionCreated", text: "name: q\n" })[0],
		);
		const id = firstId(m);
		const [m1, c1] = update(m, { kind: "deleteRequested", id });
		expect(c1).toEqual([]);
		expect(m1.browser.confirmDelete).toBe(id);
		const [m2, c2] = update(m1, { kind: "deleteRequested", id });
		expect(fileOf(m2, id)).toBeUndefined();
		expect(c2.at(-1)?.kind).toBe("persist");
	});

	it("never deletes from the bank without write access", () => {
		const m = withBank(connected(fresh(), false), [
			bankQuestion(1, "questions/q/q.yaml", "name: q\n", "name: q\n", "s"),
		]);
		const [, cmds] = run(
			m,
			{ kind: "deleteRequested", id: 1 },
			{ kind: "deleteRequested", id: 1 },
		);
		expect(cmds).toEqual([]);
	});
});

describe("connecting", () => {
	it("connect, then load the bank, then merge it: every file becomes an entry of the kind its path says", () => {
		const [m1, c1] = update(fresh(), {
			kind: "connectRequested",
			settings: { ...DEFAULT_SETTINGS, branch: "sandbox" },
		});
		expect(m1.session.kind).toBe("connecting");
		expect(c1[0]).toEqual({
			kind: "connect",
			repo: { owner: "JHUCities", repo: "bas-question-bank" },
		});
		const [m2, c2] = update(m1, {
			kind: "connected",
			result: ok({ login: "iain", canWrite: true, defaultBranch: "main" }),
		});
		expect(m2.loading.kind).toBe("loading");
		expect(c2[0]?.kind).toBe("loadBank");
		const [m3] = update(m2, {
			kind: "bankLoaded",
			result: loadOf([
				{
					path: "questions/nhd/nhd_x.yaml",
					sha: "a",
					text: "name: nhd_x\nresponses: agree4\nuniverse: renters\n",
				},
				{
					path: "scales/agree4.yaml",
					sha: "b",
					text: "labels:\n  1: Yes\n  2: No\n",
				},
				{ path: "scales/bad.yaml", sha: "c", text: "labels: [\n" },
				{ path: "universes/renters.yaml", sha: "d", text: "text: Renters\n" },
				{ path: "missing.yaml", sha: "e", text: 'labels:\n  "-8": NR\n' },
				{ path: "README.md", sha: "f", text: "# bank\n" },
			]),
		});
		expect(
			[
				...Object.values(m3.local.questions),
				...Object.values(m3.local.schemes),
			].map((e) => (e.kind === "question" ? e.kind : `${e.kind}:${e.name}`)),
		).toEqual([
			"question",
			"scale:agree4",
			"scale:bad",
			"universe:renters",
			"missing:missing",
		]);
		// Questions are read against the saved schemes; an unreadable one contributes nothing.
		const env = envOf(m3.local.schemes, m3.remote.schemes);
		expect(Object.keys(env.scales)).toEqual(["agree4"]);
		expect(env.universes.renters?.text).toBe("Renters");
		expect(env.missing.map((c) => c.code)).toEqual(["-8"]);
	});

	it("reads questions against the working scheme files, so an edit shows at once", () => {
		const [m] = update(fresh(), {
			kind: "bankLoaded",
			result: loadOf([
				{ path: "scales/yn.yaml", sha: "b", text: "labels:\n  1: Yes\n" },
			]),
		});
		const id = firstId(m);
		const [edited] = update(
			{ ...m, screen: { kind: "editing", id } },
			{ kind: "edited", text: "labels:\n  1: Yes\n  2: No\n" },
		);
		expect(
			envOf(edited.local.schemes, edited.remote.schemes).scales.yn?.codes,
		).toHaveLength(2);
		// GitHub's copy is untouched until a save.
		expect(edited.remote).toBe(m.remote);
	});

	it("disconnecting forgets the token", () => {
		const [m, cmds] = update(connected(fresh()), { kind: "disconnected" });
		expect(m.session).toEqual({ kind: "anonymous" });
		expect(cmds).toEqual([{ kind: "forgetToken" }]);
	});

	it("messages and the model are plain data", () => {
		const [m] = update(fresh(), { kind: "questionCreated", text: "name: q\n" });
		expect(JSON.parse(JSON.stringify(m))).toEqual(m);
	});
});

describe("diagnostics", () => {
	it("maps holes to CodeMirror's hint severity and keeps every range inside the text", () => {
		for (const source of [
			"",
			"name: q\n",
			"a: [",
			"name: q\ntext: x: y\nresponses:\n  1:\n",
		]) {
			const ev = evaluate(source, "org.example", EMPTY_ENV);
			for (const d of toDiagnostics(ev.findings, ev.ranges)) {
				expect(d.from).toBeLessThanOrEqual(d.to);
				expect(d.to).toBeLessThanOrEqual(source.length);
			}
		}
		const ev = evaluate("name: q\n", "org.example", EMPTY_ENV);
		expect(
			toDiagnostics(ev.findings, ev.ranges).some((d) => d.severity === "hint"),
		).toBe(true);
		const textHole = ev.findings.find((f) => f.path === "text");
		expect(textHole && locate(textHole, ev.ranges)).toEqual([
			"name: q\n".length,
			"name: q\n".length,
		]);
	});
});

describe("scheme files", () => {
	it("a new scale is named first; a bad or taken name is refused as the author types", () => {
		const [asked] = update(fresh(), {
			kind: "schemeCreateOpened",
			scheme: "scale",
		});
		expect(asked.browser.creating).toEqual({ kind: "scale", name: "" });
		expect(schemeNameProblem(asked, "scale", "")).toMatch(/name/);
		expect(schemeNameProblem(asked, "scale", "Agree 5")).toMatch(/lower case/);
		// Confirming an unusable name does nothing.
		expect(update(asked, { kind: "schemeCreateConfirmed" })[0]).toBe(asked);
		const [made] = run(
			asked,
			{ kind: "schemeNameChanged", name: "agree5" },
			{ kind: "schemeCreateConfirmed" },
		);
		const id = firstId(made);
		expect(made.local.schemes[id]).toMatchObject({
			kind: "scale",
			name: "agree5",
		});
		expect(made.local.schemes[id]?.base).toBeUndefined();
		expect(made.screen).toEqual({ kind: "editing", id });
		expect(made.browser.creating).toBeUndefined();
		expect(schemeNameProblem(made, "scale", "agree5")).toMatch(
			/already exists/,
		);
		// A universe may share a scale's name: they are different namespaces.
		expect(schemeNameProblem(made, "universe", "agree5")).toBeUndefined();
	});

	it("missing values are one list: created once, then opened", () => {
		const [m1] = update(fresh(), {
			kind: "schemeCreateOpened",
			scheme: "missing",
		});
		const id = firstId(m1);
		expect(m1.local.schemes[id]).toMatchObject({
			kind: "missing",
			name: "missing",
		});
		const [m2] = update(
			{ ...m1, screen: { kind: "blank" } },
			{ kind: "schemeCreateOpened", scheme: "missing" },
		);
		expect(Object.keys(m2.local.schemes)).toHaveLength(1);
		expect(m2.screen).toEqual({ kind: "editing", id });
	});

	it("saves a new scheme file to the path its kind and name give, with no dialog, and deletes by name", () => {
		const [made] = run(
			connected(fresh()),
			{ kind: "schemeCreateOpened", scheme: "universe" },
			{ kind: "schemeNameChanged", name: "renters" },
			{ kind: "schemeCreateConfirmed" },
		);
		const id = firstId(made);
		const [, cmds] = update(made, { kind: "saveRequested", id });
		expect(cmds[0]).toMatchObject({
			kind: "commit",
			changes: [{ path: "universes/renters.yaml", expected: null }],
			message: "Add universe renters",
		});
		const saved: Model = {
			...made,
			local: {
				...made.local,
				schemes: {
					[id]: {
						...(made.local.schemes[id] as SchemeEntry),
						base: {
							path: "universes/renters.yaml",
							sha: "s",
							text: "text: Renters\n",
						},
					},
				},
			},
		};
		const [, del] = run(
			saved,
			{ kind: "deleteRequested", id },
			{ kind: "deleteRequested", id },
		);
		expect(del[0]).toMatchObject({
			kind: "commit",
			changes: [{ path: "universes/renters.yaml", text: null }],
			message: "Delete universe renters",
		});
	});
});

describe("the environment's identity", () => {
	const loaded = update(fresh(), {
		kind: "bankLoaded",
		result: loadOf([
			{ path: "questions/a/a.yaml", sha: "q", text: "name: a\n" },
			{ path: "scales/yn.yaml", sha: "b", text: "labels:\n  1: Yes\n" },
		]),
	})[0];
	const question = Object.values(loaded.local.questions)[0];
	const scale = Object.values(loaded.local.schemes)[0];

	it("editing a question touches only local.questions: both scheme slices and GitHub's copy keep their identity", () => {
		const [edited] = update(
			{ ...loaded, screen: { kind: "editing", id: question?.id ?? 0 } },
			{ kind: "edited", text: "name: a\ntext: changed\n" },
		);
		expect(edited.local.questions).not.toBe(loaded.local.questions);
		expect(edited.local.schemes).toBe(loaded.local.schemes);
		expect(edited.remote).toBe(loaded.remote);
		const evaluations = createEvaluations();
		expect(evaluations.env(edited.local.schemes, edited.remote.schemes)).toBe(
			evaluations.env(loaded.local.schemes, loaded.remote.schemes),
		);
	});

	it("editing a scheme file touches only local.schemes", () => {
		const [edited] = update(
			{ ...loaded, screen: { kind: "editing", id: scale?.id ?? 0 } },
			{ kind: "edited", text: "labels:\n  1: Y\n" },
		);
		expect(edited.local.schemes).not.toBe(loaded.local.schemes);
		expect(edited.local.questions).toBe(loaded.local.questions);
		expect(edited.remote).toBe(loaded.remote);
	});

	it("a load that brings nothing new keeps every slice", () => {
		const [again] = update(loaded, {
			kind: "bankLoaded",
			result: loadOf([
				{ path: "questions/a/a.yaml", sha: "q", text: "name: a\n" },
				{ path: "scales/yn.yaml", sha: "b", text: "labels:\n  1: Yes\n" },
			]),
		});
		expect(again.remote.schemes).toBe(loaded.remote.schemes);
		expect(again.remote.questions).toBe(loaded.remote.questions);
		expect(again.local).toBe(loaded.local);
	});
});

describe("writing waits for this session's load", () => {
	it("refuses to save or delete until the bank has loaded, and says why", () => {
		const m = withBank(
			{ ...connected(fresh()), loading: { kind: "loading" } },
			[
				bankQuestion(
					1,
					"questions/q/q.yaml",
					"name: q\n",
					"name: q\ntext: x\n",
				),
			],
		);
		expect(writeBlocked(m)).toMatch(/Checking GitHub/);
		expect(update(m, { kind: "saveRequested", id: 1 })[1]).toEqual([]);
		expect(
			run(
				m,
				{ kind: "deleteRequested", id: 1 },
				{ kind: "deleteRequested", id: 1 },
			)[1],
		).toEqual([]);
		expect(writeBlocked({ ...m, loading: LOADED })).toBeUndefined();
	});

	it("a path a working file still claims is taken, though GitHub deleted it", () => {
		// q/q.yaml was deleted on GitHub while changed here: its base still claims the path.
		const kept = bankQuestion(
			9,
			"questions/q/q.yaml",
			"name: q\n",
			"name: q\nnote: mine\n",
		);
		const base = withBank(connected(fresh()), [kept]);
		const m: Model = {
			...base,
			remote: { questions: {}, schemes: {} },
		};
		const [made] = update(m, { kind: "questionCreated", text: "name: q\n" });
		const id = made.nextId - 1;
		const [asked] = update(made, { kind: "saveRequested", id });
		const [refused, cmds] = update(
			{ ...asked, browser: { ...asked.browser, saving: { id, folder: "q" } } },
			{ kind: "saveConfirmed" },
		);
		expect(cmds).toEqual([]);
		expect(refused.activity[id]?.kind).toBe("failed");
	});

	it("with no bank known, example scales stand in beneath a first local scale", () => {
		const [m] = run(
			fresh(),
			{ kind: "schemeCreateOpened", scheme: "scale" },
			{ kind: "schemeNameChanged", name: "mine" },
			{ kind: "schemeCreateConfirmed" },
		);
		const env = envOf(m.local.schemes, m.remote.schemes);
		expect(Object.keys(env.scales)).toContain("agree4");
	});
});

describe("the author's own branch", () => {
	it("connecting resolves an empty branch setting to qretools/<login>, and loads it", () => {
		const [m, cmds] = update(
			{ ...fresh(), settings: { ...fresh().settings, branch: "" } },
			{
				kind: "connected",
				result: ok({ login: "iain", canWrite: true, defaultBranch: "main" }),
			},
		);
		expect(m.session).toMatchObject({
			branch: "qretools/iain",
			defaultBranch: "main",
		});
		expect(cmds[0]).toEqual({
			kind: "loadBank",
			target: {
				owner: "JHUCities",
				repo: "bas-question-bank",
				branch: "qretools/iain",
				defaultBranch: "main",
			},
		});
	});

	it("never saves straight to the bank's default branch", () => {
		const m = withBank(connected(fresh()), [
			bankQuestion(1, "questions/q/q.yaml", "name: q\n", "name: q\ntext: x\n"),
		]);
		const onMain: Model = {
			...m,
			session: {
				...(m.session as Extract<Model["session"], { kind: "connected" }>),
				branch: "main",
			},
		};
		expect(writeBlocked(onMain)).toMatch(/your own branch/);
		expect(update(onMain, { kind: "saveRequested", id: 1 })[1]).toEqual([]);
		expect(writeBlocked(m)).toBeUndefined();
	});

	it("a save is one more commit on the branch, which now exists", () => {
		const m = withBank(
			{ ...connected(fresh()), loading: { ...LOADED, from: "default" } },
			[
				bankQuestion(
					1,
					"questions/q/q.yaml",
					"name: q\n",
					"name: q\ntext: x\n",
				),
			],
		);
		const [saved] = update(m, {
			kind: "committed",
			changes: [
				{
					id: 1,
					path: "questions/q/q.yaml",
					expected: "s",
					text: "name: q\ntext: x\n",
				},
			],
			result: ok({ shas: { "questions/q/q.yaml": "n" } }),
		});
		expect(saved.loading).toEqual({
			...LOADED,
			from: "branch",
			proposable: true,
		});
	});

	it("reload reads where the load read: the bank before the first save, the branch after", () => {
		const bank = (from: "branch" | "default") =>
			withBank({ ...connected(fresh()), loading: { ...LOADED, from } }, [
				bankQuestion(1, "questions/q/q.yaml", "name: q\n"),
			]);
		const [, before] = update(bank("default"), {
			kind: "reloadRequested",
			id: 1,
		});
		expect(before[0]).toMatchObject({ target: { branch: "main" } });
		const [, after] = update(bank("branch"), {
			kind: "reloadRequested",
			id: 1,
		});
		expect(after[0]).toMatchObject({ target: { branch: "qretools/iain" } });
	});
});

describe("the cursor inspector's messages", () => {
	it("records where the caret is in the open file, and never persists it", () => {
		const [m] = update(fresh(), { kind: "questionCreated", text: "name: q\n" });
		const [moved, cmds] = update(m, { kind: "cursorMoved", offset: 3 });
		expect(moved.cursor).toEqual({ id: firstId(m), offset: 3 });
		expect(cmds).toEqual([]);
		expect(
			update(fresh(), { kind: "cursorMoved", offset: 3 })[0].cursor,
		).toBeUndefined();
	});

	it("creating a name a question already uses starts the dialog with it", () => {
		const [m] = update(fresh(), {
			kind: "schemeCreateOpened",
			scheme: "universe",
			name: "renters",
		});
		expect(m.browser.creating).toEqual({ kind: "universe", name: "renters" });
		expect(schemeNameProblem(m, "universe", "renters")).toBeUndefined();
	});
});

describe("change sets", () => {
	const scale = (
		id: number,
		name: string,
		text: string,
		base?: string,
	): SchemeEntry => ({
		kind: "scale",
		id,
		name,
		source: text,
		...(base !== undefined && {
			base: { path: `scales/${name}.yaml`, sha: `s-${name}`, text: base },
		}),
	});
	const withScales = (m: Model, scales: SchemeEntry[]): Model => {
		const local = {
			...m.local,
			schemes: Object.fromEntries(scales.map((e) => [e.id, e])),
		};
		return { ...m, local, remote: remoteOfBases(local) };
	};
	const bank = () =>
		withScales(
			withBank(connected(fresh()), [
				bankQuestion(
					1,
					"questions/q/q.yaml",
					"name: q\nresponses: yn\n",
					"name: q\nresponses: yn\n",
				),
			]),
			[scale(10, "yn", "labels:\n  1: Yes\n  2: No\n", "labels:\n  1: Yes\n")],
		);

	it("a question takes along the unsaved scale it names, in one commit", () => {
		const [m, cmds] = update(bank(), { kind: "saveRequested", id: 1 });
		const cmd = cmds[0];
		expect(
			cmd?.kind === "commit" &&
				cmd.changes.map((c) => [c.id, c.path, c.expected]),
		).toEqual([
			[1, "questions/q/q.yaml", "s"],
			[10, "scales/yn.yaml", "s-yn"],
		]);
		expect(cmd?.kind === "commit" && cmd.message).toMatch(
			/With:\n- Update scale yn/,
		);
		expect(m.activity[10]).toEqual({ kind: "saving" });
		// One commit at a time.
		expect(writeBlocked(m)).toBe("Saving…");
	});

	it("a named scale GitHub also changed stops the save before any request, naming it", () => {
		const m = bank();
		const moved: Model = {
			...m,
			remote: {
				...m.remote,
				schemes: {
					"scales/yn.yaml": { sha: "theirs", text: "labels:\n  1: Y\n" },
				},
			},
		};
		const [refused, cmds] = update(moved, { kind: "saveRequested", id: 1 });
		expect(cmds).toEqual([]);
		expect(
			refused.activity[1]?.kind === "failed" &&
				refused.activity[1].failure.message,
		).toMatch(/`yn`/);
	});

	it("after the commit each base is the committed text, even if typing went on meanwhile", () => {
		const [saving, cmds] = update(bank(), { kind: "saveRequested", id: 1 });
		const cmd = cmds[0];
		if (cmd?.kind !== "commit") throw new Error("expected a commit");
		const [typed] = update(
			{ ...saving, screen: { kind: "editing", id: 1 } },
			{ kind: "edited", text: "name: q\nresponses: yn\nnote: later\n" },
		);
		const [done] = update(typed, {
			kind: "committed",
			changes: cmd.changes,
			result: ok({
				shas: { "questions/q/q.yaml": "q2", "scales/yn.yaml": "yn2" },
			}),
		});
		expect(done.local.questions[1]?.base?.text).toBe(
			"name: q\nresponses: yn\n",
		);
		expect(done.local.questions[1]?.source).toMatch(/note: later/);
		expect(done.local.schemes[10]?.base).toMatchObject({ sha: "yn2" });
		expect(done.activity).toEqual({});
	});

	it("a delete is a one-change set with no text", () => {
		const [, cmds] = run(
			bank(),
			{ kind: "deleteRequested", id: 1 },
			{ kind: "deleteRequested", id: 1 },
		);
		expect(cmds[0]).toMatchObject({
			kind: "commit",
			changes: [
				{ id: 1, path: "questions/q/q.yaml", expected: "s", text: null },
			],
		});
	});

	it("a stale scale in the change set leaves the scale in conflict, not the question", () => {
		const [saving, cmds] = update(bank(), { kind: "saveRequested", id: 1 });
		const cmd = cmds[0];
		if (cmd?.kind !== "commit") throw new Error("expected a commit");
		const [m] = update(saving, {
			kind: "committed",
			changes: cmd.changes,
			result: {
				ok: false,
				error: {
					failure: {
						kind: "stale",
						message: "Changed on GitHub: `scales/yn.yaml`.",
					},
					seen: {
						"questions/q/q.yaml": {
							sha: "s",
							text: "name: q\nresponses: yn\n",
						},
						"scales/yn.yaml": { sha: "theirs", text: "labels:\n  1: Y\n" },
					},
				},
			},
		});
		const q = m.local.questions[1];
		const yn = m.local.schemes[10];
		expect(q && syncOf(q, remoteBlob(m.remote, q))).not.toBe("conflict");
		expect(yn && syncOf(yn, remoteBlob(m.remote, yn))).toBe("conflict");
		// Reload on the scale reads it where it lives; nothing touches the question.
		const [, reload] = update(m, { kind: "reloadRequested", id: 10 });
		expect(reload[0]).toMatchObject({
			kind: "readFile",
			path: "scales/yn.yaml",
		});
	});

	it("reload on a file GitHub deleted takes the deletion; a draft GitHub also added reloads from its path", () => {
		const m = bank();
		const gone: Model = { ...m, remote: { ...m.remote, schemes: {} } };
		const [after] = update(gone, { kind: "reloadRequested", id: 10 });
		expect(after.local.schemes[10]).toBeUndefined();
		const drafted = withScales(connected(fresh()), [
			scale(11, "new1", "labels:\n  1: A\n"),
		]);
		const both: Model = {
			...drafted,
			remote: {
				...drafted.remote,
				schemes: { "scales/new1.yaml": { sha: "t", text: "x" } },
			},
		};
		const [, cmds] = update(both, { kind: "reloadRequested", id: 11 });
		expect(cmds[0]).toMatchObject({
			kind: "readFile",
			path: "scales/new1.yaml",
		});
	});
});

describe("links", () => {
	const hashFor = (file?: string, branch = "qretools/iain") =>
		formatLink({
			repo: "JHUCities/bas-question-bank",
			branch,
			...(file !== undefined && { file }),
		});
	const loadedBank = () =>
		withBank(connected(fresh()), [
			bankQuestion(1, "questions/q/q.yaml", "name: q\n"),
			bankQuestion(2, "questions/r/r.yaml", "name: r\n"),
		]);

	it("opening a file pushes its link; the same link coming back is a no-op", () => {
		const [m, cmds] = update(loadedBank(), { kind: "fileOpened", id: 2 });
		expect(cmds).toEqual([
			{ kind: "setLink", hash: hashFor("questions/r/r.yaml"), push: true },
		]);
		expect(
			update(m, { kind: "hashChanged", hash: hashFor("questions/r/r.yaml") }),
		).toEqual([m, []]);
	});

	it("a link to your branch opens your copy; a stale event from quick navigation changes nothing", () => {
		const [m] = update(loadedBank(), {
			kind: "hashChanged",
			hash: hashFor("questions/q/q.yaml"),
		});
		expect(m.screen).toEqual({ kind: "editing", id: 1 });
	});

	it("before the first save the link names the default branch, which exists", () => {
		const m = {
			...loadedBank(),
			loading: { ...LOADED, from: "default" as const },
		};
		const [, cmds] = update(m, { kind: "fileOpened", id: 1 });
		expect(cmds[0]).toMatchObject({
			hash: hashFor("questions/q/q.yaml", "main"),
		});
	});

	it("a link that needs the bank waits for it, and clears on a failed load or disconnect", () => {
		const waiting = { ...fresh(), loading: { kind: "loading" as const } };
		const [m] = update(waiting, {
			kind: "hashChanged",
			hash: hashFor("questions/q/q.yaml"),
		});
		expect(m.pendingLink).toMatchObject({ file: "questions/q/q.yaml" });
		const [opened] = update(connected(m), {
			kind: "bankLoaded",
			result: loadOf([
				{ path: "questions/q/q.yaml", sha: "s", text: "name: q\n" },
			]),
		});
		expect(opened.pendingLink).toBeUndefined();
		expect(opened.screen.kind).toBe("editing");
		const [gone] = update(m, { kind: "disconnected" });
		expect(gone.pendingLink).toBeUndefined();
	});

	it("another author's version is read only; one matching your base opens your copy", () => {
		const [m, cmds] = update(loadedBank(), {
			kind: "hashChanged",
			hash: hashFor("questions/q/q.yaml", "qretools/alice"),
		});
		expect(m.screen).toEqual({
			kind: "foreign",
			branch: "qretools/alice",
			path: "questions/q/q.yaml",
		});
		expect(cmds[0]).toMatchObject({
			kind: "readAt",
			path: "questions/q/q.yaml",
		});
		const [theirs] = update(m, {
			kind: "foreignLoaded",
			branch: "qretools/alice",
			path: "questions/q/q.yaml",
			result: ok({
				path: "questions/q/q.yaml",
				sha: "other",
				text: "name: q\nnote: hers\n",
			}),
		});
		expect(theirs.screen).toMatchObject({
			kind: "foreign",
			file: { sha: "other" },
		});
		const [same] = update(m, {
			kind: "foreignLoaded",
			branch: "qretools/alice",
			path: "questions/q/q.yaml",
			result: ok({ path: "questions/q/q.yaml", sha: "s", text: "name: q\n" }),
		});
		expect(same.screen).toEqual({ kind: "editing", id: 1 });
	});

	it("a link to another repository is refused, saying which", () => {
		const [m] = update(loadedBank(), {
			kind: "hashChanged",
			hash: formatLink({ repo: "other/bank", branch: "main" }),
		});
		expect(m.failures.at(-1)?.message).toMatch(/other\/bank/);
	});
});

describe("moving a question", () => {
	const edited = () =>
		withBank(connected(fresh()), [
			bankQuestion(
				1,
				"questions/nhd/nhd_sat.yaml",
				"name: nhd_sat\n",
				"name: nhd_sat\nnote: unsaved\n",
			),
		]);

	it("is one commit of the saved version at the new path, and the old path gone", () => {
		const [asked] = update(edited(), { kind: "moveRequested", id: 1 });
		expect(asked.browser.moving).toEqual({ id: 1, folder: "nhd" });
		const [chosen] = update(asked, {
			kind: "moveFolderChanged",
			folder: "svy",
		});
		const [, cmds] = update(chosen, { kind: "moveConfirmed" });
		expect(cmds[0]).toEqual({
			kind: "commit",
			target: {
				owner: "JHUCities",
				repo: "bas-question-bank",
				branch: "qretools/iain",
				defaultBranch: "main",
			},
			changes: [
				{
					id: 1,
					path: "questions/svy/nhd_sat.yaml",
					expected: null,
					text: "name: nhd_sat\n",
				},
				{ path: "questions/nhd/nhd_sat.yaml", expected: "s", text: null },
			],
			message: "Move nhd_sat to questions/svy",
		});
	});

	it("after the commit the file keeps its edits, its base moves, GitHub's copy moves, and the link is replaced", () => {
		const m = { ...edited(), screen: { kind: "editing" as const, id: 1 } };
		const [done, cmds] = update(m, {
			kind: "committed",
			changes: [
				{
					id: 1,
					path: "questions/svy/nhd_sat.yaml",
					expected: null,
					text: "name: nhd_sat\n",
				},
				{ path: "questions/nhd/nhd_sat.yaml", expected: "s", text: null },
			],
			result: ok({ shas: { "questions/svy/nhd_sat.yaml": "s" } }),
		});
		expect(done.local.questions[1]).toMatchObject({
			source: "name: nhd_sat\nnote: unsaved\n",
			base: { path: "questions/svy/nhd_sat.yaml", sha: "s" },
		});
		expect(Object.keys(done.remote.questions)).toEqual([
			"questions/svy/nhd_sat.yaml",
		]);
		expect(cmds.find((c) => c.kind === "setLink")).toMatchObject({
			push: false,
		});
	});

	it("refuses locally: a conflict, the same folder, a malformed or taken folder", () => {
		const m = edited();
		const q = m.local.questions[1] as Question;
		expect(moveProblem(m, q, "nhd")).toMatch(/already in that folder/);
		expect(moveProblem(m, q, "Not A Folder")).toMatch(/topic folder/);
		const clash = withBank(m, [
			bankQuestion(2, "questions/svy/nhd_sat.yaml", "name: x\n"),
		]);
		expect(
			moveProblem(clash, clash.local.questions[1] as Question, "svy"),
		).toMatch(/taken/);
		const moved: Model = {
			...m,
			remote: {
				...m.remote,
				questions: {
					"questions/nhd/nhd_sat.yaml": { sha: "theirs", text: "x" },
				},
			},
		};
		const [asked] = update(moved, {
			kind: "moveRequested",
			id: 1,
			folder: "svy",
		});
		const [refused, cmds] = update(asked, { kind: "moveConfirmed" });
		expect(cmds).toEqual([]);
		expect(refused.activity[1]?.kind).toBe("failed");
	});

	it("only the folder changes, never the filename", () => {
		expect(movedPath("questions/svy/dem_latx.yaml", "dem")).toBe(
			"questions/dem/dem_latx.yaml",
		);
	});
});
