/**
 * The GitHub adapter: the storage port over Octokit, GitHub's official client, with
 * its retry and throttling plugins. Octokit throws; this file is where exceptions
 * become Results, and HTTP becomes the shell's Failure. Nothing here throws.
 *
 * Retries: reads are retried on transient server errors; content writes are not. A
 * write that reached GitHub but whose reply was lost would, retried, present its old
 * sha and be refused as stale: a false conflict for a save that worked.
 */
import { Octokit } from "@octokit/core";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { err, ok, type Result } from "../core/result.js";
import type { BranchTarget, Failure, File, Repo, Store } from "./storage.js";

const GitHub = Octokit.plugin(retry, throttling);

/** No retries: for requests that are not safe to repeat. */
const ONCE = { request: { retries: 0 } } as const;

/**
 * `pacing` turns on the plugins' timing: writes spaced about a second apart (GitHub's
 * guidance) and retries with backoff. Tests turn it off to run without waiting.
 */
export const makeGitHubStore = (
	{ owner, repo }: Repo,
	token: string,
	fetch: typeof globalThis.fetch = globalThis.fetch,
	pacing = true,
): Store => {
	const octokit = new GitHub({
		auth: token,
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

	/** Run a request; turn what Octokit throws into a Failure. */
	async function run<T>(
		request: () => Promise<T>,
		stale = false,
	): Promise<Result<T, Failure>> {
		try {
			return ok(await request());
		} catch (e) {
			return err(failureOf(e, stale));
		}
	}

	/**
	 * A GraphQL query. GitHub answers some questions with data and errors together (a
	 * comparison with a branch that does not exist yet); the data is what counts.
	 */
	async function graphql<T>(
		query: string,
		variables: Record<string, string>,
	): Promise<Result<{ data?: T; error?: string }, Failure>> {
		try {
			return ok({ data: await octokit.graphql<T>(query, variables) });
		} catch (e) {
			if (e instanceof Error && e.name === "GraphqlResponseError") {
				const partial = e as Error & { data?: T };
				return ok({
					...(partial.data && { data: partial.data }),
					error: e.message,
				});
			}
			return err(failureOf(e, false));
		}
	}

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

	/**
	 * Run a write; if GitHub says the branch does not exist (a first save), create it
	 * from the default branch and run the write once more.
	 */
	async function onBranch<T>(
		target: BranchTarget,
		attempt: () => Promise<Result<T, Failure>>,
	): Promise<Result<T, Failure>> {
		const first = await attempt();
		if (first.ok || !isMissingBranch(first.error)) return first;
		const made = await ensureBranch(target);
		return made.ok ? attempt() : made;
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
		const r = await graphql<BankData>(BANK_QUERY, {
			owner,
			repo,
			ref: `refs/heads/${ref}`,
			bank: `refs/heads/${target.defaultBranch}`,
			head: ref,
			questions: `${ref}:questions`,
			scales: `${ref}:scales`,
			universes: `${ref}:universes`,
			instructions: `${ref}:instructions`,
			missing: `${ref}:missing.yaml`,
		});
		if (!r.ok) return r;
		const data = r.value.data?.repository;
		if (!data)
			return err({
				kind: "unreadable",
				message: r.value.error ?? "GitHub returned no repository data.",
				hint: "Check the owner, repository and branch, and that the token can read it.",
			});
		const questions = (data.questions?.entries ?? []).flatMap((folder) =>
			(folder.object?.entries ?? []).flatMap((e) =>
				blobFile(`questions/${folder.name}/${e.name}`, e),
			),
		);
		const flat = (folder: string, tree: Tree | undefined) =>
			(tree?.entries ?? []).flatMap((e) => blobFile(`${folder}/${e.name}`, e));
		const missing = data.missing
			? blobFile("missing.yaml", {
					name: "missing.yaml",
					type: "blob",
					object: data.missing,
				})
			: [];
		const compare = data.bankRef?.compare;
		return ok({
			files: [
				...questions,
				...flat("scales", data.scales),
				...flat("universes", data.universes),
				...flat("instructions", data.instructions),
				...missing,
			],
			exists: data.mine !== null && data.mine !== undefined,
			aheadBy: compare?.aheadBy ?? 0,
			behindBy: compare?.behindBy ?? 0,
		});
	}

	return {
		async whoAmI() {
			const r = await graphql<WhoData>(WHO_QUERY, { owner, repo });
			if (!r.ok) return r;
			const data = r.value.data;
			const branch = data?.repository?.defaultBranchRef?.name;
			if (!data || branch === undefined)
				return err({
					kind: "unreadable",
					message:
						r.value.error ??
						`GitHub has no repository ${owner}/${repo} for this token.`,
					hint: "Check the owner and repository, and that the token can read it.",
				});
			return ok({
				login: data.viewer.login,
				canWrite: ["WRITE", "MAINTAIN", "ADMIN"].includes(
					data.repository?.viewerPermission ?? "",
				),
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

		async read(target, path) {
			const at = (ref: string) =>
				run(() =>
					octokit.request("GET /repos/{owner}/{repo}/contents/{+path}", {
						owner,
						repo,
						path,
						ref,
					}),
				);
			let r = await at(target.branch);
			// Before the first save the branch does not exist; the file is the bank's.
			if (!r.ok && r.error.status === 404) r = await at(target.defaultBranch);
			if (!r.ok) return r;
			const file = r.value.data as { sha?: string; content?: string };
			return file.sha === undefined || file.content === undefined
				? err({ kind: "unreadable", message: `\`${path}\` is not a file.` })
				: ok({ path, sha: file.sha, text: decode(file.content) });
		},

		write(target, path, text, message, sha) {
			return onBranch(target, async () => {
				const r = await run(
					() =>
						octokit.request("PUT /repos/{owner}/{repo}/contents/{+path}", {
							owner,
							repo,
							path,
							message,
							content: encode(text),
							branch: target.branch,
							...(sha !== undefined && { sha }),
							...ONCE,
						}),
					// 409/422 means "stale" only when we presented a sha; without one the path is
					// already taken, which update() prevents before it gets here.
					sha !== undefined,
				);
				if (!r.ok) return r;
				const written = r.value.data.content?.sha;
				return written === undefined
					? err({
							kind: "unreadable",
							message: "GitHub did not say what it wrote.",
						})
					: ok({ sha: written });
			});
		},

		remove(target, path, sha, message) {
			return onBranch(target, async () => {
				const r = await run(
					() =>
						octokit.request("DELETE /repos/{owner}/{repo}/contents/{+path}", {
							owner,
							repo,
							path,
							message,
							sha,
							branch: target.branch,
							...ONCE,
						}),
					true,
				);
				return r.ok ? ok(undefined) : r;
			});
		},

		ensureBranch,
	};
};

/** GitHub's answer to a write on a branch that does not exist: 404 "Branch … not found". */
const isMissingBranch = (f: Failure): boolean =>
	f.status === 404 && /branch .* not found/i.test(f.message);

/** What Octokit threw, as the shell's Failure. */
function failureOf(e: unknown, stale: boolean): Failure {
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
	// Octokit reports a request that never got an answer as status 500 with no response.
	if (error.status === undefined || error.response === undefined)
		return { kind: "network", message: `Could not reach GitHub: ${message}` };
	const status = error.status;
	if (status === 401)
		return {
			kind: "auth",
			status,
			message: "GitHub did not accept the token.",
			hint: "It may have expired, or lack access to this repository.",
		};
	if (stale && (status === 409 || status === 422))
		return {
			kind: "stale",
			status,
			message: "This file changed on GitHub since you opened it.",
			hint: "Download your version first if you want to keep it, then reload from GitHub.",
		};
	const headers = error.response.headers ?? {};
	if (
		(status === 403 || status === 429) &&
		String(headers["x-ratelimit-remaining"]) === "0"
	) {
		const reset = Number(headers["x-ratelimit-reset"]);
		const when = Number.isFinite(reset)
			? new Date(reset * 1000).toLocaleTimeString()
			: "later";
		return {
			kind: "rateLimited",
			status,
			message: `GitHub's rate limit is exhausted until ${when}.`,
		};
	}
	// Keep GitHub's own words for a missing branch: `isMissingBranch` reads them.
	if (status === 404 && !/branch .* not found/i.test(message))
		return {
			kind: "http",
			status,
			message: "GitHub found nothing at that address.",
			hint: "Check the owner, repository, branch and path, and that the token can see the repository.",
		};
	return { kind: "http", status, message };
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
	readonly viewer: { readonly login: string };
	readonly repository: {
		readonly viewerPermission: string | null;
		readonly defaultBranchRef: { readonly name: string } | null;
	} | null;
}

interface BankData {
	readonly repository?: {
		readonly mine?: { readonly name: string } | null;
		readonly bankRef?: {
			readonly compare?: {
				readonly aheadBy: number;
				readonly behindBy: number;
			} | null;
		} | null;
		readonly questions?: Tree;
		readonly scales?: Tree;
		readonly universes?: Tree;
		readonly instructions?: Tree;
		readonly missing?: Entry["object"] | null;
	} | null;
}

const WHO_QUERY = `query Who($owner: String!, $repo: String!) {
  viewer { login }
  repository(owner: $owner, name: $repo) { viewerPermission defaultBranchRef { name } }
}`;

/**
 * Verified against the real bank: one request, cost 1, 330 blobs, none truncated. A
 * folder or file the bank lacks comes back null, which reads as empty; so does the
 * comparison with a branch that does not exist yet.
 */
const FLAT =
	"... on Tree { entries { name type object { ... on Blob { oid text isBinary isTruncated } } } }";
const BANK_QUERY = `query Bank($owner: String!, $repo: String!, $ref: String!, $bank: String!, $head: String!, $questions: String!, $scales: String!, $universes: String!, $instructions: String!, $missing: String!) {
  repository(owner: $owner, name: $repo) {
    mine: ref(qualifiedName: $ref) { name }
    bankRef: ref(qualifiedName: $bank) { compare(headRef: $head) { aheadBy behindBy } }
    questions: object(expression: $questions) { ... on Tree { entries { name type object {
      ... on Tree { entries { name type object { ... on Blob { oid text isBinary isTruncated } } } } } } } }
    scales: object(expression: $scales) { ${FLAT} }
    universes: object(expression: $universes) { ${FLAT} }
    instructions: object(expression: $instructions) { ${FLAT} }
    missing: object(expression: $missing) { ... on Blob { oid text isBinary isTruncated } }
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

/** Base64 of the UTF-8 bytes. `btoa` on raw text would corrupt curly quotes and en dashes, which the bank has. */
export function encode(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

export function decode(base64: string): string {
	const binary = atob(base64.replace(/\s/g, ""));
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}
