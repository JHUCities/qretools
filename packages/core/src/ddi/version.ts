/**
 * An item's DDI version, as history gives it: the core never computes one (it has no
 * clock and no history) and is given what is known. A file's items share its version:
 * a question's for everything elaborated from it, a shared file's for its own items.
 *
 * For whoever computes them (later, in CI): a version must change whenever an item's
 * content does, so a question file's version counts the merged changes to it and to
 * every shared file it names (and `missing.yaml` for a question with a variable,
 * `select_all.yaml` for a select-all question, whose options are coded as it says), since a
 * reference carries the referenced item's version.
 */
import { type JsonObject, obj } from "./document.ts";

export interface Version {
	/** DDI's Version: digits and dots, `1`, `2`, `1.2`. */
	readonly number: string;
	/** VersionDate, an ISO 8601 date-time: when the change was merged. */
	readonly date?: string;
	/** VersionResponsibility: who is responsible for the change. */
	readonly responsibility?: string;
	/** The git blob the version was made from, recorded as a UserID. */
	readonly blob?: string;
	/** IsPublished: false for a preview of a change not yet merged; absent when not stated. */
	readonly published?: boolean;
	/** Where the file was read, for an item rebuilt from another repository at a tag. */
	readonly origin?: GitOrigin;
}

/** A file in a repository on GitHub at a tag, as read: recorded as UserAttributePairs. */
export interface GitOrigin {
	/** `owner/repo`, from the address key, which lowercases them as GitHub compares them. */
	readonly repository: string;
	/** The file's path in the repository. */
	readonly path: string;
	readonly tag: string;
	/** The commit the tag named when it was read. */
	readonly commit: string;
}

/** Versions by bank-relative path (`questions/nhd/nhd_sat.yaml`, `scales/agree4.yaml`). */
export type Versions = Readonly<Record<string, Version>>;

/** What an item is when nothing is known of its history: version 1, and nothing more said. */
export const UNVERSIONED: Version = { number: "1" };

/** How a git blob sha is labelled among an item's UserIDs. */
const BLOB = "git-blob";

/** The keys an origin's UserAttributePairs use: one vocabulary, written once. */
const ORIGIN_KEYS = {
	repository: "git-repository",
	path: "git-path",
	tag: "git-tag",
	commit: "git-commit",
} as const;

const pair = (key: string, value: string): JsonObject => ({
	AttributeKey: { StringValue: key },
	AttributeValue: { StringValue: value },
});

/** An origin's UserAttributePairs. An `owner/repo` address means GitHub, so the repository is its URL there. */
const originPairs = (o: GitOrigin): JsonObject[] => [
	pair(ORIGIN_KEYS.repository, `https://github.com/${o.repository}`),
	pair(ORIGIN_KEYS.path, o.path),
	pair(ORIGIN_KEYS.tag, o.tag),
	pair(ORIGIN_KEYS.commit, o.commit),
];

/**
 * A versionable item's version fields. Only the file's principal item carries the blob
 * as its UserID, since a UserID must be unique within its type and every item from one
 * file shares the blob; its origin rides beside it, on the same item.
 */
export const versionFields = (
	version: Version,
	principal: boolean,
): JsonObject =>
	obj({
		VersionDate:
			version.date === undefined ? undefined : { DateTime: version.date },
		VersionResponsibility: version.responsibility,
		UserID:
			principal && version.blob !== undefined
				? [{ StringValue: version.blob, TypeOfUserID: { StringValue: BLOB } }]
				: undefined,
		UserAttributePair:
			principal && version.origin !== undefined
				? originPairs(version.origin)
				: undefined,
		IsPublished: version.published,
	});
