import "@primer/primitives/dist/css/primitives.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "./app.css";
import { BaseStyles } from "@primer/react";
import { ThemeProvider } from "@primer/react/next";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Result } from "../core/result.js";
import { type Callback, callbackOf, PendingSchema } from "./auth.js";
import { bankTemplate, signInConfig } from "./config.js";
import { PENDING_KEY } from "./effects.js";
import { makeGitHubStore } from "./github.js";
import {
	browserCredentialStore,
	readPersisted,
	STORAGE_KEY,
	UNREADABLE_KEY,
} from "./persist.js";
import type { Failure } from "./storage.js";
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
	const template = bankTemplate(import.meta.env);
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
							message: "Sign-in is not set up for this build.",
						}
					: undefined;
	const app = createApp(
		{
			stored,
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
