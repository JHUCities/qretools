/**
 * Where commands run, and the only place the shell keeps hidden state: the token,
 * the store built from it, the compiled DDI validator, the persist debouncer, and
 * a handle to the editor. `exec` is the interpreter for `Cmd`; every result goes
 * back through `dispatch` as a message. Two things live here and not in `update`,
 * by design: the token (it must never enter Model or Msg) and the editor handle
 * (a DOM object).
 */

import type { DdiDocument } from "../core/ddi/document.js";
import type { Validator } from "../core/ddi/validate.js";
import { makeValidator } from "../core/ddi/validate.js";
import type { Finding } from "../core/findings.js";
import { err, type Result } from "../core/result.js";
import type { Editor } from "./editor.js";
import type { Cmd, Dispatch } from "./model.js";
import { STORAGE_KEY } from "./persist.js";
import type {
	Failure,
	File,
	MakeStore,
	Repo,
	Store,
	TokenStore,
} from "./storage.js";

export interface Deps {
	readonly makeStore: MakeStore;
	readonly tokenStore: TokenStore;
}

export interface Effects {
	exec(cmd: Cmd, dispatch: Dispatch): void;
	registerEditor(editor: Editor | undefined): void;
	/** Set the token the next connect uses; also remembers it per the setting. */
	setToken(token: string, remember: boolean): void;
	hasToken(): boolean;
	validate(ddi: DdiDocument): readonly Finding[] | undefined;
}

/** A command that needs the bank when no token is on hand: reported, never swallowed. */
const NO_TOKEN = {
	kind: "auth",
	message: "No token. Paste a fine-grained personal access token and connect.",
} as const;

export function createEffects(deps: Deps): Effects {
	let validator: Validator | undefined;
	let token: string | null = deps.tokenStore.load();
	let store: Store | undefined;
	let repoInUse: string | undefined;
	let tokenInUse: string | null = null;
	let editor: Editor | undefined;
	const persist = debouncedPersist();

	const storeFor = (repo: Repo): Store | undefined => {
		if (token === null) return undefined;
		const key = `${repo.owner}/${repo.repo}`;
		if (!store || token !== tokenInUse || key !== repoInUse) {
			store = deps.makeStore(repo, token);
			repoInUse = key;
			tokenInUse = token;
		}
		return store;
	};

	return {
		registerEditor: (e) => {
			editor = e;
		},
		setToken: (t, remember) => {
			token = t;
			deps.tokenStore.save(t, remember);
		},
		hasToken: () => token !== null,
		validate: (ddi) => validator?.(ddi),

		exec(cmd, dispatch) {
			switch (cmd.kind) {
				case "revealRange":
					editor?.reveal(cmd.range);
					return;
				case "loadDdiSchema":
					import("../ddi/ddi-lifecycle-4.0-beta4.schema.json?raw")
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
										message: `The DDI schema could not be loaded: ${e instanceof Error ? e.message : String(e)}`,
									},
								},
							}),
						);
					return;
				case "persist":
					persist(JSON.stringify(cmd.data));
					return;
				case "connect": {
					const s = storeFor(cmd.repo);
					if (!s) return dispatch({ kind: "connected", result: err(NO_TOKEN) });
					s.whoAmI().then((result) => dispatch({ kind: "connected", result }));
					return;
				}
				case "loadBank": {
					const s = storeFor(cmd.target);
					if (!s)
						return dispatch({ kind: "bankLoaded", result: err(NO_TOKEN) });
					s.loadBank(cmd.target).then((result) =>
						dispatch({ kind: "bankLoaded", result }),
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
				case "download": {
					const url = URL.createObjectURL(
						new Blob([cmd.text], { type: cmd.mime }),
					);
					const a = document.createElement("a");
					a.href = url;
					a.download = cmd.filename;
					a.click();
					setTimeout(() => URL.revokeObjectURL(url), 1000);
					return;
				}
				case "forgetToken":
					deps.tokenStore.clear();
					token = null;
					store = undefined;
					return;
				case "setLink":
					// The browser keeps the history: setting the hash adds an entry, replace()
					// does not. Writing the address it already shows would add a duplicate.
					if (location.hash === cmd.hash) return;
					if (cmd.push) location.hash = cmd.hash;
					else
						location.replace(
							`${location.pathname}${location.search}${cmd.hash}`,
						);
					return;
				case "readAt": {
					const s = storeFor(cmd.target);
					const reply = (result: Result<File, Failure>) =>
						dispatch({
							kind: "foreignLoaded",
							branch: cmd.target.branch,
							path: cmd.path,
							result,
						});
					if (!s) return reply(err(NO_TOKEN));
					s.read(cmd.target, cmd.path).then(reply);
					return;
				}
				default:
					return cmd satisfies never;
			}
		},
	};
}

/** Persist at most every 300 ms, and flush when the page is hidden. */
function debouncedPersist(): (json: string) => void {
	let pending: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const flush = () => {
		if (pending === undefined) return;
		try {
			localStorage.setItem(STORAGE_KEY, pending);
		} catch {
			// Storage unavailable (private window, quota): the Model is still correct; drafts are just not kept.
		}
		pending = undefined;
	};
	if (typeof window !== "undefined") window.addEventListener("pagehide", flush);
	return (json) => {
		pending = json;
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(flush, 300);
	};
}
