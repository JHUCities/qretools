// GitHub's typefaces, served with the app: Mona Sans for the interface, Monaspace Neon
// for code (app.css points Primer's font stacks at them), and the header's wordmark:
// Radon for "QRE", Krypton for "tools", one weight each.
import { ok, type Result } from "@qretools/core";
import "@fontsource-variable/mona-sans";
import "@fontsource/monaspace-neon/400.css";
import "@fontsource/monaspace-radon/latin-700.css";
import "@fontsource/monaspace-krypton/latin-500.css";
import "@primer/primitives/dist/css/primitives.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "./app.css";
import { BaseStyles } from "@primer/react";
import { ThemeProvider } from "@primer/react/next";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { type Callback, callbackOf, PendingSchema } from "./auth.js";
import { bankTemplate, defaultBank, signInConfig } from "./config.js";
import { PENDING_KEY } from "./effects.js";
import { makeGitHubStore } from "./github.js";
import { warnOnLeave } from "./model.js";
import { browserCredentialStore, readStartup } from "./persist.js";
import type { Failure } from "./storage.js";
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
 * Back from GitHub's sign-in page (`?code&state`, or `?error&state`)? Check the state
 * against the one this tab stored when it left (used once), then take the code out of
 * the address with the one `history.replaceState` (a `location.replace` would reload),
 * restoring the link that was open before the round trip.
 */
function cameBackFromGitHub(): Result<Callback, Failure> | undefined {
	if (!/[?&](code|error)=/.test(location.search)) return undefined;
	let raw: string | null = null;
	try {
		raw = sessionStorage.getItem(PENDING_KEY);
		sessionStorage.removeItem(PENDING_KEY);
	} catch {
		// no storage: the state cannot be checked, so the sign-in is refused below
	}
	let pending: ReturnType<typeof PendingSchema.parse> | undefined;
	try {
		const parsed = PendingSchema.safeParse(
			raw === null ? undefined : JSON.parse(raw),
		);
		if (parsed.success) pending = parsed.data;
	} catch {
		pending = undefined;
	}
	const returned = callbackOf(location.search, pending, Date.now());
	history.replaceState(
		null,
		"",
		`${location.pathname}${pending?.hash ?? location.hash}`,
	);
	return returned;
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
