/**
 * Where a bank an instrument uses is, as its `uses` writes it: a folder beside the
 * instrument (`../banks/hh`, starting `./` or `../`), or a folder in another repository
 * at a version (`owner/repo@v1`, `owner/repo/banks/hh@v1`: the version last, after the
 * whole place). Read once here; nothing downstream looks at the text again. Pure.
 */

export type Address =
	/** A folder relative to the instrument's own, `/`-separated, as written. */
	| { readonly kind: "local"; readonly path: string }
	| {
			readonly kind: "remote";
			readonly owner: string;
			readonly repo: string;
			/** The bank's folder in that repository: "" for its root. */
			readonly path: string;
			/** The version: a tag, by the shell's rule; the core reads any ref. */
			readonly ref: string;
			/** One bank, one key, however it's capitalised (`AddressKey`). */
			readonly key: AddressKey;
	  }
	| { readonly kind: "invalid"; readonly reason: string };

/**
 * A remote bank's identity: `owner/repo[/path]@ref` with the owner and repository
 * lowercased, as GitHub compares them; the folder and version kept exact, as git does.
 */
export type AddressKey = string;

/** A GitHub login: letters, digits and single hyphens, not at either end. */
const OWNER = /^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/;
/** A repository name as GitHub allows it, other than `.` and `..`. */
const REPO = /^[A-Za-z0-9._-]+$/;
/**
 * A ref: a tag or branch name, `/`-separated segments of letters, digits and `._+-`
 * (`v1`, `v1.0.0+2026`, `release/2026.1`). Closed to the rest: git forbids `:~^?*[\`
 * and spaces, and a `:` would also break the `<ref>:<path>` expression a fetch builds.
 * Git's other bans that can arise here are checked beside it (`badRef`).
 */
const REF = /^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/;

/** Whether `ref` is one git would refuse: `..` anywhere, a segment starting `.`, a `.lock` end. */
const badRef = (ref: string): boolean =>
	!REF.test(ref) ||
	ref.includes("..") ||
	ref.split("/").some((r) => r.startsWith(".")) ||
	ref.endsWith(".lock");

const EXAMPLE =
	"Write a folder beside this instrument (`../banks/hh`), or a repository and version (`owner/bank@v1`).";

/**
 * `text` as an address, or why it isn't one. The version follows the last `@`, so a
 * version can't contain `@`; a folder beside the instrument takes none.
 */
export function addressOf(text: string): Address {
	const t = text.trim();
	if (/^\.\.?\//.test(t))
		return t.includes("@")
			? {
					kind: "invalid",
					reason: `\`${t}\`: a folder beside this instrument has no version; it's read with the instrument. Write \`${t.slice(0, t.indexOf("@"))}\`.`,
				}
			: { kind: "local", path: t };
	const at = t.lastIndexOf("@");
	if (at === -1)
		return {
			kind: "invalid",
			reason: `\`${t}\` has no version: a bank in another repository is read at one, such as \`${t}@v1\`. A folder beside this instrument starts \`./\` or \`../\`.`,
		};
	const place = t.slice(0, at).replace(/\/+$/, "");
	const ref = t.slice(at + 1);
	const [owner = "", repo = "", ...folders] = place.split("/");
	const invalid = (reason: string): Address => ({ kind: "invalid", reason });
	if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..")
		return invalid(`\`${t}\` names no repository. ${EXAMPLE}`);
	if (folders.some((f) => f === "" || f === "." || f === ".."))
		return invalid(
			`\`${t}\` has an empty, \`.\` or \`..\` folder in its path. ${EXAMPLE}`,
		);
	if (badRef(ref))
		return invalid(
			`\`${t}\` has no version after \`@\` that git would accept. ${EXAMPLE}`,
		);
	const path = folders.join("/");
	return {
		kind: "remote",
		owner,
		repo,
		path,
		ref,
		key: `${owner.toLowerCase()}/${repo.toLowerCase()}${path === "" ? "" : `/${path}`}@${ref}`,
	};
}

/**
 * The folder `relative` names from the folder `base` (both `/`-separated, "" for the
 * root), or undefined when it leads above the root.
 */
export function joinFolder(base: string, relative: string): string | undefined {
	const out: string[] = [];
	for (const p of [...base.split("/"), ...relative.split("/")]) {
		if (p === "" || p === ".") continue;
		if (p !== "..") out.push(p);
		else if (out.pop() === undefined) return undefined;
	}
	return out.join("/");
}

/**
 * How a folder beside `base` is written from it, `joinFolder`'s inverse: `../banks/hh`
 * from `instruments`, `../` for the root, `./` for `base` itself. Always starts `./` or
 * `../`, so `addressOf` reads it as local.
 */
export function relativeFolder(base: string, to: string): string {
	const from = base.split("/").filter((p) => p !== "");
	const target = to.split("/").filter((p) => p !== "");
	let shared = 0;
	while (shared < from.length && from[shared] === target[shared]) shared++;
	const up = from.length - shared;
	const down = target.slice(shared).join("/");
	const head = up === 0 ? "./" : "../".repeat(up);
	return `${head}${down}`;
}
