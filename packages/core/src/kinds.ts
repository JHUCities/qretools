/**
 * The bank's root files: shared files of which a bank has one, at its root, rather
 * than named files in a kind's folder. A leaf module (it imports only types), so the
 * modules that read it can't form a cycle through it.
 */
import type { SchemeKind } from "./schemes.js";
import type { NamedScheme } from "./surface/env.js";

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

/** Where each named kind lives in the bank. The loader reads these folders. */
export const FOLDERS: Readonly<Record<NamedScheme, string>> = {
	concept: "concepts",
	scale: "scales",
	unit: "units",
	universe: "universes",
	instruction: "instructions",
};

/** The path a scheme file lives at. The name is the filename; nothing inside repeats it. */
export const schemePath = (kind: SchemeKind, name: string): string =>
	isRoot(kind) ? ROOT[kind] : `${FOLDERS[kind]}/${name}.yaml`;
