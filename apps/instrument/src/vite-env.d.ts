/// <reference types="vite/client" />

/** Build-time configuration: `.env` for every mode, `.env.verify` adds the development flags. */
interface ImportMetaEnv {
	/** "true" shows the token-paste fallback; off in production. */
	readonly VITE_FLAG_TOKEN_PASTE?: string;
	/** The GitHub App's client id (public). */
	readonly VITE_GITHUB_CLIENT_ID?: string;
	/** The token-exchange Worker's URL. */
	readonly VITE_AUTH_URL?: string;
	/** The GitHub App's slug, for the "install the App" link. */
	readonly VITE_GITHUB_APP_SLUG?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
