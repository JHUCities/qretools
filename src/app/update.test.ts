import { describe, expect, it } from "vitest";
import { evaluate } from "../core/evaluate.js";
import { locate } from "../core/findings.js";
import { ok } from "../core/result.js";
import { toDiagnostics } from "./diagnostics.js";
import {
	DEFAULT_SETTINGS,
	type Id,
	init,
	type Model,
	type Msg,
} from "./model.js";
import { update } from "./update.js";

const fresh = (): Model => init({ stored: ok(undefined), hasToken: false })[0];
const run = (model: Model, ...msgs: Msg[]) =>
	msgs.reduce<ReturnType<typeof update>>(
		([m], msg) => update(m, msg),
		[model, []],
	);
const connected = (model: Model, canWrite = true): Model => ({
	...model,
	session: { kind: "connected", login: "iain", canWrite },
});
const firstId = (model: Model): Id => Number(Object.keys(model.questions)[0]);

describe("init", () => {
	it("starts with an empty list on first run, and asks for the DDI schema", () => {
		const [model, cmds] = init({ stored: ok(undefined), hasToken: false });
		expect(Object.keys(model.questions)).toHaveLength(0);
		expect(model.screen).toEqual({ kind: "list", text: "" });
		expect(cmds).toEqual([{ kind: "loadDdiSchema" }]);
	});

	it("restores saved work, and starts connecting when a token is on hand", () => {
		const stored = {
			version: 1 as const,
			nextId: 9,
			questions: [
				{
					id: 3,
					source: "name: q\n",
					origin: {
						kind: "bank" as const,
						path: "questions/q/q.yaml",
						sha: "abc",
						original: "name: q\n",
					},
				},
			],
			settings: { ...DEFAULT_SETTINGS, branch: "sandbox" },
		};
		const [model, cmds] = init({ stored: ok(stored), hasToken: true });
		expect(model.questions[3]?.origin).toEqual(stored.questions[0]?.origin);
		expect(model.nextId).toBe(9);
		expect(model.session.kind).toBe("connecting");
		expect(cmds.at(-1)).toEqual({ kind: "connect", settings: stored.settings });
	});

	it("keeps an unreadable store as a failure, not a crash", () => {
		const [model] = init({
			stored: { ok: false, error: { kind: "unreadable", message: "bad" } },
			hasToken: false,
		});
		expect(model.failures).toEqual([{ kind: "unreadable", message: "bad" }]);
		expect(Object.keys(model.questions)).toHaveLength(0);
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
		expect(m2.questions[1]?.source).toBe("name: q2\n");
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
		expect(Object.keys(m.questions)).toHaveLength(2);
		expect(m.screen.kind).toBe("list");
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

	it("writes a new draft to the path its name implies, with a core commit message", () => {
		const [m, cmds] = update(connected(draftModel()), {
			kind: "saveRequested",
			id: 1,
		});
		expect(m.questions[1]?.activity).toEqual({ kind: "saving" });
		expect(cmds).toEqual([
			{
				kind: "writeFile",
				id: 5,
				settings: DEFAULT_SETTINGS,
				path: "questions/nhd/nhd_new.yaml",
				text: m.questions[1]?.source,
				message: "Add nhd_new",
			},
		]);
	});

	it("refuses to save a draft over a bank question of the same name", () => {
		const base = draftModel();
		const m0: Model = {
			...connected(base),
			questions: {
				...base.questions,
				9: {
					id: 9,
					source: "name: nhd_new\n",
					origin: {
						kind: "bank",
						path: "questions/nhd/nhd_new.yaml",
						sha: "s",
						original: "name: nhd_new\n",
					},
					activity: { kind: "idle" },
				},
			},
		};
		const [m, cmds] = update(m0, { kind: "saveRequested", id: 1 });
		expect(cmds).toEqual([]);
		expect(
			m.questions[1]?.activity.kind === "failed" &&
				m.questions[1].activity.failure.message,
		).toMatch(/already exists/);
	});

	it("refuses a draft without a valid name, as a failure on the question", () => {
		const [m0] = update(fresh(), {
			kind: "questionCreated",
			text: "text: Q?\n",
		});
		const [m, cmds] = update(connected(m0), { kind: "saveRequested", id: 1 });
		expect(cmds).toEqual([]);
		expect(m.questions[1]?.activity.kind).toBe("failed");
	});

	it("a finished save makes the question a bank file at the text that was written", () => {
		const [m1] = update(connected(draftModel()), {
			kind: "saveRequested",
			id: 1,
		});
		const [m2, cmds] = update(m1, {
			kind: "saveFinished",
			id: 1,
			path: "questions/nhd/nhd_new.yaml",
			text: m1.questions[1]?.source ?? "",
			result: ok({ sha: "new" }),
		});
		expect(m2.questions[1]?.origin).toEqual({
			kind: "bank",
			path: "questions/nhd/nhd_new.yaml",
			sha: "new",
			original: m1.questions[1]?.source,
		});
		expect(cmds.at(-1)?.kind).toBe("persist");
	});

	it("a bank question saves to its opened path with its sha, and a stale answer is a failure with the reload path", () => {
		const bank: Model = {
			...connected(fresh()),
			questions: {
				1: {
					id: 1,
					source: "name: nhd_sat\ntext: New?\n",
					origin: {
						kind: "bank",
						path: "questions/svy/nhd_sat.yaml",
						sha: "s1",
						original: "name: nhd_sat\ntext: Old?\n",
					},
					activity: { kind: "idle" },
				},
			},
		};
		const [, cmds] = update(bank, { kind: "saveRequested", id: 1 });
		expect(cmds[0]).toMatchObject({
			kind: "writeFile",
			path: "questions/svy/nhd_sat.yaml",
			sha: "s1",
			message: "Update nhd_sat: text",
		});
		const [m2] = update(bank, {
			kind: "saveFinished",
			id: 1,
			path: "questions/svy/nhd_sat.yaml",
			text: "x",
			result: { ok: false, error: { kind: "stale", message: "changed" } },
		});
		expect(m2.questions[1]?.activity).toEqual({
			kind: "failed",
			failure: { kind: "stale", message: "changed" },
		});
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
		expect(m1.screen).toMatchObject({ kind: "list", confirmDelete: id });
		const [m2, c2] = update(m1, { kind: "deleteRequested", id });
		expect(m2.questions[id]).toBeUndefined();
		expect(c2.at(-1)?.kind).toBe("persist");
	});

	it("never deletes from the bank without write access", () => {
		const m: Model = {
			...connected(fresh(), false),
			questions: {
				1: {
					id: 1,
					source: "name: q\n",
					origin: {
						kind: "bank",
						path: "questions/q/q.yaml",
						sha: "s",
						original: "name: q\n",
					},
					activity: { kind: "idle" },
				},
			},
		};
		const [, cmds] = run(
			m,
			{ kind: "deleteRequested", id: 1 },
			{ kind: "deleteRequested", id: 1 },
		);
		expect(cmds).toEqual([]);
	});
});

describe("connecting", () => {
	it("connect, then load the bank, then merge it and take its scales", () => {
		const [m1, c1] = update(fresh(), {
			kind: "connectRequested",
			settings: { ...DEFAULT_SETTINGS, branch: "sandbox" },
		});
		expect(m1.session.kind).toBe("connecting");
		expect(c1[0]).toEqual({
			kind: "connect",
			settings: { ...DEFAULT_SETTINGS, branch: "sandbox" },
		});
		const [m2, c2] = update(m1, {
			kind: "connected",
			result: ok({ login: "iain", canWrite: true }),
		});
		expect(m2.bank.kind).toBe("loading");
		expect(c2[0]?.kind).toBe("loadBank");
		const [m3] = update(m2, {
			kind: "bankLoaded",
			result: ok({
				questions: [
					{ path: "questions/nhd/nhd_x.yaml", sha: "a", text: "name: nhd_x\n" },
				],
				scales: [
					{
						path: "scales/agree4.yaml",
						sha: "b",
						text: "labels:\n  1: Yes\n  2: No\n",
					},
					{ path: "scales/bad.yaml", sha: "c", text: "labels: [\n" },
				],
			}),
		});
		expect(
			Object.values(m3.questions).some(
				(q) =>
					q.origin.kind === "bank" &&
					q.origin.path === "questions/nhd/nhd_x.yaml",
			),
		).toBe(true);
		expect(Object.keys(m3.scales)).toEqual(["agree4"]);
		expect(
			m3.bank.kind === "loaded" && m3.bank.scaleFindings.map((s) => s.name),
		).toEqual(["bad"]);
	});

	it("disconnecting forgets the token and returns to the bundled scales", () => {
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
			const ev = evaluate(source, "org.example", {});
			for (const d of toDiagnostics(ev.findings, ev.ranges)) {
				expect(d.from).toBeLessThanOrEqual(d.to);
				expect(d.to).toBeLessThanOrEqual(source.length);
			}
		}
		const ev = evaluate("name: q\n", "org.example", {});
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
