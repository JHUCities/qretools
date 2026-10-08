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
import { describe, expect, it } from "vitest";
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
];

function renderWorkspace() {
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
		loadWorkspace: () =>
			Promise.resolve(
				ok({
					files: FILES,
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
