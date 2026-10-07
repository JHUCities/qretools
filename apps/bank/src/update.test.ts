import { EMPTY_ENV, evaluate, ok } from "@qretools/core";
import { locate } from "@qretools/core/editor";
import { describe, expect, it } from "vitest";
import { toDiagnostics } from "./diagnostics.js";
import { createEvaluations } from "./evaluations.js";
import { formatLink } from "./link.js";
import {
	allFiles,
	envOf,
	fileOf,
	type Id,
	init,
	type Model,
	type Msg,
	type Question,
	remoteOfBases,
	type SchemeEntry,
	toWork,
	warnOnLeave,
} from "./model.js";
import type { File } from "./storage.js";
import { remoteBlob, syncOf } from "./sync.js";
import {
	bankLoading,
	branchOwner,
	movedPath,
	moveProblem,
	ownBranch,
	schemeNameProblem,
	sessionStatus,
	signOutPlan,
	update,
	writeBlocked,
} from "./update.js";

const fresh = (): Model =>
	init({
		work: ok(undefined),
		hasToken: false,
		defaultBank: { owner: "JHUCities", repo: "bas-question-bank" },
	})[0];
const SETTINGS = { owner: "octo-org", repo: "survey-bank", remember: false };
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
		avatarUrl: "https://a/iain",
		access: canWrite ? { kind: "write" } : { kind: "readOnly" },
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
		const [model, cmds] = init({ work: ok(undefined), hasToken: false });
		expect(Object.keys(model.local.questions)).toHaveLength(0);
		expect(model.screen).toEqual({ kind: "blank" });
		expect(cmds).toEqual([{ kind: "loadDdiSchema" }]);
	});

	it("restores saved work, and starts connecting when a token is on hand", () => {
		const stored = {
			version: 5 as const,
			repo: "JHUCities/bas-question-bank",
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
		};
		const [model, cmds] = init({ work: ok(stored), hasToken: true });
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

	it("offers the build's default bank when nothing is stored, and an empty field without one", () => {
		const bank = { owner: "octo-org", repo: "bank-template" };
		const [offered] = init({
			work: ok(undefined),
			hasToken: false,
			defaultBank: bank,
		});
		expect(offered.settings).toEqual({ ...bank, remember: false });
		const [empty] = init({ work: ok(undefined), hasToken: false });
		expect(empty.settings).toEqual({ owner: "", repo: "", remember: false });
	});

	it("keeps an unreadable store as a failure, not a crash", () => {
		const [model] = init({
			work: { ok: false, error: { kind: "unreadable", message: "bad" } },
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
			text: "name: q\ntext:\nintent: i\nopen: {}\n",
		});
		const [, cmds] = update(m, {
			kind: "locationClicked",
			target: { path: "text", severity: "hole" },
		});
		const cmd = cmds[0];
		expect(
			cmd?.kind === "revealRange" &&
				"name: q\ntext:\nintent: i\nopen: {}\n".slice(
					cmd.range[0],
					cmd.range[1],
				),
		).toBe("text:");
		expect(cmd?.kind === "revealRange" && cmd.complete).toBeFalsy();
	});

	it("a hole at an empty value is a point: the caret goes there and completion opens", () => {
		const text = "name: q\ntext: Hi\nintent: i\nopen:\n";
		const [m] = update(fresh(), { kind: "questionCreated", text });
		const at = text.indexOf("open:") + "open:".length;
		const [, cmds] = update(m, {
			kind: "locationClicked",
			target: { path: "open", severity: "hole", range: [at, at] },
		});
		expect(cmds[0]).toEqual({
			kind: "revealRange",
			range: [at, at],
			complete: true,
		});
		// A field not written at all has no place of its own: the end of the text, no completion.
		const [, absent] = update(m, {
			kind: "locationClicked",
			target: { path: "", severity: "hole" },
		});
		expect(absent[0]).toEqual({
			kind: "revealRange",
			range: [text.length, text.length],
		});
	});

	it("a missing space's fix adds it and puts the caret after it", () => {
		const text = "name: q\ntext: Hi\nintent: i\nopen:{}\n";
		const [m] = update(fresh(), { kind: "questionCreated", text });
		const [next, cmds] = update(m, {
			kind: "fixApplied",
			id: 1,
			fix: { kind: "space", label: "x", path: "open:{}", word: "open" },
		});
		expect(next.local.questions[1]?.source).toBe(
			"name: q\ntext: Hi\nintent: i\nopen: {}\n",
		);
		const after = text.indexOf("open:") + "open: ".length;
		expect(cmds[0]).toEqual({ kind: "revealRange", range: [after, after] });
	});

	it("an unquoted code's fix quotes it, in a question or a shared file, caret after it", () => {
		const text =
			'name: q\ntext: Hi\nintent: i\nresponses:\n  010: a\n  "2": b\n';
		const [m] = update(fresh(), { kind: "questionCreated", text });
		const fix = {
			kind: "quote",
			label: "Quote `010`",
			path: "responses.010",
			code: "010",
		} as const;
		const [next, cmds] = update(m, { kind: "fixApplied", id: 1, fix });
		expect(next.local.questions[1]?.source).toBe(
			'name: q\ntext: Hi\nintent: i\nresponses:\n  "010": a\n  "2": b\n',
		);
		const after = text.indexOf("010") + '"010"'.length;
		expect(cmds[0]).toEqual({ kind: "revealRange", range: [after, after] });

		const [opened] = update(fresh(), {
			kind: "schemeCreateOpened",
			scheme: "missing",
		});
		const [edited] = update(opened, {
			kind: "edited",
			text: "labels:\n  -8: Refused\n",
		});
		const id = Number(Object.keys(edited.local.schemes)[0]);
		const [quoted] = update(edited, {
			kind: "fixApplied",
			id,
			fix: {
				kind: "quote",
				label: "Quote `-8`",
				path: "labels.-8",
				code: "-8",
			},
		});
		expect(quoted.local.schemes[id]?.source).toBe('labels:\n  "-8": Refused\n');
	});
});

