/**
 * Saving and deleting a workspace's own files: an instrument takes along what it reads
 * that isn't saved yet, so it never lands on the branch reading differently from how it
 * reads here; the workspace details save alone.
 */
import { fileURLToPath } from "node:url";
import { ok } from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { beforeAll, describe, expect, it } from "vitest";
import { createEvaluations } from "./evaluations.js";
import {
	type Cmd,
	type Entry,
	type InstrumentEntry,
	init,
	type Model,
	type Question,
} from "./model.js";
import {
	instrumentAlsoSaves,
	instrumentDependencies,
	signOutPlan,
	update,
} from "./update.js";

let files: Record<string, string>;
beforeAll(async () => {
	files = {
		...(await readWorkspace(
			fileURLToPath(
				new URL("../../../packages/core/fixtures", import.meta.url),
			),
		)),
		"workspace.yaml": "agency: org.example\n",
	};
});

/** Signed in, with the fixture workspace loaded from the author's branch. */
function loaded(): Model {
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
			files: Object.entries(files).map(([path, text]) => ({
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

const at = (m: Model, path: string): Entry => {
	const f = [
		...Object.values(m.local.questions),
		...Object.values(m.local.schemes),
		...Object.values(m.local.workspace),
	].find((e) => e.base?.path === path);
	if (f === undefined) throw new Error(`nothing at ${path}`);
	return f;
};
/** The working copy at `path` with a line added, as typing it would. */
const edit = (m: Model, path: string): Model => {
	const f = at(m, path);
	const changed = { ...f, source: `${f.source}# edited\n` };
	const slice =
		f.kind === "question"
			? "questions"
			: f.kind === "instrument" || f.kind === "workspaceFile"
				? "workspace"
				: "schemes";
	return {
		...m,
		local: { ...m.local, [slice]: { ...m.local[slice], [f.id]: changed } },
	};
};
const commitOf = (cmds: readonly Cmd[]) =>
	cmds.find((c): c is Extract<Cmd, { kind: "commit" }> => c.kind === "commit");
const save = (m: Model, path: string) =>
	update(m, { kind: "saveRequested", id: at(m, path).id });

const HOUSEHOLDS = "instruments/households.yaml";
const CONSENT = "households/questions/household/consent.yaml";
const YES_NO = "households/scales/yes_no.yaml";
const TENURE = "households/questions/household/tenure.yaml";

describe("saving an instrument", () => {
	it("takes along the questions it asks that have unsaved changes, and their shared files", () => {
		const m = edit(edit(edit(loaded(), HOUSEHOLDS), CONSENT), YES_NO);
		const commit = commitOf(save(m, HOUSEHOLDS)[1]);
		expect(commit?.changes.map((c) => c.path)).toEqual([
			HOUSEHOLDS,
			CONSENT,
			YES_NO,
		]);
		expect(commit?.message).toBe(
			"Update instrument households\n\nWith:\n- Update consent\n- Update shared scale yes_no",
		);
	});

	it("takes along an unsaved scale a saved question it asks names", () => {
		const m = edit(edit(loaded(), HOUSEHOLDS), YES_NO);
		expect(
			commitOf(save(m, HOUSEHOLDS)[1])?.changes.map((c) => c.path),
		).toEqual([HOUSEHOLDS, YES_NO]);
	});

	it("leaves out what it doesn't ask", () => {
		const m = edit(
			edit(loaded(), HOUSEHOLDS),
			"bank/questions/examples/library_visits.yaml",
		);
		expect(
			commitOf(save(m, HOUSEHOLDS)[1])?.changes.map((c) => c.path),
		).toEqual([HOUSEHOLDS]);
	});

	it("stops before any request when a question it asks changed on GitHub", () => {
		const m = edit(edit(loaded(), HOUSEHOLDS), TENURE);
		const changed: Model = {
			...m,
			remote: {
				...m.remote,
				questions: {
					...m.remote.questions,
					[TENURE]: { sha: "theirs", text: "name: tenure\n" },
				},
			},
		};
		const [refused, cmds] = save(changed, HOUSEHOLDS);
		expect(commitOf(cmds)).toBeUndefined();
		expect(refused.activity[at(m, HOUSEHOLDS).id]).toMatchObject({
			kind: "failed",
			failure: {
				message:
					"The question `tenure` this instrument asks changed on GitHub since you started.",
			},
		});
	});

	it("saves a new one at its name's path, unless one is there", () => {
		const m = loaded();
		const draft = (name: string): Model => {
			const e: InstrumentEntry = {
				kind: "instrument",
				name,
				id: m.nextId,
				source: `name: ${name}\n`,
			};
			return {
				...m,
				nextId: m.nextId + 1,
				local: {
					...m.local,
					workspace: { ...m.local.workspace, [e.id]: e },
				},
			};
		};
		const fresh = update(draft("wave2"), {
			kind: "saveRequested",
			id: m.nextId,
		});
		expect(commitOf(fresh[1])).toMatchObject({
			changes: [{ path: "instruments/wave2.yaml", expected: null }],
			message: "Add instrument wave2",
		});
		const [refused, cmds] = update(draft("households"), {
			kind: "saveRequested",
			id: m.nextId,
		});
		expect(commitOf(cmds)).toBeUndefined();
		expect(refused.activity[m.nextId]).toMatchObject({
			failure: { message: "`instruments/households.yaml` already exists." },
		});
	});

	it("saves the workspace details alone", () => {
		const m = edit(edit(loaded(), "workspace.yaml"), CONSENT);
		expect(commitOf(save(m, "workspace.yaml")[1])).toMatchObject({
			changes: [{ path: "workspace.yaml", expected: "sha-workspace.yaml" }],
			message: "Update workspace details",
		});
	});
});

describe("deleting an instrument", () => {
	it("commits its path gone, once confirmed", () => {
		const m = loaded();
		const id = at(m, "instruments/remote.yaml").id;
		const [asked] = update(m, { kind: "deleteRequested", id });
		const [, cmds] = update(asked, { kind: "deleteRequested", id });
		expect(commitOf(cmds)).toMatchObject({
			changes: [
				{
					path: "instruments/remote.yaml",
					expected: "sha-instruments/remote.yaml",
					text: null,
				},
			],
			message: "Delete instrument remote",
		});
	});
});

describe("signing out", () => {
	it("saves an instrument's unsaved changes with the rest", () => {
		const m = edit(edit(loaded(), HOUSEHOLDS), "workspace.yaml");
		expect(
			signOutPlan(m)
				.save.map((f) => f.base?.path)
				.sort(),
		).toEqual([HOUSEHOLDS, "workspace.yaml"]);
	});
});

describe("an open instrument", () => {
	it("goes to a place its own reading names", () => {
		const m = loaded();
		const e = at(m, HOUSEHOLDS);
		const [opened] = update(m, { kind: "fileOpened", id: e.id });
		const [, cmds] = update(opened, {
			kind: "locationClicked",
			target: { path: "flow.1", severity: "info" },
		});
		const from = e.source.indexOf("- ask: hh.consent") + 2;
		expect(cmds).toContainEqual(
			expect.objectContaining({
				kind: "revealRange",
				range: [from, expect.any(Number)],
			}),
		);
	});

	it("says what its save takes along, by name", () => {
		const m = edit(edit(edit(loaded(), HOUSEHOLDS), CONSENT), YES_NO);
		const evaluations = createEvaluations();
		const e = at(m, HOUSEHOLDS) as InstrumentEntry;
		const read = (q: Question) =>
			evaluations.get(q, evaluations.env(m, q.bank));
		expect(
			instrumentAlsoSaves(
				instrumentDependencies(
					m,
					evaluations.instrument(m, e),
					(q) => read(q).symbols.mentions,
				),
				(q) => read(q).draft.name ?? "",
			),
		).toEqual(["consent", "shared scale yes_no"]);
	});
});
