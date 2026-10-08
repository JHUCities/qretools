// @vitest-environment jsdom

/** The sign-in page offers both starting points: a workspace, and a bank on its own. */
import { ThemeProvider } from "@primer/react/next";
import { ok } from "@qretools/core";
import type { Store } from "@qretools/shell";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createApp } from "../store.js";
import { App } from "./App.js";
import { AppContext } from "./AppContext.js";

describe("the sign-in page", () => {
	it("links the workspace template and the bank template, each by what it starts", () => {
		const app = createApp(
			{ work: ok(undefined), hasToken: false },
			{
				makeStore: () => ({}) as unknown as Store,
				credentialStore: { load: () => null, save: () => {}, clear: () => {} },
			},
			{
				template: "https://github.com/o/bank-template/generate",
				workspaceTemplate: "https://github.com/o/workspace-template/generate",
			},
		);
		render(
			<AppContext.Provider value={app}>
				<ThemeProvider colorMode="light">
					<App />
				</ThemeProvider>
			</AppContext.Provider>,
		);
		// Each link says what it starts: a list of links read out of context tells them apart.
		expect(
			screen
				.getByRole("link", { name: /^Start a workspace from the template/ })
				.getAttribute("href"),
		).toBe("https://github.com/o/workspace-template/generate");
		expect(
			screen
				.getByRole("link", { name: /^Start a bank from the template/ })
				.getAttribute("href"),
		).toBe("https://github.com/o/bank-template/generate");
		expect(
			screen.getByText(/an example instrument and the bank it uses/),
		).toBeTruthy();
	});
});
