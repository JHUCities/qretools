/**
 * Where a bank an instrument uses is, from the address its `uses` gives: a folder
 * relative to the instrument's own (`../banks/hh`), in the same repository, as the CLI
 * reads one relative to the file. Pure: no request is made for an address that can't
 * be resolved. An address in another repository (`owner/repo@ref`) isn't read yet.
 */
import type { BankRef } from "@qretools/shell";

export type Resolved =
	| { readonly kind: "folder"; readonly bank: BankRef }
	| { readonly kind: "unreadable"; readonly reason: string };

/**
 * `address` resolved against the folder of the instrument at `file`, a path in the
 * project (`instruments/x.yaml`), in the project's repository.
 */
export function resolveAddress(
	project: BankRef,
	file: string,
	address: string,
): Resolved {
	if (!/^\.\.?\//.test(address))
		return {
			kind: "unreadable",
			reason: `\`${address}\` isn't a folder beside the instrument; only addresses starting \`./\` or \`../\` are read yet.`,
		};
	const parts = [
		...project.path.split("/"),
		...file.split("/").slice(0, -1),
		...address.split("/"),
	].filter((p) => p !== "" && p !== ".");
	const out: string[] = [];
	for (const p of parts) {
		if (p !== "..") out.push(p);
		else if (out.pop() === undefined)
			return {
				kind: "unreadable",
				reason: `\`${address}\` leads out of the repository.`,
			};
	}
	return {
		kind: "folder",
		bank: { owner: project.owner, repo: project.repo, path: out.join("/") },
	};
}
