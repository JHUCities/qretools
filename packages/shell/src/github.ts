/**
 * The GitHub adapter: the storage port over Octokit, GitHub's official client, with
 * its retry and throttling plugins. Octokit throws; this file is where exceptions
 * become Results, and HTTP becomes the shell's Failure. Nothing here throws.
 *
 * Every save is one commit of a change set through the Git Data API: read the branch
 * head and every touched path at one commit, check each against the sha the author
 * started from, then blobs, a tree on the head's tree, a commit, and a fast-forward of
 * the branch (never forced). Blobs, trees and commits are content-addressed, so a
 * retried creation is harmless; the branch update runs once, and a lost fast-forward
 * (someone pushed meanwhile) starts over from the read, once.
 */

import { Octokit } from "@octokit/core";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { RequestError } from "@octokit/request-error";
import {
	err,
	FOLDERS,
	ok,
	type Result,
	ROOT,
	type RootKind,
} from "@qretools/core";
import {
	AuthError,
	type BankRef,
	type BranchTarget,
	type Change,
	type CommitFailure,
	type Committed,
	type Failure,
	type File,
	type Store,
} from "./storage.ts";

const GitHub = Octokit.plugin(retry, throttling);

/** No retries: for requests that are not safe to repeat. */
const ONCE = { request: { retries: 0 } } as const;

/**
 * `pacing` turns on the plugins' timing: writes spaced about a second apart (GitHub's
 * guidance) and retries with backoff. Tests turn it off to run without waiting.
 */
