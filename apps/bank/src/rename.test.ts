import { err, ok, sharedIdentity } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { describeRename } from "./commits.js";
import { init, type Model } from "./model.js";
import { renamePlan } from "./rename.js";
import { update } from "./update.js";

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

const q = (name: string, rest: string) =>
	`name: ${name}\ntext: ${name}?\nintent: i\n${rest}`;
const BANK = {
	"workspace.yaml": "agency: org.example\n",
	"scales/agree4.yaml": 'labels:\n  "1": Agree\n  "2": Disagree\n',
	"questions/a/one.yaml": q("one", "responses: agree4\n"),
	"questions/a/two.yaml": q("two", "responses: agree4\n"),
	"questions/a/other.yaml": q("other", 'responses:\n  "1": Yes\n'),
	"instruments/survey.yaml":
		"name: survey\nuses:\n  b: ../\ninputs:\n  mood:\n    responses: b.agree4\nflow:\n  - ask: b.one\n",
};

const idOf = (m: Model, path: string) => {
	const f = [
		...Object.values(m.local.questions),
		...Object.values(m.local.schemes),
		...Object.values(m.local.workspace),
	].find((e) => e.base?.path === path);
	if (f === undefined) throw new Error(path);
	return f.id;
};
const edited = (m: Model, path: string, source: string): Model => {
	const id = idOf(m, path);
	const f =
		m.local.questions[id] ?? m.local.schemes[id] ?? m.local.workspace[id];
	if (f === undefined) throw new Error(path);
	const slice =
		f.kind === "question"
			? "questions"
			: f.kind === "instrument"
				? "workspace"
				: "schemes";
	return {
		...m,
		local: {
			...m.local,
			[slice]: { ...m.local[slice], [id]: { ...f, source } },
		},
	};
};
const plan = (m: Model, to = "agree_4") => {
	const r = renamePlan(m, idOf(m, "scales/agree4.yaml"), to);
	if (!r.ok) throw new Error(r.error);
	return r.value;
};

describe("renaming a saved shared file", () => {
	it("commits the file at its new path, the old path deleted, and every file naming it", () => {
		const m = loaded(BANK);
		const { changes } = plan(m);
		expect(
			changes.map((c) => [
				c.path,
				c.expected,
				c.text === null ? "deleted" : "written",
			]),
		).toEqual([
			["scales/agree_4.yaml", null, "written"],
			["scales/agree4.yaml", "sha-scales/agree4.yaml", "deleted"],
			["questions/a/one.yaml", "sha-questions/a/one.yaml", "written"],
			["questions/a/two.yaml", "sha-questions/a/two.yaml", "written"],
			["instruments/survey.yaml", "sha-instruments/survey.yaml", "written"],
		]);
		expect(changes[2]?.text).toContain("responses: agree_4\n");
		expect(changes[4]?.text).toContain("responses: b.agree_4\n");
		// The instrument is renamed here too, read while the old name still resolves.
		const survey = idOf(m, "instruments/survey.yaml");
		expect(plan(m).local.find(([id]) => id === survey)?.[1]).toContain(
			"responses: b.agree_4\n",
		);
	});

	it("commits only the rename: unsaved edits stay unsaved, and are renamed here", () => {
		const m = edited(
			loaded(BANK),
			"questions/a/one.yaml",
			`${q("one", "responses: agree4\n")}note: Still deciding.\n`,
		);
		const p = plan(m);
		const committed = p.changes.find((c) => c.path === "questions/a/one.yaml");
		expect(committed?.text).toBe(q("one", "responses: agree_4\n"));
		const here = p.local.find(([id]) => id === idOf(m, "questions/a/one.yaml"));
		expect(here?.[1]).toBe(
			`${q("one", "responses: agree_4\n")}note: Still deciding.\n`,
		);
	});

	it("renames a mention that is only an unsaved edit here, never on GitHub", () => {
		const m = edited(
			loaded(BANK),
			"questions/a/other.yaml",
			q("other", "responses: agree4\n"),
		);
		const p = plan(m);
		const other = idOf(m, "questions/a/other.yaml");
		expect(p.changes.some((c) => c.id === other)).toBe(false);
		expect(p.local.some(([id]) => id === other)).toBe(true);
	});

	it("lists the questions that already name the new name", () => {
		const m = edited(
			loaded(BANK),
			"questions/a/other.yaml",
			q("other", "responses: agree_4\n"),
		);
		expect(plan(m).fills).toEqual([idOf(m, "questions/a/other.yaml")]);
	});

	it("refuses an unchanged, invalid or taken name", () => {
		const m = loaded({
			...BANK,
			"scales/yes2.yaml": 'labels:\n  "1": Yes\n  "2": No\n',
		});
		const why = (to: string) => {
			const r = renamePlan(m, idOf(m, "scales/agree4.yaml"), to);
			return r.ok ? undefined : r.error;
		};
		expect(why("agree4")).toBe("That's its name already.");
		expect(why("Agree-4")).toBeDefined();
		expect(why("yes2")).toMatch(/already exists/);
	});

	it("refuses while a file it must change was also changed on GitHub, naming it", () => {
		const m = loaded(BANK);
		const two = idOf(m, "questions/a/two.yaml");
		const conflicted: Model = {
			...edited(
				m,
				"questions/a/two.yaml",
				`${BANK["questions/a/two.yaml"]}# here\n`,
			),
			remote: {
				...m.remote,
				questions: {
					...m.remote.questions,
					"questions/a/two.yaml": { sha: "sha-new", text: "changed\n" },
				},
			},
		};
		expect(conflicted.local.questions[two]).toBeDefined();
		const r = renamePlan(conflicted, idOf(m, "scales/agree4.yaml"), "agree_4");
		expect(r.ok ? undefined : r.error).toBe(
			"`two` was changed both here and on GitHub.",
		);
	});
});

