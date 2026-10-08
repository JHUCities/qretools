/**
 * Where commands run, and the only hidden state: the GitHub credentials, held by the
 * shell's `createCredentials` with their renewal and stores. Every result goes back
 * through `dispatch` as a message; the token never enters the Model or a Msg.
 */
import {
	type DdiDocument,
	err,
	type Finding,
	makeValidator,
	ok,
	type Result,
	type Validator,
	WORKSPACE,
} from "@qretools/core";
import type { Editor } from "@qretools/editor";
import {
	type BranchTarget,
	bankText,
	type CredentialsDeps,
	createCredentials,
	type Failure,
	type File,
	NO_TOKEN,
} from "@qretools/shell";
import {
	type Cmd,
	type Dispatch,
	SETTINGS_KEY,
	THEME_KEY,
	type WorkspaceFiles,
} from "./model.ts";

export interface Effects {
	exec(cmd: Cmd, dispatch: Dispatch): void;
	/** The open editor, which `revealRange` reaches; a DOM object, so never in the Model. */
	registerEditor(editor: Editor | undefined): void;
	/** Set the token the next sign-in uses (development); remembered per the setting. */
	setToken(token: string, remember: boolean): void;
	hasToken(): boolean;
	/** The official schema's problems with a document, or undefined until it has loaded. */
	validate(ddi: DdiDocument): readonly Finding[] | undefined;
}

/** How long an address must stay as typed before its bank is read. */
const BANK_DELAY_MS = 500;

export function createEffects(deps: CredentialsDeps): Effects {
	const credentials = createCredentials(deps);
	let editor: Editor | undefined;
	let validator: Validator | undefined;
	/** Banks being read now, by key: never asked for twice at once. */
	const inFlight = new Set<string>();
	/** The latest batch not yet sent: typing an address replaces it. */
	let waiting: ReturnType<typeof setTimeout> | undefined;
	const loadBanks = (
		targets: readonly BranchTarget[],
		dispatch: Dispatch,
	): void => {
		for (const target of targets) {
			const key = bankText(target);
			if (inFlight.has(key)) continue;
			const s = credentials.storeFor(target);
			if (!s) {
				dispatch({ kind: "bankLoaded", key, result: err(NO_TOKEN) });
				continue;
			}
			inFlight.add(key);
			s.loadWorkspace(target).then((result) => {
				inFlight.delete(key);
				dispatch({ kind: "bankLoaded", key, result });
			});
		}
	};
	return {
		registerEditor: (e) => {
			editor = e;
		},
		validate: (ddi) => validator?.(ddi),
		setToken: credentials.setToken,
		hasToken: credentials.hasToken,
		exec(cmd, dispatch) {
			switch (cmd.kind) {
				case "connect": {
					const s = credentials.storeFor(cmd.repo);
					if (!s) return dispatch({ kind: "connected", result: err(NO_TOKEN) });
					s.whoAmI().then((result) => dispatch({ kind: "connected", result }));
					return;
				}
				case "loadWorkspace": {
					const s = credentials.storeFor(cmd.target);
					if (!s)
						return dispatch({ kind: "workspaceLoaded", result: err(NO_TOKEN) });
					// The instruments' folder and the workspace's own file, read together.
					Promise.all([
						s.readFolder(cmd.target, WORKSPACE.instruments),
						s.read(cmd.target, WORKSPACE.file),
					]).then(([folder, file]) =>
						dispatch({
							kind: "workspaceLoaded",
							result: workspaceFiles(folder, file),
						}),
					);
					return;
				}
				case "loadBanks":
					if (waiting !== undefined) clearTimeout(waiting);
					waiting = setTimeout(() => {
						waiting = undefined;
						loadBanks(cmd.targets, dispatch);
					}, BANK_DELAY_MS);
					return;
				case "loadDdiSchema":
					// 900KB: loaded once, apart from the app's own code.
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
				case "revealRange":
					editor?.reveal(cmd.range, cmd.complete);
					return;
				case "signIn":
					if (!credentials.canSignIn)
						return dispatch({
							kind: "connected",
							result: err({
								kind: "auth",
								message: "Sign-in isn't set up for this build.",
							}),
						});
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
				case "saveSettings":
					try {
						localStorage.setItem(SETTINGS_KEY, JSON.stringify(cmd.settings));
					} catch {
						// Storage unavailable: the next visit starts from an empty field.
					}
					return;
				case "applyTheme":
					document.documentElement.dataset.colorMode =
						cmd.theme === "system" ? "auto" : cmd.theme;
					try {
						if (cmd.theme === "system") localStorage.removeItem(THEME_KEY);
						else localStorage.setItem(THEME_KEY, cmd.theme);
					} catch {
						// Storage unavailable: the choice lasts for this page only.
					}
					return;
				case "forgetToken":
					if (waiting !== undefined) clearTimeout(waiting);
					waiting = undefined;
					credentials.forget();
					return;
				default:
					return cmd satisfies never;
			}
		},
	};
}

/** A workspace's two reads as one result: a missing workspace file is none, any other failure is the load's. */
export function workspaceFiles(
	folder: Result<WorkspaceFiles["instruments"], Failure>,
	file: Result<File, Failure>,
): Result<WorkspaceFiles, Failure> {
	if (!folder.ok) return folder;
	if (!file.ok && file.error.status !== 404) return file;
	return ok({
		instruments: folder.value,
		workspace: file.ok ? file.value : null,
	});
}