export const makeGitHubStore = (
	{ owner, repo, path: folder }: BankRef,
	token: () => Promise<string>,
	{ appToken }: { readonly appToken: boolean } = { appToken: true },
	fetch: typeof globalThis.fetch = globalThis.fetch,
	pacing = true,
): Store => {
	/**
	 * A bank path where the repository has it: the bank's folder in front. The one place
	 * a repository path is made; every path in and out of the store is the bank's own.
	 */
	const at = (path: string): string =>
		folder === "" ? path : `${folder}/${path}`;
	const octokit = new GitHub({
		request: { fetch },
		headers: { "X-GitHub-Api-Version": "2022-11-28" },
		retry: { enabled: pacing },
		// Wait out a rate limit once, then report it rather than stall the page.
		throttle: {
			enabled: pacing,
			onRateLimit: (_after, _options, _octokit, count) => count < 1,
			onSecondaryRateLimit: (_after, _options, _octokit, count) => count < 1,
		},
	});

	// The token is asked for before every request, so a renewed one is used at once
	// without rebuilding anything. If none can be had, the getter throws an AuthError.
	octokit.hook.before("request", async (options) => {
		options.headers.authorization = `token ${await token()}`;
	});

	/** Run a request; turn what Octokit throws into a Failure. */
	async function run<T>(
		request: () => Promise<T>,
	): Promise<Result<T, Failure>> {
		try {
			return ok(await request());
		} catch (e) {
			return err(failureOf(e));
		}
	}

	/**
	 * A GraphQL query. GitHub answers one question here with data and an error together:
	 * comparing the bank with a branch that does not exist yet. Only errors under
	 * `tolerated` keep the data; any other error is a failure, because a folder that
	 * failed to load would otherwise read as empty and its clean files as deleted.
	 */
	async function graphql<T>(
		query: string,
		variables: Record<string, string>,
		tolerated?: string,
	): Promise<Result<{ data?: T; error?: string }, Failure>> {
		try {
			return ok({ data: await octokit.graphql<T>(query, variables) });
		} catch (e) {
			if (e instanceof Error && e.name === "GraphqlResponseError") {
				const partial = e as Error & {
					data?: T;
					errors?: readonly {
						type?: string;
						path?: readonly (string | number)[];
					}[];
				};
				const onlyTolerated =
					tolerated !== undefined &&
					(partial.errors ?? []).every(
						(x) => x.path?.[0] === "repository" && x.path?.[1] === tolerated,
					);
				if (onlyTolerated && partial.data) return ok({ data: partial.data });
				// GitHub answers "Could not resolve to a Repository" both for a name that
				// does not exist and for one this sign-in cannot see: say it plainly.
				if (
					(partial.errors ?? []).some(
						(x) =>
							x.type === "NOT_FOUND" &&
							x.path?.[0] === "repository" &&
							x.path.length === 1,
					)
				)
					return err({
						kind: "unreadable",
						message: `GitHub has no repository ${owner}/${repo} that you can open.`,
						hint: "Check the name, and that the QREtools app is installed on it.",
					});
				return err({
					kind: "unreadable",
					message: "GitHub couldn't read the bank.",
					detail: e.message,
				});
			}
			return err(failureOf(e));
		}
	}

	/**
	 * Is the GitHub App this token comes from installed on the repository? Its user
	 * tokens list their installations: the one on the repository's owner, then, when it
	 * covers only selected repositories, whether this is one of them.
	 */
	const installedHere = async (): Promise<Result<boolean, Failure>> => {
		const list = await run(() =>
			octokit
				.request("GET /user/installations", { per_page: 100 })
				.catch((e: unknown) => {
					// Not a GitHub App token after all (a token pasted before tokens were
					// marked): there are no installations to check.
					if (
						e instanceof RequestError &&
						e.status === 403 &&
						/authorized to a GitHub App/i.test(e.message)
					)
						return undefined;
					throw e;
				}),
		);
		if (!list.ok) return list;
		if (list.value === undefined) return ok(true);
		const installation = list.value.data.installations.find(
			(i) =>
				i.account !== null &&
				"login" in i.account &&
				i.account.login.toLowerCase() === owner.toLowerCase(),
		);
		if (installation === undefined) return ok(false);
		if (installation.repository_selection === "all") return ok(true);
		const full = `${owner}/${repo}`.toLowerCase();
		for (let page = 1; ; page++) {
			const repos = await run(() =>
				octokit.request(
					"GET /user/installations/{installation_id}/repositories",
					{
						installation_id: installation.id,
						per_page: 100,
						page,
					},
				),
			);
			if (!repos.ok) return repos;
			const found = repos.value.data.repositories;
			if (found.some((x) => x.full_name.toLowerCase() === full))
				return ok(true);
			if (found.length < 100) return ok(false);
		}
	};

	const ensureBranch = async (
		target: BranchTarget,
	): Promise<Result<void, Failure>> => {
		const head = await run(() =>
			octokit.request("GET /repos/{owner}/{repo}/git/ref/{+ref}", {
				owner,
				repo,
				ref: `heads/${target.defaultBranch}`,
			}),
		);
		if (!head.ok) return head;
		const made = await run(() =>
			octokit.request("POST /repos/{owner}/{repo}/git/refs", {
				owner,
				repo,
				ref: `refs/heads/${target.branch}`,
				sha: head.value.data.object.sha,
			}),
		);
		// 422 "Reference already exists": another tab or device made it first. Fine.
		return made.ok || made.error.status === 422 ? ok(undefined) : made;
	};

	type Head = {
		oid: string;
		tree: string;
		files: Record<string, { sha: string; text: string } | null>;
	};

	/** The branch head and every touched path, read at that one commit; null if no branch. */
	async function readHead(
		branch: string,
		paths: readonly string[],
	): Promise<Result<Head | null, Failure>> {
		const vars: Record<string, string> = {
			owner,
			repo,
			ref: `refs/heads/${branch}`,
		};
		const fields = paths
			.map((p, i) => {
				vars[`p${i}`] = at(p);
				return `p${i}: file(path: $p${i}) { oid object { ... on Blob { text } } }`;
			})
			.join(" ");
		const params = paths.map((_, i) => `, $p${i}: String!`).join("");
		const r = await graphql<{
			repository: {
				head: {
					target: {
						oid: string;
						tree: { oid: string };
						[p: string]: unknown;
					};
				} | null;
			} | null;
		}>(
			`query Head($owner: String!, $repo: String!, $ref: String!${params}) {
  repository(owner: $owner, name: $repo) {
    head: ref(qualifiedName: $ref) { target { ... on Commit { oid tree { oid } ${fields} } } }
  }
}`,
			vars,
			"head",
		);
		if (!r.ok) return r;
		const head = r.value.data?.repository?.head;
		if (!head) return ok(null);
		const files: Head["files"] = {};
		paths.forEach((p, i) => {
			const f = head.target[`p${i}`] as
				| { oid: string; object: { text?: string } | null }
				| null
				| undefined;
			files[p] = f ? { sha: f.oid, text: f.object?.text ?? "" } : null;
		});
		return ok({ oid: head.target.oid, tree: head.target.tree.oid, files });
	}

	/** One attempt at the commit; `lost` means the fast-forward lost a race. */
	async function attempt(
		target: BranchTarget,
		changes: readonly Change[],
		message: string,
	): Promise<Result<Committed, CommitFailure> | "lost"> {
		const paths = changes.map((c) => c.path);
		let head = await readHead(target.branch, paths);
		if (head.ok && head.value === null) {
			// The author's first save: their branch starts at the bank's head.
			const made = await ensureBranch(target);
			if (!made.ok) return err({ failure: made.error });
			head = await readHead(target.branch, paths);
		}
		if (!head.ok) return err({ failure: head.error });
		if (head.value === null)
			return err({
				failure: {
					kind: "unreadable",
					message: "Your branch couldn't be created.",
				},
			});
		const { oid, tree, files } = head.value;
		const stale = changes.filter(
			(c) => (files[c.path]?.sha ?? null) !== c.expected,
		);
		if (stale.length > 0)
			return err({
				failure: {
					kind: "stale",
					message: `Changed on GitHub since you started: ${stale.map((c) => `\`${c.path}\``).join(", ")}.`,
					hint: "Copy your version somewhere first if you want to keep it, then reload from GitHub.",
				},
				seen: Object.fromEntries(paths.map((p) => [p, files[p] ?? null])),
			});
		const blobs = await Promise.all(
			changes.map((c) =>
				c.text === null
					? Promise.resolve(ok(null))
					: run(() =>
							octokit.request("POST /repos/{owner}/{repo}/git/blobs", {
								owner,
								repo,
								content: c.text as string,
								encoding: "utf-8",
							}),
						).then((r) => (r.ok ? ok(r.value.data.sha) : r)),
			),
		);
		const failed = blobs.find((b) => !b.ok);
		if (failed && !failed.ok) return err({ failure: failed.error });
		const shas: Record<string, string> = {};
		// A change that leaves its path as it is makes no commit of its own.
		const entries = changes.flatMap((c, i) => {
			const b = blobs[i];
			const sha = b?.ok ? b.value : null;
			if (sha === (files[c.path]?.sha ?? null)) {
				if (sha !== null) shas[c.path] = sha;
				return [];
			}
			if (sha !== null) shas[c.path] = sha;
			return [
				{
					path: at(c.path),
					mode: "100644" as const,
					type: "blob" as const,
					sha,
				},
			];
		});
		if (entries.length === 0) return ok({ shas });
		const newTree = await run(() =>
			octokit.request("POST /repos/{owner}/{repo}/git/trees", {
				owner,
				repo,
				base_tree: tree,
				tree: entries,
			}),
		);
		if (!newTree.ok) return err({ failure: newTree.error });
		const commit = await run(() =>
			octokit.request("POST /repos/{owner}/{repo}/git/commits", {
				owner,
				repo,
				message,
				tree: newTree.value.data.sha,
				parents: [oid],
			}),
		);
		if (!commit.ok) return err({ failure: commit.error });
		try {
			await octokit.request("PATCH /repos/{owner}/{repo}/git/refs/{+ref}", {
				owner,
				repo,
				ref: `heads/${target.branch}`,
				sha: commit.value.data.sha,
				force: false,
				...ONCE,
			});
		} catch (e) {
			// Decided from GitHub's own error, before it becomes display text: 422
			// "Update is not a fast forward" (someone pushed) or "Reference does not
			// exist" (the branch was merged and deleted mid-save) means read again and
			// retry, which recreates the branch if need be. Any other 422 is itself.
			if (
				e instanceof RequestError &&
				e.status === 422 &&
				/fast forward|does not exist/i.test(e.message)
			)
				return "lost";
			return err({ failure: failureOf(e) });
		}
		return ok({ shas });
	}

	/** The files at a branch, whether the branch exists, and how it compares with the bank. */
	async function loadFrom(
		ref: string,
		target: BranchTarget,
	): Promise<
		Result<
			{ files: File[]; exists: boolean; aheadBy: number; behindBy: number },
			Failure
		>
	> {
		const r = await graphql<BankData>(
			BANK_QUERY,
			{
				owner,
				repo,
				ref: `refs/heads/${ref}`,
				bank: `refs/heads/${target.defaultBranch}`,
				head: ref,
				questions: `${ref}:${at("questions")}`,
				...folderVariables(ref, at),
				...rootVariables(ref, at),
			},
			"bankRef",
		);
		if (!r.ok) return r;
		const data = r.value.data?.repository;
		if (!data)
			return err({
				kind: "unreadable",
				message: "GitHub couldn't read the bank.",
				hint: "Check the repository's name, and that you can open it on GitHub.",
				...(r.value.error !== undefined && { detail: r.value.error }),
			});
		const questions = (data.questions?.entries ?? []).flatMap((folder) =>
			(folder.object?.entries ?? []).flatMap((e) =>
				blobFile(`questions/${folder.name}/${e.name}`, e),
			),
		);
		const compare = data.bankRef?.compare;
		return ok({
			files: [...questions, ...schemeFiles(data), ...rootFiles(data)],
			exists: data.mine !== null && data.mine !== undefined,
			aheadBy: compare?.aheadBy ?? 0,
			behindBy: compare?.behindBy ?? 0,
		});
	}

	return {
		async whoAmI() {
			// Whether the app can write here is asked alongside, so it adds no wait; a
			// pasted development token has no installations to ask about.
			const [r, installed] = await Promise.all([
				graphql<WhoData>(WHO_QUERY, { owner, repo, dir: `HEAD:${folder}` }),
				appToken ? installedHere() : Promise.resolve(ok(true)),
			]);
			if (!r.ok) return r;
			const data = r.value.data;
			const writable = ["WRITE", "MAINTAIN", "ADMIN"].includes(
				data?.repository?.viewerPermission ?? "",
			);
			// A new repository has no commits and so no default branch: say that, not
			// that it does not exist. GitHub's own page for it offers the first file.
			if (data?.repository?.isEmpty)
				return err({
					kind: "empty",
					message: `${owner}/${repo} is empty on GitHub.`,
					hint: writable
						? "Add a first file on GitHub (a README will do), then sign in again."
						: "Ask someone with write access to add a first file, then sign in again.",
				});
			const branch = data?.repository?.defaultBranchRef?.name;
			if (!data || branch === undefined)
				return err({
					kind: "unreadable",
					message: `GitHub has no repository ${owner}/${repo} that you can open.`,
					hint: "Check the repository's name, and that you can open it on GitHub.",
					...(r.value.error !== undefined && { detail: r.value.error }),
				});
			// A folder that isn't there would read as an empty bank, and the first save would
			// start a new one at a mistyped path: refuse it, as a folder dialog would.
			if (folder !== "" && data.repository?.dir?.__typename !== "Tree")
				return err({
					kind: "unreadable",
					message: `GitHub has no folder \`${folder}\` in ${owner}/${repo}.`,
					hint: "Check the bank's folder, as it is on the repository's default branch.",
				});
			if (!installed.ok) return installed;
			return ok({
				login: data.viewer.login,
				avatarUrl: data.viewer.avatarUrl,
				access: !writable
					? { kind: "readOnly" }
					: installed.value
						? { kind: "write" }
						: { kind: "notInstalled" },
				defaultBranch: branch,
			});
		},

		async loadBank(target) {
			const first = await loadFrom(target.branch, target);
			if (!first.ok) return first;
			if (first.value.exists)
				return ok({
					files: first.value.files,
					from: "branch",
					aheadBy: first.value.aheadBy,
					behindBy: first.value.behindBy,
				});
			// The author's branch does not exist yet: the bank is what they start from.
			const bank = await loadFrom(target.defaultBranch, target);
			return bank.ok
				? ok({
						files: bank.value.files,
						from: "default",
						aheadBy: 0,
						behindBy: 0,
					})
				: bank;
		},

		async readWithSchemes(target, path) {
			const ref = target.branch;
			const r = await graphql<{
				repository:
					| ({
							file: { oid: string; text: string | null } | null;
					  } & Folders)
					| null;
			}>(FOREIGN_QUERY, {
				owner,
				repo,
				at: `${ref}:${at(path)}`,
				...folderVariables(ref, at),
				...rootVariables(ref, at),
			});
			if (!r.ok) return r;
			const data = r.value.data?.repository;
			const file = data?.file;
			if (!data || typeof file?.text !== "string")
				return err({
					kind: "http",
					status: 404,
					message: `\`${path}\` isn't on ${ref}.`,
				});
			return ok({
				file: { path, sha: file.oid, text: file.text },
				schemes: [...schemeFiles(data), ...rootFiles(data)],
			});
		},

		async read(target, path) {
			const r = await graphql<{
				repository: {
					file: { oid: string; text: string | null } | null;
				} | null;
			}>(
				`query Read($owner: String!, $repo: String!, $at: String!) {
  repository(owner: $owner, name: $repo) { file: object(expression: $at) { ... on Blob { oid text } } }
}`,
				{ owner, repo, at: `${target.branch}:${at(path)}` },
			);
			if (!r.ok) return r;
			const file = r.value.data?.repository?.file;
			return file?.text === undefined || file.text === null
				? err({
						kind: "http",
						status: 404,
						message: `\`${path}\` isn't on ${target.branch}.`,
					})
				: ok({ path, sha: file.oid, text: file.text });
		},

		async commit(target, changes, message) {
			const first = await attempt(target, changes, message);
			if (first !== "lost") return first;
			// Someone pushed between our read and our update: read again and retry, once.
			const second = await attempt(target, changes, message);
			return second !== "lost"
				? second
				: err({
						failure: {
							kind: "stale",
							message: "Your branch kept changing while saving.",
							hint: "Reload from GitHub, then save again.",
						},
					});
		},

		ensureBranch,
	};
};

