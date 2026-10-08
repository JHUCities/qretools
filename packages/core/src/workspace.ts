/**
 * A workspace: a repository, or a folder in one, holding instruments (`instruments/`),
 * its own file (`workspace.yaml`) and one or more banks, each a folder of its own or the
 * workspace's root. Pure: files by path in, values out.
 */
import {
	type Address,
	type AddressKey,
	addressOf,
	joinFolder,
} from "./address.ts";
import type { Versions } from "./ddi/version.ts";
import { type Bank, type BankScope, bankOf } from "./evaluate.ts";
import type { Use } from "./instrument/draft.ts";
import {
	type Instrument,
	importsOf,
	instrumentOf,
} from "./instrument/instrument.ts";
import type { Unread } from "./instrument/parse.ts";
import { FOLDERS, ROOT } from "./kinds.ts";
import { type BankFile, kindAt } from "./schemes.ts";
import {
	WORKSPACE,
	type WorkspaceFile,
	workspaceFileOf,
} from "./workspacefile.ts";

/**
 * Whether a folder is never walked for a workspace's files, by its name: hidden ones
 * (a clone's `.git`, GitHub's `.github`) and installed packages (`node_modules`).
 */
export const skippedFolder = (name: string): boolean =>
	name.startsWith(".") || name === "node_modules";

/**
 * Whether a path in a workspace is one of its files: YAML, not hidden, outside any
 * skipped folder.
 * The one rule for what a workspace holds, wherever it's read from (a directory, GitHub).
 */
export const readsInWorkspace = (path: string): boolean =>
	path.endsWith(".yaml") && !path.split("/").some(skippedFolder);

/** The folders a bank lays out by name: a bank never sits in one of another bank's. */
const LAYOUT: ReadonlySet<string> = new Set([
	"questions",
	...Object.values(FOLDERS),
]);

/** The workspace's own files, never a bank's, even when its root is one. */
const own = (path: string): boolean =>
	path === WORKSPACE.file || path.startsWith(`${WORKSPACE.instruments}/`);

/** A path in a bank's folder ("" for the workspace's root), as a path in the workspace. */
export const inBank = (bank: string, path: string): string =>
	bank === "" ? path : `${bank}/${path}`;

/**
 * A path in the workspace, as a path in the bank folder `bank` holding it. The path must
 * lie in that bank (as `bankAt` finds it, or as an entry's own bank says).
 */
export const relIn = (bank: string, path: string): string =>
	bank === "" ? path : path.slice(bank.length + 1);

/**
 * The bank folder among `banks` a workspace path belongs to: the deepest one above it.
 * None for the workspace's own files, whatever banks there are.
 */
export function bankAt(
	path: string,
	banks: Iterable<string>,
): string | undefined {
	if (own(path)) return undefined;
	let found: string | undefined;
	for (const b of banks)
		if (
			(b === "" || path.startsWith(`${b}/`)) &&
			(found === undefined || b.length > found.length)
		)
			found = b;
	return found;
}

/**
 * Where a workspace path is: the bank among `banks` holding it, the path within that
 * bank, and what the bank reads it as (`kindAt`). None for a path no bank holds or reads.
 */
export function placeOf(
	path: string,
	banks: Iterable<string>,
):
	| {
			readonly bank: string;
			readonly rel: string;
			readonly at: BankFile;
	  }
	| undefined {
	const bank = bankAt(path, banks);
	if (bank === undefined) return undefined;
	const rel = relIn(bank, path);
	const at = kindAt(rel);
	return at === undefined ? undefined : { bank, rel, at };
}

/** What a workspace reads a file as: a bank's, an instrument, or the workspace's own file. */
export type WorkspacePlace =
	| ({ readonly kind: "bank" } & NonNullable<ReturnType<typeof placeOf>>)
	| { readonly kind: "instrument"; readonly name: string }
	| { readonly kind: "workspaceFile" };

/** The path an instrument of this name is saved at. */
export const instrumentPath = (name: string): string =>
	`${WORKSPACE.instruments}/${name}.yaml`;

/**
 * Where a workspace path is, among the workspace's `banks`: in a bank (`placeOf`), an
 * instrument (`instruments/<name>.yaml`), or the workspace's own file. None for a path
 * the workspace doesn't read.
 */
export function fileAt(
	path: string,
	banks: Iterable<string>,
): WorkspacePlace | undefined {
	if (path === WORKSPACE.file) return { kind: "workspaceFile" };
	if (isInstrument(path))
		return {
			kind: "instrument",
			name: path.slice(WORKSPACE.instruments.length + 1, -".yaml".length),
		};
	const place = placeOf(path, banks);
	return place === undefined ? undefined : { kind: "bank", ...place };
}

