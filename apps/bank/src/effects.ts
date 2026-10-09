/**
 * Where commands run, and the only place the shell keeps hidden state: the GitHub
 * credentials (held by the shell's `createCredentials`, with their renewal and the
 * store), the compiled DDI validator, the persist debouncer, and a handle to the
 * editor. `exec` is the interpreter for `Cmd`; every result goes back through
 * `dispatch` as a message. Two things live here and not in `update`, by design: the
 * token (it must never enter Model or Msg) and the editor handle (a DOM object).
 */

import {
	type DdiDocument,
	err,
	type Finding,
	makeValidator,
	type Result,
	type Validator,
} from "@qretools/core";
import type { Editor } from "@qretools/editor";
import {
	type CredentialsDeps,
	createCredentials,
	type Failure,
	type File,
	formatLink,
	NO_TOKEN,
	parseLink,
} from "@qretools/shell";
import type { Cmd, Dispatch, Id, RemoteAddress } from "./model.js";
import {
	SETTINGS_KEY,
	setAsideWork,
	settingsValue,
	THEME_KEY,
	WORK_KEY,
} from "./persist.js";

/** What the credentials need (the store, sign-in, the clock, the Worker, the lock). */
export type Deps = CredentialsDeps;

export interface Effects {
	exec(cmd: Cmd, dispatch: Dispatch): void;
	registerEditor(editor: Editor | undefined): void;
	/** The editor now shows file `id`: a reveal waiting for it is applied, any other dropped. */
	editorSynced(id: Id): void;
	/** Set the token the next connect uses; also remembers it per the setting. */
	setToken(token: string, remember: boolean): void;
	hasToken(): boolean;
	validate(ddi: DdiDocument): readonly Finding[] | undefined;
}

/** The address with any place in its file left out, as the app writes a file's link. */
function withoutPlace(hash: string): string | undefined {
	const link = parseLink(hash);
	if (link?.at === undefined) return undefined;
	const { at: _, ...file } = link;
	return formatLink(file);
}

/** How long an address must stay as typed before its bank is read. */
const REMOTE_DELAY_MS = 500;