/** What Octokit threw, as the shell's Failure. */
function failureOf(e: unknown): Failure {
	const error = e as {
		status?: number;
		message?: string;
		response?: {
			headers?: Record<string, string | number | undefined>;
			data?: unknown;
		};
	};
	const message =
		(error.response?.data as { message?: string } | undefined)?.message ??
		error.message ??
		String(e);
	// The token getter's own answer: no token, or the sign-in has ended.
	if (e instanceof AuthError) return e.failure;
	// GitHub's answer when the app a token comes from cannot act on the repository.
	if (
		e instanceof RequestError &&
		e.status === 403 &&
		/Resource not accessible by integration/i.test(message)
	)
		return {
			kind: "notInstalled",
			status: 403,
			message: "The app can't write to this repository.",
			hint: "Install the app on the repository, or allow it to write there (or ask an owner to).",
		};
	// Anything but Octokit's own error is a bug here, not an outage: say so.
	if (!(e instanceof RequestError))
		return {
			kind: "unreadable",
			message: "GitHub's reply wasn't understood.",
			detail: message,
		};
	// Octokit reports a request that never got an answer as status 500 with no response.
	if (error.response === undefined)
		return {
			kind: "network",
			message: "Couldn't reach GitHub.",
			hint: "Check that you're online, then try again.",
			detail: message,
		};
	const status = e.status;
	if (status === 401)
		return {
			kind: "auth",
			status,
			message: "GitHub didn't accept your sign-in.",
			hint: "It may have ended. Sign in again.",
		};
	const headers = error.response.headers ?? {};
	// The primary limit says so in its headers; a secondary one sends retry-after.
	if (
		(status === 403 || status === 429) &&
		(String(headers["x-ratelimit-remaining"]) === "0" ||
			headers["retry-after"] !== undefined ||
			/secondary rate limit/i.test(message))
	) {
		const reset = Number(headers["x-ratelimit-reset"]);
		const when = Number.isFinite(reset)
			? new Date(reset * 1000).toLocaleTimeString()
			: "later";
		return {
			kind: "rateLimited",
			status,
			message: `GitHub's rate limit is used up until ${when}.`,
			hint: "Try again then.",
		};
	}
	if (status === 404)
		return {
			kind: "http",
			status,
			message: "GitHub found nothing at that address.",
			hint: "Check the repository, branch and path, and that you can open the repository on GitHub.",
		};
	return {
		kind: "http",
		status,
		message: `GitHub refused the request (${status}).`,
		detail: message,
	};
}