/**
 * The workspace's files, by bank: each bank folder ("" for the root) with its files by
 * path within it, and the files no bank holds, by path in the workspace. The root is a
 * bank when it holds a file a bank reads there (`bank.yaml`, a shared file, a question)
 * or a `questions/` folder (as banks made before `bank.yaml` do); any other folder when
 * it holds `bank.yaml`, unless that is inside
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
		// The root is a bank when it holds anything a bank reads there (its `bank.yaml`,
		// a shared file, a question) or a `questions/` folder, as banks made before
		// `bank.yaml` did: a folder of only shared files is a bank too.
		if (
			!own(path) &&
			(kindAt(path) !== undefined || path.startsWith("questions/"))
		)
			candidates.add("");
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
	const banks: Record<string, Record<string, string>> = {};
	for (const folder of folders) banks[folder] = {};
	const outside: Record<string, string> = {};
	for (const path of Object.keys(files).sort()) {
		const text = files[path] ?? "";
		const folder = bankAt(path, folders);
		const bank = folder === undefined ? undefined : banks[folder];
		if (folder === undefined || bank === undefined) outside[path] = text;
		else bank[relIn(folder, path)] = text;
	}
	return { banks, outside };
}

/** Where a bank an instrument uses was found, or why it wasn't. */
export type Resolution =
	/** A bank folder of this workspace. */
	| { readonly kind: "local"; readonly folder: string }
	/** A bank in another repository, read and given. */
	| { readonly kind: "remote"; readonly key: AddressKey }
	/** A bank in another repository not given yet: the shell is reading it. */
	| { readonly kind: "pending"; readonly key: AddressKey }
	/** A folder of this workspace that holds no bank. */
	| { readonly kind: "missing"; readonly folder: string }
	/** An address that can't be read, or a bank that couldn't be. */
	| { readonly kind: "unreadable"; readonly reason: string };

/** A bank in another repository, as the shell read it at its version, or why it couldn't. */
export type RemoteBank =
	| {
			readonly kind: "files";
			/** By path within the bank's own folder (the address's `path`), never the repository's. */
			readonly files: Readonly<Record<string, string>>;
	  }
	| { readonly kind: "unavailable"; readonly reason: string };

/**
 * Each bank the instrument at `instrument` (a path in the workspace) uses, by alias:
 * a folder beside it among `banks` (the workspace's bank folders), or a bank in another
 * repository among `remote` (by key) or still to be read. A use with no address is
 * left out: the parser has its own hole for it.
 */
export function resolveUses(
	instrument: string,
	uses: readonly Use[],
	banks: ReadonlySet<string>,
	remote: Readonly<Record<AddressKey, RemoteBank>> = {},
): Readonly<Record<string, Resolution>> {
	const own = instrument.split("/").slice(0, -1).join("/");
	const out: Record<string, Resolution> = {};
	for (const u of uses) {
		if (u.address === undefined) continue;
		const address = addressOf(u.address);
		if (address.kind === "invalid")
			out[u.alias] = { kind: "unreadable", reason: address.reason };
		else if (address.kind === "local") {
			const folder = joinFolder(own, address.path);
			out[u.alias] =
				folder === undefined
					? {
							kind: "unreadable",
							reason: `\`${address.path}\` leads out of the workspace.`,
						}
					: banks.has(folder)
						? { kind: "local", folder }
						: { kind: "missing", folder };
		} else {
			const read = remote[address.key];
			out[u.alias] =
				read === undefined
					? { kind: "pending", key: address.key }
					: read.kind === "files"
						? { kind: "remote", key: address.key }
						: { kind: "unreadable", reason: read.reason };
		}
	}
	return out;
}

/** What the parser is told of a use that found no bank (see `Unread`). */
function unreadOf(r: Resolution): Unread | undefined {
	switch (r.kind) {
		case "local":
		case "remote":
			return undefined;
		case "pending":
			return { kind: "pending" };
		case "missing":
			return {
				kind: "unreadable",
				reason:
					r.folder === ""
						? "This workspace's root holds no bank."
						: `This workspace has no bank at \`${r.folder}\`.`,
			};
		case "unreadable":
			return r;
	}
}

/** Whether a path is one of the workspace's instruments: `instruments/<name>.yaml`. */
const isInstrument = (path: string): boolean =>
	/^[^/]+\/[^/]+\.yaml$/.test(path) &&
	path.startsWith(`${WORKSPACE.instruments}/`);

type RemoteAddress = Extract<Address, { kind: "remote" }>;

