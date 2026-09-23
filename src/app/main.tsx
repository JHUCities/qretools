import "@primer/primitives/dist/css/primitives.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "./app.css";
import { BaseStyles } from "@primer/react";
import { ThemeProvider } from "@primer/react/next";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { makeGitHubStore } from "./github.js";
import {
	browserTokenStore,
	readPersisted,
	STORAGE_KEY,
	UNREADABLE_KEY,
} from "./persist.js";
import { createApp } from "./store.js";
import { App } from "./ui/App.js";
import { AppContext } from "./ui/AppContext.js";

const root = document.querySelector<HTMLElement>("#app");
if (root) {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		// no storage: start fresh
	}
	const stored = readPersisted(raw);
	if (!stored.ok && raw !== null) {
		// Keep what could not be read, so the first save does not destroy it.
		try {
			localStorage.setItem(UNREADABLE_KEY, raw);
		} catch {
			// nothing more to do
		}
	}
	const app = createApp(
		{ stored, hasToken: browserTokenStore.load() !== null },
		{ makeStore: makeGitHubStore, tokenStore: browserTokenStore },
	);
	createRoot(root).render(
		<StrictMode>
			<AppContext.Provider value={app}>
				<ThemeProvider colorMode="auto">
					<BaseStyles>
						<App />
					</BaseStyles>
				</ThemeProvider>
			</AppContext.Provider>
		</StrictMode>,
	);
}
