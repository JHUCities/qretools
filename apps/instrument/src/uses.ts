/**
 * What the open instrument uses, derived from the Model and never stored: its text (as
 * edited in this tab, or as read), and each bank its `uses` names, where that is, and
 * how far reading it has got. Pure.
 */
import { importsOf } from "@qretools/core";
import { type BankRef, type BranchTarget, bankText } from "@qretools/shell";
import { resolveAddress } from "./address.ts";
import type { BankLoad, Model } from "./model.ts";

/** What the open instrument's uses are read from: the Model's slices, nothing else. */
export type UsesInput = Pick<
	Model,
	"banks" | "settings" | "working" | "workspace" | "open"
>;

/** The open instrument's text: this tab's edit, or the file as read. */
export function openText(model: UsesInput): string | undefined {
	const path = model.open;
	if (path === undefined) return undefined;
	const read =
		model.workspace.kind === "loaded"
			? model.workspace.instruments[path]?.text
			: undefined;
	return model.working[path] ?? read;
}

export type UseState =
	| { readonly kind: "unreadable"; readonly reason: string }
	| { readonly kind: "loading"; readonly key: string }
	| { readonly kind: "loaded"; readonly key: string; readonly load: BankLoad };

export interface Use {
	readonly alias: string;
	readonly address?: string;
	readonly state: UseState;
}

/** Each bank the open instrument's `uses` names, in the order written. */
export function usesOf(model: UsesInput): readonly Use[] {
	const text = openText(model);
	const path = model.open;
	if (text === undefined || path === undefined) return [];
	return importsOf(text).map((u): Use => {
		const state = stateOf(model, path, u.address);
		return {
			alias: u.alias,
			...(u.address !== undefined && { address: u.address }),
			state,
		};
	});
}

function stateOf(
	model: UsesInput,
	path: string,
	address: string | undefined,
): UseState {
	if (address === undefined)
		return { kind: "unreadable", reason: "No address is given for it." };
	const resolved = resolveAddress(model.settings, path, address);
	if (resolved.kind === "unreadable") return resolved;
	const key = bankText(resolved.bank);
	const load = model.banks[key];
	return load === undefined
		? { kind: "loading", key }
		: { kind: "loaded", key, load };
}

/** The banks the open instrument needs that haven't been read: what to load next. */
export function wanted(model: Model): readonly BranchTarget[] {
	if (model.session.kind !== "connected") return [];
	const { defaultBranch } = model.session;
	const text = openText(model);
	const path = model.open;
	if (text === undefined || path === undefined) return [];
	const seen = new Set<string>();
	return importsOf(text).flatMap((u): BranchTarget[] => {
		if (u.address === undefined) return [];
		const resolved = resolveAddress(model.settings, path, u.address);
		if (resolved.kind !== "folder") return [];
		const key = bankText(resolved.bank);
		if (model.banks[key] !== undefined || seen.has(key)) return [];
		seen.add(key);
		return [targetOf(resolved.bank, defaultBranch)];
	});
}

/** A bank as published: its repository's default branch, read only. */
const targetOf = (bank: BankRef, defaultBranch: string): BranchTarget => ({
	...bank,
	branch: defaultBranch,
	defaultBranch,
});