describe("renaming a draft shared file", () => {
	it("commits nothing and renames the working copies", () => {
		const m = loaded(BANK);
		const id = idOf(m, "scales/agree4.yaml");
		const scale = m.local.schemes[id];
		if (scale === undefined) throw new Error("scale");
		const { base: _, ...draft } = scale;
		const drafted: Model = {
			...m,
			local: { ...m.local, schemes: { ...m.local.schemes, [id]: draft } },
		};
		const r = renamePlan(drafted, id, "agree_4");
		expect(r.ok && r.value.changes).toEqual([]);
		expect(r.ok && r.value.local.length).toBe(3);
	});
});

describe("a rename's message and identity", () => {
	it("says the file in the subject and counts the rest", () => {
		expect(describeRename("scale", "agree4", "agree_4", 0, 0)).toBe(
			"Rename shared scale agree4 to agree_4",
		);
		expect(describeRename("scale", "agree4", "agree_4", 1, 0)).toBe(
			"Rename shared scale agree4 to agree_4\n\nAnd the 1 question that name it.",
		);
		expect(describeRename("scale", "agree4", "agree_4", 14, 2)).toBe(
			"Rename shared scale agree4 to agree_4\n\nAnd the 14 questions and 2 instruments that name it.",
		);
	});

	it("gives a unit no DDI identity", () => {
		expect(sharedIdentity("scale", "agree4")).toBe("scale-agree4");
		expect(sharedIdentity("unit", "days")).toBeUndefined();
	});
});

