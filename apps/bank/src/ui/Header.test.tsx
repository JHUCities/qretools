// @vitest-environment jsdom

/**
 * The header as it is drawn today, in each state of the session: written before its
 * pieces (the wordmark, the theme toggle, the account menu) moved into the shell, so
 * the move can show it changed nothing. React's generated ids are normalised: they
 * follow the component tree, which a move may deepen without changing the page.
 */
import { ThemeProvider } from "@primer/react/next";
import { ok } from "@qretools/core";
import type { Store, Who } from "@qretools/shell";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../store.js";
import { App } from "./App.js";
import { AppContext } from "./AppContext.js";

// Primer's Spinner asks for the reduced-motion preference; jsdom has no matchMedia.
// Primer's AriaStatus announces through a `live-region` element, which its Node build
// (what Vitest resolves) never defines: a silent one stands in.
beforeAll(() => {
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
});

const SETTINGS = { owner: "o", repo: "r", path: "", remember: false };
const WHO: Who = {
	login: "me",
	avatarUrl: "https://avatars.example/me",
	access: { kind: "write" },
	defaultBranch: "main",
};

/** The app with a bank that answers who is signed in (or never does), and never loads. */
function renderApp(opts: { token: boolean; who?: Who }) {
	const never = () => new Promise<never>(() => {});
	const store = {
		whoAmI: () =>
			opts.who === undefined ? never() : Promise.resolve(ok(opts.who)),
		loadBank: never,
	} as unknown as Store;
	const app = createApp(
		{ work: ok(undefined), settings: SETTINGS, hasToken: opts.token },
		{
			makeStore: () => store,
			credentialStore: {
				load: () =>
					opts.token ? { credentials: { access: "t" }, remember: false } : null,
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

const header = (): string =>
	(document.querySelector("header")?.outerHTML ?? "").replace(
		/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g,
		"ID",
	);

describe("the header, as drawn before its pieces moved", () => {
	it("signed in: the wordmark, the status, New, the theme toggle and the account", async () => {
		const app = renderApp({ token: true, who: WHO });
		await act(async () => {});
		expect(app.store.getState().model.session.kind).toBe("connected");
		expect(header()).toMatchSnapshot();
	});

	it("signing in: New held disabled and the avatar's place", () => {
		renderApp({ token: true });
		expect(header()).toMatchSnapshot();
	});

	it("signed out: the sign-in page's header", () => {
		renderApp({ token: false });
		expect(header()).toMatchSnapshot();
	});

	it("the theme toggle names the theme it switches to, and chooses it", () => {
		const app = renderApp({ token: false });
		fireEvent.click(
			screen.getByRole("button", { name: "Switch to dark theme" }),
		);
		expect(app.store.getState().model.theme).toBe("dark");
	});

	it("the account menu says who is signed in, and signs out", async () => {
		const app = renderApp({ token: true, who: WHO });
		await act(async () => {});
		fireEvent.click(screen.getByRole("button", { name: "Account: me" }));
		expect(screen.getByText("Signed in as me")).toBeTruthy();
		fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
		expect(app.store.getState().model.session.kind).not.toBe("connected");
	});
});
