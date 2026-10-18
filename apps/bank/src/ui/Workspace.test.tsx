// @vitest-environment jsdom

import { resolve } from "node:path";
/**
 * A workspace, drawn: its instruments first, then its questions and shared files, and
 * what New makes in it.
 */
import { ThemeProvider } from "@primer/react/next";
import { ok } from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import type { Store } from "@qretools/shell";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detailsOf } from "../model.js";
import type { Work } from "../persist.js";
import { createApp } from "../store.js";
import { App } from "./App.js";
import { AppContext } from "./AppContext.js";

const file = (path: string, text: string) => ({
	path,
	sha: `sha-${path}`,
	text,
});
/** The example questions as the template ships them (the library's fixture), in `questions/example/`. */
const EXAMPLE_QUESTIONS = Object.entries(
	// From the package's folder, where Vitest runs: jsdom gives this module no file URL.
	await readWorkspace(resolve("../../packages/core/fixtures/bank")),
).map(([path, text]) => file(path, text));

const QUESTION = (name: string) =>
	`name: ${name}\ntext: Is it so?\nintent: To see.\nresponses: yn\n`;
const FILES = [
	file("workspace.yaml", "agency: org.example\n"),
	file("scales/yn.yaml", 'labels:\n  "1": Yes\n  "2": No\n'),
	file("questions/t/alpha.yaml", QUESTION("alpha")),
	file("questions/u/beta.yaml", QUESTION("beta")),
	file(
		"instruments/wave1.yaml",
		"name: wave1\nuses:\n  a: ../\nflow:\n  - ask: a.alpha\n  - section: Close\n    flow:\n      - say: Thank you.\n",
	),
];

function renderWorkspace(
	files = FILES,
	access = { kind: "write" },
	/** This tab's kept work, and a load that waits for `loading`. */
	start: { work?: Work; loading?: Promise<void> } = {},
) {
	const store = {
		whoAmI: () =>
			Promise.resolve(
				ok({
					login: "me",
					avatarUrl: "https://a/me",
					// A copy, as each reply from GitHub is: a test may change what it says next.
					access: { ...access },
					defaultBranch: "main",
				}),
			),
		// A bank in another repository an instrument names: one question, `far`.
		loadBankAt: () =>
			Promise.resolve(
				ok({
					found: true,
					files: [
						{
							path: "workspace.yaml",
							sha: "r1",
							text: "agency: org.example\n",
						},
						{ path: "questions/t/far.yaml", sha: "r2", text: QUESTION("far") },
					],
					unread: [],
				}),
			),
		loadWorkspace: () =>
			(start.loading ?? Promise.resolve()).then(() =>
				ok({
					files,
					found: true,
					from: "branch",
					aheadBy: 0,
					behindBy: 0,
					unread: [],
				}),
			),
	} as unknown as Store;
	const app = createApp(
		{
			work: ok(start.work),
			settings: { owner: "o", repo: "r", path: "", remember: false },
			hasToken: true,
		},
		{
			makeStore: () => store,
			credentialStore: {
				load: () => ({ credentials: { access: "t" }, remember: false }),
				save: () => {},
				clear: () => {},
			},
		},
	);
	render(
		<AppContext.Provider value={app}>
			<ThemeProvider colorMode="light">
				<App />
			</ThemeProvider>
		</AppContext.Provider>,
	);
	return app;
}

describe("a workspace's bank", () => {
	it("is its root alone: one set of questions and shared files, and New asks no bank", async () => {
		renderWorkspace([
			...FILES,
			// Settings in a folder make no bank of it.
			file("banks/b/workspace.yaml", "agency: org.example\n"),
		]);
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		expect(within(nav).queryByRole("region", { name: "banks/b" })).toBeNull();
		expect(
			within(nav).getAllByRole("heading", { name: "Questions" }),
		).toHaveLength(1);
		for (const folder of ["t", "u"])
			expect(
				within(nav).getByRole("treeitem", {
					name: new RegExp(`^${folder}\\b`),
				}),
			).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
		expect(items[0]).toBe("Instrument…");
		expect(items).not.toContain("Bank…");
		expect(items).toContain("Blank question");
	});
});

