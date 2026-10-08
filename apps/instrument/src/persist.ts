/**
 * What this app keeps on the device, read once at startup and parsed at the boundary:
 * which workspace, and the theme. Anything unreadable is as if nothing were kept.
 */
import { type BankSettings, parseBank } from "@qretools/shell";
import { SETTINGS_KEY, THEME_KEY, type ThemeChoice } from "./model.ts";

export function readSettings(storage: Storage): BankSettings | undefined {
	try {
		const raw: unknown = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "null");
		if (raw === null || typeof raw !== "object") return undefined;
		const { owner, repo, path, remember } = raw as Record<string, unknown>;
		if (typeof owner !== "string" || typeof repo !== "string") return undefined;
		// Parsed as a repository once, here: a corrupted value never reaches GitHub.
		const workspace = parseBank(
			[owner, repo, typeof path === "string" ? path : ""]
				.filter((p) => p !== "")
				.join("/"),
		);
		return workspace.ok
			? { ...workspace.value, remember: remember === true }
			: undefined;
	} catch {
		return undefined;
	}
}

export function readTheme(storage: Storage): ThemeChoice | undefined {
	const t = storage.getItem(THEME_KEY);
	return t === "light" || t === "dark" ? t : undefined;
}
