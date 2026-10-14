import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import {
	readSettings,
	readStartup,
	readTheme,
	readWork,
	SETTINGS_KEY,
	setAsideWork,
	settingsValue,
	startingSettings,
	THEME_KEY,
	WORK_ASIDE_KEY,
	WORK_KEY,
	WORK_UNREADABLE_KEY,
} from "./persist.js";

/** A Storage in memory: local and session storage are stubbed apart, as the browser keeps them. */
class MemoryStorage implements Storage {
	private readonly items = new Map<string, string>();
	get length() {
		return this.items.size;
	}
	clear() {
		this.items.clear();
	}
	getItem(key: string) {
		return this.items.get(key) ?? null;
	}
	key(i: number) {
		return [...this.items.keys()][i] ?? null;
	}
	removeItem(key: string) {
		this.items.delete(key);
	}
	setItem(key: string, value: string) {
		this.items.set(key, value);
	}
}

/** Settings as stored for a workspace at its repository's root: no folder. */
const legacy = { owner: "o", repo: "r", remember: false };
const settings = { ...legacy, path: "" };
const base = { path: "questions/q/q.yaml", sha: "abc", text: "name: q\n" };

const work = {
	version: 8 as const,
	repo: "o/r",
	login: "iain",
	nextId: 3,
	questions: [{ kind: "question" as const, id: 1, source: "name: q\n", base }],
	schemes: [
		{
			kind: "scale" as const,
			name: "yn",
			id: 2,
			source: "labels: {}\n",
		},
		// The workspace's details: a shared file of the root, as any other.
		{
			kind: "workspace" as const,
			name: "workspace",
			id: 5,
			source: "agency: x\n",
		},
	],
	workspace: [
		{
			kind: "instrument" as const,
			name: "wave1",
			id: 4,
			source: "name: wave1\n",
			base: { path: "instruments/wave1.yaml", sha: "i", text: "name: wave1\n" },
		},
	],
};

describe("this tab's work and the default settings", () => {
	it("keeps them under their own keys", () => {
		expect(WORK_KEY).toBe("qretools.work");
		expect(SETTINGS_KEY).toBe("qretools.settings");
		expect(WORK_UNREADABLE_KEY).toBe("qretools.work.unreadable");
	});

	it("reads work version 8, and reports anything else as a failure", () => {
		expect(readWork(null)).toEqual({ ok: true, value: undefined });
		expect(readWork(JSON.stringify(work))).toEqual({ ok: true, value: work });
		const { login: _, ...nobody } = work;
		expect(readWork(JSON.stringify(nobody)).ok).toBe(true);
		const v4 = readWork(JSON.stringify({ ...work, version: 4 }));
		expect(!v4.ok && v4.error.hint).toContain(WORK_UNREADABLE_KEY);
		expect(readWork(JSON.stringify({ ...work, repo: undefined })).ok).toBe(
			false,
		);
	});

	it("sets older tab work aside as unreadable, never upgrading or crashing on it", () => {
		// Version 7 as it was written: a `bank.yaml` and the workspace's file kept apart.
		const v7 = {
			...work,
			version: 8,
			schemes: [{ kind: "bank", name: "bank", id: 2, source: "agency: x\n" }],
			workspace: [{ kind: "workspaceFile", id: 5, source: "agency: x\n" }],
		};
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem(WORK_KEY, JSON.stringify(v7));
		const started = readStartup(local, session);
		expect(started.work.ok).toBe(false);
		expect(local.getItem(WORK_UNREADABLE_KEY)).toBe(JSON.stringify(v7));
		// Even one that would read: the version alone decides.
		for (const version of [5, 6, 7])
			expect(
				readWork(JSON.stringify({ ...work, schemes: [], version })).ok,
			).toBe(false);
	});

	it("sets work aside that names a bank on its files, as version 8 first wrote them", () => {
		const banked = {
			...work,
			questions: work.questions.map((q) => ({ ...q, bank: "" })),
			schemes: work.schemes.map((e) => ({ ...e, bank: "" })),
		};
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem(WORK_KEY, JSON.stringify(banked));
		const started = readStartup(local, session);
		expect(!started.work.ok && started.work.error.kind).toBe("unreadable");
		expect(local.getItem(WORK_UNREADABLE_KEY)).toBe(JSON.stringify(banked));
	});

	it("leaves what versions before tabs kept their own work where it is, unread", () => {
		const local = new MemoryStorage();
		local.setItem("qretools.v1", "{anything");
		expect(readStartup(local, new MemoryStorage())).toEqual({
			work: { ok: true, value: undefined },
		});
		expect(local.getItem("qretools.v1")).toBe("{anything");
	});

	it("reads settings version 1; anything unreadable is simply no default", () => {
		expect(readSettings(settingsValue(settings))).toEqual(settings);
		expect(JSON.parse(settingsValue(settings))).toEqual({
			version: 1,
			...legacy,
		});
		expect(readSettings(null)).toBeUndefined();
		expect(readSettings("{")).toBeUndefined();
		expect(readSettings(JSON.stringify(settings))).toBeUndefined();
	});

	it("starts in the work's own bank, whatever another tab stored since", () => {
		const other = { owner: "x", repo: "y", path: "", remember: true };
		const fallback = { owner: "d", repo: "d", path: "", remember: false };
		expect(startingSettings(other, work, fallback)).toEqual({
			owner: "o",
			repo: "r",
			path: "",
			remember: true,
		});
		expect(
			startingSettings(other, { ...work, repo: "o/r/banks/bas" }, fallback),
		).toMatchObject({ owner: "o", repo: "r", path: "banks/bas" });
		expect(startingSettings(other, undefined, fallback)).toBe(other);
		expect(startingSettings(undefined, undefined, fallback)).toBe(fallback);
	});

	it("copies unreadable work to local storage, so a save can't destroy it", () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem(WORK_KEY, "{not json");
		local.setItem(SETTINGS_KEY, settingsValue(settings));
		const started = readStartup(local, session);
		expect(started.work.ok).toBe(false);
		expect(started.settings).toEqual(settings);
		expect(local.getItem(WORK_UNREADABLE_KEY)).toBe("{not json");
	});

	it("appends work set aside, never replacing what was set aside before", () => {
		const local = new MemoryStorage();
		setAsideWork(local, work);
		setAsideWork(local, { ...work, login: "ann" });
		expect(JSON.parse(local.getItem(WORK_ASIDE_KEY) ?? "")).toEqual([
			work,
			{ ...work, login: "ann" },
		]);
		local.setItem(WORK_ASIDE_KEY, "{broken");
		setAsideWork(local, work);
		expect(JSON.parse(local.getItem(WORK_ASIDE_KEY) ?? "")).toEqual([
			"{broken",
			work,
		]);
	});
});

describe("the stored theme", () => {
	it("is light or dark; anything else is the system's", () => {
		expect(readTheme("dark")).toBe("dark");
		expect(readTheme("light")).toBe("light");
		expect(readTheme(null)).toBeUndefined();
		expect(readTheme("auto")).toBeUndefined();
	});

	it("is read by index.html's early script under the same key", () => {
		expect(indexHtml).toContain(`localStorage.getItem("${THEME_KEY}")`);
	});
});
