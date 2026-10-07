/**
 * Feature flags: Vite build-time variables, read directly as `import.meta.env` so the
 * minifier drops a disabled branch from the bundle (AGENTS.md, feature flags). Every
 * flag lives here; call sites import the constant, never the variable.
 */

/** Pasting a fine-grained personal access token instead of signing in: development and fallback only. */
export const TOKEN_PASTE: boolean =
	import.meta.env.VITE_FLAG_TOKEN_PASTE === "true";
