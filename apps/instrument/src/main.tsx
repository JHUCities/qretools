// The shared look first (typefaces, Primer's tokens, the stylesheet): its order is the cascade's.
import "@qretools/shell/base";
import "./instrument.css";
import { BaseStyles } from "@primer/react";
import { ThemeProvider } from "@primer/react/next";
import {
	browserCredentialStore,
	cameBackFromGitHub,
	makeGitHubStore,
	signInConfig,
} from "@qretools/shell";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { workspaceTemplate } from "./config.ts";
import { warnOnLeave } from "./model.ts";
import { readSettings, readTheme } from "./persist.ts";
import { createApp } from "./store.ts";
import { App } from "./ui/App.tsx";
import { AppContext, useModel } from "./ui/AppContext.ts";

const root = document.querySelector<HTMLElement>("#app");
if (root) {
	let settings: ReturnType<typeof readSettings>;
	let theme: ReturnType<typeof readTheme>;
	try {
		settings = readSettings(localStorage);
		theme = readTheme(localStorage);
	} catch {
		// No storage (a private window, blocked site data): start fresh.
	}
	const template = workspaceTemplate(import.meta.env);
	const config = signInConfig(
		import.meta.env,
		location.origin,
		import.meta.env.BASE_URL,
	);
	// Any code in the address is taken out, configured or not; only a build with sign-in
	// set up redeems it.
	const back = cameBackFromGitHub();
	const returned =
		config !== undefined && back?.ok === true ? back.value : undefined;
	const refused =
		back === undefined
			? undefined
			: !back.ok
				? back.error
				: config === undefined
					? {
							kind: "auth" as const,
							message: "Sign-in isn't set up for this build.",
						}
					: undefined;
	const app = createApp(
		{
			...(settings !== undefined && { settings }),
			...(theme !== undefined && { theme }),
			hasToken:
				browserCredentialStore.load() !== null || returned !== undefined,
			...(refused !== undefined && { signInFailure: refused }),
		},
		{
			makeStore: makeGitHubStore,
			credentialStore: browserCredentialStore,
			...(config !== undefined && {
				signIn: { config, ...(returned !== undefined && { returned }) },
			}),
		},
		template === undefined ? {} : { template },
	);
	// Which instrument is open follows the address. Read when the event is handled,
	// never taken from the event.
	const followLink = () =>
		app.dispatch({ kind: "hashChanged", hash: location.hash });
	window.addEventListener("hashchange", followLink);
	followLink();
	// Edits live only in this tab: closing it, or going elsewhere, asks first. The Model
	// is read when the event fires; the rule is `warnOnLeave`'s.
	window.addEventListener("beforeunload", (event) => {
		if (!warnOnLeave(app.store.getState().model)) return;
		event.preventDefault();
		event.returnValue = "";
	});
	createRoot(root).render(
		<StrictMode>
			<AppContext.Provider value={app}>
				<Themed>
					<BaseStyles>
						<App />
					</BaseStyles>
				</Themed>
			</AppContext.Provider>
		</StrictMode>,
	);
}

/** Primer's theme, following the Model, as the bank app's. */
function Themed({ children }: { children: ReactNode }) {
	const theme = useModel((m) => m.theme);
	return (
		<ThemeProvider colorMode={theme === "system" ? "auto" : theme}>
			{children}
		</ThemeProvider>
	);
}
