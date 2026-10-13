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
import { type BankFile, kindAt, ROOT } from "./schemes.ts";
import { agencyWritten } from "./surface/bankfile.ts";

/** Where a workspace keeps what no bank reads: its instruments' folder (one file each). */
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

/** The workspace's own files, never a bank's, even when its root is one. */
const own = (path: string): boolean =>
	path.startsWith(`${WORKSPACE.instruments}/`);

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

/** What a workspace reads a file as: a bank's, or an instrument. */
export type WorkspacePlace =
	| ({ readonly kind: "bank" } & NonNullable<ReturnType<typeof placeOf>>)
	| { readonly kind: "instrument"; readonly name: string };

/** The path an instrument of this name is saved at. */
export const instrumentPath = (name: string): string =>
	`${WORKSPACE.instruments}/${name}.yaml`;

/**
 * Where a workspace path is, among the workspace's `banks`: in a bank (`placeOf`) or an
 * instrument (`instruments/<name>.yaml`). None for a path the workspace doesn't read.
 */
export function fileAt(
	path: string,
	banks: Iterable<string>,
): WorkspacePlace | undefined {
	if (isInstrument(path))
		return {
			kind: "instrument",
			name: path.slice(WORKSPACE.instruments.length + 1, -".yaml".length),
		};
	const place = placeOf(path, banks);
	return place === undefined ? undefined : { kind: "bank", ...place };
}

/**
 * The workspace's files, by bank: the root ("") with its files by path, when it is a
 * bank, and the files no bank holds. The root is the only bank there can be, and is one
 * when it holds a file a bank reads there (`workspace.yaml`, a shared file, a question)
 * or a `questions/` folder, so a workspace of settings alone is a bank with no questions
 * yet; a `workspace.yaml` in any other folder makes no bank of it. The workspace's
 * instruments (`instruments/`) no bank holds. Total, and
 * independent of the order the files are given in.
 */
export function banksIn(files: Readonly<Record<string, string>>): {
	readonly banks: Readonly<Record<string, Readonly<Record<string, string>>>>;
	readonly outside: Readonly<Record<string, string>>;
} {
	const paths = Object.keys(files).sort();
	const root = paths.some(
		(path) =>
			!own(path) &&
			(kindAt(path) !== undefined || path.startsWith("questions/")),
	);
	const held: Record<string, string> = {};
	const outside: Record<string, string> = {};
	for (const path of paths)
		(root && !own(path) ? held : outside)[path] = files[path] ?? "";
	return { banks: root ? { "": held } : {}, outside };
}

/** Where a bank an instrument uses was found, or why it wasn't. */
export type Resolution =
	/** This workspace's own bank: `folder` is its root, "". */
	| { readonly kind: "local"; readonly folder: string }
	/** A bank in another repository, read and given. */
	| { readonly kind: "remote"; readonly key: AddressKey }
	/** A bank in another repository not given yet: the shell is reading it. */
	| { readonly kind: "pending"; readonly key: AddressKey }
	/** This workspace's root (`folder`, ""), which holds no bank. */
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
 * its own workspace's, when `banks` has the root, or a bank in another repository among
 * `remote` (by key) or still to be read. Its own workspace is written exactly `../`, from
 * `instruments/<name>.yaml`: the text is compared, since `.././` names the same folder
 * and one bank has one spelling. A use with no address is left out: the parser has its
 * own hole for it.
 */
export function resolveUses(
	instrument: string,
	uses: readonly Use[],
	banks: ReadonlySet<string>,
	remote: Readonly<Record<AddressKey, RemoteBank>> = {},
): Readonly<Record<string, Resolution>> {
	const out: Record<string, Resolution> = {};
	for (const u of uses) {
		if (u.address === undefined) continue;
		const address = addressOf(u.address);
		if (address.kind === "invalid")
			out[u.alias] = { kind: "unreadable", reason: address.reason };
		else if (address.kind === "local") {
			out[u.alias] =
				address.path !== HERE || !isInstrument(instrument)
					? { kind: "unreadable", reason: notHere(address.path) }
					: banks.has("")
						? { kind: "local", folder: "" }
						: { kind: "missing", folder: "" };
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
				reason: "This workspace's root holds no bank.",
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
 * folder) and the remote banks given (by key), under the agency its workspace writes
 * (`agencyWritten`). However the banks were put together (`bankOf` whole, or `bankFrom` from
 * evaluations kept), this is the one place a use's resolution becomes a bank or a reason.
 */
export function instrumentIn(
	path: string,
	source: string,
	{
		banks,
		remote,
		remoteBanks,
		agency,
	}: {
		readonly banks: Readonly<Record<string, BankScope>>;
		readonly remote: Readonly<Record<AddressKey, RemoteBank>>;
		readonly remoteBanks: Readonly<Record<AddressKey, BankScope>>;
		/** As `workspace.yaml` writes it, valid or not: the instrument says when it isn't one. */
		readonly agency?: string | undefined;
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
			...(agency !== undefined && { agency }),
		}),
		uses,
	};
}

/** A workspace, evaluated: its banks, and its instruments read against them. */
export interface Workspace {
	/** Its banks by folder ("" for the root), each whole (`bankOf`). */
	readonly banks: Readonly<Record<string, Bank>>;
	/** The banks in other repositories its instruments use, read and given, by key. */
	readonly remote: Readonly<Record<AddressKey, BankScope>>;
	/** Its instruments by path, each with where its banks were found. */
	readonly instruments: Readonly<Record<string, InstrumentIn>>;
	/** YAML files read as nothing, by the bank or the workspace: a wrong folder shows here. */
	readonly ignored: readonly string[];
}

/**
 * A workspace from its files, by path in it: its bank found (`banksIn`) and evaluated,
 * and each instrument read against the banks it uses, published under the agency
 * `workspace.yaml` gives its questions too. `remote` holds the banks in other
 * repositories as read (see `remotesOf`); one not there yet is pending. `versions` gives each local bank's files'
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
	// Read only: what instruments read of them, never the findings a check of them adds.
	const remoteBanks: Record<AddressKey, BankScope> = {};
	for (const [key, read] of Object.entries(remote))
		if (read.kind === "files") remoteBanks[key] = scopeOf(read.files);
	const settings = files[ROOT.workspace];
	const agency = settings === undefined ? undefined : agencyWritten(settings);
	const instruments: Record<string, InstrumentIn> = {};
	// The root's bank holds every file but the workspace's own, so what it reads as
	// nothing (a `workspace.yaml` in a folder, say) is the workspace's to report too.
	const ignored: string[] = Object.values(banks).flatMap((b) =>
		b.ignored.filter(readsInWorkspace),
	);
	for (const [path, source] of Object.entries(outside)) {
		if (!isInstrument(path)) {
			// Only the workspace's own kind of file is worth saying it's read nowhere.
			if (readsInWorkspace(path)) ignored.push(path);
			continue;
		}
		instruments[path] = instrumentIn(path, source, {
			banks,
			remote,
			remoteBanks,
			agency,
		});
	}
	return {
		banks,
		remote: remoteBanks,
		instruments,
		ignored: ignored.sort(),
	};
}
