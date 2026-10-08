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
		loadBankAt: () =>
			Promise.resolve(ok({ found: false, reason: "Not in these tests." })),
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

	it("come first, then each bank, with the workspace details last among them", async () => {
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
		expect(items).toHaveLength(2);
		expect(items[0]).toMatch(/^wave1/);
		expect(items[1]).toMatch(/^workspace details/);
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

	it("aren't shown for a workspace that is one bank alone", async () => {
		renderWorkspace([
			file("bank.yaml", "agency: org.example\n"),
			file("questions/t/alpha.yaml", QUESTION("alpha")),
		]);
		await act(async () => {});
		expect(screen.queryByRole("heading", { name: "Instruments" })).toBeNull();
		expect(screen.queryByRole("tree", { name: "Instruments" })).toBeNull();
	});
});