describe("the workspace's details, open while the workspace loads", () => {
	it("aren't told a folder holds no question until the questions are here", async () => {
		const required =
			"agency: org.example\nrequired_in:\n  questions/t:\n    - universe\n  questions/gone:\n    - universe\n";
		let arrive = () => {};
		const loading = new Promise<void>((done) => {
			arrive = done;
		});
		// Kept from before a reload: the details with unsaved changes, and no question
		// (a clean copy is never kept; the load brings it).
		const app = renderWorkspace(
			FILES,
			{ kind: "write" },
			{
				loading,
				work: {
					version: 8,
					repo: "o/r",
					login: "me",
					nextId: 2,
					questions: [],
					schemes: [
						{
							kind: "workspace",
							name: "workspace",
							id: 1,
							source: required,
							base: {
								path: "workspace.yaml",
								sha: "sha-workspace.yaml",
								text: "agency: org.example\n",
							},
						},
					],
					workspace: [],
				},
			},
		);
		await act(async () => {});
		await act(async () => app.dispatch({ kind: "fileOpened", id: 1 }));
		expect(app.store.getState().model.loading.kind).toBe("loading");
		expect(screen.queryByText(/No questions are saved in/)).toBeNull();
		await act(async () => arrive());
		await waitFor(() =>
			expect(screen.getAllByText(/No questions are saved in/)).toHaveLength(1),
		);
		expect(app.store.getState().model.loading.kind).toBe("loaded");
	});
});

