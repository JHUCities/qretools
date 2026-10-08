import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import { SETTINGS_KEY, THEME_KEY } from "./model.ts";
import { readSettings, readTheme } from "./persist.ts";

/** A `Storage` holding these entries. */
const storage = (entries: Record<string, string>): Storage =>
	({ getItem: (k: string) => entries[k] ?? null }) as Storage;

describe("what the app keeps on the device", () => {
	it("reads the project as a repository, and anything else as nothing kept", () => {
		const kept = (value: unknown) =>
			readSettings(storage({ [SETTINGS_KEY]: JSON.stringify(value) }));
		expect(kept({ owner: "o", repo: "r", path: "p", remember: true })).toEqual({
			owner: "o",
			repo: "r",
			path: "p",
			remember: true,
		});
		expect(kept({ owner: "o", repo: "r b", path: "", remember: false })).toBe(
			undefined,
		);
		expect(kept({ owner: "o" })).toBeUndefined();
		expect(readSettings(storage({ [SETTINGS_KEY]: "{not json" }))).toBe(
			undefined,
		);
	});

	it("keeps the theme under the key index.html's early script reads", () => {
		expect(indexHtml).toContain(`localStorage.getItem("${THEME_KEY}")`);
		expect(readTheme(storage({ [THEME_KEY]: "dark" }))).toBe("dark");
		expect(readTheme(storage({ [THEME_KEY]: "auto" }))).toBeUndefined();
	});
});
