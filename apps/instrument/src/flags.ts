/**
 * Feature flags: Vite build-time variables, read directly as `import.meta.env` so the
 * minifier drops a disabled branch from the bundle. Every flag lives here.
 */

/** Pasting a fine-grained personal access token instead of signing in: development only. */
export const TOKEN_PASTE: boolean =
	import.meta.env.VITE_FLAG_TOKEN_PASTE === "true";
