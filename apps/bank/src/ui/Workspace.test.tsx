// @vitest-environment jsdom

import { resolve } from "node:path";
/**
 * A workspace of several banks, drawn: each bank under its own heading with its own
 * questions and shared files, and New asking which bank first. A workspace of one bank
 * is drawn as a bank always was (the header's and the browser's own tests).
 */
import { ThemeProvider } from "@primer/react/next";
import { ok } from "@qretools/core";
import { readBank } from "@qretools/core/node";
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
import { createApp } from "../store.js";
import { App } from "./App.js";
import { AppContext } from "./AppContext.js";

const file = (path: string, text: string) => ({
	path,
	sha: `sha-${path}`,
	text,
});
/** The example bank as the template ships it (the library's fixture), at `banks/example`. */
const EXAMPLE_BANK = Object.entries(
	// From the package's folder, where Vitest runs: jsdom gives this module no file URL.
	await readBank(resolve("../../packages/core/fixtures/bank")),
).map(([path, text]) => file(`banks/example/${path}`, text));

const QUESTION = (name: string) =>
	`name: ${name}\ntext: Is it so?\nintent: To see.\nresponses: yn\n`;
const FILES = [
	file("workspace.yaml", "agency: org.example\n"),
	file("banks/a/bank.yaml", "agency: org.example\n"),
	file("banks/a/scales/yn.yaml", 'labels:\n  "1": Yes\n  "2": No\n'),
	file("banks/a/questions/t/alpha.yaml", QUESTION("alpha")),
	file("banks/b/bank.yaml", "agency: org.example\n"),
	file("banks/b/questions/u/beta.yaml", QUESTION("beta")),
	file(
		"instruments/wave1.yaml",
		"name: wave1\nuses:\n  a: ../banks/a\nflow:\n  - ask: a.alpha\n  - section: Close\n    flow:\n      - say: Thank you.\n",
	),
];

