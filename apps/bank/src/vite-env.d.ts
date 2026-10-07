/// <reference types="vite/client" />

/** Build-time configuration: `.env` for every mode, `.env.verify` adds the headless-check flags. */
interface ImportMetaEnv {
	/** "true" shows the token-paste fallback; off in production (AGENTS.md, feature flags). */
	readonly VITE_FLAG_TOKEN_PASTE?: string;
	/** The GitHub App's client id (public). */
	readonly VITE_GITHUB_CLIENT_ID?: string;
	/** The token-exchange Worker's URL, e.g. https://qretools-auth.<account>.workers.dev */
	readonly VITE_AUTH_URL?: string;
	/** The GitHub App's slug, for the "install the App" link. */
	readonly VITE_GITHUB_APP_SLUG?: string;
	/** The template a new bank starts from, as owner/name (the sign-in page links it). */
	readonly VITE_BANK_TEMPLATE?: string;
	/** The bank the sign-in page offers first, as owner/name; absent means an empty field. */
	readonly VITE_DEFAULT_BANK?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
