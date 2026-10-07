/**
 * The bank's root files: shared files of which a bank has one, at its root, rather
 * than named files in a kind's folder. A leaf module (it imports only types), so the
 * modules that read it can't form a cycle through it.
 */
import type { SchemeKind } from "./schemes.js";

/** `missing`: the bank's one missing-value list; `bank`: what the bank says about itself. */
export type RootKind = "missing" | "bank";

/**
 * Where each root kind's one file lives, from which paths, the loader and `readBank`
 * all derive. A root file's name is its kind.
 */
export const ROOT: Readonly<Record<RootKind, string>> = {
	missing: "missing.yaml",
	bank: "bank.yaml",
};

/** Whether a kind is one file per bank at its root, rather than named in a folder. */
export const isRoot = (kind: SchemeKind): kind is RootKind =>
	Object.hasOwn(ROOT, kind);
