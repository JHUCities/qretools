/** What the command says when git itself can't be run, wherever it uses git. */

/** Why git can't be run: there's none on PATH. `needs` says what for. */
export const noGit = (needs: string): string =>
	`git isn't installed (or isn't on PATH): qretools needs git ${needs}.`;

/** Whether a failed run is git missing, not git refusing. */
export const isNoGit = (e: unknown): boolean =>
	typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";
