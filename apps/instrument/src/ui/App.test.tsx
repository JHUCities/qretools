// @vitest-environment jsdom
import { ThemeProvider } from "@primer/react/next";
import { err, ok } from "@qretools/core";
import type { Store } from "@qretools/shell";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createApp } from "../store.ts";
import { App } from "./App.tsx";
import { AppContext } from "./AppContext.ts";

const SETTINGS = { owner: "o", repo: "r", path: "", remember: false };

function renderApp(
	token: boolean,
	{
		instrument = "name: x\n",
		project = "name: x\n",
	}: { instrument?: string; project?: string | null } = {},
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
			Promise.resolve(ok([file("instruments/households.yaml", instrument)])),
		read: () =>
			Promise.resolve(
				project === null
					? err({ kind: "http", status: 404, message: "Not there." })
					: ok(file("project.yaml", project)),
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
	it("signed out, is the sign-in page for a project", () => {
		renderApp(false);
		expect(
			screen.getByRole("heading", { name: "Sign in to your project" }),
		).toBeTruthy();
		expect(screen.getByRole("textbox", { name: "Project" })).toBeTruthy();
	});

	it("signed in, lists the project's instruments as links to their addresses", async () => {
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
			project: null,
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
		expect(screen.getByText(/This project has no/)).toBeTruthy();
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
			project: "agency: org.example\n",
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
});