interface Entry {
	readonly name: string;
	readonly type: string;
	readonly object?: {
		readonly oid?: string;
		readonly text?: string | null;
		readonly isBinary?: boolean;
		readonly isTruncated?: boolean;
		readonly entries?: readonly Entry[];
	};
}
type Tree = { readonly entries?: readonly Entry[] } | null;

interface WhoData {
	readonly viewer: { readonly login: string; readonly avatarUrl: string };
	readonly repository: {
		readonly viewerPermission: string | null;
		readonly isEmpty: boolean;
		readonly defaultBranchRef: { readonly name: string } | null;
		/** The bank's folder on the default branch: a `Tree` when it exists. */
		readonly dir?: { readonly __typename: string } | null;
	} | null;
}

interface BankData {
	readonly repository?:
		| ({
				readonly mine?: { readonly name: string } | null;
				readonly bankRef?: {
					readonly compare?: {
						readonly aheadBy: number;
						readonly behindBy: number;
					} | null;
				} | null;
				readonly questions?: Tree;
		  } & Folders)
		| null;
}

const WHO_QUERY = `query Who($owner: String!, $repo: String!, $dir: String!) {
  viewer { login avatarUrl(size: 64) }
  repository(owner: $owner, name: $repo) {
    viewerPermission isEmpty defaultBranchRef { name }
    dir: object(expression: $dir) { __typename }
  }
}`;

