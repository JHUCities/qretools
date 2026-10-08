// The shared look first (typefaces, Primer's tokens, our stylesheet): its order is the cascade's.
import "@qretools/shell/base";
import { BaseStyles } from "@primer/react";
import { ThemeProvider } from "@primer/react/next";
import { ok } from "@qretools/core";
import {
	browserCredentialStore,
	cameBackFromGitHub,
	makeGitHubStore,
	signInConfig,
} from "@qretools/shell";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bankTemplate, defaultBank } from "./config.js";
import { warnOnLeave } from "./model.js";
import { readStartup } from "./persist.js";
import { createApp } from "./store.js";
import { App } from "./ui/App.js";
import { AppContext, useModel } from "./ui/AppContext.js";

const root = document.querySelector<HTMLElement>("#app");
if (root) {
	let started: ReturnType<typeof readStartup> = {
		work: ok(undefined),
		notices: [],
	};
	try {
		started = readStartup(localStorage, sessionStorage);
	} catch {
		// No storage (a private window, blocked site data): start fresh.
	}
	const template = bankTemplate(import.meta.env);
	const bank = defaultBank(import.meta.env);
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
			work: started.work,
			...(started.settings !== undefined && { settings: started.settings }),
			...(started.theme !== undefined && { theme: started.theme }),
			...(bank !== undefined && { defaultBank: bank }),
			notices: started.notices,
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
	// Links live in the hash. The address is read when the event is handled, never
	// taken from the event: a stale event after quick navigation must not pull back.
	const followLink = () =>
		app.dispatch({ kind: "hashChanged", hash: location.hash });
	window.addEventListener("hashchange", followLink);
	followLink();
	// Unsaved work lives only in this tab: closing it, or going elsewhere, asks first.
	// The Model is read when the event fires; the rule is `warnOnLeave`'s.
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

/**
 * Primer's theme, following the Model. ThemeProvider's wrapper carries its own colour
 * mode, which would override the page's, so both come from the one choice.
 */
function Themed({ children }: { children: ReactNode }) {
	const theme = useModel((m) => m.theme);
	return (
		<ThemeProvider colorMode={theme === "system" ? "auto" : theme}>
			{children}
		</ThemeProvider>
	);
}