function renderWorkspace(files = FILES, access = { kind: "write" }) {
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
						{ path: "bank.yaml", sha: "r1", text: "agency: org.example\n" },
						{ path: "questions/t/far.yaml", sha: "r2", text: QUESTION("far") },
					],
					unread: [],
				}),
			),
		loadWorkspace: () =>
			Promise.resolve(
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
			work: ok(undefined),
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

describe("a workspace of several banks", () => {
	it("shows each bank under its own heading, with its own questions and shared files", async () => {
		renderWorkspace();
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		for (const [bank, folder] of [
			["banks/a", "t"],
			["banks/b", "u"],
		] as const) {
			const region = within(nav).getByRole("region", { name: bank });
			expect(
				within(region).getByRole("heading", { level: 4, name: "Questions" }),
			).toBeTruthy();
			expect(
				within(region).getByRole("treeitem", {
					name: new RegExp(`^${folder}\\b`),
				}),
			).toBeTruthy();
		}
		// The scale is bank a's alone: bank a's shared scales count it, bank b's don't.
		const a = within(nav).getByRole("region", { name: "banks/a" });
		const b = within(nav).getByRole("region", { name: "banks/b" });
		const scales = (region: HTMLElement) =>
			within(region).getByRole("treeitem", { name: "Scales" });
		expect(within(scales(a)).getByText("1")).toBeTruthy();
		expect(within(scales(b)).getByText("0")).toBeTruthy();
	});

	it("asks which bank a new file goes in, and puts it there", async () => {
		const app = renderWorkspace();
		await act(async () => {});
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
			"Instrument…",
			"Bank…",
			"banks/a",
			"banks/b",
		]);
		fireEvent.click(screen.getByRole("menuitem", { name: "banks/b" }));
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Blank question" }),
		);
		const { model } = app.store.getState();
		const made = Object.values(model.local.questions).find(
			(q) => q.base === undefined,
		);
		expect(made?.bank).toBe("banks/b");
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

	it("come first, then each bank, and hold only instruments", async () => {
		renderWorkspace();
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		const headings = within(nav)
			.getAllByRole("heading", { level: 3 })
			.map((h) => h.textContent);
		expect(headings.slice(0, 2)).toEqual(["Instruments", "banks/a"]);
		const tree = within(nav).getByRole("tree", { name: "Instruments" });
		const items = within(tree)
			.getAllByRole("treeitem")
			.map((i) => i.textContent ?? "");
		expect(items).toHaveLength(1);
		expect(items[0]).toMatch(/^wave1/);
	});

	it("leave the workspace's details to the button beside its name, which says when they're open", async () => {
		const app = renderWorkspace();
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		const gear = within(nav).getByRole("button", { name: "Workspace details" });
		expect(gear.getAttribute("aria-current")).toBeNull();
		fireEvent.click(gear);
		await act(async () => {});
		const { model } = app.store.getState();
		const details = Object.values(model.local.workspace).find(
			(e) => e.kind === "workspaceFile",
		);
		expect(model.screen).toEqual({ kind: "editing", id: details?.id });
		expect(gear.getAttribute("aria-current")).toBe("page");
	});

	it("say on that button what the tree's marks said: unsaved, and something to fill in", async () => {
		const app = renderWorkspace();
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		fireEvent.click(
			within(nav).getByRole("button", { name: "Workspace details" }),
		);
		await act(async () => {});
		act(() => app.dispatch({ kind: "edited", text: "agency:\n" }));
		await act(async () => {});
		expect(
			within(nav).getByRole("button", {
				name: "Workspace details (unsaved changes; to fill in or fix)",
			}),
		).toBeTruthy();
	});

	it("are listed on a question they use, as links to them", async () => {
		const app = renderWorkspace();
		await act(async () => {});
		const alpha = Object.values(
			app.store.getState().model.local.questions,
		).find((q) => q.base?.path === "banks/a/questions/t/alpha.yaml");
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
				"name: wave1\nuses:\n  a: ../banks/a\ninputs:\n  x:\n    responses: a.yn\nflow:\n  - ask: a.alpha\n",
			),
		]);
		await act(async () => {});
		const yn = Object.values(app.store.getState().model.local.schemes).find(
			(e) => e.name === "yn",
		);
		act(() => app.dispatch({ kind: "fileOpened", id: yn?.id ?? -1 }));
		await act(async () => {});
		// Opening it opens its section: the tree's count is the pane's, both kinds of file.
		expect(screen.getAllByText("used by 2").length).toBeGreaterThan(0);
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
			/file=banks%2Fa%2Fquestions%2Ft%2Falpha\.yaml/,
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

	it("are all a workspace with no bank of its own shows, and New makes them, or a bank", async () => {
		renderWorkspace([
			file("workspace.yaml", "agency: org.example\n"),
			file(
				"instruments/w.yaml",
				"name: w\nuses:\n  tpl: JHUCities/qretools-bank-template@v1\nflow:\n  - ask: tpl.q\n",
			),
		]);
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		expect(within(nav).getByRole("tree", { name: "Instruments" })).toBeTruthy();
		expect(
			within(nav).queryByRole("heading", { name: "Questions" }),
		).toBeNull();
		expect(within(nav).queryByRole("heading", { name: "Shared" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
			"Instrument…",
			"Bank…",
		]);
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

	it("add a new bank from New: named, listed, its details open", async () => {
		const app = renderWorkspace();
		await act(async () => {});
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Bank…" }));
		const dialog = await screen.findByRole("dialog", { name: "New bank" });
		fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), {
			target: { value: "survey" },
		});
		expect(within(dialog).getByText("banks/survey")).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
		await act(async () => {});
		const nav = screen.getByRole("navigation", { name: "Question bank" });
		expect(
			within(nav).getByRole("region", { name: "banks/survey" }),
		).toBeTruthy();
		const { model } = app.store.getState();
		const id = model.screen.kind === "editing" ? model.screen.id : undefined;
		expect(id !== undefined && model.local.schemes[id]).toMatchObject({
			kind: "bank",
			bank: "banks/survey",
		});
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
	}, 15_000);

	it("mark a name of this workspace's bank apart from one of another repository's", async () => {
		renderWorkspace([
			...FILES.filter((f) => f.path !== "instruments/wave1.yaml"),
			file(
				"instruments/wave1.yaml",
				"name: wave1\nuses:\n  a: ../banks/a\n  far: o/elsewhere@v1\nflow:\n  - ask: a.alpha\n  - ask: far.far\n",
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

	// The owner's reversal (2026-10-09): the section stays with none yet, a bank at the
	// root included, so instruments are found where a team starts.
	it("say there are none yet, and the first offers the example where a bank is called example", async () => {
		const app = renderWorkspace([
			file("workspace.yaml", "agency: org.example\n"),
			...EXAMPLE_BANK,
		]);
		await act(async () => {});
		expect(screen.getByRole("heading", { name: "Instruments" })).toBeTruthy();
		expect(screen.queryByRole("tree", { name: "Instruments" })).toBeNull();
		expect(screen.getByText("No instruments yet.")).toBeTruthy();
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
		expect(screen.queryByText("No instruments yet.")).toBeNull();
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
		// It reads the bank called `example`.
		expect(made?.source).toContain("uses:\n  bank: ../banks/example\n");
		expect(made?.source).toContain("rating: label(bank.service_satisfaction)");
		// Two instruments now: neither offers it again.
		expect(screen.queryByText("New here?")).toBeNull();
	});

	it("say there are none yet in a workspace that is one bank alone, where the first offers no example", async () => {
		renderWorkspace([
			file("bank.yaml", "agency: org.example\n"),
			file("questions/t/alpha.yaml", QUESTION("alpha")),
		]);
		await act(async () => {});
		expect(screen.getByRole("heading", { name: "Instruments" })).toBeTruthy();
		expect(screen.getByText("No instruments yet.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "New" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Instrument…" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "mine" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await act(async () => {});
		expect(screen.getByRole("tree", { name: "Instruments" })).toBeTruthy();
		// No bank called `example`: nothing to offer.
		expect(screen.queryByText("New here?")).toBeNull();
	});

	it("stop offering the example once the offer is dismissed", async () => {
		const app = renderWorkspace([
			file("workspace.yaml", "agency: org.example\n"),
			...EXAMPLE_BANK,
		]);
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
			file("banks/a/bank.yaml", "agency: org.example\n"),
			file(
				"banks/a/questions/t/alpha.yaml",
				`name: alpha\ntext: ${LONG} here?\nintent: To see.\nopen: {}\n`,
			),
			file(
				"banks/a/questions/t/beta.yaml",
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
