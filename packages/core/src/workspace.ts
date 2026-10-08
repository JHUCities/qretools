/**
 * A workspace: a repository, or a folder in one, holding instruments (`instruments/`),
 * its own file (`workspace.yaml`) and one or more banks, each a folder of its own or the
 * workspace's root. Pure: files by path in, values out.
 */
import { FOLDERS, ROOT } from "./kinds.ts";
import { WORKSPACE } from "./workspacefile.ts";

/** The folders a bank lays out by name: a bank never sits in one of another bank's. */
const LAYOUT: ReadonlySet<string> = new Set([
	"questions",
	...Object.values(FOLDERS),
]);

/** The workspace's own files, never a bank's, even when its root is one. */
const own = (path: string): boolean =>
	path === WORKSPACE.file || path.startsWith(`${WORKSPACE.instruments}/`);

/**
 * The workspace's files, by bank: each bank folder ("" for the root) with its files by
 * path within it, and the files no bank holds, by path in the workspace. The root is a
 * bank when it holds `bank.yaml` or a `questions/` folder (as banks made before
 * `bank.yaml` do); any other folder when it holds `bank.yaml`, unless that is inside
 * another bank's own folders (its `questions/`, `scales/`, …) or the workspace's
 * `instruments/`. A file belongs to the deepest bank folder above it, except the
 * workspace's own (`workspace.yaml`, `instruments/`), which no bank holds. Total, and
 * independent of the order the files are given in.
 */
export function banksIn(files: Readonly<Record<string, string>>): {
	readonly banks: Readonly<Record<string, Readonly<Record<string, string>>>>;
	readonly outside: Readonly<Record<string, string>>;
} {
	const candidates = new Set<string>();
	for (const path of Object.keys(files)) {
		if (path === ROOT.bank || path.startsWith("questions/")) candidates.add("");
		else if (path.endsWith(`/${ROOT.bank}`) && !own(path))
			candidates.add(path.slice(0, -`/${ROOT.bank}`.length));
	}
	// A bank.yaml in another bank's own folders is that bank's file, not a bank.
	const inLayout = (folder: string): boolean =>
		[...candidates].some((c) => {
			if (c === folder) return false;
			if (c !== "" && !folder.startsWith(`${c}/`)) return false;
			const next = folder.slice(c === "" ? 0 : c.length + 1).split("/")[0];
			return next !== undefined && LAYOUT.has(next);
		});
	const folders = [...candidates].filter((f) => f === "" || !inLayout(f));
	// Deepest first, so a file finds the nearest bank above it.
	const depth = (f: string): number => (f === "" ? 0 : f.split("/").length);
	const deepest = [...folders].sort(
		(a, b) => depth(b) - depth(a) || (a < b ? -1 : 1),
	);
	const banks: Record<string, Record<string, string>> = {};
	for (const folder of folders) banks[folder] = {};
	const outside: Record<string, string> = {};
	for (const path of Object.keys(files).sort()) {
		const text = files[path] ?? "";
		const folder = own(path)
			? undefined
			: deepest.find((f) => f === "" || path.startsWith(`${f}/`));
		const bank = folder === undefined ? undefined : banks[folder];
		if (folder === undefined || bank === undefined) outside[path] = text;
		else bank[folder === "" ? path : path.slice(folder.length + 1)] = text;
	}
	return { banks, outside };
}
