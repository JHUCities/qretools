import { ok, sharedIdentity } from "@qretools/core";
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
