/**
 * A workspace release's manifest: each file's DDI version as the workspace's history
 * gave it when the release was built, written as the release tag's own message, so a
 * reader of the tag gets real versions without that history. `build` writes it; a
 * reader trusts it only when it describes exactly the files read at the tag. Each
 * instrument is listed apart, with the digest of its DDI as built, so the DDI can be
 * rebuilt from the tag and checked (`instrumentRelease`). Pure.
 */
import { z } from "zod";
import type { Version, Versions } from "./ddi/version.ts";
import { kindAt } from "./schemes.ts";

const Entry = z.object({
	version: z.string().regex(/^\d+(\.\d+)*$/),
	// As `versionsOf` writes it (git's `%cI`): a bad one is the manifest's fault, said here.
	date: z.iso.datetime({ offset: true }).optional(),
	blob: z.string(),
});

// Unknown fields pass, so a later format may add some. The commit is the tag's own target.
const Manifest = z.object({
	qretools: z.string(),
	files: z.record(z.string(), Entry),
	// Apart from `files`, which a bank's reader checks against every file it reads.
	instruments: z
		.record(z.string(), Entry.extend({ ddi: z.string() }))
		.optional(),
});

/** What the manifest gives for the files read, or why nothing. */
export type ManifestRead =
	| { readonly kind: "used"; readonly versions: Versions }
	/** No manifest: a lightweight tag, or one whose message is prose. */
	| { readonly kind: "none" }
	| { readonly kind: "stale" | "unreadable"; readonly reason: string };

/** Whether a file has a version of its own (`versionsOf` counts it): what a manifest must hold. */
const versioned = (path: string): boolean => {
	const at = kindAt(path);
	return at !== undefined && at.kind !== "workspace";
};

/**
 * A tag's message for a release: a line for people, a blank line, then the manifest. Each
 * instrument (a path in `ddis`) is listed apart, with the digest of its DDI as built.
 */
export function tagMessage(
	versions: Versions,
	builtBy: string,
	ddis: Readonly<Record<string, string>> = {},
): string {
	const listed = (instruments: boolean) =>
		Object.fromEntries(
			Object.keys(versions)
				.filter((path) => path in ddis === instruments)
				.sort()
				.flatMap((path) => {
					const v = versions[path];
					const ddi = ddis[path];
					return v?.blob === undefined
						? []
						: [
								[
									path,
									{
										version: v.number,
										...(v.date !== undefined && { date: v.date }),
										blob: v.blob,
										...(ddi !== undefined && { ddi }),
									},
								],
							];
				}),
		);
	const manifest = {
		qretools: builtBy,
		files: listed(false),
		instruments: listed(true),
	};
	return `Each file's DDI version, by QREtools ${builtBy}\n\n${JSON.stringify(manifest, null, 2)}\n`;
}

type Read =
	| { readonly kind: "read"; readonly manifest: z.infer<typeof Manifest> }
	| { readonly kind: "none" }
	| { readonly kind: "unreadable"; readonly reason: string };

/** The manifest in a tag's message, if it has one. */
function manifestIn(message: string): Read {
	const text = message.replaceAll("\r\n", "\n");
	const blank = text.indexOf("\n\n");
	const after = blank < 0 ? "" : text.slice(blank + 2).trimStart();
	if (!after.startsWith("{")) return { kind: "none" };
	// Up to its last line that is a lone `}`: whatever signature git keeps after it is left.
	const end = after.lastIndexOf("\n}");
	const body = end < 0 ? after : after.slice(0, end + 2);
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		return { kind: "unreadable", reason: "It isn't JSON." };
	}
	const parsed = Manifest.safeParse(json);
	return parsed.success
		? { kind: "read", manifest: parsed.data }
		: {
				kind: "unreadable",
				reason: "This version of QREtools doesn't know its format.",
			};
}

/** A manifest line as a version. */
const versionOf = (e: z.infer<typeof Entry>): Version => ({
	number: e.version,
	blob: e.blob,
	...(e.date !== undefined && { date: e.date }),
});

/**
 * The versions a tag's message gives the files read at the tag (`blobs`, by path in the
 * workspace), all or none: a question's version counts its shared files' changes too, so
 * one file that differs makes every number doubtful.
 */
export function manifestVersions(
	message: string,
	blobs: Readonly<Record<string, string>>,
): ManifestRead {
	const read = manifestIn(message);
	if (read.kind !== "read") return read;
	const { files } = read.manifest;
	const differ = [
		...Object.keys(blobs).filter((p) => versioned(p) && !(p in files)),
		...Object.keys(files).filter((p) => files[p]?.blob !== blobs[p]),
	].sort();
	if (differ.length > 0)
		return {
			kind: "stale",
			reason: `It doesn't match the files in the release: ${differ.slice(0, 3).join(", ")}${differ.length > 3 ? ", …" : ""}.`,
		};
	const versions: Record<string, Version> = {};
	for (const [path, e] of Object.entries(files)) versions[path] = versionOf(e);
	return { kind: "used", versions };
}

/** What a release gives to rebuild one of its instruments, or why it can't. */
export type InstrumentRelease =
	| {
			readonly kind: "release";
			/** The bank's files' versions and the instrument's own, by path. */
			readonly versions: Versions;
			/** The digest of the instrument's DDI as built, `sha256:<hex>`. */
			readonly ddi: string;
			/** The version of QREtools that built it. */
			readonly qretools: string;
	  }
	| { readonly kind: "refused"; readonly reason: string };

/**
 * What a release tag's message gives to rebuild the instrument at `path` exactly: every
 * version its DDI carries, and the digest to check the rebuild against. Refused when the
 * tag isn't a release, its manifest doesn't match the files read at it (`blobs`), or it
 * was made before manifests listed instruments.
 */
export function instrumentRelease(
	message: string,
	blobs: Readonly<Record<string, string>>,
	path: string,
): InstrumentRelease {
	const refused = (reason: string): InstrumentRelease => ({
		kind: "refused",
		reason,
	});
	const read = manifestIn(message);
	if (read.kind === "none")
		return refused(
			"Its tag isn't a release: its message has no manifest from `qretools build --tag-message`.",
		);
	if (read.kind === "unreadable") return refused(read.reason);
	const { instruments, qretools } = read.manifest;
	if (instruments === undefined)
		return refused(
			"Its release was made before tag references. Release the workspace again.",
		);
	const bank = manifestVersions(message, blobs);
	// Read above, so only a manifest that doesn't match the files is left.
	if (bank.kind !== "used") return refused("reason" in bank ? bank.reason : "");
	const entry = instruments[path];
	if (entry === undefined)
		return refused(
			`The release has no instrument \`${path}\`. It has ${Object.keys(instruments).join(", ") || "none"}.`,
		);
	if (entry.blob !== blobs[path])
		return refused(`It doesn't match the files in the release: ${path}.`);
	return {
		kind: "release",
		versions: { ...bank.versions, [path]: versionOf(entry) },
		ddi: entry.ddi,
		qretools,
	};
}
