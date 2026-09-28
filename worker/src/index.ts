/**
 * qretools' token exchange: the one narrow exception to "no server" (AGENTS.md, step 10).
 *
 * GitHub accepts PKCE for GitHub Apps but still requires the client secret when a code
 * or refresh token is redeemed, and its token endpoint refuses browser calls. This
 * Worker holds the secret and does exactly two things: `POST /exchange` redeems a code
 * with its PKCE verifier, `POST /refresh` redeems a refresh token. It keeps no data.
 *
 * The origin allowlist is hygiene, not a security boundary (a script can forge Origin):
 * `/exchange` is useless without the verifier held by the browser that started the
 * sign-in, `/refresh` without a refresh token. The Worker adds no power of its own.
 */

export interface Env {
	/** The GitHub App's client id (public). */
	readonly CLIENT_ID: string;
	/** The GitHub App's client secret: set with `wrangler secret put CLIENT_SECRET`. */
	readonly CLIENT_SECRET: string;
	/** Exact origins the app is served from, comma separated. */
	readonly ALLOWED_ORIGINS: string;
}

const TOKEN_URL = "https://github.com/login/oauth/access_token";

/** Only these fields of GitHub's answer reach the browser. */
const RETURNED = [
	"access_token",
	"token_type",
	"expires_in",
	"refresh_token",
	"refresh_token_expires_in",
] as const;

/** GitHub's errors that mean this Worker is set up wrong; never passed on in detail. */
const OURS = new Set(["incorrect_client_credentials", "redirect_uri_mismatch"]);

export default {
	fetch: (request: Request, env: Env): Promise<Response> =>
		handle(request, env, fetch),
};

export async function handle(
	request: Request,
	env: Env,
	upstream: typeof fetch,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? "";
	const allowed = env.ALLOWED_ORIGINS.split(",")
		.map((o) => o.trim())
		.filter((o) => o !== "");
	if (!allowed.includes(origin)) return new Response(null, { status: 403 });
	const cors = {
		"Access-Control-Allow-Origin": origin,
		Vary: "Origin",
	};
	if (request.method === "OPTIONS")
		return new Response(null, {
			status: 204,
			headers: {
				...cors,
				"Access-Control-Allow-Methods": "POST",
				"Access-Control-Allow-Headers": "Content-Type",
				"Access-Control-Max-Age": "86400",
			},
		});
	const reply = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), {
			status,
			headers: {
				...cors,
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
			},
		});
	if (request.method !== "POST")
		return reply(405, { error: "method_not_allowed" });

	const path = new URL(request.url).pathname;
	if (path !== "/exchange" && path !== "/refresh")
		return reply(404, { error: "not_found" });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return reply(400, { error: "invalid_request" });
	}
	const grant =
		path === "/exchange" ? exchangeGrant(body, origin) : refreshGrant(body);
	if (grant === undefined) return reply(400, { error: "invalid_request" });

	let answer: Record<string, unknown>;
	try {
		const response = await upstream(TOKEN_URL, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				client_id: env.CLIENT_ID,
				client_secret: env.CLIENT_SECRET,
				...grant,
			}),
		});
		if (!response.ok) return reply(502, { error: "upstream" });
		answer = (await response.json()) as Record<string, unknown>;
	} catch {
		return reply(502, { error: "upstream" });
	}
	// GitHub reports errors as 200 with an `error` field.
	const error = answer.error;
	if (typeof error === "string")
		return OURS.has(error)
			? reply(502, { error: "misconfigured" })
			: reply(400, {
					error,
					...(typeof answer.error_description === "string" && {
						error_description: answer.error_description,
					}),
				});
	if (typeof answer.access_token !== "string")
		return reply(502, { error: "upstream" });
	return reply(
		200,
		Object.fromEntries(
			RETURNED.flatMap((k) =>
				answer[k] === undefined ? [] : [[k, answer[k]]],
			),
		),
	);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** A code, its PKCE verifier, and the redirect it was issued for, which must be this origin's. */
function exchangeGrant(
	body: unknown,
	origin: string,
): Record<string, string> | undefined {
	if (!isObject(body)) return undefined;
	const { code, code_verifier, redirect_uri } = body;
	if (typeof code !== "string" || code.length === 0 || code.length > 100)
		return undefined;
	if (
		typeof code_verifier !== "string" ||
		!/^[A-Za-z0-9._~-]{43,128}$/.test(code_verifier)
	)
		return undefined;
	if (typeof redirect_uri !== "string") return undefined;
	try {
		if (new URL(redirect_uri).origin !== origin) return undefined;
	} catch {
		return undefined;
	}
	return { code, code_verifier, redirect_uri };
}

function refreshGrant(body: unknown): Record<string, string> | undefined {
	if (!isObject(body)) return undefined;
	const { refresh_token } = body;
	if (
		typeof refresh_token !== "string" ||
		refresh_token.length === 0 ||
		refresh_token.length > 200
	)
		return undefined;
	return { grant_type: "refresh_token", refresh_token };
}
