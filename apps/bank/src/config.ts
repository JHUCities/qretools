/**
 * The bank app's build configuration read once at startup: the template a new
 * workspace starts from, and the bank offered first (sign-in's is the shell's, `signInConfig`).
 * Build-time configuration, never constants (AGENTS.md, step 10).
 */
import { type BankRef, parseBank, parseRepo } from "@qretools/shell";

/**
 * Where qretools itself lives: a fact about the tool, not about any bank, so one literal
 * (a team running its own copy still runs qretools).
 */
export const SOURCE_URL = "https://github.com/JHUCities/qretools";

/**
 * The template a new workspace starts from (`VITE_TEMPLATE`, as owner/name): one bank
 * of examples and no instrument, since the app makes one (New, Example instrument).
 * The sign-in page links GitHub's "Use this template" for it. Configuration, not a
 * constant: another team points it at its own. Absent or malformed means no link.
 */
export function template(env: ImportMetaEnv): string | undefined {
	const text = env.VITE_TEMPLATE?.trim();
	if (!text) return undefined;
	const parsed = parseRepo(text);
	if (!parsed.ok) return undefined;
	const { owner, repo } = parsed.value;
	return `https://github.com/${owner}/${repo}/generate`;
}

/**
 * The bank the sign-in page offers first (`VITE_DEFAULT_BANK`, as owner/name[/folder]). Its own
 * setting, not the template's: a team may reuse a template and keep its own bank.
 * Absent or malformed means an empty field.
 */
export function defaultBank(env: ImportMetaEnv): BankRef | undefined {
	const text = env.VITE_DEFAULT_BANK?.trim();
	if (!text) return undefined;
	const parsed = parseBank(text);
	return parsed.ok ? parsed.value : undefined;
}
