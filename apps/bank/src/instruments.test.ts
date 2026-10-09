/**
 * Saving and deleting a workspace's own files: an instrument takes along what it reads
 * that isn't saved yet, so it never lands on the branch reading differently from how it
 * reads here; the workspace details save alone.
 */
import { fileURLToPath } from "node:url";
import { NAME_RULE_TEXT, ok } from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { parseLink } from "@qretools/shell";
import { beforeAll, describe, expect, it } from "vitest";
import { createEvaluations } from "./evaluations.js";
import {
	type Cmd,
	type Entry,
	type InstrumentEntry,
	init,
	type Model,
	type Msg,
	type Question,
	WORKSPACE_DETAILS_TEMPLATE,
} from "./model.js";
import { claimOf } from "./sync.js";
import {
	bankAddProblem,
	instrumentAlsoSaves,
	instrumentDependencies,
	instrumentNameProblem,
	signOutPlan,
	update,
} from "./update.js";
import { instrumentsUsing, instrumentUses } from "./usedBy.js";

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
	return loading()[0];
}

/** The same, with what the load asked for. */
function loading(): ReturnType<typeof update> {
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
	});
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

	it("takes along the unsaved shared scale an input names", () => {
		const loadedModel = loaded();
		const e = at(loadedModel, HOUSEHOLDS) as InstrumentEntry;
		// Only an input reads the scale: no question it asks is changed.
		const source =
			"name: households\nuses:\n  hh: ../households\ninputs:\n  eligible:\n    responses: hh.yes_no\nflow:\n  - say: Hello.\n";
		const m = edit(
			{
				...loadedModel,
				local: {
					...loadedModel.local,
					workspace: {
						...loadedModel.local.workspace,
						[e.id]: { ...e, source },
					},
				},
			},
			YES_NO,
		);
		const commit = commitOf(save(m, HOUSEHOLDS)[1]);
		expect(commit?.changes.map((c) => c.path)).toEqual([HOUSEHOLDS, YES_NO]);
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

describe("a new instrument", () => {
	const named = (m: Model, name: string): Model =>
		update(update(m, { kind: "instrumentCreateOpened" })[0], {
			kind: "instrumentNameChanged",
			name,
		})[0];

	it("is named by the rule its file's path needs, never as another's", () => {
		const m = loaded();
		expect(instrumentNameProblem(m, "")).toBe("Give it a name.");
		expect(instrumentNameProblem(m, "Wave 2")).toBe(NAME_RULE_TEXT);
		// On GitHub already, in any case.
		expect(instrumentNameProblem(m, "households")).toMatch(/already exists/);
		const [made] = update(named(m, "wave2"), {
			kind: "instrumentNamingConfirmed",
		});
		// In this tab, before it's saved.
		expect(instrumentNameProblem(made, "wave2")).toMatch(/already exists/);
		// The rule allows lowercase only, but GitHub may hold a file in any case: the
		// two would collide in a checkout on macOS or Windows.
		const capital: Model = {
			...m,
			remote: {
				...m.remote,
				workspace: {
					...m.remote.workspace,
					"instruments/Wave3.yaml": { sha: "w", text: "name: Wave3\n" },
				},
			},
		};
		expect(instrumentNameProblem(capital, "wave3")).toMatch(/already exists/);
		const [refused] = update(named(made, "wave2"), {
			kind: "instrumentNamingConfirmed",
		});
		expect(Object.keys(refused.local.workspace)).toEqual(
			Object.keys(made.local.workspace),
		);
	});

	it("opens as the template with its name written, and saves at its name's path", () => {
		const [m] = update(named(loaded(), "wave2"), {
			kind: "instrumentNamingConfirmed",
		});
		expect(m.browser.namingInstrument).toBeUndefined();
		const e = Object.values(m.local.workspace).find(
			(f) => f.kind === "instrument" && f.name === "wave2",
		);
		expect(e?.source).toMatch(/^name: wave2$/m);
		expect(e?.source).toMatch(/^uses:$/m);
		expect(m.screen).toEqual({ kind: "editing", id: e?.id });
		expect(
			commitOf(update(m, { kind: "saveRequested", id: e?.id ?? -1 })[1]),
		).toMatchObject({
			changes: [{ path: "instruments/wave2.yaml", expected: null }],
		});
	});

	it("is only discarded when deleted before it's saved", () => {
		const [m] = update(named(loaded(), "wave2"), {
			kind: "instrumentNamingConfirmed",
		});
		const id = m.nextId - 1;
		const [asked] = update(m, { kind: "deleteRequested", id });
		const [gone, cmds] = update(asked, { kind: "deleteRequested", id });
		expect(commitOf(cmds)).toBeUndefined();
		expect(gone.local.workspace[id]).toBeUndefined();
	});
});

describe("the workspace details", () => {
	it("are started once, then opened", () => {
		const [start] = init({ work: ok(undefined), hasToken: false });
		const [made] = update(start, { kind: "workspaceDetailsOpened" });
		const [e] = Object.values(made.local.workspace);
		expect(e).toMatchObject({
			kind: "workspaceFile",
			source: WORKSPACE_DETAILS_TEMPLATE,
		});
		expect(made.screen).toEqual({ kind: "editing", id: e?.id });
		const [again] = update(
			{ ...made, screen: { kind: "blank" } },
			{ kind: "workspaceDetailsOpened" },
		);
		expect(Object.values(again.local.workspace)).toHaveLength(1);
		expect(again.screen).toEqual({ kind: "editing", id: e?.id });
	});
});

describe("the example instrument", () => {
	it("is named already, never over one taken, and reads the bank New makes questions in", () => {
		const m = loaded();
		const [asked] = update(m, {
			kind: "instrumentCreateOpened",
			example: true,
		});
		expect(asked.browser.namingInstrument).toEqual({
			name: "example",
			example: true,
		});
		const [made] = update(asked, { kind: "instrumentNamingConfirmed" });
		const e = Object.values(made.local.workspace).find(
			(f) => f.kind === "instrument" && f.name === "example",
		);
		expect(e?.source).toContain("uses:\n  bank: ../bank\n");
		expect(made.screen).toEqual({ kind: "editing", id: e?.id });
		const [again] = update(made, {
			kind: "instrumentCreateOpened",
			example: true,
		});
		expect(again.browser.namingInstrument?.name).toBe("example_2");
		// A blank one starts unnamed, as before, and renaming keeps what it is.
		const [blank] = update(m, { kind: "instrumentCreateOpened" });
		expect(blank.browser.namingInstrument).toEqual({ name: "" });
		const [renamed] = update(asked, {
			kind: "instrumentNameChanged",
			name: "demo",
		});
		expect(renamed.browser.namingInstrument).toEqual({
			name: "demo",
			example: true,
		});
	});
});

describe("the instruments a question is used by", () => {
	/** `instrumentsUsing` for the question at `path`, with the workspace as `m` holds it. */
	const usesOf = (m: Model, path: string) =>
		instrumentsUsing(
			instrumentUses(m, createEvaluations()),
			claimOf(at(m, path)),
		).map((u) => ({
			name: u.name,
			places: u.places.map((p) => ({
				at: p.at,
				label: p.label.map((part) => part.text).join(" "),
			})),
		}));
	/** The workspace with an instrument of this source added, as a saved file would be. */
	const withInstrument = (m: Model, name: string, source: string): Model => {
		const [added] = update(m, { kind: "instrumentCreateOpened" });
		const [named] = update(added, { kind: "instrumentNameChanged", name });
		const [made] = update(named, { kind: "instrumentNamingConfirmed" });
		const e = Object.values(made.local.workspace).find(
			(f) => f.kind === "instrument" && f.name === name,
		) as InstrumentEntry;
		return {
			...made,
			local: {
				...made.local,
				workspace: { ...made.local.workspace, [e.id]: { ...e, source } },
			},
		};
	};

	it("lists each instrument once, with each step that names it, as its outline says it", () => {
		const [use] = usesOf(loaded(), CONSENT);
		// Asked, then read in `stop:`.
		expect(use).toEqual({
			name: "households",
			places: [
				{ at: "flow.1.ask", label: "Ask hh.consent" },
				{ at: "flow.2.stop", label: expect.stringMatching(/^Stop/) },
			],
		});
	});

	it("lists a step once however often it names the file, and a check by its ask", () => {
		const m = withInstrument(
			loaded(),
			"twice",
			"name: twice\nuses:\n  hh: ../households\nflow:\n  - ask: hh.size\n    checks:\n      - ensure: hh.size > 0 and hh.size < 30\n        severity: info\n        message: Is that right?\n",
		);
		const use = usesOf(m, "households/questions/household/size.yaml").find(
			(u) => u.name === "twice",
		);
		expect(use?.places).toEqual([{ at: "flow.0.ask", label: "Ask hh.size" }]);
	});

	it("links each to its first place, which a link opens it at", () => {
		const m = loaded();
		const [use] = instrumentsUsing(
			instrumentUses(m, createEvaluations()),
			claimOf(at(m, CONSENT)),
		);
		expect(use?.places[0]?.at).toBe("flow.1.ask");
		const households = at(m, HOUSEHOLDS) as InstrumentEntry;
		const [opened, cmds] = update(m, {
			kind: "hashChanged",
			hash: `#repo=o%2Fr&branch=qretools-iain&file=${encodeURIComponent(HOUSEHOLDS)}&at=flow.1.ask`,
		});
		expect(opened.screen).toEqual({ kind: "editing", id: households.id });
		// The step that asks it, as a finding there is revealed; the reveal names the
		// instrument, whose editor isn't drawn yet.
		const from = households.source.indexOf("ask: hh.consent");
		expect(cmds).toContainEqual({
			kind: "revealRange",
			range: [from, from + "ask: hh.consent".length],
			id: households.id,
		});
	});

	it("counts an option variable read in a condition, by any alias for the bank", () => {
		const m = withInstrument(
			loaded(),
			"news",
			'name: news\nuses:\n  b: ../bank\n  again: ../bank\nflow:\n  - if: again.news_sources_1 = "1"\n    then:\n      - say: Reads the paper.\n',
		);
		expect(usesOf(m, "bank/questions/examples/news_sources.yaml")).toEqual([
			{ name: "news", places: [expect.objectContaining({ at: "flow.0.if" })] },
		]);
	});

	it("counts an instrument's universe as a use of the shared universe", () => {
		const m = loaded();
		const e = at(m, HOUSEHOLDS) as InstrumentEntry;
		const source = e.source.replace(/^uses:/m, "universe: hh.renters\nuses:");
		const named: Model = {
			...m,
			local: {
				...m.local,
				workspace: { ...m.local.workspace, [e.id]: { ...e, source } },
			},
		};
		const universe = at(named, "households/universes/renters.yaml");
		expect(
			instrumentsUsing(
				instrumentUses(named, createEvaluations()),
				claimOf(universe),
			).map((u) => u.name),
		).toEqual(["households"]);
	});

	it("follows a draft shared file's rename into the instruments naming it", () => {
		const steps: Msg[] = [
			{ kind: "schemeCreateOpened", scheme: "universe", bank: "households" },
			{ kind: "schemeNameChanged", name: "r" },
			{ kind: "schemeTextChanged", text: "Renters" },
			{ kind: "schemeNamingConfirmed" },
		];
		const made = steps.reduce((m, msg) => update(m, msg)[0], loaded());
		const draft = Object.values(made.local.schemes).find(
			(f) => f.kind === "universe" && f.name === "r",
		);
		expect(draft?.base).toBeUndefined();
		const e = at(made, HOUSEHOLDS) as InstrumentEntry;
		const source = e.source.replace(/^uses:/m, "universe: hh.r\nuses:");
		const named: Model = {
			...made,
			local: {
				...made.local,
				workspace: { ...made.local.workspace, [e.id]: { ...e, source } },
			},
		};
		const renamed = (
			[
				{ kind: "schemeRenameOpened", id: draft?.id ?? -1 },
				{ kind: "schemeNameChanged", name: "r2" },
				{ kind: "schemeNamingConfirmed" },
			] as Msg[]
		).reduce((m, msg) => update(m, msg)[0], named);
		const after = renamed.local.workspace[e.id];
		expect(after?.source).toContain("universe: hh.r2\n");
		expect(after?.source).not.toContain("universe: hh.r\n");
	});

	it("is none for a question no instrument here names, or one never saved", () => {
		const m = loaded();
		expect(usesOf(m, "bank/questions/examples/library_visits.yaml")).toEqual(
			[],
		);
		const draft = { ...(at(m, CONSENT) as Question) };
		delete (draft as { base?: unknown }).base;
		expect(
			instrumentsUsing(instrumentUses(m, createEvaluations()), claimOf(draft)),
		).toEqual([]);
	});
});

describe("go to definition in an instrument", () => {
	/** The open instrument, with `universe: hh.renters` added, and F12 at a word of it. */
	const follow = (word: string) => {
		const loadedModel = loaded();
		const e = at(loadedModel, HOUSEHOLDS) as InstrumentEntry;
		const source = e.source.replace(/^uses:/m, "universe: hh.renters\nuses:");
		const m: Model = {
			...loadedModel,
			local: {
				...loadedModel.local,
				workspace: {
					...loadedModel.local.workspace,
					[e.id]: { ...e, source },
				},
			},
		};
		const [opened] = update(m, { kind: "fileOpened", id: e.id });
		return update(opened, {
			kind: "definitionRequested",
			id: e.id,
			offset: source.indexOf(word) + 3,
		});
	};

	it("opens the question an ask names, as a link would", () => {
		const [m, cmds] = follow("hh.consent");
		expect(m.screen).toEqual({ kind: "editing", id: at(m, CONSENT).id });
		expect(cmds).toContainEqual(
			expect.objectContaining({ kind: "setLink", push: true }),
		);
	});

	it("opens the universe it names", () => {
		const [m] = follow("hh.renters");
		expect(m.screen).toEqual({
			kind: "editing",
			id: at(m, "households/universes/renters.yaml").id,
		});
	});

	it("opens the question a condition reads", () => {
		const [m] = follow("hh.tenure = ");
		expect(m.screen).toEqual({ kind: "editing", id: at(m, TENURE).id });
	});

	it("opens the list a code is on, at that code, waiting for its editor", () => {
		// `hh.consent = "2"`: consent's answers are on the shared scale yes_no.
		const [m, cmds] = follow('= "2"');
		const scale = at(m, YES_NO);
		expect(m.screen).toEqual({ kind: "editing", id: scale.id });
		const from = scale.source.indexOf('"2"');
		expect(cmds).toContainEqual({
			kind: "revealRange",
			range: [from, expect.any(Number)],
			id: scale.id,
		});
		// The condition names the question, not its scale: no use of yes_no.
		expect(
			instrumentsUsing(instrumentUses(m, createEvaluations()), claimOf(scale)),
		).toEqual([]);
	});

	it("goes to where the instrument declares a name, in place", () => {
		/** F12 on `word` puts the caret on `name`, as the line `line` writes it. */
		const reveal = (word: string, line: string, name: string) => {
			const [m, cmds] = follow(word);
			const e = at(m, HOUSEHOLDS) as InstrumentEntry;
			const from = e.source.indexOf(line) + line.indexOf(name);
			// No other file opens, and no history entry: the caret moves within this one.
			expect(m.screen).toEqual({ kind: "editing", id: e.id });
			expect(cmds).toEqual([
				{ kind: "revealRange", range: [from, from + name.length] },
			]);
		};
		reveal("{{county", "  county:\n", "county");
		reveal("f: renter", "compute: renter", "renter");
		reveal("{{index", "roster: members", "members");
	});

	it("does nothing on an ask its bank doesn't resolve, or a bank in another repository", () => {
		const m = loaded();
		const press = (path: string, source: string, word: string) => {
			const e = at(m, path) as InstrumentEntry;
			const edited: Model = {
				...m,
				local: {
					...m.local,
					workspace: { ...m.local.workspace, [e.id]: { ...e, source } },
				},
			};
			const [opened] = update(edited, { kind: "fileOpened", id: e.id });
			return update(opened, {
				kind: "definitionRequested",
				id: e.id,
				offset: source.indexOf(word) + 3,
			});
		};
		const nope = press(
			HOUSEHOLDS,
			"name: households\nuses:\n  hh: ../households\nflow:\n  - ask: hh.nope\n",
			"hh.nope",
		);
		expect(nope[1]).toEqual([]);
		const remote = at(m, "instruments/remote.yaml") as InstrumentEntry;
		const far = press("instruments/remote.yaml", remote.source, "bas.consent");
		expect(far[0].screen).toEqual({ kind: "editing", id: remote.id });
		expect(far[1]).toEqual([]);
	});

	it("does nothing on a name that isn't followable", () => {
		const [m, cmds] = follow("households");
		expect(m.screen).toEqual({
			kind: "editing",
			id: at(m, HOUSEHOLDS).id,
		});
		expect(cmds).toEqual([]);
	});
});

describe("a bank in another repository an instrument uses", () => {
	const KEY = "owner/bank@v1";
	const reads = (cmds: readonly Cmd[]) =>
		cmds.flatMap((c) =>
			c.kind === "loadRemoteBanks"
				? [{ keys: c.addresses.map((a) => a.key), now: c.now }]
				: [],
		);
	const typedIn = (m: Model, path: string, source: string) => {
		const e = at(m, path) as InstrumentEntry;
		const [opened] = update(m, { kind: "fileOpened", id: e.id });
		return update(opened, { kind: "edited", text: source });
	};

	it("is read at once when the workspace loads", () => {
		expect(reads(loading()[1])).toEqual([{ keys: [KEY], now: true }]);
	});

	it("is asked for after a pause while its address is typed, and only when the addresses change", () => {
		const m = loaded();
		const remote = at(m, "instruments/remote.yaml");
		const [, retyped] = typedIn(
			m,
			"instruments/remote.yaml",
			remote.source.replace("owner/bank@v1", "owner/bank@v2"),
		);
		// The address now names v2 alone: that is what's wanted, after a pause.
		expect(reads(retyped)).toEqual([{ keys: ["owner/bank@v2"], now: false }]);
		const [, other] = typedIn(
			m,
			HOUSEHOLDS,
			`${at(m, HOUSEHOLDS).source}# x\n`,
		);
		expect(reads(other)).toEqual([]);
	});

	it("is being read only once a read starts, so a batch replaced before it went leaves nothing waiting", () => {
		const m = loaded();
		expect(m.remoteBanks).toEqual({});
		const [started] = update(m, { kind: "remoteBankStarted", key: KEY });
		expect(started.remoteBanks).toEqual({ [KEY]: { kind: "loading" } });
		// Being read, it isn't wanted again.
		const [, again] = typedIn(
			started,
			"instruments/remote.yaml",
			`${at(started, "instruments/remote.yaml").source}# x\n`,
		);
		expect(reads(again)).toEqual([]);
	});

	it("takes its files, or why not, and only while awaited", () => {
		const [started] = update(loaded(), { kind: "remoteBankStarted", key: KEY });
		const [read] = update(started, {
			kind: "remoteBankLoaded",
			key: KEY,
			result: ok({
				found: true,
				files: [{ path: "bank.yaml", sha: "b", text: "agency: x\n" }],
				unread: [],
			}),
		});
		expect(read.remoteBanks[KEY]).toEqual({
			kind: "files",
			files: { "bank.yaml": "agency: x\n" },
		});
		const [missing] = update(started, {
			kind: "remoteBankLoaded",
			key: KEY,
			result: ok({ found: false, reason: "No tag `v1`." }),
		});
		expect(missing.remoteBanks[KEY]).toEqual({
			kind: "unavailable",
			reason: "No tag `v1`.",
		});
		const [privately] = update(started, {
			kind: "remoteBankLoaded",
			key: KEY,
			result: {
				ok: false,
				error: {
					kind: "unreadable",
					message: "No repository.",
					hint: "Check the name, and that the app is installed on it.",
				},
			},
		});
		expect(privately.remoteBanks[KEY]).toEqual({
			kind: "unavailable",
			reason:
				"No repository. Check the name, and that the app is installed on it.",
		});
		// Not awaited (signed out since, or never asked): dropped.
		const [late] = update(loaded(), {
			kind: "remoteBankLoaded",
			key: KEY,
			result: ok({ found: false, reason: "x" }),
		});
		expect(late.remoteBanks).toEqual({});
	});

	it("is read again on a reload only if it couldn't be, and forgotten on sign-out", () => {
		const m: Model = {
			...loaded(),
			remoteBanks: {
				[KEY]: { kind: "files", files: {} },
				"owner/gone@v1": { kind: "unavailable", reason: "x" },
			},
		};
		const [reloading] = update(m, { kind: "bankReloadRequested" });
		expect(Object.keys(reloading.remoteBanks)).toEqual([KEY]);
		const [out] = update(m, { kind: "disconnected" });
		expect(out.remoteBanks).toEqual({});
	});
});

describe("a link to an instrument", () => {
	it("is the instrument's address once it's open, and opens it when followed", () => {
		const m = loaded();
		const e = at(m, HOUSEHOLDS);
		const [opened, cmds] = update(m, { kind: "fileOpened", id: e.id });
		const link = cmds.find(
			(c): c is Extract<Cmd, { kind: "setLink" }> => c.kind === "setLink",
		);
		expect(link?.push).toBe(true);
		expect(parseLink(link?.hash ?? "")).toMatchObject({
			repo: "o/r",
			file: HOUSEHOLDS,
		});
		// Followed from elsewhere: the same instrument opens.
		const [away] = update(opened, { kind: "listOpened" });
		const [back] = update(away, {
			kind: "hashChanged",
			hash: link?.hash ?? "",
		});
		expect(back.screen).toEqual({ kind: "editing", id: e.id });
	});
});

describe("following an instrument's question, editing it, and coming back", () => {
	it("is the author's own copy throughout, the instrument reading the edit, before and after a save", () => {
		const [start] = init({
			work: ok(undefined),
			hasToken: true,
			settings: { owner: "o", repo: "r", path: "", remember: false },
		});
		let [m] = update(start, {
			kind: "connected",
			result: ok({
				login: "iain",
				avatarUrl: "https://a/iain",
				access: { kind: "write" },
				defaultBranch: "main",
			}),
		});
		// No branch of the author's yet: the workspace is read from main.
		[m] = update(m, {
			kind: "workspaceLoaded",
			result: ok({
				files: Object.entries(files).map(([path, text]) => ({
					path,
					sha: `sha-${path}`,
					text,
				})),
				found: false,
				from: "default" as const,
				aheadBy: 0,
				behindBy: 0,
				unread: [],
			}),
		});
		const e = at(m, HOUSEHOLDS) as InstrumentEntry;
		[m] = update(m, { kind: "fileOpened", id: e.id });
		const [followed, cmds] = update(m, {
			kind: "definitionRequested",
			id: e.id,
			offset: e.source.indexOf("hh.consent") + 3,
		});
		const q = at(followed, CONSENT);
		expect(followed.screen).toEqual({ kind: "editing", id: q.id });
		const old = cmds.find(
			(c): c is Extract<Cmd, { kind: "setLink" }> => c.kind === "setLink",
		)?.hash;
		expect(parseLink(old ?? "")).toMatchObject({
			branch: "main",
			file: CONSENT,
		});
		// Renamed here: the instrument reads it at once, before any save.
		const renamed = q.source.replace(/^name: consent$/m, "name: agreed");
		[m] = update(followed, { kind: "edited", text: renamed });
		const evaluations = createEvaluations();
		const said = (model: Model) =>
			evaluations
				.instrument(model, at(model, HOUSEHOLDS) as InstrumentEntry)
				.instrument.findings.some((f) => /consent/.test(f.message));
		expect(said(m)).toBe(true);
		// Saved: the author's branch now exists, and holds a newer version than main.
		const [saving, saved] = update(m, { kind: "saveRequested", id: q.id });
		const commit = saved.find(
			(c): c is Extract<Cmd, { kind: "commit" }> => c.kind === "commit",
		);
		[m] = update(saving, {
			kind: "committed",
			changes: commit?.changes ?? [],
			result: ok({ shas: { [CONSENT]: "newer" } }),
		});
		// Back to the instrument, then Forward to the link written before the save.
		[m] = update(m, { kind: "fileOpened", id: e.id });
		const [forward] = update(m, { kind: "hashChanged", hash: old ?? "" });
		expect(forward.screen).toEqual({ kind: "editing", id: q.id });
	});
});

describe("a name from a bank in another repository", () => {
	const hh = () =>
		Object.fromEntries(
			Object.entries(files).flatMap(([path, text]) =>
				path.startsWith("households/")
					? [[path.slice("households/".length), text]]
					: [],
			),
		);
	/** F12 on `word` in an instrument using `address` as `bas`, that bank read. */
	const follow = (address: string, key: string, word = "bas.consent") => {
		const m = loaded();
		const e = at(m, "instruments/remote.yaml") as InstrumentEntry;
		const source = e.source.replace("owner/bank@v1", address);
		const read: Model = {
			...m,
			remoteBanks: { [key]: { kind: "files", files: hh() } },
			local: {
				...m.local,
				workspace: { ...m.local.workspace, [e.id]: { ...e, source } },
			},
		};
		const [opened] = update(read, { kind: "fileOpened", id: e.id });
		return update(opened, {
			kind: "definitionRequested",
			id: e.id,
			offset: source.indexOf(word) + 3,
		});
	};

	it("opens on GitHub at its tag, in a new tab, and leaves the app where it was", () => {
		const [m, cmds] = follow("owner/bank@v1", "owner/bank@v1");
		expect(cmds).toEqual([
			{
				kind: "openExternal",
				url: "https://github.com/owner/bank/blob/v1/questions/household/consent.yaml",
			},
		]);
		expect(m.screen.kind).toBe("editing");
	});

	it("opens within the bank's folder when the address names one", () => {
		const [, cmds] = follow(
			"Owner/Bank/banks/hh@release/2026.1",
			"owner/bank/banks/hh@release/2026.1",
		);
		expect(cmds).toEqual([
			{
				kind: "openExternal",
				url: "https://github.com/Owner/Bank/blob/release/2026.1/banks/hh/questions/household/consent.yaml",
			},
		]);
	});
});

describe("an instrument's pickers", () => {
	it("write the question chosen at an ask, found again in the text as it is now", () => {
		const m = loaded();
		const id = at(m, HOUSEHOLDS).id;
		const open: Model = { ...m, screen: { kind: "editing", id } };
		const [next, cmds] = update(open, {
			kind: "livelitChosen",
			id,
			livelit: "flow.1.ask",
			value: "hh.tenure",
		});
		const source = next.local.workspace[id]?.source ?? "";
		expect(source).toContain("  - ask: hh.tenure\n  - stop: hh.consent");
		const end = source.indexOf("hh.tenure") + "hh.tenure".length;
		expect(cmds[0]).toEqual({ kind: "revealRange", range: [end, end] });
		// The bank written at `uses` is a folder beside the instrument.
		const [bank] = update(open, {
			kind: "livelitChosen",
			id,
			livelit: "uses.hh",
			value: "../banks/hh",
		});
		expect(bank.local.workspace[id]?.source).toContain("  hh: ../banks/hh\n");
	});

	it("write the codes ticked in a condition's set, escaped for its value", () => {
		const m = loaded();
		const id = at(m, HOUSEHOLDS).id;
		const typed = update(
			{ ...m, screen: { kind: "editing", id } },
			{
				kind: "edited",
				text: (m.local.workspace[id]?.source ?? "").replace(
					'stop: hh.consent = "2"',
					'stop: "hh.consent in {\\"2\\"}"',
				),
			},
		)[0];
		const [next] = update(typed, {
			kind: "livelitChosen",
			id,
			livelit: "flow.2.stop#0",
			value: ["1", "2"],
		});
		expect(next.local.workspace[id]?.source).toContain(
			'stop: "hh.consent in {\\"1\\", \\"2\\"}"',
		);
	});
});

describe("adding a bank", () => {
	const fromUses = (how: "new" | "import") => {
		const m = loaded();
		const id = at(m, HOUSEHOLDS).id;
		const open: Model = { ...m, screen: { kind: "editing", id } };
		const fix = { kind: "bank" as const, label: "", how, path: "uses.hh" };
		return { id, m: update(open, { kind: "fixApplied", id, fix })[0] };
	};
	const typed = (m: Model, text: string) =>
		update(m, { kind: "bankAddChanged", text })[0];
	const confirmed = (m: Model) => update(m, { kind: "bankAddConfirmed" });

	it("makes a new one here, lists it, and writes its folder at the `uses` entry", () => {
		const { id, m } = fromUses("new");
		expect(m.browser.addingBank).toEqual({
			how: "new",
			text: "",
			use: { id, path: "uses.hh" },
		});
		const [next, cmds] = confirmed(typed(m, "survey"));
		expect(next.banks).toContain("banks/survey");
		expect(next.browser.addingBank).toBeUndefined();
		const bank = Object.values(next.local.schemes).find(
			(s) => s.bank === "banks/survey",
		);
		expect(bank).toMatchObject({ kind: "bank", name: "bank" });
		expect(next.local.workspace[id]?.source).toContain(
			"  hh: ../banks/survey\n",
		);
		// The author stays in the instrument, the caret after what was written.
		expect(next.screen).toEqual({ kind: "editing", id });
		expect(cmds[0]?.kind).toBe("revealRange");
		// Deleting its only file, a draft, unlists it; a bank GitHub has stays listed.
		const gone = update(
			update(next, { kind: "deleteRequested", id: bank?.id ?? 0 })[0],
			{ kind: "deleteRequested", id: bank?.id ?? 0 },
		)[0];
		expect(gone.banks).not.toContain("banks/survey");
		expect(gone.banks).toEqual(loaded().banks);
	});

	it("keeps a bank GitHub has when its files here are all gone", () => {
		const m = loaded();
		const inHouseholds = [
			...Object.values(m.local.questions),
			...Object.values(m.local.schemes),
		].filter((f) => f.bank === "households");
		const dropped = inHouseholds.reduce(
			(acc, f) =>
				update(update(acc, { kind: "deleteRequested", id: f.id })[0], {
					kind: "deleteRequested",
					id: f.id,
				})[0],
			m,
		);
		expect(dropped.banks).toContain("households");
	});

	it("refuses a folder no bank can be in, or one a bank has", () => {
		const { m } = fromUses("new");
		const problem = (text: string) => {
			const next = typed(m, text);
			return next.browser.addingBank === undefined
				? "closed"
				: bankAddProblem(next, next.browser.addingBank);
		};
		expect(problem("")).toBe("Give it a name.");
		expect(problem("Has Space")).toBeDefined();
		expect(problem("survey")).toBeUndefined();
		const made = confirmed(typed(m, "survey"))[0];
		expect(bankAddProblem(made, { how: "new", text: " survey " })).toMatch(
			/already a bank/,
		);
	});

	it("uses one on GitHub: its address written, and its read started at once", () => {
		const { id, m } = fromUses("import");
		expect(bankAddProblem(m, { how: "import", text: "../households" })).toMatch(
			/choose it from the list/,
		);
		expect(bankAddProblem(m, { how: "import", text: "o/r" })).toMatch(
			/no version/,
		);
		const [next, cmds] = confirmed(typed(m, "Owner/Bank@v2"));
		expect(next.local.workspace[id]?.source).toContain("  hh: Owner/Bank@v2\n");
		expect(cmds.some((c) => c.kind === "loadRemoteBanks" && c.now)).toBe(true);
	});

	it("from New, opens the new bank's details", () => {
		const m = update(loaded(), { kind: "bankAddOpened", how: "new" })[0];
		const [next] = confirmed(typed(m, "survey"));
		const id = next.screen.kind === "editing" ? next.screen.id : undefined;
		expect(id !== undefined && next.local.schemes[id]?.bank).toBe(
			"banks/survey",
		);
	});
});
