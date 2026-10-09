// @vitest-environment jsdom

/**
 * A workspace of several banks, drawn: each bank under its own heading with its own
 * questions and shared files, and New asking which bank first. A workspace of one bank
 * is drawn as a bank always was (the header's and the browser's own tests).
 */
import { ThemeProvider } from "@primer/react/next";
import { ok } from "@qretools/core";
import type { Store } from "@qretools/shell";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../store.js";
import { App } from "./App.js";
import { AppContext } from "./AppContext.js";

const file = (path: string, text: string) => ({
	path,
	sha: `sha-${path}`,
	text,
});
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

function renderWorkspace(files = FILES) {
	const store = {
		whoAmI: () =>
			Promise.resolve(
				ok({
					login: "me",
					avatarUrl: "https://a/me",
					access: { kind: "write" },
					defaultBranch: "main",
				}),
			),
		// A bank in another repository an instrument names: not there in these tests.
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
			"Example instrument…",
			"Workspace details",
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
		const { model } = app.store.getState();
		expect(
			Object.values(model.local.workspace).map((e) =>
				e.kind === "instrument" ? e.name : e.kind,
			),
		).toContain("wave2");
	});

	it("are all a workspace with no bank of its own shows, and New makes only them", async () => {
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
			"Example instrument…",
			"Workspace details",
		]);
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
	it("say there are none yet in a workspace that is one bank alone, and offer both ways to start one", async () => {
		const app = renderWorkspace([
			file("bank.yaml", "agency: org.example\n"),
			file("questions/t/alpha.yaml", QUESTION("alpha")),
		]);
		await act(async () => {});
		expect(screen.getByRole("heading", { name: "Instruments" })).toBeTruthy();
		expect(screen.queryByRole("tree", { name: "Instruments" })).toBeNull();
		expect(screen.getByText("No instruments yet.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Example instrument" }));
		expect(app.store.getState().model.browser.namingInstrument).toEqual({
			name: "example",
			example: true,
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await act(async () => {});
		const made = Object.values(app.store.getState().model.local.workspace).find(
			(e) => e.kind === "instrument",
		);
		// The bank is at the root: the example reads it as `../`, built from its question.
		expect(made?.source).toContain("uses:\n  bank: ../\n");
		expect(made?.source).toMatch(/^name: example$/m);
		expect(screen.queryByText("No instruments yet.")).toBeNull();
	});
});
