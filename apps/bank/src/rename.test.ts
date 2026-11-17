import { err, ok } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { describeRename } from "./commits.js";
import { init, type Model } from "./model.js";
import {
	renamePlan,
	renameSaved,
	renameScope,
	showsRenameNotice,
	undoProblem,
} from "./rename.js";
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

describe("a rename's message", () => {
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

describe("what the dialog lists and what the rename commits", () => {
	it("commits a subset of what it lists: exactly the files whose GitHub copy names it", () => {
		const m = edited(
			loaded(BANK),
			"questions/a/other.yaml",
			q("other", "responses: agree4\n"),
		);
		const id = idOf(m, "scales/agree4.yaml");
		const scope = renameScope(m, id);
		const listed = [...scope.questions, ...scope.instruments];
		const committed = plan(m).changes.flatMap((c) =>
			c.id === undefined || c.id === id ? [] : [c.id],
		);
		expect(committed.every((c) => listed.includes(c))).toBe(true);
		// `other` names it only here, so it is listed but not committed.
		const other = idOf(m, "questions/a/other.yaml");
		expect(listed).toContain(other);
		expect(committed).not.toContain(other);
	});
});

describe("undoing a rename", () => {
	// An instrument that already names the new name (a hole until the rename fills it).
	const SURVEY_WITH_HOLE =
		"name: survey\nuses:\n  b: ../\ninputs:\n  mood:\n    responses: b.agree4\n  later:\n    responses: b.agree_4\nflow:\n  - ask: b.one\n";
	const start = () =>
		loaded({ ...BANK, "instruments/survey.yaml": SURVEY_WITH_HOLE });
	/** Renamed to agree_4 and committed. */
	const renamed = (m: Model) => {
		const id = idOf(m, "scales/agree4.yaml");
		const [opened] = update(m, { kind: "schemeRenameOpened", id });
		const [typed] = update(opened, {
			kind: "schemeNameChanged",
			name: "agree_4",
		});
		const [busy, cmds] = update(typed, { kind: "schemeNamingConfirmed" });
		return landed(busy, cmds);
	};
	const landed = (m: Model, cmds: ReturnType<typeof update>[1]) => {
		const commit = cmds.find((c) => c.kind === "commit");
		if (commit?.kind !== "commit") throw new Error("no commit");
		return update(m, {
			kind: "committed",
			changes: commit.changes,
			result: ok({
				shas: Object.fromEntries(
					commit.changes.map((c) => [c.path, `sha2-${c.path}`]),
				),
			}),
		})[0];
	};
	const texts = (m: Model) =>
		Object.fromEntries(
			[
				...Object.values(m.local.questions),
				...Object.values(m.local.workspace),
				...Object.values(m.local.schemes),
			].map((f) => [f.id, [f.source, f.base?.path, "name" in f ? f.name : ""]]),
		);

	it("puts back exactly what was there, in one commit, a hole the rename filled included", () => {
		const m = start();
		const after = renamed(m);
		expect(undoProblem(after)).toBeUndefined();
		const [busy, cmds] = update(after, { kind: "renameUndoRequested" });
		const commit = cmds.find((c) => c.kind === "commit");
		expect(commit?.kind === "commit" && commit.message).toBe(
			"Rename shared scale agree_4 back to agree4",
		);
		// Each file expected at what the rename committed.
		expect(
			commit?.kind === "commit" &&
				commit.changes.every(
					(c) => c.expected === null || c.expected.startsWith("sha2-"),
				),
		).toBe(true);
		const back = landed(busy, cmds);
		expect(texts(back)).toEqual(texts(m));
		expect(back.browser.renamed).toBeUndefined();
	});

	it("is refused once a file it changed was changed again", () => {
		const after = renamed(start());
		const one = idOf(after, "questions/a/one.yaml");
		const q1 = after.local.questions[one];
		if (q1?.base === undefined) throw new Error("one");
		const moved: Model = {
			...after,
			local: {
				...after.local,
				questions: {
					...after.local.questions,
					[one]: { ...q1, base: { ...q1.base, sha: "someone-else" } },
				},
			},
		};
		expect(undoProblem(moved)).toBe(
			"Something it changed was changed again since.",
		);
		expect(update(moved, { kind: "renameUndoRequested" })[1]).toEqual([]);
	});

	it("says what it saved besides the shared file, and when their other edits stay unsaved", () => {
		const after = renamed(start());
		const r = after.browser.renamed;
		if (r === undefined) throw new Error("no rename");
		expect(renameSaved(r)).toBe(
			"2 questions and 1 instrument were updated and saved.",
		);
		// An edit of its own in a renamed question: only the rename was saved.
		const busy = edited(
			start(),
			"questions/a/one.yaml",
			q("one", "responses: agree4\ntitle: Mine\n"),
		);
		const later = renamed(busy);
		const r2 = later.browser.renamed;
		if (r2 === undefined) throw new Error("no rename");
		expect(renameSaved(r2)).toBe(
			"2 questions and 1 instrument were updated and saved. Their other changes are still unsaved.",
		);
	});

	it("is refused once a file it changed was moved, even with the same text", () => {
		const after = renamed(start());
		const one = idOf(after, "questions/a/one.yaml");
		const q1 = after.local.questions[one];
		if (q1?.base === undefined) throw new Error("one");
		const moved: Model = {
			...after,
			local: {
				...after.local,
				questions: {
					...after.local.questions,
					[one]: { ...q1, base: { ...q1.base, path: "questions/b/one.yaml" } },
				},
			},
		};
		expect(undoProblem(moved)).toBe(
			"Something it changed was changed again since.",
		);
	});

	it("is refused once another shared scale has the old name", () => {
		const after = renamed(start());
		const [creating] = update(after, {
			kind: "schemeCreateOpened",
			scheme: "scale",
		});
		const [named] = update(creating, {
			kind: "schemeNameChanged",
			name: "agree4",
		});
		const [made] = update(named, { kind: "schemeNamingConfirmed" });
		expect(undoProblem(made)).toMatch(/already exists/);
	});

	it("keeps an edit made since, renaming it back", () => {
		const after = renamed(start());
		const edit = `${q("one", "responses: agree_4\n")}note: Since.\n`;
		const changed = edited(after, "questions/a/one.yaml", edit);
		const [busy, cmds] = update(changed, { kind: "renameUndoRequested" });
		const back = landed(busy, cmds);
		expect(
			back.local.questions[idOf(after, "questions/a/one.yaml")]?.source,
		).toBe(`${q("one", "responses: agree4\n")}note: Since.\n`);
	});

	it("is refused while a file it changed is in conflict with GitHub", () => {
		const after = renamed(start());
		const path = "questions/a/one.yaml";
		const conflicted: Model = {
			...edited(after, path, `${q("one", "responses: agree_4\n")}# here\n`),
			remote: {
				...after.remote,
				questions: {
					...after.remote.questions,
					[path]: { sha: "theirs", text: "changed\n" },
				},
			},
		};
		expect(undoProblem(conflicted)).toBeDefined();
	});

	it("is kept when a new rename is refused", () => {
		const after = renamed(start());
		const id = idOf(after, "scales/agree_4.yaml");
		const [opened] = update(after, { kind: "schemeRenameOpened", id });
		const [typed] = update(opened, {
			kind: "schemeNameChanged",
			name: "agree5",
		});
		const [busy, cmds] = update(typed, { kind: "schemeNamingConfirmed" });
		const commit = cmds.find((c) => c.kind === "commit");
		const [refused] = update(busy, {
			kind: "committed",
			changes: commit?.kind === "commit" ? commit.changes : [],
			result: err({
				failure: { kind: "network" as const, message: "Offline." },
			}),
		});
		expect(refused.browser.renamed?.to).toBe("agree_4");
	});

	it("is dismissed", () => {
		const after = renamed(start());
		const [gone] = update(after, { kind: "renameNoticeDismissed" });
		expect(gone.browser.renamed).toBeUndefined();
	});
});

describe("F2 on a shared name in a question", () => {
	const at = (m: Model, path: string) => {
		const id = idOf(m, path);
		const source = m.local.questions[id]?.source ?? "";
		return { id, offset: source.indexOf("agree4") + 2 };
	};

	it("opens the rename of the file it names", () => {
		const m = loaded(BANK);
		const { id, offset } = at(m, "questions/a/one.yaml");
		const [open] = update(m, { kind: "fileOpened", id });
		const [asked] = update(open, { kind: "renameRequestedAt", id, offset });
		expect(asked.browser.naming).toEqual({
			kind: "scale",
			name: "agree4",
			text: "",
			purpose: {
				kind: "rename",
				id: idOf(m, "scales/agree4.yaml"),
				from: id,
			},
		});
	});

	it("opens nothing on a name no file has, or while nothing can be written", () => {
		const m = edited(
			loaded(BANK),
			"questions/a/one.yaml",
			q("one", "responses: agree9\n"),
		);
		const one = idOf(m, "questions/a/one.yaml");
		const [open] = update(m, { kind: "fileOpened", id: one });
		const offset = (m.local.questions[one]?.source ?? "").indexOf("agree9") + 2;
		expect(
			update(open, { kind: "renameRequestedAt", id: one, offset })[0].browser
				.naming,
		).toBeUndefined();
		const plain = loaded(BANK);
		const two = at(plain, "questions/a/two.yaml");
		const [opened] = update(plain, { kind: "fileOpened", id: two.id });
		// Saving something else: nothing can be written until it lands.
		const busy: Model = {
			...opened,
			activity: { [idOf(plain, "questions/a/one.yaml")]: { kind: "saving" } },
		};
		expect(
			update(busy, { kind: "renameRequestedAt", ...two })[0].browser.naming,
		).toBeUndefined();
	});
});

describe("where a rename offers its undo", () => {
	it("on the renamed file and the question it was started from, not every file it rewrote", () => {
		const m = loaded(BANK);
		const one = idOf(m, "questions/a/one.yaml");
		const two = idOf(m, "questions/a/two.yaml");
		const scale = idOf(m, "scales/agree4.yaml");
		const [open] = update(m, { kind: "fileOpened", id: one });
		const offset = (m.local.questions[one]?.source ?? "").indexOf("agree4") + 2;
		const [asked] = update(open, {
			kind: "renameRequestedAt",
			id: one,
			offset,
		});
		const [typed] = update(asked, {
			kind: "schemeNameChanged",
			name: "agree_4",
		});
		const [busy, cmds] = update(typed, { kind: "schemeNamingConfirmed" });
		const commit = cmds.find((c) => c.kind === "commit");
		const [done] = update(busy, {
			kind: "committed",
			changes: commit?.kind === "commit" ? commit.changes : [],
			result: ok({
				shas: Object.fromEntries(
					(commit?.kind === "commit" ? commit.changes : []).map((c) => [
						c.path,
						`n-${c.path}`,
					]),
				),
			}),
		});
		const r = done.browser.renamed;
		expect(showsRenameNotice(r, scale)).toBe(true);
		expect(showsRenameNotice(r, one)).toBe(true);
		expect(showsRenameNotice(r, two)).toBe(false);
	});
});
