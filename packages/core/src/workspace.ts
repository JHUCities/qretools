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
import {
	WORKSPACE,
	type WorkspaceFile,
	workspaceFileOf,
} from "./workspacefile.ts";

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

/**
 * Whether a file no bank holds is worth saying it's read nowhere: YAML, the language a
 * misfiled question or instrument is written in. Anything else (a licence, docs,
 * images), and GitHub's own YAML in `.github/`, isn't ours to judge.
 */
const isStray = (path: string): boolean =>
	/\.ya?ml$/.test(path) && !path.startsWith(".github/");

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
			if (isStray(path)) ignored.push(path);
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