/**
 * Verified against the real bank: one request, cost 1, 330 blobs, none truncated. A
 * folder or file the bank lacks comes back null, which reads as empty; so does the
 * comparison with a branch that does not exist yet.
 */
const FLAT =
	"... on Tree { entries { name type object { ... on Blob { oid text isBinary isTruncated } } } }";
/**
 * The shared kinds' folders, one GraphQL alias and variable each, from the one table
 * (`FOLDERS`): a new kind is read without touching the queries. Folder names are
 * lowercase words, so they are safe as aliases.
 */
const SHARED = Object.values(FOLDERS);
const folderVariables = (
	ref: string,
	at: (path: string) => string,
): Record<string, string> =>
	Object.fromEntries(SHARED.map((f) => [f, `${ref}:${at(f)}`]));
const FOLDER_PARAMS = SHARED.map((f) => `$${f}: String!`).join(", ");
const FOLDER_FIELDS = SHARED.map(
	(f) => `${f}: object(expression: $${f}) { ${FLAT} }`,
).join("\n    ");
/** The folders' trees and the root files' blobs, each under its alias. */
type Folders = {
	readonly [alias: string]: Entry["object"] | null | undefined;
};
const schemeFiles = (data: Folders): File[] =>
	SHARED.flatMap((folder) =>
		(data[folder]?.entries ?? []).flatMap((e) =>
			blobFile(`${folder}/${e.name}`, e),
		),
	);

