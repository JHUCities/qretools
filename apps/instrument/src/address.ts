/**
 * Where a bank an instrument uses is, from the address its `uses` gives: a folder
 * relative to the instrument's own (`../banks/hh`), in the same repository, as the CLI
 * reads one relative to the file. Pure: no request is made for an address that can't
 * be resolved. An address in another repository (`owner/repo@ref`) isn't read yet; both kinds
 * are read by the core's `addressOf`.
 */
import { addressOf, joinFolder } from "@qretools/core";
import type { BankRef } from "@qretools/shell";

export type Resolved =
	| { readonly kind: "folder"; readonly bank: BankRef }
	| { readonly kind: "unreadable"; readonly reason: string };

/**
 * `address` resolved against the folder of the instrument at `file`, a path in the
 * workspace (`instruments/x.yaml`), in the workspace's repository.
 */
export function resolveAddress(
	workspace: BankRef,
	file: string,
	address: string,
): Resolved {
	const read = addressOf(address);
	if (read.kind === "invalid")
		return { kind: "unreadable", reason: read.reason };
	if (read.kind === "remote")
		return {
			kind: "unreadable",
			reason: `\`${address}\` is in another repository; only addresses starting \`./\` or \`../\` are read yet.`,
		};
	const own = file.split("/").slice(0, -1).join("/");
	const folder = joinFolder(`${workspace.path}/${own}`, read.path);
	return folder === undefined
		? {
				kind: "unreadable",
				reason: `\`${address}\` leads out of the repository.`,
			}
		: {
				kind: "folder",
				bank: { owner: workspace.owner, repo: workspace.repo, path: folder },
			};
}