/** The banks in other repositories the workspace's instruments use, each once, in key order. */
export function remotesOf(
	files: Readonly<Record<string, string>>,
): readonly RemoteAddress[] {
	const found = new Map<AddressKey, RemoteAddress>();
	for (const [path, text] of Object.entries(files)) {
		if (!isInstrument(path)) continue;
		for (const u of importsOf(text)) {
			const a = u.address === undefined ? undefined : addressOf(u.address);
			if (a?.kind === "remote" && !found.has(a.key)) found.set(a.key, a);
		}
	}
	return [...found.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([, a]) => a);
}

/** An instrument of a workspace, read: where each bank it uses was found, and the instrument. */
export interface InstrumentIn {
	readonly instrument: Instrument;
	readonly uses: Readonly<Record<string, Resolution>>;
}

/**
 * The instrument at `path` in a workspace, read against the workspace's banks (by
 * folder) and the remote banks given (by key), under the agency its workspace file
 * writes. However the banks were put together (`bankOf` whole, or `bankFrom` from
 * evaluations kept), this is the one place a use's resolution becomes a bank or a reason.
 */
export function instrumentIn(
	path: string,
	source: string,
	{
		banks,
		remote,
		remoteBanks,
		file,
	}: {
		readonly banks: Readonly<Record<string, BankScope>>;
		readonly remote: Readonly<Record<AddressKey, RemoteBank>>;
		readonly remoteBanks: Readonly<Record<AddressKey, BankScope>>;
		readonly file?: WorkspaceFile;
	},
): InstrumentIn {
	const uses = resolveUses(
		path,
		importsOf(source),
		new Set(Object.keys(banks)),
		remote,
	);
	const given: Record<string, BankScope> = {};
	const unresolved: Record<string, Unread> = {};
	for (const [alias, r] of Object.entries(uses)) {
		const bank =
			r.kind === "local"
				? banks[r.folder]
				: r.kind === "remote"
					? remoteBanks[r.key]
					: undefined;
		const unread = unreadOf(r);
		if (bank !== undefined) given[alias] = bank;
		else if (unread !== undefined) unresolved[alias] = unread;
	}
	return {
		instrument: instrumentOf(source, {
			banks: given,
			unresolved,
			// As written, valid or not: the instrument says when it isn't one.
			...(file?.given !== undefined && { agency: file.given }),
		}),
		uses,
	};
}

/** A workspace, evaluated: its banks, its instruments read against them, and its own file. */
export interface Workspace {
	/** Its banks by folder ("" for the root), each whole (`bankOf`). */
	readonly banks: Readonly<Record<string, Bank>>;
	/** The banks in other repositories its instruments use, read and given, by key. */
	readonly remote: Readonly<Record<AddressKey, Bank>>;
	/** Its instruments by path, each with where its banks were found. */
	readonly instruments: Readonly<Record<string, InstrumentIn>>;
	/** `workspace.yaml`, read; absent when there's none. */
	readonly file?: WorkspaceFile;
	/** YAML files no bank holds that aren't the workspace's: a wrong folder shows here. */
	readonly ignored: readonly string[];
}

/**
 * A workspace from its files, by path in it: its banks found (`banksIn`) and evaluated,
 * and each instrument read against the banks it uses, published under the agency its
 * `workspace.yaml` gives. `remote` holds the banks in other repositories as read (see
 * `remotesOf`); one not there yet is pending. `versions` gives each local bank's files'
 * DDI versions, by bank folder. Total, and independent of the order of the files.
 */
export function workspaceOf(
	files: Readonly<Record<string, string>>,
	{
		remote = {},
		versions = {},
	}: {
		readonly remote?: Readonly<Record<AddressKey, RemoteBank>>;
		readonly versions?: Readonly<Record<string, Versions>>;
	} = {},
): Workspace {
	const { banks: byFolder, outside } = banksIn(files);
	const banks: Record<string, Bank> = {};
	for (const [folder, bankFiles] of Object.entries(byFolder))
		banks[folder] = bankOf(bankFiles, versions[folder]);
	const remoteBanks: Record<AddressKey, Bank> = {};
	for (const [key, read] of Object.entries(remote))
		if (read.kind === "files") remoteBanks[key] = bankOf(read.files);
	const text = outside[WORKSPACE.file];
	const file = text === undefined ? undefined : workspaceFileOf(text);
	const instruments: Record<string, InstrumentIn> = {};
	const ignored: string[] = [];
	for (const [path, source] of Object.entries(outside)) {
		if (path === WORKSPACE.file) continue;
		if (!isInstrument(path)) {
			// Only the workspace's own kind of file is worth saying it's read nowhere.
			if (readsInWorkspace(path)) ignored.push(path);
			continue;
		}
		instruments[path] = instrumentIn(path, source, {
			banks,
			remote,
			remoteBanks,
			...(file !== undefined && { file }),
		});
	}
	return {
		banks,
		remote: remoteBanks,
		instruments,
		...(file !== undefined && { file }),
		ignored: ignored.sort(),
	};
}