/**
 * The bank's root files (`ROOT`), one alias and variable each, prefixed so a kind's
 * name can't collide with the queries' own variables (`$bank` is the default branch).
 */
const ROOTS = Object.entries(ROOT) as readonly (readonly [RootKind, string])[];
const rootAlias = (kind: RootKind): string => `root_${kind}`;
const rootVariables = (
	ref: string,
	at: (path: string) => string,
): Record<string, string> =>
	Object.fromEntries(
		ROOTS.map(([k, path]) => [rootAlias(k), `${ref}:${at(path)}`]),
	);
const ROOT_PARAMS = ROOTS.map(([k]) => `$${rootAlias(k)}: String!`).join(", ");
const ROOT_FIELDS = ROOTS.map(
	([k]) =>
		`${rootAlias(k)}: object(expression: $${rootAlias(k)}) { ... on Blob { oid text isBinary isTruncated } }`,
).join("\n    ");
const rootFiles = (data: Folders): File[] =>
	ROOTS.flatMap(([k, path]) => {
		const object = data[rootAlias(k)];
		return object ? blobFile(path, { name: path, type: "blob", object }) : [];
	});

const FOREIGN_QUERY = `query Foreign($owner: String!, $repo: String!, $at: String!, ${FOLDER_PARAMS}, ${ROOT_PARAMS}) {
  repository(owner: $owner, name: $repo) {
    file: object(expression: $at) { ... on Blob { oid text } }
    ${FOLDER_FIELDS}
    ${ROOT_FIELDS}
  }
}`;
const BANK_QUERY = `query Bank($owner: String!, $repo: String!, $ref: String!, $bank: String!, $head: String!, $questions: String!, ${FOLDER_PARAMS}, ${ROOT_PARAMS}) {
  repository(owner: $owner, name: $repo) {
    mine: ref(qualifiedName: $ref) { name }
    bankRef: ref(qualifiedName: $bank) { compare(headRef: $head) { aheadBy behindBy } }
    questions: object(expression: $questions) { ... on Tree { entries { name type object {
      ... on Tree { entries { name type object { ... on Blob { oid text isBinary isTruncated } } } } } } } }
    ${FOLDER_FIELDS}
    ${ROOT_FIELDS}
  }
}`;

function blobFile(path: string, e: Entry): File[] {
	const o = e.object;
	if (
		!path.endsWith(".yaml") ||
		!o?.oid ||
		typeof o.text !== "string" ||
		o.isBinary ||
		o.isTruncated
	)
		return [];
	return [{ path, sha: o.oid, text: o.text }];
}
