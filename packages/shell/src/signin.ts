/**
 * Sign-in's build configuration: the GitHub App and the token-exchange Worker. Build
 * configuration, never constants: another team runs its own App and Worker by building
 * with its own values. Absent values mean sign-in isn't set up for this build, which a
 * sign-in page says instead of offering a button that fails. Each app reads its own
 * environment and passes the values here.
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

/** The build's sign-in values, as an app's environment names them. */
export interface SignInEnv {
	readonly VITE_GITHUB_CLIENT_ID?: string;
	readonly VITE_AUTH_URL?: string;
	readonly VITE_GITHUB_APP_SLUG?: string;
}

export function signInConfig(
	env: SignInEnv,
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
