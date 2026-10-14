/**
 * A workspace: a repository, or a folder in one, holding instruments (`instruments/`)
 * and, at its root, a bank: its questions, its shared files and its settings
 * (`workspace.yaml`). Pure: files by path in, values out.
 */
import {
	type Address,
	type AddressKey,
	addressOf,
	HERE,
	notHere,
} from "./address.ts";
import type { Versions } from "./ddi/version.ts";
import { type Bank, type BankScope, bankOf, scopeOf } from "./evaluate.ts";
import type { Use } from "./instrument/draft.ts";
import {
	type Instrument,
	importsOf,
	instrumentOf,
} from "./instrument/instrument.ts";
import type { Unread } from "./instrument/parse.ts";
import { ROOT } from "./schemes.ts";
import { agencyWritten } from "./surface/bankfile.ts";

/** Where a workspace keeps what its bank doesn't read: its instruments' folder (one file each). */
export const WORKSPACE = { instruments: "instruments" } as const;

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

/** The workspace's own files, never its bank's: everything under `instruments/`. */
const own = (path: string): boolean =>
	path.startsWith(`${WORKSPACE.instruments}/`);

/** The path an instrument of this name is saved at. */
export const instrumentPath = (name: string): string =>
	`${WORKSPACE.instruments}/${name}.yaml`;

const INSTRUMENT = new RegExp(`^${WORKSPACE.instruments}/([^/]+)\\.yaml$`);

/** The name of the instrument at a workspace path (`instruments/<name>.yaml`), if it is one. */
export const instrumentAt = (path: string): string | undefined =>
	INSTRUMENT.exec(path)?.[1];

/** Where a bank an instrument uses was found, or why it wasn't. */
export type Resolution =
	/** This workspace's own: its root is its bank, whatever it holds. */
	| { readonly kind: "local" }
	/** A bank in another repository, read and given. */
	| { readonly kind: "remote"; readonly key: AddressKey }
	/** A bank in another repository not given yet: the shell is reading it. */
	| { readonly kind: "pending"; readonly key: AddressKey }
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
 * Each bank an instrument uses, by alias: its own workspace's, or a bank in another
 * repository among `remote` (by key) or still to be read. Its own workspace is written
 * exactly `../`: the text is compared, since `.././` names the same folder and one bank
 * has one spelling. A use with no address is left out: the parser has its own hole for it.
 */
export function resolveUses(
	uses: readonly Use[],
	remote: Readonly<Record<AddressKey, RemoteBank>> = {},
): Readonly<Record<string, Resolution>> {
	const out: Record<string, Resolution> = {};
	for (const u of uses) {
		if (u.address === undefined) continue;
		const address = addressOf(u.address);
		if (address.kind === "invalid")
			out[u.alias] = { kind: "unreadable", reason: address.reason };
		else if (address.kind === "local")
			out[u.alias] =
				address.path === HERE
					? { kind: "local" }
					: { kind: "unreadable", reason: notHere(address.path, u.alias) };
		else {
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
		case "unreadable":
			return r;
	}
}

type RemoteAddress = Extract<Address, { kind: "remote" }>;

/** The banks in other repositories the workspace's instruments use, each once, in key order. */
export function remotesOf(
	files: Readonly<Record<string, string>>,
): readonly RemoteAddress[] {
	const found = new Map<AddressKey, RemoteAddress>();
	for (const [path, text] of Object.entries(files)) {
		if (instrumentAt(path) === undefined) continue;
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
 * An instrument of a workspace, read against the workspace's bank and the remote banks
 * given (by key), under the agency its workspace writes (`agencyWritten`). However the
 * banks were put together (`bankOf` whole, or `bankFrom` from evaluations kept), this is
 * the one place a use's resolution becomes a bank or a reason.
 */
export function instrumentIn(
	source: string,
	{
		bank,
		remote,
		remoteBanks,
		agency,
	}: {
		/** The workspace's own bank; needed only when a use is local (`resolveUses`). */
		readonly bank: BankScope | undefined;
		readonly remote: Readonly<Record<AddressKey, RemoteBank>>;
		readonly remoteBanks: Readonly<Record<AddressKey, BankScope>>;
		/** As `workspace.yaml` writes it, valid or not: the instrument says when it isn't one. */
		readonly agency?: string | undefined;
	},
): InstrumentIn {
	const uses = resolveUses(importsOf(source), remote);
	const given: Record<string, BankScope> = {};
	const unresolved: Record<string, Unread> = {};
	for (const [alias, r] of Object.entries(uses)) {
		const found =
			r.kind === "local"
				? bank
				: r.kind === "remote"
					? remoteBanks[r.key]
					: undefined;
		const unread = unreadOf(r);
		if (found !== undefined) given[alias] = found;
		else if (unread !== undefined) unresolved[alias] = unread;
	}
	return {
		instrument: instrumentOf(source, {
			banks: given,
			unresolved,
			...(agency !== undefined && { agency }),
		}),
		uses,
	};
}

/** A workspace, evaluated: its bank, and its instruments read against it. */
export interface Workspace {
	/** Its bank, whole (`bankOf`): every file but its instruments, by path in the workspace. */
	readonly bank: Bank;
	/** The banks in other repositories its instruments use, read and given, by key. */
	readonly remote: Readonly<Record<AddressKey, BankScope>>;
	/** Its instruments by path, each with where its banks were found. */
	readonly instruments: Readonly<Record<string, InstrumentIn>>;
	/** YAML files read as nothing, by the bank or the workspace: a wrong folder shows here. */
	readonly ignored: readonly string[];
}

/**
 * A workspace from its files, by path in it: its root evaluated as its bank (an empty
 * workspace is an empty bank), and each instrument read against the banks it uses,
 * published under the agency `workspace.yaml` gives its questions too. `remote` holds
 * the banks in other repositories as read (see `remotesOf`); one not there yet is
 * pending. `versions` gives the bank's files' DDI versions, by path. Total, and
 * independent of the order of the files.
 */
export function workspaceOf(
	files: Readonly<Record<string, string>>,
	{
		remote = {},
		versions,
	}: {
		readonly remote?: Readonly<Record<AddressKey, RemoteBank>>;
		readonly versions?: Versions;
	} = {},
): Workspace {
	const held: Record<string, string> = {};
	const outside: Record<string, string> = {};
	for (const [path, text] of Object.entries(files))
		(own(path) ? outside : held)[path] = text;
	const bank = bankOf(held, versions);
	// Read only: what instruments read of them, never the findings a check of them adds.
	const remoteBanks: Record<AddressKey, BankScope> = {};
	for (const [key, read] of Object.entries(remote))
		if (read.kind === "files") remoteBanks[key] = scopeOf(read.files);
	const settings = files[ROOT.workspace];
	const agency = settings === undefined ? undefined : agencyWritten(settings);
	const instruments: Record<string, InstrumentIn> = {};
	// The bank holds every file but the workspace's own, so what it reads as nothing
	// (a `workspace.yaml` in a folder, say) is the workspace's to report too.
	const ignored = bank.ignored.filter(readsInWorkspace);
	for (const path of Object.keys(outside).sort()) {
		if (instrumentAt(path) === undefined) {
			// Only the workspace's own kind of file is worth saying it's read nowhere.
			if (readsInWorkspace(path)) ignored.push(path);
			continue;
		}
		instruments[path] = instrumentIn(outside[path] ?? "", {
			bank,
			remote,
			remoteBanks,
			agency,
		});
	}
	return { bank, remote: remoteBanks, instruments, ignored: ignored.sort() };
}