describe("a quick fix", () => {
	const opened = () =>
		update(fresh(), {
			kind: "questionCreated",
			text: "name: q\nnumber:\n  unit: Days\n",
		})[0];
	const fix = {
		kind: "edit" as const,
		label: "Use `days`",
		edits: [{ path: "number.unit", value: "days" }],
	};

	it("rewrites the open question's text, and only its slice of the Model", () => {
		const m = opened();
		const [next, cmds] = update(m, { kind: "fixApplied", id: 1, fix });
		expect(next.local.questions[1]?.source).toBe(
			"name: q\nnumber:\n  unit: days\n",
		);
		expect(next.local.schemes).toBe(m.local.schemes);
		expect(next.remote).toBe(m.remote);
		expect(cmds.at(-1)?.kind).toBe("persist");
		// Focus follows the change: the caret where the edit starts.
		const at = "name: q\nnumber:\n  ".length;
		expect(cmds[0]).toEqual({ kind: "revealRange", range: [at, at] });
	});

	it("leaves focus to the name dialog when the fix creates a shared entry", () => {
		const m = update(fresh(), {
			kind: "questionCreated",
			text: "name: q\nconcept: Racial identification\n",
		})[0];
		const create = {
			kind: "create" as const,
			label: "Make it a shared concept `racial_identification`",
			create: {
				scheme: "concept" as const,
				name: "racial_identification",
				text: "Racial identification",
				path: "concept",
			},
		};
		const [, cmds] = update(m, { kind: "fixApplied", id: 1, fix: create });
		expect(cmds.some((c) => c.kind === "revealRange")).toBe(false);
	});

	it("does nothing when its place is gone, or no file is open", () => {
		const m = opened();
		const gone = { ...fix, edits: [{ path: "universe", value: "x" }] };
		expect(update(m, { kind: "fixApplied", id: 1, fix: gone })[0]).toBe(m);
		const closed = update(m, { kind: "listOpened" })[0];
		expect(update(closed, { kind: "fixApplied", id: 1, fix })[0]).toBe(closed);
	});
});

