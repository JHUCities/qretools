/**
 * Build configuration read once at startup: sign-in (the GitHub App and the
 * token-exchange Worker) and the template a new bank starts from. Build-time
 * configuration, never constants (AGENTS.md, step 10): another team runs its own App
 * and Worker by building with its own values. Absent values mean sign-in is not set up
 * for this build, which the sign-in page says instead of offering a button that fails.
 */
import { parseRepo } from "./storage.js";

export interface SignInConfig {
	readonly clientId: string;
	/** The Worker, without a trailing slash. */
	readonly authUrl: string;
	/** The App's slug, for the link that installs it on a repository. */
	readonly appSlug?: string;
	/** Where GitHub sends the author back: the app itself, exactly as registered. */
	readonly redirectUri: string;
}

export function signInConfig(
	env: ImportMetaEnv,
	origin: string,
	base: string,
): SignInConfig | undefined {
	const clientId = env.VITE_GITHUB_CLIENT_ID?.trim();
	const authUrl = env.VITE_AUTH_URL?.trim().replace(/\/+$/, "");
	if (!clientId || !authUrl) return undefined;
	const slug = env.VITE_GITHUB_APP_SLUG?.trim();
	return {
		clientId,
		authUrl,
		...(slug && { appSlug: slug }),
		redirectUri: `${origin}${base}`,
	};
}

/** Where the app is installed on a repository: GitHub's own page, one literal. */
export const installUrl = (appSlug: string): string =>
	`https://github.com/apps/${appSlug}/installations/select_target`;

/**
 * The template a new bank starts from (`VITE_BANK_TEMPLATE`, as owner/name): the
 * sign-in page links GitHub's "Use this template" for it. Configuration, not a
 * constant: another team points it at its own. Absent or malformed means no link.
 */
export function bankTemplate(env: ImportMetaEnv): string | undefined {
	const text = env.VITE_BANK_TEMPLATE?.trim();
	if (!text) return undefined;
	const parsed = parseRepo(text);
	if (!parsed.ok) return undefined;
	const { owner, repo } = parsed.value;
	return `https://github.com/${owner}/${repo}/generate`;
}