describe("confirming a rename of a saved shared file", () => {
	/** The dialog opened on agree4, the name typed, confirmed: the model and its commands. */
	const confirm = (m: Model, to = "agree_4") => {
		const id = idOf(m, "scales/agree4.yaml");
		const [opened] = update(m, { kind: "schemeRenameOpened", id });
		const [typed] = update(opened, { kind: "schemeNameChanged", name: to });
		return update(typed, { kind: "schemeNamingConfirmed" });
	};
	/** GitHub took every change: each path gets a new sha. */
	const accepted = (m: Model, cmds: ReturnType<typeof update>[1]) => {
		const commit = cmds.find((c) => c.kind === "commit");
		if (commit?.kind !== "commit") throw new Error("no commit");
		return update(m, {
			kind: "committed",
			changes: commit.changes,
			result: ok({
				shas: Object.fromEntries(
					commit.changes.map((c) => [c.path, `new-${c.path}`]),
				),
			}),
		})[0];
	};
	const scaleOf = (m: Model) =>
		Object.values(m.local.schemes).find((e) => e.kind === "scale");

	it("commits the plan once, with the rename's message, the name unchanged until GitHub has it", () => {
		const m = loaded(BANK);
		const [busy, cmds] = confirm(m);
		const commit = cmds.find((c) => c.kind === "commit");
		expect(commit).toMatchObject({
			kind: "commit",
			message:
				"Rename shared scale agree4 to agree_4\n\nAnd the 2 questions and 1 instrument that name it.",
		});
		expect(commit?.kind === "commit" && commit.changes[0]).toMatchObject({
			path: "scales/agree_4.yaml",
			expected: null,
		});
		expect(scaleOf(busy)?.name).toBe("agree4");
		expect(busy.activity[idOf(m, "scales/agree4.yaml")]).toEqual({
			kind: "saving",
			renaming: "agree_4",
		});
		expect(busy.browser.naming).toBeUndefined();
	});

	it("reserves the new name while it runs, for a rename and for a new file", () => {
		const [busy] = confirm(loaded(BANK));
		const [creating] = update(busy, {
			kind: "schemeCreateOpened",
			scheme: "scale",
		});
		const [named] = update(creating, {
			kind: "schemeNameChanged",
			name: "agree_4",
		});
		const [after] = update(named, { kind: "schemeNamingConfirmed" });
		expect(Object.values(after.local.schemes).map((e) => e.name)).not.toContain(
			"agree_4",
		);
	});

	it("renames the file and everything naming it once GitHub has the commit, with nothing left unsaved", () => {
		const m = loaded(BANK);
		const [busy, cmds] = confirm(m);
		const done = accepted(busy, cmds);
		const scale = scaleOf(done);
		expect(scale?.name).toBe("agree_4");
		expect(scale?.base?.path).toBe("scales/agree_4.yaml");
		for (const path of [
			"questions/a/one.yaml",
			"questions/a/two.yaml",
			"instruments/survey.yaml",
		]) {
			const id = idOf(m, path);
			const f = done.local.questions[id] ?? done.local.workspace[id];
			expect(f?.source).toContain("agree_4");
			// The instrument walk: committed and working copy agree, no spurious unsaved change.
			expect(f?.source).toBe(f?.base?.text);
		}
		expect(done.activity).toEqual({});
	});

	it("moves the address of the open file to its new path", () => {
		const m = loaded(BANK);
		const id = idOf(m, "scales/agree4.yaml");
		const [open] = update(m, { kind: "fileOpened", id });
		const [busy, cmds] = confirm(open);
		const commit = cmds.find((c) => c.kind === "commit");
		const [, after] = update(busy, {
			kind: "committed",
			changes: commit?.kind === "commit" ? commit.changes : [],
			result: ok({ shas: { "scales/agree_4.yaml": "new" } }),
		});
		const link = after.find((c) => c.kind === "setLink");
		expect(link?.kind === "setLink" && link.hash).toContain(
			"scales%2Fagree_4.yaml",
		);
	});

	it("keeps what was typed while the commit ran, renamed", () => {
		const m = loaded(BANK);
		const [busy, cmds] = confirm(m);
		const typed = edited(
			busy,
			"questions/a/one.yaml",
			`${q("one", "responses: agree4\n")}note: Typed meanwhile.\n`,
		);
		const done = accepted(typed, cmds);
		expect(done.local.questions[idOf(m, "questions/a/one.yaml")]?.source).toBe(
			`${q("one", "responses: agree_4\n")}note: Typed meanwhile.\n`,
		);
	});

	it("renames nothing when GitHub refuses the commit", () => {
		const m = loaded(BANK);
		const [busy, cmds] = confirm(m);
		const commit = cmds.find((c) => c.kind === "commit");
		const [after] = update(busy, {
			kind: "committed",
			changes: commit?.kind === "commit" ? commit.changes : [],
			result: err({
				failure: { kind: "network" as const, message: "Offline." },
			}),
		});
		expect(scaleOf(after)?.name).toBe("agree4");
		expect(
			after.local.questions[idOf(m, "questions/a/one.yaml")]?.source,
		).toContain("responses: agree4\n");
	});

	it("is ignored when it arrives after signing out", () => {
		const m = loaded(BANK);
		const [busy, cmds] = confirm(m);
		const [out] = update(busy, { kind: "signOutRequested" });
		const done = accepted(out, cmds);
		expect(Object.values(done.local.schemes).map((e) => e.name)).not.toContain(
			"agree_4",
		);
	});
});

describe("reloading during a rename's commit", () => {
	it("is ignored for a file in the commit, whose base the answer sets", () => {
		const m = loaded(BANK);
		const id = idOf(m, "scales/agree4.yaml");
		const [opened] = update(m, { kind: "schemeRenameOpened", id });
		const [typed] = update(opened, {
			kind: "schemeNameChanged",
			name: "agree_4",
		});
		const [busy] = update(typed, { kind: "schemeNamingConfirmed" });
		const one = idOf(m, "questions/a/one.yaml");
		expect(update(busy, { kind: "reloadRequested", id: one })[0]).toBe(busy);
	});
});
