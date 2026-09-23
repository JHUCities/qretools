/**
 * The GitHub adapter: the storage port over GitHub's REST and GraphQL APIs with a
 * personal access token. Every method returns a Result; nothing here throws.
 */
import { err, ok, type Result } from "../core/result.js";
import type { BankSettings, Failure, File, Store } from "./storage.js";

const API = "https://api.github.com";

export const makeGitHubStore = (
	settings: BankSettings,
	token: string,
	fetch: typeof globalThis.fetch = globalThis.fetch,
): Store => {
	const { owner, repo, branch } = settings;
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"Content-Type": "application/json",
	};
	const contents = (path: string) =>
		`${API}/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;

	async function call<T>(
		url: string,
		init: RequestInit,
		stale = false,
	): Promise<Result<T, Failure>> {
		let response: Response;
		try {
			response = await fetch(url, {
				...init,
				headers: { ...headers, ...(init.headers ?? {}) },
			});
		} catch (e) {
			return err({
				kind: "network",
				message: `Could not reach GitHub: ${e instanceof Error ? e.message : String(e)}`,
			});
		}
		if (response.ok) {
			try {
				return ok(
					(response.status === 204 ? undefined : await response.json()) as T,
				);
			} catch {
				return err({
					kind: "unreadable",
					message: "GitHub's reply was not JSON.",
					status: response.status,
				});
			}
		}
		return err(await failureOf(response, stale));
	}

	return {
		async whoAmI() {
			const user = await call<{ login: string }>(`${API}/user`, {
				method: "GET",
			});
			if (!user.ok) return user;
			const repository = await call<{ permissions?: { push?: boolean } }>(
				`${API}/repos/${owner}/${repo}`,
				{ method: "GET" },
			);
			if (!repository.ok) return repository;
			return ok({
				login: user.value.login,
				canWrite: repository.value.permissions?.push === true,
			});
		},

		async loadBank() {
			const result = await call<GraphQL>(`${API}/graphql`, {
				method: "POST",
				body: JSON.stringify({
					query: BANK_QUERY,
					variables: {
						owner,
						repo,
						questions: `${branch}:questions`,
						scales: `${branch}:scales`,
						universes: `${branch}:universes`,
						instructions: `${branch}:instructions`,
						missing: `${branch}:missing.yaml`,
					},
				}),
			});
			if (!result.ok) return result;
			const data = result.value.data?.repository;
			if (!data) {
				return err({
					kind: "unreadable",
					message:
						result.value.errors?.[0]?.message ??
						"GitHub returned no repository data.",
					hint: "Check the owner, repository and branch, and that the token can read it.",
				});
			}
			const questions = (data.questions?.entries ?? []).flatMap((folder) =>
				(folder.object?.entries ?? []).flatMap((e) =>
					blobFile(`questions/${folder.name}/${e.name}`, e),
				),
			);
			const flat = (folder: string, tree?: { entries?: readonly Entry[] }) =>
				(tree?.entries ?? []).flatMap((e) =>
					blobFile(`${folder}/${e.name}`, e),
				);
			const missing = data.missing
				? blobFile("missing.yaml", {
						name: "missing.yaml",
						type: "blob",
						object: data.missing,
					})
				: [];
			return ok([
				...questions,
				...flat("scales", data.scales),
				...flat("universes", data.universes),
				...flat("instructions", data.instructions),
				...missing,
			]);
		},

		async read(path) {
			const r = await call<{ sha: string; content: string }>(
				`${contents(path)}?ref=${encodeURIComponent(branch)}`,
				{ method: "GET" },
			);
			return r.ok
				? ok({ path, sha: r.value.sha, text: decode(r.value.content) })
				: r;
		},

		async write(path, text, message, sha) {
			const r = await call<{ content: { sha: string } }>(
				contents(path),
				{
					method: "PUT",
					body: JSON.stringify({
						message,
						content: encode(text),
						branch,
						...(sha !== undefined && { sha }),
					}),
				},
				// 409/422 means "stale" only when we presented a sha; without one the path is
				// already taken, which update() prevents before it gets here.
				sha !== undefined,
			);
			return r.ok ? ok({ sha: r.value.content.sha }) : r;
		},

		async remove(path, sha, message) {
			const r = await call<unknown>(
				contents(path),
				{ method: "DELETE", body: JSON.stringify({ message, sha, branch }) },
				true,
			);
			return r.ok ? ok(undefined) : r;
		},
	};
};

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
interface GraphQL {
	readonly data?: {
		readonly repository?: {
			readonly questions?: { readonly entries?: readonly Entry[] };
			readonly scales?: { readonly entries?: readonly Entry[] };
			readonly universes?: { readonly entries?: readonly Entry[] };
			readonly instructions?: { readonly entries?: readonly Entry[] };
			readonly missing?: Entry["object"];
		} | null;
	};
	readonly errors?: readonly { readonly message: string }[];
}

/**
 * Verified against the real bank: one request, cost 1, 330 blobs, none truncated.
 * A folder or file the bank lacks comes back null, which reads as empty.
 */
const FLAT =
	"... on Tree { entries { name type object { ... on Blob { oid text isBinary isTruncated } } } }";
const BANK_QUERY = `query Bank($owner: String!, $repo: String!, $questions: String!, $scales: String!, $universes: String!, $instructions: String!, $missing: String!) {
  repository(owner: $owner, name: $repo) {
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

async function failureOf(response: Response, stale: boolean): Promise<Failure> {
	const status = response.status;
	let message = response.statusText;
	try {
		const body = (await response.json()) as { message?: string };
		if (typeof body.message === "string") message = body.message;
	} catch {
		// keep statusText
	}
	if (status === 401)
		return {
			kind: "auth",
			status,
			message: "GitHub did not accept the token.",
			hint: "It may have expired, or lack access to this repository.",
		};
	if (stale && (status === 409 || status === 422)) {
		return {
			kind: "stale",
			status,
			message: "This file changed on GitHub since you opened it.",
			hint: "Download your version first if you want to keep it, then reload from GitHub.",
		};
	}
	if (
		(status === 403 || status === 429) &&
		response.headers.get("x-ratelimit-remaining") === "0"
	) {
		const reset = Number(response.headers.get("x-ratelimit-reset"));
		const when = Number.isFinite(reset)
			? new Date(reset * 1000).toLocaleTimeString()
			: "later";
		return {
			kind: "rateLimited",
			status,
			message: `GitHub's rate limit is exhausted until ${when}.`,
		};
	}
	if (status === 404)
		return {
			kind: "http",
			status,
			message: "GitHub found nothing at that address.",
			hint: "Check the owner, repository, branch and path, and that the token can see the repository.",
		};
	return {
		kind: "http",
		status,
		message: `GitHub answered ${status}: ${message}`,
	};
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
