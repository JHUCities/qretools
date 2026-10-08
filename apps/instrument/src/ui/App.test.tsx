// @vitest-environment jsdom
import { ThemeProvider } from "@primer/react/next";
import { ok } from "@qretools/core";
import type { Store } from "@qretools/shell";
import { act, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../store.ts";
import { App } from "./App.tsx";
import { AppContext } from "./AppContext.ts";

// jsdom gaps Primer's Spinner and AriaStatus reach (the bank's header test has the same).
beforeAll(() => {
	window.matchMedia ??= (query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		}) as MediaQueryList;
	if (!customElements.get("live-region"))
		customElements.define(
			"live-region",
			class extends HTMLElement {
				announce() {
					return { cancel: () => {} };
				}
				announceFromElement() {
					return { cancel: () => {} };
				}
			},
		);
});

const SETTINGS = { owner: "o", repo: "r", path: "", remember: false };

function renderApp(token: boolean) {
	const file = (path: string) => ({ path, sha: "s", text: "name: x\n" });
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
			Promise.resolve(ok([file("instruments/households.yaml")])),
		read: () => Promise.resolve(ok(file("project.yaml"))),
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
});