export function createEffects(deps: Deps): Effects {
	const credentials = createCredentials(deps);
	const storeFor = credentials.storeFor;
	let validator: Validator | undefined;
	let editor: Editor | undefined;
	/** The file the editor shows, as it last synced. */
	let shown: Id | undefined;
	/** A reveal in a file only now opening: applied once its editor has its text. */
	let waitingReveal: Extract<Cmd, { kind: "revealRange" }> | undefined;
	const persist = debouncedPersist();
	/** Banks in other repositories being read now, by address: never asked for twice at once. */
	const inFlight = new Set<string>();
	/** The latest batch not yet sent: typing an address replaces it. */
	let waiting: ReturnType<typeof setTimeout> | undefined;
	const loadRemote = (
		addresses: readonly RemoteAddress[],
		dispatch: Dispatch,
	): void => {
		for (const a of addresses) {
			if (inFlight.has(a.key)) continue;
			const s = storeFor({ owner: a.owner, repo: a.repo, path: a.path });
			if (!s) {
				dispatch({
					kind: "remoteBankLoaded",
					key: a.key,
					result: err(NO_TOKEN),
				});
				continue;
			}
			inFlight.add(a.key);
			// Marked as being read only now: a batch replaced before it went never is.
			dispatch({ kind: "remoteBankStarted", key: a.key });
			s.loadBankAt(a.ref).then((result) => {
				inFlight.delete(a.key);
				dispatch({ kind: "remoteBankLoaded", key: a.key, result });
			});
		}
	};

	return {
		registerEditor: (e) => {
			editor = e;
			if (e === undefined) shown = undefined;
		},
		editorSynced: (id) => {
			shown = id;
			const reveal = waitingReveal;
			waitingReveal = undefined;
			// Another file opened meanwhile: its place no longer applies.
			if (reveal !== undefined && reveal.id === id)
				editor?.reveal(reveal.range, reveal.complete);
		},
		setToken: credentials.setToken,
		hasToken: credentials.hasToken,
		validate: (ddi) => validator?.(ddi),

		exec(cmd, dispatch) {
			switch (cmd.kind) {
				case "revealRange":
					// A reveal in a file the editor doesn't show yet waits for it to sync.
					if (cmd.id !== undefined && cmd.id !== shown) waitingReveal = cmd;
					else editor?.reveal(cmd.range, cmd.complete);
					return;
				case "loadDdiSchema":
					import("@qretools/core/schema.json?raw")
						.then((m) => makeValidator(JSON.parse(m.default)))
						.then((compiled) => {
							if (compiled.ok) validator = compiled.value;
							dispatch({
								kind: "ddiSchemaLoaded",
								result: compiled.ok
									? { kind: "ready" }
									: { kind: "failed", finding: compiled.error },
							});
						})
						.catch((e: unknown) =>
							dispatch({
								kind: "ddiSchemaLoaded",
								result: {
									kind: "failed",
									finding: {
										code: "ddi-invalid",
										severity: "error",
										path: "",
										message:
											"The DDI schema couldn't be loaded, so the export can't be checked.",
										detail: e instanceof Error ? e.message : String(e),
									},
								},
							}),
						);
					return;
				case "persist":
					persist(JSON.stringify(cmd.work));
					return;
				case "applyTheme":
					// The page shows it at once; the inline script in index.html shows it
					// before the first paint on the next visit.
					document.documentElement.dataset.colorMode =
						cmd.theme === "system" ? "auto" : cmd.theme;
					try {
						if (cmd.theme === "system") localStorage.removeItem(THEME_KEY);
						else localStorage.setItem(THEME_KEY, cmd.theme);
					} catch {
						// Storage unavailable: the choice lasts for this page only.
					}
					return;
				case "saveSettings":
					try {
						localStorage.setItem(SETTINGS_KEY, settingsValue(cmd.settings));
					} catch {
						// Storage unavailable: a new tab starts from the default bank.
					}
					return;
				case "setAside":
					try {
						setAsideWork(localStorage, cmd.work);
					} catch {
						// Storage unavailable (private window, quota): nothing more can be done.
					}
					return;
				case "connect": {
					const s = storeFor(cmd.repo);
					if (!s) return dispatch({ kind: "connected", result: err(NO_TOKEN) });
					s.whoAmI().then((result) => dispatch({ kind: "connected", result }));
					return;
				}
				case "openExternal":
					// Must stay inside the click or keypress that asked for it (follow,
					// dispatch, update, exec run synchronously): a browser opens a new tab
					// only during the gesture, so a debounce or an `await` on this path
					// would have the popup blocker drop it without a word.
					window.open(cmd.url, "_blank", "noopener,noreferrer");
					return;
				case "loadRemoteBanks":
					if (waiting !== undefined) clearTimeout(waiting);
					waiting = undefined;
					if (cmd.now) loadRemote(cmd.addresses, dispatch);
					else
						waiting = setTimeout(() => {
							waiting = undefined;
							loadRemote(cmd.addresses, dispatch);
						}, REMOTE_DELAY_MS);
					return;
				case "loadWorkspace": {
					const s = storeFor(cmd.target);
					if (!s)
						return dispatch({ kind: "workspaceLoaded", result: err(NO_TOKEN) });
					s.loadWorkspace(cmd.target).then((result) =>
						dispatch({ kind: "workspaceLoaded", result }),
					);
					return;
				}
				case "updateFromDefault": {
					const s = storeFor(cmd.target);
					if (!s)
						return dispatch({
							kind: "updatedFromDefault",
							result: err(NO_TOKEN),
						});
					s.updateFromDefault(cmd.target).then((result) =>
						dispatch({ kind: "updatedFromDefault", result }),
					);
					return;
				}
				case "readFile": {
					const s = storeFor(cmd.target);
					if (!s)
						return dispatch({
							kind: "fileReloaded",
							id: cmd.id,
							result: err(NO_TOKEN),
						});
					s.read(cmd.target, cmd.path).then((result) =>
						dispatch({ kind: "fileReloaded", id: cmd.id, result }),
					);
					return;
				}
				case "commit": {
					const s = storeFor(cmd.target);
					if (!s)
						return dispatch({
							kind: "committed",
							changes: cmd.changes,
							result: err({ failure: NO_TOKEN }),
						});
					s.commit(cmd.target, cmd.changes, cmd.message).then((result) =>
						dispatch({ kind: "committed", changes: cmd.changes, result }),
					);
					return;
				}
				case "forgetToken":
					credentials.forget();
					return;
				case "signIn": {
					if (!credentials.canSignIn)
						return dispatch({
							kind: "connected",
							result: err({
								kind: "auth",
								message: "Sign-in isn't set up for this build.",
							}),
						});
					// Leaving the page: write what should survive first.
					persist.flush();
					void credentials.startSignIn(cmd.remember).catch((e: unknown) =>
						dispatch({
							kind: "connected",
							result: err({
								kind: "auth",
								message: "Sign-in couldn't start.",
								detail: e instanceof Error ? e.message : String(e),
							}),
						}),
					);
					return;
				}
				case "setLink":
					// The browser keeps the history: setting the hash adds an entry, replace()
					// does not. Writing the address it already shows would add a duplicate.
					if (location.hash === cmd.hash) return;
					// A link to a place opened its file there: the address keeps the place it
					// was opened at, rather than a second entry for the file alone.
					if (withoutPlace(location.hash) === cmd.hash) return;
					if (cmd.push) location.hash = cmd.hash;
					else
						location.replace(
							`${location.pathname}${location.search}${cmd.hash}`,
						);
					return;
				case "readAt": {
					const s = storeFor(cmd.target);
					const reply = (
						result: Result<{ file: File; schemes: readonly File[] }, Failure>,
					) =>
						dispatch({
							kind: "foreignLoaded",
							branch: cmd.target.branch,
							path: cmd.path,
							result,
						});
					if (!s) return reply(err(NO_TOKEN));
					s.readWithSchemes(cmd.target, cmd.rel).then(reply);
					return;
				}
				default:
					return cmd satisfies never;
			}
		},
	};
}

/**
 * Persist this tab's work at most every 300 ms, and flush when the page is hidden, or
 * on demand. Session storage: the work outlives a reload, never the tab.
 */
function debouncedPersist(): ((json: string) => void) & { flush(): void } {
	let pending: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const flush = () => {
		if (pending === undefined) return;
		try {
			sessionStorage.setItem(WORK_KEY, pending);
		} catch {
			// Storage unavailable (private window, quota): the Model is still correct; drafts are just not kept.
		}
		pending = undefined;
	};
	if (typeof window !== "undefined") window.addEventListener("pagehide", flush);
	const write = (json: string) => {
		pending = json;
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(flush, 300);
	};
	return Object.assign(write, { flush });
}