describe("saving", () => {
	const draftModel = () =>
		update(fresh(), {
			kind: "questionCreated",
			text: "name: nhd_new\ntext: Q?\nintent: Prevalence of a thing\nopen: {}\n",
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

	it("asks where a new draft goes, with no folder guessed from its name, and writes nothing yet", () => {
		const [m, cmds] = update(connected(draftModel()), {
			kind: "saveRequested",
			id: 1,
		});
		expect(cmds).toEqual([]);
		// The draft is named nhd_new: no folder is read into the prefix.
		expect(m.browser.saving).toEqual({ id: 1, folder: "" });
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
					branch: "qretools-iain",
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
		const [asked] = run(
			m0,
			{ kind: "saveRequested", id: 1 },
			{ kind: "saveFolderChanged", folder: "nhd" },
		);
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
			settings: SETTINGS,
		});
		expect(m1.session.kind).toBe("connecting");
		expect(c1.find((c) => c.kind === "connect")).toEqual({
			kind: "connect",
			repo: { owner: "octo-org", repo: "survey-bank" },
		});
		const [m2, c2] = update(m1, {
			kind: "connected",
			result: ok({
				login: "iain",
				avatarUrl: "https://a/iain",
				access: { kind: "write" },
				defaultBranch: "main",
			}),
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
		const [m] = update(connected(fresh()), {
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
		expect(cmds).toContainEqual({ kind: "forgetToken" });
	});

	it("signed out, only the author's own work stays: drafts and unsaved edits", () => {
		const m = {
			...withBank(connected(fresh()), [
				bankQuestion(1, "questions/q/clean.yaml", "name: clean\n"),
				bankQuestion(
					2,
					"questions/q/edited.yaml",
					"name: edited\n",
					"name: e2\n",
				),
			]),
			nextId: 3,
			screen: { kind: "editing" as const, id: 1 },
			cursor: { id: 1, offset: 3 },
		};
		const [draft] = update(m, { kind: "questionCreated", text: "name: d\n" });
		const [out, cmds] = update(draft, { kind: "disconnected" });
		expect(Object.keys(out.local.questions).sort()).toEqual(["2", "3"]);
		// GitHub's copy is what the kept bases record; nothing points at a dropped file.
		expect(Object.keys(out.remote.questions)).toEqual([
			"questions/q/edited.yaml",
		]);
		expect(out.screen).toEqual({ kind: "blank" });
		expect(out.cursor).toBeUndefined();
		expect(cmds.some((c) => c.kind === "persist")).toBe(true);
	});

	it("a reply from GitHub after signing out is ignored", () => {
		const [out] = update(connected(fresh()), { kind: "disconnected" });
		const [after, cmds] = update(out, {
			kind: "bankLoaded",
			result: loadOf([
				{ path: "questions/q/q.yaml", sha: "s", text: "name: q\n" },
			]),
		});
		expect(after).toBe(out);
		expect(cmds).toEqual([]);
		expect(
			update(out, {
				kind: "connected",
				result: ok({
					login: "iain",
					avatarUrl: "https://a/iain",
					access: { kind: "write" },
					defaultBranch: "main",
				}),
			})[0],
		).toBe(out);
	});

	it("starting without a sign-in forgets the bank's clean copies too", () => {
		const stored = toWork(
			withBank(fresh(), [
				bankQuestion(1, "questions/q/clean.yaml", "name: clean\n"),
				bankQuestion(2, "questions/q/edited.yaml", "name: edited\n", "x\n"),
			]),
		);
		const [m, cmds] = init({ work: ok(stored), hasToken: false });
		expect(Object.keys(m.local.questions)).toEqual(["2"]);
		expect(cmds.some((c) => c.kind === "persist")).toBe(true);
		const [kept] = init({ work: ok(stored), hasToken: true });
		expect(Object.keys(kept.local.questions)).toHaveLength(2);
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
			const ev = evaluate(source, EMPTY_ENV);
			for (const d of toDiagnostics(ev.findings, ev.ranges)) {
				expect(d.from).toBeLessThanOrEqual(d.to);
				expect(d.to).toBeLessThanOrEqual(source.length);
			}
		}
		const ev = evaluate("name: q\n", EMPTY_ENV);
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
		expect(asked.browser.naming).toEqual({
			kind: "scale",
			name: "",
			text: "",
			purpose: { kind: "create" },
		});
		expect(schemeNameProblem(asked, "scale", "")).toMatch(/name/);
		expect(schemeNameProblem(asked, "scale", "Agree 5")).toMatch(
			/Lowercase letters, digits and underscores/,
		);
		// Confirming an unusable name does nothing.
		expect(update(asked, { kind: "schemeNamingConfirmed" })[0]).toBe(asked);
		const [made] = run(
			asked,
			{ kind: "schemeNameChanged", name: "agree5" },
			{ kind: "schemeNamingConfirmed" },
		);
		const id = firstId(made);
		expect(made.local.schemes[id]).toMatchObject({
			kind: "scale",
			name: "agree5",
		});
		expect(made.local.schemes[id]?.base).toBeUndefined();
		expect(made.screen).toEqual({ kind: "editing", id });
		expect(made.browser.naming).toBeUndefined();
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
			{ kind: "schemeNamingConfirmed" },
		);
		const id = firstId(made);
		const [, cmds] = update(made, { kind: "saveRequested", id });
		expect(cmds[0]).toMatchObject({
			kind: "commit",
			changes: [{ path: "universes/renters.yaml", expected: null }],
			message: "Add shared universe renters",
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
			message: "Delete shared universe renters",
		});
	});
});

describe("the environment's identity", () => {
	const loaded = update(connected(fresh()), {
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
		expect(writeBlocked(m)).toMatch(/Loading the bank/);
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
			{ kind: "schemeNamingConfirmed" },
		);
		const env = envOf(m.local.schemes, m.remote.schemes);
		expect(Object.keys(env.scales)).toContain("agree4");
	});
});

describe("the author's own branch", () => {
	it("saves always go to qretools-<login>, resolved on connecting, and the bank loads from it", () => {
		const [m, cmds] = update(
			{ ...fresh(), session: { kind: "connecting" } },
			{
				kind: "connected",
				result: ok({
					login: "iain",
					avatarUrl: "https://a/iain",
					access: { kind: "write" },
					defaultBranch: "main",
				}),
			},
		);
		expect(m.session).toMatchObject({
			defaultBranch: "main",
		});
		expect(cmds[0]).toEqual({
			kind: "loadBank",
			target: {
				owner: "JHUCities",
				repo: "bas-question-bank",
				branch: "qretools-iain",
				defaultBranch: "main",
			},
		});
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
		expect(after[0]).toMatchObject({ target: { branch: "qretools-iain" } });
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
		expect(m.browser.naming).toMatchObject({
			kind: "universe",
			name: "renters",
		});
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
			/With:\n- Update shared scale yn/,
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

describe("the open file's folder", () => {
	const loadedBank = () =>
		withBank(connected(fresh()), [
			bankQuestion(1, "questions/q/q1.yaml", "name: q1\n"),
			bankQuestion(2, "questions/q/q2.yaml", "name: q2\n"),
			bankQuestion(3, "questions/r/r.yaml", "name: r\n"),
		]);
	const expanded = (m: Model) => m.browser.expanded;

	it("opens when a file opens, and closes when the user closes it, the file still open", () => {
		const [opened] = update(loadedBank(), { kind: "fileOpened", id: 1 });
		expect(expanded(opened)).toEqual(["q"]);
		const [closed] = update(opened, { kind: "folderToggled", folder: "q" });
		expect(closed.screen).toEqual({ kind: "editing", id: 1 });
		expect(expanded(closed)).toEqual([]);
		// Typing in the open file leaves it closed.
		const [typed] = update(closed, { kind: "edited", text: "name: q1x\n" });
		expect(expanded(typed)).toEqual([]);
	});

	it("opens again when another file opens, in the same folder or another", () => {
		const [closed] = run(
			loadedBank(),
			{ kind: "fileOpened", id: 1 },
			{ kind: "folderToggled", folder: "q" },
		);
		expect(expanded(update(closed, { kind: "fileOpened", id: 2 })[0])).toEqual([
			"q",
		]);
		expect(expanded(update(closed, { kind: "fileOpened", id: 3 })[0])).toEqual([
			"r",
		]);
	});

	it("is not added twice", () => {
		const [m] = run(
			loadedBank(),
			{ kind: "fileOpened", id: 1 },
			{ kind: "fileOpened", id: 2 },
		);
		expect(expanded(m)).toEqual(["q"]);
	});
});

describe("links", () => {
	const hashFor = (file?: string, branch = "qretools-iain") =>
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
			hash: hashFor("questions/q/q.yaml", "qretools-alice"),
		});
		expect(m.screen).toEqual({
			kind: "foreign",
			branch: "qretools-alice",
			path: "questions/q/q.yaml",
		});
		expect(cmds[0]).toMatchObject({
			kind: "readAt",
			path: "questions/q/q.yaml",
		});
		const [theirs] = update(m, {
			kind: "foreignLoaded",
			branch: "qretools-alice",
			path: "questions/q/q.yaml",
			result: ok({
				file: {
					path: "questions/q/q.yaml",
					sha: "other",
					text: "name: q\nnote: hers\n",
				},
				schemes: [
					{ path: "scales/yn.yaml", sha: "t", text: "labels:\n  1: Theirs\n" },
				],
			}),
		});
		expect(theirs.screen).toMatchObject({
			kind: "foreign",
			file: { sha: "other" },
			// Their question reads against their branch's shared files.
			schemes: { "scales/yn.yaml": { sha: "t" } },
		});
		const [same] = update(m, {
			kind: "foreignLoaded",
			branch: "qretools-alice",
			path: "questions/q/q.yaml",
			result: ok({
				file: { path: "questions/q/q.yaml", sha: "s", text: "name: q\n" },
				schemes: [],
			}),
		});
		expect(same.screen).toEqual({ kind: "editing", id: 1 });
	});

	it("signed out, a link to another repository waits: the sign-in form offers it", () => {
		const [m] = update(fresh(), {
			kind: "hashChanged",
			hash: formatLink({ repo: "other/bank", branch: "main" }),
		});
		expect(m.failures).toEqual([]);
		expect(m.pendingLink).toMatchObject({ repo: "other/bank" });
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

	const move = (m: Model, folder = "svy") =>
		update(update(m, { kind: "moveRequested", id: 1, folder })[0], {
			kind: "moveConfirmed",
		});
	const target = {
		owner: "JHUCities",
		repo: "bas-question-bank",
		branch: "qretools-iain",
		defaultBranch: "main",
	};

	it("also saves: the current text at the new path, and the old path gone, in one commit", () => {
		const [asked] = update(edited(), { kind: "moveRequested", id: 1 });
		expect(asked.browser.moving).toEqual({ id: 1, folder: "nhd" });
		const [chosen] = update(asked, {
			kind: "moveFolderChanged",
			folder: "svy",
		});
		const [, cmds] = update(chosen, { kind: "moveConfirmed" });
		expect(cmds[0]).toEqual({
			kind: "commit",
			target,
			changes: [
				{
					id: 1,
					path: "questions/svy/nhd_sat.yaml",
					expected: null,
					text: "name: nhd_sat\nnote: unsaved\n",
				},
				{ path: "questions/nhd/nhd_sat.yaml", expected: "s", text: null },
			],
			message: "Move nhd_sat to svy and update note",
		});
	});

	it("a question moved unchanged says only that it moved", () => {
		const m = withBank(connected(fresh()), [
			bankQuestion(1, "questions/nhd/nhd_sat.yaml", "name: nhd_sat\n"),
		]);
		const [, cmds] = move(m);
		expect(cmds[0]).toMatchObject({
			kind: "commit",
			changes: [
				{ path: "questions/svy/nhd_sat.yaml", expected: null },
				{ path: "questions/nhd/nhd_sat.yaml", expected: "s", text: null },
			],
			message: "Move nhd_sat to svy",
		});
	});

	const withScale = (m: Model, remoteText?: string): Model => {
		const yn: SchemeEntry = {
			kind: "scale",
			id: 10,
			name: "yn",
			source: "labels:\n  1: Yes\n  2: No\n",
			base: {
				path: "scales/yn.yaml",
				sha: "s-yn",
				text: "labels:\n  1: Yes\n",
			},
		};
		const local = { ...m.local, schemes: { 10: yn } };
		const remote = remoteOfBases(local);
		return {
			...m,
			local,
			remote:
				remoteText === undefined
					? remote
					: {
							...remote,
							schemes: {
								"scales/yn.yaml": { sha: "theirs", text: remoteText },
							},
						},
		};
	};
	const naming = () =>
		withBank(connected(fresh()), [
			bankQuestion(
				1,
				"questions/nhd/nhd_sat.yaml",
				"name: nhd_sat\nresponses: yn\n",
			),
		]);

	it("takes along an unsaved scale the question names, listed under With:", () => {
		const [m, cmds] = move(withScale(naming()));
		const cmd = cmds[0];
		expect(
			cmd?.kind === "commit" &&
				cmd.changes.map((c) => [c.id, c.path, c.expected, c.text === null]),
		).toEqual([
			[1, "questions/svy/nhd_sat.yaml", null, false],
			[10, "scales/yn.yaml", "s-yn", false],
			[undefined, "questions/nhd/nhd_sat.yaml", "s", true],
		]);
		expect(cmd?.kind === "commit" && cmd.message).toBe(
			"Move nhd_sat to svy\n\nWith:\n- Update shared scale yn",
		);
		expect(m.activity[10]).toEqual({ kind: "saving" });
	});

	it("a named scale GitHub also changed stops the move before any request, naming it", () => {
		const [refused, cmds] = move(withScale(naming(), "labels:\n  1: Y\n"));
		expect(cmds).toEqual([]);
		expect(
			refused.activity[1]?.kind === "failed" &&
				refused.activity[1].failure.message,
		).toMatch(/`yn`/);
	});

	it("a plain save of a bank file expects its base and deletes nothing", () => {
		const [, cmds] = update(edited(), { kind: "saveRequested", id: 1 });
		expect(cmds[0]).toMatchObject({
			kind: "commit",
			changes: [{ id: 1, path: "questions/nhd/nhd_sat.yaml", expected: "s" }],
		});
		expect(cmds[0]?.kind === "commit" && cmds[0].changes).toHaveLength(1);
	});

	it("after the commit the file is in sync at its new path, GitHub's copy moves, and the link is replaced", () => {
		const m = { ...edited(), screen: { kind: "editing" as const, id: 1 } };
		const [done, cmds] = update(m, {
			kind: "committed",
			changes: [
				{
					id: 1,
					path: "questions/svy/nhd_sat.yaml",
					expected: null,
					text: "name: nhd_sat\nnote: unsaved\n",
				},
				{ path: "questions/nhd/nhd_sat.yaml", expected: "s", text: null },
			],
			result: ok({ shas: { "questions/svy/nhd_sat.yaml": "s2" } }),
		});
		const q = done.local.questions[1] as Question;
		expect(q).toMatchObject({
			source: "name: nhd_sat\nnote: unsaved\n",
			base: {
				path: "questions/svy/nhd_sat.yaml",
				sha: "s2",
				text: "name: nhd_sat\nnote: unsaved\n",
			},
		});
		expect(syncOf(q, remoteBlob(done.remote, q))).toBe("inSync");
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
		expect(moveProblem(m, q, "Not A Folder")).toMatch(
			/Lowercase letters, digits, hyphens/,
		);
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

describe("links while connecting", () => {
	const link = formatLink({
		repo: "JHUCities/bas-question-bank",
		branch: "qretools-alice",
		file: "questions/q/q.yaml",
	});

	it("a link being opened keeps the address until it resolves, through connecting and loading", () => {
		const [waiting] = update(fresh(), { kind: "hashChanged", hash: link });
		expect(waiting.pendingLink).toBeDefined();
		const [connectedM, c1] = update(waiting, {
			kind: "connected",
			result: ok({
				login: "iain",
				avatarUrl: "https://a/iain",
				access: { kind: "write" },
				defaultBranch: "main",
			}),
		});
		expect(c1.some((c) => c.kind === "setLink")).toBe(false);
		const [, c2] = update(connectedM, {
			kind: "bankLoaded",
			result: loadOf([
				{ path: "questions/q/q.yaml", sha: "s", text: "name: q\n" },
			]),
		});
		// Alice's branch: opened read only, the address still names her branch.
		const setLink = c2.find((c) => c.kind === "setLink");
		expect(
			setLink === undefined ||
				(setLink.kind === "setLink" && setLink.hash === link),
		).toBe(true);
	});

	it("before the load, a link to another branch waits instead of opening your copy", () => {
		const m = {
			...withBank(connected(fresh()), [
				bankQuestion(1, "questions/q/q.yaml", "name: q\n"),
			]),
			loading: { kind: "loading" as const },
		};
		const [waiting] = update(m, { kind: "hashChanged", hash: link });
		expect(waiting.screen.kind).toBe("blank");
		expect(waiting.pendingLink).toMatchObject({ branch: "qretools-alice" });
		// Going back to the bank stops waiting: the link must not pull the author away later.
		expect(
			update(waiting, { kind: "listOpened" })[0].pendingLink,
		).toBeUndefined();
		const own = formatLink({
			repo: "JHUCities/bas-question-bank",
			branch: "qretools-iain",
			file: "questions/q/q.yaml",
		});
		expect(update(m, { kind: "hashChanged", hash: own })[0].screen).toEqual({
			kind: "editing",
			id: 1,
		});
	});
});

describe("signing in", () => {
	it("keeps the settings and leaves for GitHub", () => {
		const settings = { ...SETTINGS, remember: true };
		const [m, cmds] = update(fresh(), { kind: "signInRequested", settings });
		expect(m.session).toEqual({ kind: "connecting", toGitHub: true });
		expect(cmds.map((c) => c.kind)).toEqual([
			"saveSettings",
			"signIn",
			"persist",
		]);
		expect(cmds[0]).toEqual({ kind: "saveSettings", settings });
		expect(cmds[1]).toEqual({ kind: "signIn", remember: true });
	});

	it("a sign-in that has ended ends the session, whatever reply says so, and forgets the credentials", () => {
		const ended = {
			kind: "auth" as const,
			message: "Your GitHub sign-in has ended.",
		};
		const m = withBank(connected(fresh()), [
			bankQuestion(1, "questions/q/q.yaml", "name: q\n"),
		]);
		const [afterLoad, c1] = update(m, {
			kind: "bankLoaded",
			result: { ok: false, error: ended },
		});
		expect(afterLoad.session).toEqual({ kind: "failed", failure: ended });
		expect(c1).toContainEqual({ kind: "forgetToken" });
		// Only the author's own work stays (this bank question is unchanged).
		expect(afterLoad.local.questions).toEqual({});
		const [afterSave] = update(m, {
			kind: "committed",
			changes: [
				{ id: 1, path: "questions/q/q.yaml", expected: "s", text: "x" },
			],
			result: { ok: false, error: { failure: ended } },
		});
		expect(afterSave.session.kind).toBe("failed");
		expect(afterSave.activity).toEqual({});
	});

	it("a network failure leaves the session as it is", () => {
		const m = connected(fresh());
		const [after, cmds] = update(m, {
			kind: "bankLoaded",
			result: { ok: false, error: { kind: "network", message: "offline" } },
		});
		expect(after.session).toBe(m.session);
		expect(cmds).not.toContainEqual({ kind: "forgetToken" });
	});

	it("a bank that did not load says so, and nothing can be written", () => {
		const offline = { kind: "network" as const, message: "offline" };
		const [after] = update(connected(fresh()), {
			kind: "bankLoaded",
			result: { ok: false, error: offline },
		});
		expect(after.loading).toEqual({ kind: "failed", failure: offline });
		expect(writeBlocked(after)).toBeDefined();
		expect(sessionStatus(after)).toMatch(/didn't load: offline/);
	});

	it("trying again reloads the bank as the same session, without reconnecting", () => {
		const m = {
			...connected(fresh()),
			loading: {
				kind: "failed" as const,
				failure: { kind: "network" as const, message: "offline" },
			},
		};
		const [after, cmds] = update(m, { kind: "bankReloadRequested" });
		expect(after.session).toBe(m.session);
		expect(after.loading).toEqual({ kind: "loading" });
		expect(cmds).toEqual([
			{
				kind: "loadBank",
				target: {
					owner: "JHUCities",
					repo: "bas-question-bank",
					branch: "qretools-iain",
					defaultBranch: "main",
				},
			},
		]);
	});
});

describe("the app not installed on the repository", () => {
	it("blocks writing with its own reason, and a refused save says so", () => {
		const m = withBank(connected(fresh()), [
			bankQuestion(1, "questions/q/q.yaml", "name: q\n", "name: q\ntext: x\n"),
		]);
		const [after] = update(
			{ ...m, activity: { 1: { kind: "saving" } } },
			{
				kind: "committed",
				changes: [
					{ id: 1, path: "questions/q/q.yaml", expected: "s", text: "x" },
				],
				result: {
					ok: false,
					error: {
						failure: {
							kind: "notInstalled",
							message: "The app you signed in with isn't installed.",
						},
					},
				},
			},
		);
		expect(after.session).toMatchObject({ access: { kind: "notInstalled" } });
		expect(writeBlocked(after)).toMatch(/can't save to this bank/);
		expect(sessionStatus(after)).toMatch(/can't save to this bank/);
		expect(update(after, { kind: "saveRequested", id: 1 })[1]).toEqual([]);
	});
});

describe("the top bar's status", () => {
	it("gives a reason whenever writing is blocked, and is empty in the steady state", () => {
		const base = connected(fresh());
		const models: Model[] = [
			{ ...fresh(), session: { kind: "connecting" } },
			{ ...base, loading: { kind: "loading" } },
			{ ...base, loading: { kind: "bundled" } },
			{
				...base,
				loading: { kind: "failed", failure: { kind: "network", message: "x" } },
			},
			connected(fresh(), false),
			{
				...base,
				session: {
					...(base.session as Extract<Model["session"], { kind: "connected" }>),
					access: { kind: "notInstalled" },
				},
			},
			{ ...base, activity: { 1: { kind: "saving" } } },
			base,
		];
		for (const m of models)
			if (writeBlocked(m) !== undefined) expect(sessionStatus(m)).toBeDefined();
		expect(writeBlocked(base)).toBeUndefined();
		expect(sessionStatus(base)).toBeUndefined();
		expect(bankLoading(base)).toBe(false);
		expect(bankLoading({ ...base, loading: { kind: "loading" } })).toBe(true);
		expect(bankLoading({ ...fresh(), session: { kind: "connecting" } })).toBe(
			true,
		);
		// Someone else's file on its way is said there too, the one place loading is said.
		expect(
			sessionStatus({
				...base,
				screen: { kind: "foreign", branch: "qretools-alice", path: "q.yaml" },
			}),
		).toBe("Loading q.yaml from qretools-alice…");
		expect(
			sessionStatus({
				...connected(fresh(), false),
				screen: { kind: "foreign", branch: "qretools-alice", path: "q.yaml" },
			}),
		).toBe("Loading q.yaml from qretools-alice…");
	});
});

describe("a refused return from GitHub", () => {
	it("is only a message: an existing sign-in is kept and connects as usual", () => {
		const refused = {
			kind: "auth" as const,
			message: "This sign-in didn't start here, or has already been used.",
		};
		const [m, cmds] = init({
			work: ok(undefined),
			hasToken: true,
			signInFailure: refused,
		});
		expect(m.failures).toEqual([refused]);
		expect(m.session).toEqual({ kind: "connecting" });
		expect(cmds.map((c) => c.kind)).toContain("connect");
		expect(cmds.map((c) => c.kind)).not.toContain("forgetToken");
	});
});

describe("the author's own branch", () => {
	it("is named from the login, and read back from the name", () => {
		expect(branchOwner(ownBranch("iain"))).toBe("iain");
		expect(branchOwner("qretools-a-b")).toBe("a-b");
		expect(branchOwner("qretools-")).toBeUndefined();
		expect(branchOwner("main")).toBeUndefined();
		// The old slashed name is someone else's branch now.
		expect(branchOwner("qretools/iain")).toBeUndefined();
	});
});

describe("work belongs to this tab", () => {
	const who = (login: string) => ({
		kind: "connected" as const,
		result: ok({
			login,
			avatarUrl: `https://a/${login}`,
			access: { kind: "write" as const },
			defaultBranch: "main",
		}),
	});
	const withDraft = (m: Model): Model =>
		update(m, { kind: "questionCreated", text: "name: mine\n" })[0];

	it("starts in its own work's bank, and records who signed in with it", () => {
		const work = {
			version: 5 as const,
			repo: "a/bank",
			login: "iain",
			nextId: 1,
			questions: [],
			schemes: [],
		};
		const [m] = init({
			work: ok(work),
			settings: { owner: "x", repo: "y", remember: true },
			hasToken: false,
		});
		expect(m.settings).toEqual({ owner: "a", repo: "bank", remember: true });
		expect(m.author).toBe("iain");
		expect(toWork(m)).toEqual(work);
	});

	it("someone else signing in sets the work aside, said once, never dropped", () => {
		const mine = {
			...withDraft({ ...fresh(), session: { kind: "connecting" } }),
			author: "iain",
		};
		const [ann, cmds] = update(mine, who("Ann"));
		expect(ann.local.questions).toEqual({});
		expect(ann.author).toBe("Ann");
		expect(ann.failures.at(-1)?.message).toBe(
			"Unsaved work in this tab belonged to iain and was set aside.",
		);
		expect(cmds).toContainEqual({ kind: "setAside", work: toWork(mine) });
		// The same person, in other capitals, keeps it.
		const [same, sameCmds] = update(mine, who("IAIN"));
		expect(same.local).toBe(mine.local);
		expect(sameCmds.some((c) => c.kind === "setAside")).toBe(false);
	});

	it("signing in to another bank sets this tab's work aside; the same bank keeps it", () => {
		const mine = withDraft(fresh());
		const other = { owner: "b", repo: "bank", remember: false };
		const [away, cmds] = update(mine, {
			kind: "signInRequested",
			settings: other,
		});
		expect(away.local.questions).toEqual({});
		expect(away.settings).toEqual(other);
		expect(cmds).toContainEqual({ kind: "setAside", work: toWork(mine) });
		const [here, hereCmds] = update(mine, {
			kind: "signInRequested",
			settings: { ...mine.settings, remember: true },
		});
		expect(here.local).toBe(mine.local);
		expect(hereCmds.some((c) => c.kind === "setAside")).toBe(false);
	});
});

describe("leaving the page", () => {
	it("warns only while there is unsaved work, and not on the way to GitHub's sign-in", () => {
		const clean = withBank(connected(fresh()), [
			bankQuestion(1, "questions/q/q.yaml", "name: q\n"),
		]);
		expect(warnOnLeave(clean)).toBe(false);
		const edited = withBank(connected(fresh()), [
			bankQuestion(1, "questions/q/q.yaml", "name: q\n", "name: q2\n"),
		]);
		expect(warnOnLeave(edited)).toBe(true);
		const draft = update(fresh(), { kind: "questionCreated", text: "" })[0];
		expect(warnOnLeave(draft)).toBe(true);
		const [leaving] = update(draft, {
			kind: "signInRequested",
			settings: draft.settings,
		});
		expect(warnOnLeave(leaving)).toBe(false);
		// Signing in at startup (a token on hand) is not leaving.
		expect(warnOnLeave({ ...draft, session: { kind: "connecting" } })).toBe(
			true,
		);
	});
});

describe("signing out", () => {
	/** Connected and loaded: a clean question, an edited one, a question draft, a scale draft. */
	const holding = (): Model => {
		const m = withBank(connected(fresh()), [
			bankQuestion(1, "questions/q/clean.yaml", "name: clean\n"),
			bankQuestion(
				2,
				"questions/q/edited.yaml",
				"name: edited\n",
				"name: e2\n",
			),
		]);
		return {
			...m,
			local: {
				questions: {
					...m.local.questions,
					3: { kind: "question", id: 3, source: "name: draft\n" },
				},
				schemes: {
					4: { kind: "scale", name: "yn", id: 4, source: "labels:\n  1: Y\n" },
				},
			},
			nextId: 5,
		};
	};

	it("with no unsaved work is exactly signing out", () => {
		const clean = withBank(connected(fresh()), [
			bankQuestion(1, "questions/q/q.yaml", "name: q\n"),
		]);
		expect(update(clean, { kind: "signOutRequested" })).toEqual(
			update(clean, { kind: "disconnected" }),
		);
		const [out] = update(clean, { kind: "signOutRequested" });
		expect(out.session).toEqual({ kind: "anonymous" });
	});

	it("with unsaved work asks first, and Cancel stays signed in", () => {
		const m = holding();
		const [asking, cmds] = update(m, { kind: "signOutRequested" });
		expect(asking.browser.signingOut).toEqual({ phase: "asking" });
		expect(asking.session.kind).toBe("connected");
		expect(cmds).toEqual([]);
		const [back] = update(asking, { kind: "signOutCancelled" });
		expect(back.browser.signingOut).toBeUndefined();
		expect(back.session.kind).toBe("connected");
	});

	it("plans the save: edited files and new shared files; question drafts are discarded", () => {
		const plan = signOutPlan(holding());
		expect(plan.save.map((f) => f.id)).toEqual([2, 4]);
		expect(plan.discard.map((f) => f.id)).toEqual([3]);
		expect(plan.blocked).toEqual([]);
	});

	it("Discard signs out with nothing left in this tab", () => {
		const [asking] = update(holding(), { kind: "signOutRequested" });
		const [out, cmds] = update(asking, { kind: "signOutDiscardConfirmed" });
		expect(out.session).toEqual({ kind: "anonymous" });
		expect(allFiles(out.local)).toEqual([]);
		expect(out.browser.signingOut).toBeUndefined();
		expect(cmds).toContainEqual({ kind: "forgetToken" });
		expect(cmds).toContainEqual({ kind: "persist", work: toWork(out) });
	});

	it("Save commits every saveable file at once, then signs out", () => {
		const [asking] = update(holding(), { kind: "signOutRequested" });
		const [saving, cmds] = update(asking, { kind: "signOutSaveConfirmed" });
		expect(saving.browser.signingOut).toEqual({ phase: "saving" });
		const commit = cmds.find((c) => c.kind === "commit");
		if (commit?.kind !== "commit") throw new Error("expected a commit");
		expect(commit.target.branch).toBe(ownBranch("iain"));
		expect(commit.changes).toEqual([
			{
				id: 2,
				path: "questions/q/edited.yaml",
				expected: "s",
				text: "name: e2\n",
			},
			{
				id: 4,
				path: "scales/yn.yaml",
				expected: null,
				text: "labels:\n  1: Y\n",
			},
		]);
		// Cancel does nothing while the save is on its way.
		expect(update(saving, { kind: "signOutCancelled" })[0]).toBe(saving);
		const [out, after] = update(saving, {
			kind: "committed",
			changes: commit.changes,
			result: ok({
				shas: { "questions/q/edited.yaml": "n", "scales/yn.yaml": "y" },
			}),
		});
		expect(out.session).toEqual({ kind: "anonymous" });
		expect(allFiles(out.local)).toEqual([]);
		expect(after).toContainEqual({ kind: "forgetToken" });
	});

	it("a refused save stays signed in, the dialog says why, and the files show what GitHub has", () => {
		const [asking] = update(holding(), { kind: "signOutRequested" });
		const [saving, cmds] = update(asking, { kind: "signOutSaveConfirmed" });
		const commit = cmds.find((c) => c.kind === "commit");
		if (commit?.kind !== "commit") throw new Error("expected a commit");
		const failure = { kind: "stale" as const, message: "Changed on GitHub." };
		const [m] = update(saving, {
			kind: "committed",
			changes: commit.changes,
			result: {
				ok: false,
				error: {
					failure,
					seen: {
						"questions/q/edited.yaml": { sha: "theirs", text: "name: t\n" },
						"scales/yn.yaml": null,
					},
				},
			},
		});
		expect(m.session.kind).toBe("connected");
		expect(m.browser.signingOut).toEqual({ phase: "asking", failure });
		// The dialog reports, never a file.
		expect(m.activity).toEqual({});
		// The edited question is in conflict now: it blocks the next try until reloaded.
		expect(signOutPlan(m).blocked.map((f) => f.id)).toEqual([2]);
		const [still] = update(m, { kind: "signOutSaveConfirmed" });
		expect(still).toBe(m);
	});

	it("can't save while the bank is loading, but can still discard", () => {
		const [asking] = update(
			{ ...holding(), loading: { kind: "loading" } },
			{ kind: "signOutRequested" },
		);
		const [same, cmds] = update(asking, { kind: "signOutSaveConfirmed" });
		expect(same).toBe(asking);
		expect(cmds).toEqual([]);
		expect(
			update(asking, { kind: "signOutDiscardConfirmed" })[0].session.kind,
		).toBe("anonymous");
	});
});

describe("naming a shared file from a question", () => {
	const asked = (text: string) =>
		update(fresh(), { kind: "questionCreated", text })[0];

	it("creates a universe with its text and points the question at the name chosen, staying on it", () => {
		const m = asked("name: q\nuniverse: rent\n");
		const [done] = run(
			m,
			{
				kind: "schemeCreateOpened",
				scheme: "universe",
				name: "rent",
				use: { id: 1, path: "universe" },
			},
			{ kind: "schemeNameChanged", name: "renters" },
			{ kind: "schemeTextChanged", text: "Renters only" },
			{ kind: "schemeNamingConfirmed" },
		);
		expect(done.local.questions[1]?.source).toBe(
			"name: q\nuniverse: renters\n",
		);
		const made = Object.values(done.local.schemes)[0];
		expect(made).toMatchObject({
			kind: "universe",
			name: "renters",
			source: "text: Renters only\n",
		});
		expect(done.screen).toEqual({ kind: "editing", id: 1 });
		expect(done.browser.naming).toBeUndefined();
	});

	it("opens a new scale for its labels, after pointing the question at it", () => {
		const m = asked("name: q\nresponses: agr\n");
		const [done] = run(
			m,
			{
				kind: "schemeCreateOpened",
				scheme: "scale",
				name: "agr",
				use: { id: 1, path: "responses" },
			},
			{ kind: "schemeNameChanged", name: "agree4" },
			{ kind: "schemeNamingConfirmed" },
		);
		expect(done.local.questions[1]?.source).toBe(
			"name: q\nresponses: agree4\n",
		);
		const made = Object.values(done.local.schemes)[0];
		expect(done.screen).toEqual({ kind: "editing", id: made?.id });
	});
});

describe("renaming a draft shared file", () => {
	const drafted = () => {
		const [m] = run(
			fresh(),
			{ kind: "questionCreated", text: "name: a\nuniverse: rent\n" },
			{ kind: "questionCreated", text: "name: b\nuniverse: other\n" },
			{ kind: "schemeCreateOpened", scheme: "universe" },
			{ kind: "schemeNameChanged", name: "rent" },
			{ kind: "schemeNamingConfirmed" },
		);
		return m;
	};

	it("renames it and the questions in this tab that name it, touching no others", () => {
		const m = drafted();
		const id = Object.values(m.local.schemes)[0]?.id ?? -1;
		const [done] = run(
			m,
			{ kind: "schemeRenameOpened", id },
			{ kind: "schemeNameChanged", name: "renters" },
			{ kind: "schemeNamingConfirmed" },
		);
		expect(done.local.schemes[id]?.name).toBe("renters");
		expect(done.local.questions[1]?.source).toBe(
			"name: a\nuniverse: renters\n",
		);
		expect(done.local.questions[2]).toBe(m.local.questions[2]);
	});

	it("keeps its own name free (no change is not taken), and refuses a saved file", () => {
		const m = drafted();
		const e = Object.values(m.local.schemes)[0];
		if (!e) throw new Error("no file");
		const [same] = update(m, { kind: "schemeRenameOpened", id: e.id });
		expect(same.browser.naming?.name).toBe("rent");
		const saved = {
			...m,
			local: {
				...m.local,
				schemes: {
					[e.id]: {
						...e,
						base: { path: "universes/rent.yaml", sha: "s", text: e.source },
					},
				},
			},
		};
		expect(update(saved, { kind: "schemeRenameOpened", id: e.id })[0]).toBe(
			saved,
		);
	});
});

describe("making a concept shared from a question", () => {
	it("opens the name dialog prefilled from the words, then creates it and points the question at it", () => {
		const [m] = update(fresh(), {
			kind: "questionCreated",
			text: "name: q\nconcept: Racial identification\n",
		});
		const fix = {
			kind: "create" as const,
			label: "Make it a shared concept `racial_identification`",
			create: {
				scheme: "concept" as const,
				name: "racial_identification",
				text: "Racial identification",
				path: "concept",
			},
		};
		const [asked] = update(m, { kind: "fixApplied", id: 1, fix });
		expect(asked.browser.naming).toEqual({
			kind: "concept",
			name: "racial_identification",
			text: "Racial identification",
			purpose: { kind: "create", use: { id: 1, path: "concept" } },
		});
		const [done] = update(asked, { kind: "schemeNamingConfirmed" });
		expect(done.local.questions[1]?.source).toBe(
			"name: q\nconcept: racial_identification\n",
		);
		expect(Object.values(done.local.schemes)[0]).toMatchObject({
			kind: "concept",
			name: "racial_identification",
			source: "label: Racial identification\n",
		});
		expect(done.screen).toEqual({ kind: "editing", id: 1 });
	});
});

describe("the theme", () => {
	it("starts from the device's stored choice, else the system's", () => {
		expect(fresh().theme).toBe("system");
		expect(
			init({ work: ok(undefined), hasToken: false, theme: "dark" })[0].theme,
		).toBe("dark");
	});

	it("is shown and remembered when chosen, and only then", () => {
		const m = fresh();
		const [dark, cmds] = update(m, { kind: "themeChosen", theme: "dark" });
		expect(dark.theme).toBe("dark");
		expect(cmds).toEqual([{ kind: "applyTheme", theme: "dark" }]);
		expect(dark.local).toBe(m.local);
		expect(update(dark, { kind: "themeChosen", theme: "dark" })).toEqual([
			dark,
			[],
		]);
	});
});

describe("go to definition", () => {
	const withScale = () => {
		const [m] = run(
			fresh(),
			{ kind: "schemeCreateOpened", scheme: "scale" },
			{ kind: "schemeNameChanged", name: "agree4" },
			{ kind: "schemeNamingConfirmed" },
			{ kind: "questionCreated", text: "name: q\nresponses: agree4\n" },
		);
		return m;
	};

	it("opens the shared file the name at the offset names, as opening it would", () => {
		const m = withScale();
		const q = Object.values(m.local.questions)[0];
		const scale = Object.values(m.local.schemes)[0];
		if (!q || !scale) throw new Error("setup");
		const offset = q.source.indexOf("agree4") + 1;
		const [next] = update(m, { kind: "definitionRequested", id: q.id, offset });
		expect(next.screen).toEqual({ kind: "editing", id: scale.id });
	});

	it("does nothing off a name, for a name nothing has, or for a file not open", () => {
		const m = withScale();
		const q = Object.values(m.local.questions)[0];
		if (!q) throw new Error("setup");
		expect(
			update(m, { kind: "definitionRequested", id: q.id, offset: 2 })[0],
		).toBe(m);
		expect(
			update(m, { kind: "definitionRequested", id: q.id + 99, offset: 20 })[0],
		).toBe(m);
		const [edited] = update(m, {
			kind: "edited",
			text: "name: q\nresponses: nothing9\n",
		});
		expect(
			update(edited, { kind: "definitionRequested", id: q.id, offset: 22 })[0],
		).toBe(edited);
	});
});
