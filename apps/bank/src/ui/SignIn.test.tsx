// @vitest-environment jsdom

/** The sign-in page offers one starting point: a workspace from the template. */
import { ThemeProvider } from "@primer/react/next";
import { ok } from "@qretools/core";
import type { Store } from "@qretools/shell";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createApp } from "../store.js";
import { App } from "./App.js";
import { AppContext } from "./AppContext.js";

describe("the sign-in page", () => {
	it("links the one template, by what it starts, with what it holds", () => {
		const app = createApp(
			{ work: ok(undefined), hasToken: false },
			{
				makeStore: () => ({}) as unknown as Store,
				credentialStore: { load: () => null, save: () => {}, clear: () => {} },
			},
			{ template: "https://github.com/o/template/generate" },
		);
		render(
			<AppContext.Provider value={app}>
				<ThemeProvider colorMode="light">
					<App />
				</ThemeProvider>
			</AppContext.Provider>,
		);
		// The link says what it starts: a list of links read out of context tells it apart.
		expect(
			screen
				.getByRole("link", { name: /^Start a workspace from the template/ })
				.getAttribute("href"),
		).toBe("https://github.com/o/template/generate");
		expect(screen.queryByRole("link", { name: /^Start a bank/ })).toBeNull();
		expect(screen.getByText(/a bank of examples to copy/)).toBeTruthy();
	});
});
