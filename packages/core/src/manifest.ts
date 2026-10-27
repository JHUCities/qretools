/**
 * A workspace release's manifest: each file's DDI version as the workspace's history
 * gave it when the release was built, written as the release tag's own message, so a
 * reader of the tag gets real versions without that history. `build` writes it; a
 * reader trusts it only when it describes exactly the files read at the tag. Pure.
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

/** A tag's message for a release: a line for people, a blank line, then the manifest. */
export function tagMessage(versions: Versions, builtBy: string): string {
	const files = Object.fromEntries(
		Object.keys(versions)
			.sort()
			.flatMap((path) => {
				const v = versions[path];
				return v?.blob === undefined
					? []
					: [
							[
								path,
								{
									version: v.number,
									...(v.date !== undefined && { date: v.date }),
									blob: v.blob,
								},
							],
						];
			}),
	);
	const manifest = { qretools: builtBy, files };
	return `Each file's DDI version, by QREtools ${builtBy}\n\n${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The versions a tag's message gives the files read at the tag (`blobs`, by path in the
 * workspace), all or none: a question's version counts its shared files' changes too, so
 * one file that differs makes every number doubtful.
 */
export function manifestVersions(
	message: string,
	blobs: Readonly<Record<string, string>>,
): ManifestRead {
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
	if (!parsed.success)
		return {
			kind: "unreadable",
			reason: "This version of QREtools doesn't know its format.",
		};
	const { files } = parsed.data;
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
	for (const [path, e] of Object.entries(files))
		versions[path] = {
			number: e.version,
			blob: e.blob,
			...(e.date !== undefined && { date: e.date }),
		};
	return { kind: "used", versions };
}
