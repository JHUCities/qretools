/**
 * Sign-in configuration: the GitHub App and the token-exchange Worker. Build-time
 * configuration, never constants (AGENTS.md, step 10): another team runs its own App
 * and Worker by building with its own values. Absent values mean sign-in is not set up
 * for this build, which the Bank panel says instead of offering a button that fails.
 */

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
