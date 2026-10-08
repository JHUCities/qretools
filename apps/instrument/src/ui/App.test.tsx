// @vitest-environment jsdom
import { ThemeProvider } from "@primer/react/next";
import { err, ok } from "@qretools/core";
import type { Store } from "@qretools/shell";
import { act, cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createApp } from "../store.ts";
import { App } from "./App.tsx";
import { AppContext } from "./AppContext.ts";

const SETTINGS = { owner: "o", repo: "r", path: "", remember: false };

function renderApp(
	token: boolean,
	{
		instrument = "name: x\n",
		workspace = "name: x\n",
		folder = true,
		template,
	}: {
		instrument?: string;
		workspace?: string | null;
		folder?: boolean;
		template?: string;
	} = {},
) {
	const file = (path: string, text = "name: x\n") => ({ path, sha: "s", text });
	const store = {
		whoAmI: () =>
			Promise.resolve(
				ok({
					login: "me",
					avatarUrl: "https://a/me",
					access: { kind: "readOnly" },
					defaultBranch: "main",
				}),
			),
		readFolder: () =>
			Promise.resolve(
				ok(folder ? [file("instruments/households.yaml", instrument)] : null),
			),
		read: () =>
			Promise.resolve(
				workspace === null
					? err({ kind: "http", status: 404, message: "Not there." })
					: ok(file("workspace.yaml", workspace)),
			),
	} as unknown as Store;
	const app = createApp(
		{ settings: SETTINGS, hasToken: token },
		{
			makeStore: () => store,
			credentialStore: {
				load: () =>
					token ? { credentials: { access: "t" }, remember: false } : null,
				save: () => {},
				clear: () => {},
			},
		},
		template === undefined ? {} : { template },
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

describe("the instrument app", () => {
	it("signed out, is the sign-in page for a workspace", () => {
		renderApp(false);
		expect(
			screen.getByRole("heading", { name: "Sign in to your workspace" }),
		).toBeTruthy();
		expect(screen.getByRole("textbox", { name: "Workspace" })).toBeTruthy();
	});

	it("signed in, lists the workspace's instruments as links to their addresses", async () => {
		renderApp(true);
		await act(async () => {});
		const link = screen.getByRole("link", { name: "households" });
		expect(link.getAttribute("href")).toBe(
			"#repo=o%2Fr&branch=main&file=instruments%2Fhouseholds.yaml",
		);
	});

	it("opens an instrument with its findings, outline and DDI, and holds the download back with the reason", async () => {
		const app = renderApp(true, {
			instrument: "name: households\nflow:\n  - say: Hello.\n",
			workspace: null,
		});
		await act(async () => {});
		await act(async () =>
			app.dispatch({
				kind: "hashChanged",
				hash: "#repo=o%2Fr&branch=main&file=instruments%2Fhouseholds.yaml",
			}),
		);
		for (const pane of ["Findings", "Outline"])
			expect(
				screen.getByRole("heading", { name: new RegExp(pane) }),
			).toBeTruthy();
		expect(screen.getByRole("button", { name: "Say Hello." })).toBeTruthy();
		expect(screen.getByText(/This workspace has no/)).toBeTruthy();
		const download = screen.getByRole("button", { name: "Download DDI" });
		const reason = document.getElementById(
			download.getAttribute("aria-describedby") ?? "",
		);
		expect(reason?.textContent).toBe(
			"There's no DDI agency to publish it under yet.",
		);
	});

	it("offers the DDI as a file once it may be exported, a new one as it changes", async () => {
		let made = 0;
		const revoked: string[] = [];
		// jsdom has no blob URLs: stand-ins, put back after.
		const { createObjectURL, revokeObjectURL } = URL;
		URL.createObjectURL = () => `blob:${++made}`;
		URL.revokeObjectURL = (u: string) => {
			revoked.push(u);
		};
		onTestFinished(() => {
			URL.createObjectURL = createObjectURL;
			URL.revokeObjectURL = revokeObjectURL;
		});
		const app = renderApp(true, {
			instrument: "name: households\nflow:\n  - say: Hello.\n",
			workspace: "agency: org.example\n",
		});
		await act(async () => {});
		await act(async () =>
			app.dispatch({
				kind: "hashChanged",
				hash: "#repo=o%2Fr&branch=main&file=instruments%2Fhouseholds.yaml",
			}),
		);
		// The official schema loads on its own; then the export may be written.
		await vi.waitFor(
			() => expect(app.store.getState().model.ddiSchema.kind).toBe("ready"),
			{ timeout: 10_000 },
		);
		await act(async () => {});
		const link = screen.getByRole("link", { name: "Download DDI" });
		expect(link.getAttribute("download")).toBe("households.ddi.json");
		const first = link.getAttribute("href");
		expect(first).toMatch(/^blob:/);
		await act(async () =>
			app.dispatch({
				kind: "edited",
				text: "name: households\nflow:\n  - say: Hello again.\n",
			}),
		);
		const next = screen.getByRole("link", { name: "Download DDI" });
		expect(next.getAttribute("href")).not.toBe(first);
		expect(revoked).toContain(first);
	});

	it("offers the workspace template to someone without a workspace", async () => {
		const template =
			"https://github.com/JHUCities/qretools-instrument-template/generate";
		renderApp(false, { template });
		expect(
			screen
				.getByRole("link", { name: /Start one from the template/ })
				.getAttribute("href"),
		).toBe(template);
		cleanup();
		renderApp(true, { template, folder: false });
		await act(async () => {});
		expect(screen.getByText(/has no instruments\/ folder yet/)).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: /Start a workspace from the template/ })
				.getAttribute("href"),
		).toBe(template);
	});
});
