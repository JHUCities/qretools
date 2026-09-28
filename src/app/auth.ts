/**
 * Signing in with GitHub (AGENTS.md, step 10): the authorization-code flow with PKCE,
 * the code redeemed through the token-exchange Worker, which holds the client secret.
 * The rules are pure functions here, tested without a browser; the two Worker calls take
 * `fetch` as a parameter. The token never enters the Model or a Msg, and neither does
 * the code: the shell carries both.
 */
import { z } from "zod";
import { err, ok, type Result } from "../core/result.js";
import type { SignInConfig } from "./config.js";
import type { Failure } from "./storage.js";

/** What the app holds for GitHub: an access token and, for an App user token, how to renew it. */
export interface Credentials {
	readonly access: string;
	/** Epoch ms; absent for a token that does not expire (a pasted one, or an App with expiry off). */
	readonly expiresAt?: number;
	readonly refresh?: string;
	readonly refreshExpiresAt?: number;
	/** Pasted in development, not issued by the GitHub App: no installations to check. */
	readonly pasted?: true;
}

/** What the browser keeps across the round trip to GitHub, in session storage, used once. */
export interface PendingSignIn {
	readonly state: string;
	readonly verifier: string;
	readonly remember: boolean;
	/** The link that was open, so the round trip does not lose it. */
	readonly hash: string;
	/** Epoch ms when the sign-in started: a code is only good for minutes. */
	readonly at: number;
}

export const PendingSchema = z.strictObject({
	state: z.string(),
	verifier: z.string(),
	remember: z.boolean(),
	hash: z.string(),
	at: z.number(),
});

export interface Callback {
	readonly code: string;
	readonly verifier: string;
	readonly remember: boolean;
	readonly hash: string;
}

/** GitHub's codes expire after ten minutes. */
const CODE_LIFETIME = 10 * 60 * 1000;

/** Base64url without padding, as PKCE wants it. */
export const base64url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

export function authorizeUrl(
	config: SignInConfig,
	pkce: { readonly state: string; readonly challenge: string },
): string {
	const params = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		state: pkce.state,
		code_challenge: pkce.challenge,
		code_challenge_method: "S256",
	});
	return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * GitHub sent the author back: `?code&state`, or `?error&state` if they declined. The
 * state must be the one this browser stored, and recent; anything else is refused.
 * Undefined when the address carries no sign-in at all.
 */
export function callbackOf(
	search: string,
	pending: PendingSignIn | undefined,
	now: number,
): Result<Callback, Failure> | undefined {
	const params = new URLSearchParams(search);
	const code = params.get("code");
	const error = params.get("error");
	if (code === null && error === null) return undefined;
	const refused = (message: string, hint?: string): Result<Callback, Failure> =>
		err(
			hint === undefined
				? { kind: "auth", message }
				: { kind: "auth", message, hint },
		);
	if (pending === undefined || params.get("state") !== pending.state)
		return refused(
			"This sign-in did not start here, or has already been used.",
			"Sign in again from the Bank panel.",
		);
	if (error !== null)
		return refused(
			error === "access_denied"
				? "Sign-in was cancelled on GitHub."
				: `GitHub did not sign you in: ${error}.`,
		);
	if (now - pending.at > CODE_LIFETIME)
		return refused("The sign-in took too long.", "Sign in again.");
	return ok({
		code: code ?? "",
		verifier: pending.verifier,
		remember: pending.remember,
		hash: pending.hash,
	});
}

const TokenReply = z.object({
	access_token: z.string(),
	expires_in: z.number().optional(),
	refresh_token: z.string().optional(),
	refresh_token_expires_in: z.number().optional(),
});

/** The Worker's reply as Credentials, with lifetimes made absolute on arrival (no clock skew). */
export function credentialsOf(
	json: unknown,
	now: number,
): Credentials | undefined {
	const r = TokenReply.safeParse(json);
	if (!r.success) return undefined;
	const d = r.data;
	return {
		access: d.access_token,
		...(d.expires_in !== undefined && { expiresAt: now + d.expires_in * 1000 }),
		...(d.refresh_token !== undefined && { refresh: d.refresh_token }),
		...(d.refresh_token_expires_in !== undefined && {
			refreshExpiresAt: now + d.refresh_token_expires_in * 1000,
		}),
	};
}

/** Renew this long before expiry, so no request runs on a token about to lapse. */
export const MARGIN = 5 * 60 * 1000;

export const stale = (c: Credentials, now: number): boolean =>
	c.expiresAt !== undefined && c.expiresAt - now < MARGIN;

/** Redeem a code, or a refresh token, through the Worker. Errors are values. */
async function redeem(
	config: SignInConfig,
	path: "/exchange" | "/refresh",
	body: Record<string, string>,
	now: () => number,
	fetcher: typeof fetch,
): Promise<Result<Credentials, Failure>> {
	let response: Response;
	try {
		response = await fetcher(`${config.authUrl}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	} catch (e) {
		return err({
			kind: "network",
			message: `Could not reach the sign-in service: ${e instanceof Error ? e.message : String(e)}`,
		});
	}
	let json: unknown;
	try {
		json = await response.json();
	} catch {
		json = undefined;
	}
	if (!response.ok) {
		const code = (json as { error?: string } | undefined)?.error;
		// Only GitHub refusing the grant means the sign-in has ended; anything else is
		// transient, and the session survives to try again.
		return code === "bad_refresh_token" || code === "bad_verification_code"
			? err({
					kind: "auth",
					status: response.status,
					message: "Your GitHub sign-in has ended.",
					hint: "Sign in again from the Bank panel.",
				})
			: err({
					kind: "http",
					status: response.status,
					message:
						code === "misconfigured"
							? "The sign-in service is not set up correctly."
							: `The sign-in service answered ${response.status}.`,
				});
	}
	const credentials = credentialsOf(json, now());
	return credentials === undefined
		? err({
				kind: "unreadable",
				message: "The sign-in service's answer was not understood.",
			})
		: ok(credentials);
}

export const exchange = (
	config: SignInConfig,
	callback: Pick<Callback, "code" | "verifier">,
	now: () => number,
	fetcher: typeof fetch,
) =>
	redeem(
		config,
		"/exchange",
		{
			code: callback.code,
			code_verifier: callback.verifier,
			redirect_uri: config.redirectUri,
		},
		now,
		fetcher,
	);

export const refresh = (
	config: SignInConfig,
	token: string,
	now: () => number,
	fetcher: typeof fetch,
) => redeem(config, "/refresh", { refresh_token: token }, now, fetcher);
