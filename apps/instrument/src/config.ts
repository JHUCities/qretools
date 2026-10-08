/**
 * The instrument app's build configuration, read once at startup (sign-in's is the
 * shell's, `signInConfig`). Build-time configuration, never constants: another team
 * points it at its own.
 */
import { parseRepo } from "@qretools/shell";

/**
 * The template a new workspace starts from (`VITE_WORKSPACE_TEMPLATE`, as owner/name):
 * the app links GitHub's "Use this template" for it. Absent or malformed means no link.
 */
export function workspaceTemplate(env: ImportMetaEnv): string | undefined {
	const text = env.VITE_WORKSPACE_TEMPLATE?.trim();
	if (!text) return undefined;
	const parsed = parseRepo(text);
	if (!parsed.ok) return undefined;
	const { owner, repo } = parsed.value;
	return `https://github.com/${owner}/${repo}/generate`;
}
