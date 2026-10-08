/**
 * Where commands run, and the only hidden state: the GitHub credentials, held by the
 * shell's `createCredentials` with their renewal and stores. Every result goes back
 * through `dispatch` as a message; the token never enters the Model or a Msg.
 */
import { err, ok, PROJECT, type Result } from "@qretools/core";
import {
	type CredentialsDeps,
	createCredentials,
	type Failure,
	type File,
	NO_TOKEN,
} from "@qretools/shell";
import {
	type Cmd,
	type Dispatch,
	type ProjectFiles,
	SETTINGS_KEY,
	THEME_KEY,
} from "./model.ts";

export interface Effects {
	exec(cmd: Cmd, dispatch: Dispatch): void;
	/** Set the token the next sign-in uses (development); remembered per the setting. */
	setToken(token: string, remember: boolean): void;
	hasToken(): boolean;
}

export function createEffects(deps: CredentialsDeps): Effects {
	const credentials = createCredentials(deps);
	return {
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
				case "loadProject": {
					const s = credentials.storeFor(cmd.target);
					if (!s)
						return dispatch({ kind: "projectLoaded", result: err(NO_TOKEN) });
					// The instruments' folder and the project's own file, read together.
					Promise.all([
						s.readFolder(cmd.target, PROJECT.instruments),
						s.read(cmd.target, PROJECT.file),
					]).then(([folder, file]) =>
						dispatch({
							kind: "projectLoaded",
							result: projectFiles(folder, file),
						}),
					);
					return;
				}
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
					credentials.forget();
					return;
				default:
					return cmd satisfies never;
			}
		},
	};
}

/** A project's two reads as one result: a missing project file is none, any other failure is the load's. */
export function projectFiles(
	folder: Result<ProjectFiles["instruments"], Failure>,
	file: Result<File, Failure>,
): Result<ProjectFiles, Failure> {
	if (!folder.ok) return folder;
	if (!file.ok && file.error.status !== 404) return file;
	return ok({
		instruments: folder.value,
		project: file.ok ? file.value : null,
	});
}