describe("a workspace's instruments", () => {
	// jsdom makes no blob URLs; an open instrument's download link needs one.
	const { createObjectURL, revokeObjectURL } = URL;
	beforeEach(() => {
		URL.createObjectURL = () => "blob:ddi";
		URL.revokeObjectURL = () => {};
	});
	afterEach(() => {
		URL.createObjectURL = createObjectURL;
		URL.revokeObjectURL = revokeObjectURL;
	});

	it("come first, then the questions, and hold only instruments", async () => {
		renderWorkspace();
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		const headings = within(nav)
			.getAllByRole("heading", { level: 3 })
			.map((h) => h.textContent);
		expect(headings.slice(0, 2)).toEqual(["Instruments", "Questions"]);
		const tree = within(nav).getByRole("tree", { name: "Instruments" });
		const items = within(tree)
			.getAllByRole("treeitem")
			.map((i) => i.textContent ?? "");
		expect(items).toHaveLength(1);
		expect(items[0]).toMatch(/^wave1/);
	});

	it("list the workspace's own files under Settings, one row each, and nowhere else", async () => {
		const app = renderWorkspace();
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		const settings = within(nav).getByRole("tree", { name: "Settings" });
		const row = (name: RegExp) =>
			within(settings).getByRole("treeitem", { name });
		// No file of select all that apply: what applies is said beside its row,
		// in full where it's heard, with no verdict on a file that isn't there.
		const selectAll = within(settings).getByRole("treeitem", {
			name: "select_all.yaml",
			description: "usual coding: 0 = No, 1 = Yes",
		});
		expect(selectAll.textContent).toContain("usual");
		const details = row(/^workspace\.yaml/);
		expect(details.getAttribute("aria-current")).toBeNull();
		fireEvent.click(details);
		await act(async () => {});
		const { model } = app.store.getState();
		const entry = detailsOf(model.local.schemes);
		expect(entry?.base?.path).toBe("workspace.yaml");
		expect(model.screen).toEqual({ kind: "editing", id: entry?.id });
		expect(row(/^workspace\.yaml/).getAttribute("aria-current")).toBe("true");
		// Not a shared kind: neither Shared nor New lists them.
		const shared = within(nav).getByRole("tree", { name: "Shared" });
		expect(
			within(shared).queryByRole("treeitem", {
				name: /\.yaml$|details|missing|select all/i,
			}),
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		expect(
			screen
				.getAllByRole("menuitem")
				.map((i) => i.textContent)
				.filter((t) => /details|missing|select-all/i.test(t ?? "")),
		).toEqual([]);
	});

	it("start the workspace's details from their row when it has none, which says they're to fill in", async () => {
		const app = renderWorkspace(
			FILES.filter((f) => f.path !== "workspace.yaml"),
		);
		await act(async () => {});
		const settings = screen.getByRole("tree", { name: "Settings" });
		fireEvent.click(
			within(settings).getByRole("treeitem", {
				name: "workspace.yaml",
				description: /has fields to fill in/,
			}),
		);
		await act(async () => {});
		const { model } = app.store.getState();
		const details = detailsOf(model.local.schemes);
		expect(details).toMatchObject({ kind: "workspace" });
		expect(details?.base).toBeUndefined();
		expect(model.screen).toEqual({ kind: "editing", id: details?.id });
	});

	it("are listed on a question they use, as links to them", async () => {
		const app = renderWorkspace();
		await act(async () => {});
		const alpha = Object.values(
			app.store.getState().model.local.questions,
		).find((q) => q.base?.path === "questions/t/alpha.yaml");
		act(() => app.dispatch({ kind: "fileOpened", id: alpha?.id ?? -1 }));
		await act(async () => {});
		const heading = screen.getByRole("heading", { name: /^Used by/ });
		expect(heading.textContent).toMatch(/^Used by\s*1\b/);
		// The tree's wave1 is a tree item; the pane's is a link, and so is each step.
		expect(screen.getByRole("link", { name: "wave1" })).toBeTruthy();
		const step = screen.getByRole("link", { name: /^Ask\s*a\.alpha$/ });
		expect(step.getAttribute("href")).toMatch(/&at=flow\.0\.ask$/);
	});

	it("count, and are listed apart, on a shared scale a question and an instrument both use", async () => {
		const app = renderWorkspace([
			...FILES.filter((f) => f.path !== "instruments/wave1.yaml"),
			file(
				"instruments/wave1.yaml",
				"name: wave1\nuses:\n  a: ../\ninputs:\n  x:\n    responses: a.yn\nflow:\n  - ask: a.alpha\n",
			),
		]);
		await act(async () => {});
		const yn = Object.values(app.store.getState().model.local.schemes).find(
			(e) => e.name === "yn",
		);
		act(() => app.dispatch({ kind: "fileOpened", id: yn?.id ?? -1 }));
		await act(async () => {});
		// Opening it opens its section: the tree's count is the pane's, both kinds of file.
		expect(screen.getAllByText("used by 3").length).toBeGreaterThan(0);
		// The previews (ScrollableRegion names itself only while it scrolls, which jsdom
		// never measures).
		const previews = document.querySelector(".split .right") as HTMLElement;
		for (const name of ["Questions", "Instruments"])
			expect(within(previews).getByRole("heading", { name })).toBeTruthy();
		expect(within(previews).getByRole("link", { name: "alpha" })).toBeTruthy();
		expect(within(previews).getByRole("link", { name: "wave1" })).toBeTruthy();
	});

	it("open as their source, findings, outline and DDI", async () => {
		renderWorkspace();
		await act(async () => {});
		fireEvent.click(screen.getByRole("treeitem", { name: /^wave1\b/ }));
		await act(async () => {});
		expect(
			screen.getByRole("heading", { level: 2, name: /instrument\s*wave1/ }),
		).toBeTruthy();
		for (const name of [/^Findings/, /^Outline/, /DDI-Lifecycle/])
			expect(screen.getByRole("heading", { name })).toBeTruthy();
		// The outline is the flow, each step a way to its place.
		expect(screen.getByRole("button", { name: /alpha/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Close/ })).toBeTruthy();
		// An ask's label goes to the source, its question's words to the question.
		expect(
			screen.getByRole("button", { name: /alpha\s*in the source$/ }),
		).toBeTruthy();
		const words = screen.getByRole("link", { name: "Is it so?" });
		expect(words.getAttribute("href")).toMatch(
			/file=questions%2Ft%2Falpha\.yaml/,
		);
	});

	it("are made from New, named first", async () => {
		const app = renderWorkspace();
		await act(async () => {});
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Instrument…" }));
		const dialog = await screen.findByRole("dialog", {
			name: "New instrument",
		});
		fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), {
			target: { value: "wave2" },
		});
		expect(within(dialog).getByText("instruments/wave2.yaml")).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
		await act(async () => {});
		const tree = screen.getByRole("tree", { name: "Instruments" });
		expect(within(tree).getByRole("treeitem", { name: /^wave2/ })).toBeTruthy();
		// Not the workspace's first instrument: no offer of the example.
		expect(screen.queryByText("New here?")).toBeNull();
		const { model } = app.store.getState();
		expect(
			Object.values(model.local.workspace).map((e) =>
				e.kind === "instrument" ? e.name : e.kind,
			),
		).toContain("wave2");
	});

	it("come with the bank's empty sections in a workspace of instruments alone, and New makes a question there", async () => {
		// The workspace's root is its bank, with or without a file in it yet.
		renderWorkspace([
			file(
				"instruments/w.yaml",
				"name: w\nuses:\n  tpl: JHUCities/qretools-bank-template@v1\nflow:\n  - ask: tpl.q\n",
			),
		]);
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		expect(within(nav).getByRole("tree", { name: "Instruments" })).toBeTruthy();
		expect(
			within(nav).getByRole("heading", { name: "Questions" }),
		).toBeTruthy();
		expect(within(nav).getByText("No questions yet")).toBeTruthy();
		expect(within(nav).getByRole("heading", { name: "Shared" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
		expect(items[0]).toBe("Instrument…");
		expect(items).toContain("Blank question");
	});

	it("draw their pickers: a question at each ask, a bank at each use", async () => {
		renderWorkspace();
		await act(async () => {});
		fireEvent.click(screen.getByRole("treeitem", { name: /^wave1/ }));
		await act(async () => {});
		const labels = [...document.querySelectorAll(".cm-livelit")].map((b) =>
			b.getAttribute("aria-label"),
		);
		expect(labels).toEqual(["Choose a bank", "Choose a question"]);
	});

	it("leave an empty repository as it was: one bank to start, at its root", async () => {
		renderWorkspace([]);
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		expect(
			within(nav).getByRole("heading", { name: "Questions" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		expect(
			screen.getByRole("menuitem", { name: "Blank question" }),
		).toBeTruthy();
	});

	it("hold the download back, with the reason, while the workspace gives no agency", async () => {
		renderWorkspace(FILES.filter((f) => f.path !== "workspace.yaml"));
		await act(async () => {});
		fireEvent.click(screen.getByRole("treeitem", { name: /^wave1\b/ }));
		await act(async () => {});
		expect(screen.getByText(/This workspace has no/)).toBeTruthy();
		const download = screen.getByRole("button", { name: "Download DDI" });
		const reason = document.getElementById(
			download.getAttribute("aria-describedby") ?? "",
		);
		expect(reason?.textContent).toBe(
			"There's no DDI agency to publish it under yet.",
		);
		// The survey is made from the DDI: held back for the same reason.
		const qsf = screen.getByRole("button", { name: "Download QSF" });
		expect(qsf.getAttribute("aria-describedby")).toBe(
			download.getAttribute("aria-describedby"),
		);
	});

	it("offer the DDI as a file once it may be exported, a new one as it changes", async () => {
		let made = 0;
		const revoked: string[] = [];
		URL.createObjectURL = () => `blob:${++made}`;
		URL.revokeObjectURL = (u: string) => {
			revoked.push(u);
		};
		const app = renderWorkspace();
		await act(async () => {});
		fireEvent.click(screen.getByRole("treeitem", { name: /^wave1\b/ }));
		// The official schema loads on its own; then the export may be written.
		await vi.waitFor(
			() => expect(app.store.getState().model.ddiSchema.kind).toBe("ready"),
			{ timeout: 10_000 },
		);
		await act(async () => {});
		const link = screen.getByRole("link", { name: "Download DDI" });
		expect(link.getAttribute("download")).toBe("wave1.ddi.json");
		const first = link.getAttribute("href");
		expect(first).toMatch(/^blob:/);
		const { model } = app.store.getState();
		const e = Object.values(model.local.workspace).find(
			(f) => f.kind === "instrument",
		);
		await act(async () =>
			app.dispatch({ kind: "edited", text: `${e?.source ?? ""}# again\n` }),
		);
		expect(
			screen.getByRole("link", { name: "Download DDI" }).getAttribute("href"),
		).not.toBe(first);
		expect(revoked).toContain(first);
		expect(
			screen
				.getByRole("link", { name: "Download QSF" })
				.getAttribute("download"),
		).toBe("wave1.qsf");
		// A warning showing the answer it checks: Qualtrics would show it empty.
		await act(async () =>
			app.dispatch({
				kind: "edited",
				text: (e?.source ?? "").replace(
					"  - ask: a.alpha\n",
					'  - ask: a.alpha\n    checks:\n      - ensure: a.alpha = "1"\n        severity: warning\n        message: "{{a.alpha}}?"\n',
				),
			}),
		);
		const qsf = screen.getByRole("button", { name: "Download QSF" });
		expect(
			document.getElementById(qsf.getAttribute("aria-describedby") ?? "")
				?.textContent,
		).toMatch(/^1 thing in this instrument can't be run in Qualtrics/);
		expect(
			within(screen.getByRole("list", { name: "Qualtrics" })).getAllByRole(
				"listitem",
			).length,
		).toBeGreaterThan(0);
		expect(screen.getByRole("link", { name: "Download DDI" })).toBeTruthy();
	}, 15_000);

	it("mark a name of this workspace's bank apart from one of another repository's", async () => {
		renderWorkspace([
			...FILES.filter((f) => f.path !== "instruments/wave1.yaml"),
			file(
				"instruments/wave1.yaml",
				"name: wave1\nuses:\n  a: ../\n  far: o/elsewhere@v1\nflow:\n  - ask: a.alpha\n  - ask: far.far\n",
			),
		]);
		await act(async () => {});
		fireEvent.click(screen.getByRole("treeitem", { name: /^wave1\b/ }));
		await act(async () => {});
		const editor = document.querySelector(".cm-content") as HTMLElement;
		const local = [...editor.querySelectorAll(".cm-ref:not(.cm-external)")];
		const away = [...editor.querySelectorAll(".cm-external")];
		expect(local.map((e) => e.textContent)).toEqual(["a.alpha"]);
		expect(away.map((e) => e.textContent)).toEqual(["far.far"]);
	});

	// The owner (2026-10-14): a workspace of questions alone is normal, so with no
	// instrument there's no section saying so.
	it("show no section until there's one, and the first offers the example where the example questions are", async () => {
		const app = renderWorkspace([...EXAMPLE_QUESTIONS]);
		await act(async () => {});
		expect(screen.queryByRole("heading", { name: "Instruments" })).toBeNull();
		// The section offers nothing itself (owner, 2026-10-13): New, in the header, starts
		// one, and the first one offers the example beside it.
		expect(screen.queryByRole("button", { name: "New instrument" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Instrument…" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "mine" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await act(async () => {});
		expect(screen.getByRole("tree", { name: "Instruments" })).toBeTruthy();
		// Primer's Banner draws its action twice, for its wide and narrow layouts.
		const [open] = screen.getAllByRole("button", { name: "Open the example" });
		fireEvent.click(open as HTMLElement);
		expect(app.store.getState().model.browser.namingInstrument).toEqual({
			name: "example",
			example: true,
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await act(async () => {});
		const made = Object.values(app.store.getState().model.local.workspace).find(
			(e) => e.kind === "instrument" && e.name === "example",
		);
		// It asks its own workspace's questions.
		expect(made?.source).toContain("uses:\n  example: ../\n");
		expect(made?.source).toContain(
			"rating: label(example.service_satisfaction)",
		);
		// Two instruments now: neither offers it again.
		expect(screen.queryByText("New here?")).toBeNull();
	});

	it("show no section in a workspace without the example questions, where the first offers no example", async () => {
		renderWorkspace([
			file("workspace.yaml", "agency: org.example\n"),
			file("questions/t/alpha.yaml", QUESTION("alpha")),
		]);
		await act(async () => {});
		expect(screen.queryByRole("heading", { name: "Instruments" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Instrument…" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "mine" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await act(async () => {});
		expect(screen.getByRole("tree", { name: "Instruments" })).toBeTruthy();
		// No question in `questions/example/`: nothing to offer.
		expect(screen.queryByText("New here?")).toBeNull();
	});

	it("stop offering the example once the offer is dismissed", async () => {
		const app = renderWorkspace([...EXAMPLE_QUESTIONS]);
		await act(async () => {});
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Instrument…" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "mine" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await act(async () => {});
		expect(screen.getByText("New here?")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
		expect(screen.queryByText("New here?")).toBeNull();
		expect(app.store.getState().model.browser.exampleHintDismissed).toBe(true);
	});
});

describe("a fix in the Findings list", () => {
	it("marks a similar question as a variant, into the text as it is now", async () => {
		const LONG =
			"How strongly do you agree that residents are treated fairly by police officers in your own neighborhood these days";
		const app = renderWorkspace([
			file("workspace.yaml", "agency: org.example\n"),
			file(
				"questions/t/alpha.yaml",
				`name: alpha\ntext: ${LONG} here?\nintent: To see.\nopen: {}\n`,
			),
			file(
				"questions/t/beta.yaml",
				`name: beta\ntext: ${LONG} now?\nintent: To see.\nopen: {}\n`,
			),
		]);
		await act(async () => {});
		fireEvent.click(screen.getByRole("treeitem", { name: /^t\b/ }));
		fireEvent.click(screen.getByRole("treeitem", { name: /^alpha/ }));
		await act(async () => {});
		const fix = await screen.findByRole("button", {
			name: "Mark as a variant of beta",
		});
		fireEvent.click(fix);
		await act(async () => {});
		const { model } = app.store.getState();
		const alpha = Object.values(model.local.questions).find((q) =>
			q.source.startsWith("name: alpha"),
		);
		expect(alpha?.source).toMatch(/\nvariant_of:\n {2}beta:\n$/);
	});
});

describe("a write the session can't make", () => {
	const REASON =
		"The QREtools app isn't installed on this repository, so this workspace can't be changed";
	const openAlpha = async () => {
		const app = renderWorkspace(FILES, { kind: "notInstalled" });
		await act(async () => {});
		fireEvent.click(screen.getByRole("treeitem", { name: /^t\b/ }));
		fireEvent.click(screen.getByRole("treeitem", { name: /^alpha/ }));
		await act(async () => {});
		return app;
	};
	const describedBy = (el: HTMLElement) =>
		(el.getAttribute("aria-describedby") ?? "")
			.split(" ")
			.map((id) => document.getElementById(id)?.textContent ?? "")
			.join(" ")
			.trim();

	it("is said in full in the top bar, and at the button as its description", async () => {
		await openAlpha();
		expect(document.getElementById("session-status")?.textContent).toBe(REASON);
		const remove = screen.getByRole("button", { name: "Delete…" });
		expect(remove.getAttribute("aria-disabled")).toBe("true");
		expect(describedBy(remove)).toBe(REASON);
	});

	it("opens a notice with the reason and what to do when the button is pressed", async () => {
		const app = await openAlpha();
		fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
		const dialog = await screen.findByRole("dialog", {
			name: "This workspace can't be changed",
		});
		expect(dialog.textContent).toContain(
			`${REASON}. Install it there, then try again.`,
		);
		expect(
			within(dialog).getByRole("button", { name: "Try again" }),
		).toBeTruthy();
		// Nothing was asked of GitHub, and nothing confirmed: the file is still there.
		expect(app.store.getState().model.browser.confirmDelete).toBeUndefined();
		fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
		await act(async () => {});
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("says nothing at a Save with nothing to save, and the reason once there is", async () => {
		const app = await openAlpha();
		const save = screen.getByRole("button", { name: "Save" });
		fireEvent.click(save);
		await act(async () => {});
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(describedBy(save)).toBe("");
		act(() =>
			app.dispatch({ kind: "edited", text: `${QUESTION("alpha")}note: n\n` }),
		);
		await act(async () => {});
		const unsaved = screen.getByRole("button", { name: "Save" });
		expect(describedBy(unsaved)).toBe(REASON);
		fireEvent.click(unsaved);
		expect(
			await screen.findByRole("dialog", {
				name: "This workspace can't be changed",
			}),
		).toBeTruthy();
	});

	it("becomes possible when the author comes back from installing the app, with nothing reloaded", async () => {
		const access = { kind: "notInstalled" };
		const app = renderWorkspace(FILES, access);
		await act(async () => {});
		fireEvent.click(screen.getByRole("treeitem", { name: /^t\b/ }));
		fireEvent.click(screen.getByRole("treeitem", { name: /^alpha/ }));
		await act(async () => {});
		const before = app.store.getState().model;
		expect(
			screen
				.getByRole("button", { name: "Delete…" })
				.getAttribute("aria-disabled"),
		).toBe("true");
		// Installed in another tab; then back to this one.
		access.kind = "write";
		act(() => app.dispatch({ kind: "tabShown" }));
		await act(async () => {});
		const after = app.store.getState().model;
		expect(after.session).toMatchObject({ access: { kind: "write" } });
		expect(after.loading).toBe(before.loading);
		expect(after.local).toBe(before.local);
		expect(
			screen
				.getByRole("button", { name: "Delete…" })
				.getAttribute("aria-disabled"),
		).toBeNull();
		await waitFor(() =>
			expect(document.getElementById("session-status")?.textContent).toBe(""),
		);
	});
});
