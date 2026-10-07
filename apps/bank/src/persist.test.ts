import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import {
	LEGACY_KEY,
	migrate,
	RETIRED_KEY,
	readPersisted,
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

/** Settings as older versions stored them, inside their work; no folder. */
const legacy = { owner: "o", repo: "r", remember: false };
const settings = { ...legacy, path: "" };
const base = { path: "questions/q/q.yaml", sha: "abc", text: "name: q\n" };

describe("readPersisted", () => {
	it("accepts nothing, a valid value, and reports the rest as failures", () => {
		expect(readPersisted(null)).toEqual({ ok: true, value: undefined });
		const good = {
			version: 4,
			nextId: 3,
			questions: [{ kind: "question", id: 1, source: "name: q2\n", base }],
			schemes: [{ kind: "scale", name: "yn", id: 2, source: "labels: {}\n" }],
			settings: legacy,
			workOf: { repo: "o/r", login: "iain" },
			kept: {
				"x/y@ann": {
					questions: [{ kind: "question", id: 4, source: "name: a\n" }],
					schemes: [],
				},
			},
		};
		expect(readPersisted(JSON.stringify(good))).toEqual({
			ok: true,
			value: good,
		});
		expect(readPersisted("{not json").ok).toBe(false);
		const wrong = readPersisted(JSON.stringify({ ...good, version: 5 }));
		expect(!wrong.ok && wrong.error.kind).toBe("unreadable");
		// A scheme file without its name is not readable: the name is its identity.
		const nameless = readPersisted(
			JSON.stringify({
				...good,
				schemes: [{ ...good.schemes[0], name: undefined }],
			}),
		);
		expect(nameless.ok).toBe(false);
	});

	it("reads version 3: its one pool of work is its own bank's, by a person not recorded", () => {
		const v3 = {
			version: 3,
			nextId: 3,
			questions: [{ kind: "question", id: 1, source: "name: q2\n", base }],
			schemes: [],
			settings: legacy,
		};
		expect(readPersisted(JSON.stringify(v3))).toEqual({
			ok: true,
			value: { ...v3, version: 4, workOf: { repo: "o/r" }, kept: {} },
		});
	});

	it("reads version 2: a bank origin becomes a base, a draft has none, files split by kind", () => {
		const v2 = {
			version: 2,
			nextId: 3,
			files: [
				{
					id: 1,
					kind: "question",
					source: "name: q2\n",
					origin: {
						kind: "bank",
						path: base.path,
						sha: base.sha,
						original: base.text,
					},
				},
				{
					id: 2,
					kind: "scale",
					name: "yn",
					source: "labels: {}\n",
					origin: { kind: "draft" },
				},
			],
			settings: legacy,
		};
		expect(readPersisted(JSON.stringify(v2))).toEqual({
			ok: true,
			value: {
				version: 4,
				nextId: 3,
				questions: [{ id: 1, kind: "question", source: "name: q2\n", base }],
				schemes: [{ id: 2, kind: "scale", name: "yn", source: "labels: {}\n" }],
				settings: legacy,
				workOf: { repo: "o/r" },
				kept: {},
			},
		});
	});

	it("reads version 1, which held only questions, through version 2", () => {
		const v1 = {
			version: 1,
			nextId: 2,
			questions: [{ id: 1, source: "name: q\n", origin: { kind: "draft" } }],
			settings: legacy,
		};
		expect(readPersisted(JSON.stringify(v1))).toEqual({
			ok: true,
			value: {
				version: 4,
				nextId: 2,
				questions: [{ id: 1, kind: "question", source: "name: q\n" }],
				schemes: [],
				settings: legacy,
				workOf: { repo: "o/r" },
				kept: {},
			},
		});
	});

	it("drops a branch an older version stored: saves always go to the author's own", () => {
		const stored = {
			version: 3,
			nextId: 1,
			questions: [],
			schemes: [],
			settings: { ...legacy, branch: "sandbox" },
		};
		expect(readPersisted(JSON.stringify(stored))).toEqual({
			ok: true,
			value: {
				...stored,
				version: 4,
				settings: legacy,
				workOf: { repo: "o/r" },
				kept: {},
			},
		});
	});
});

const work = {
	version: 5 as const,
	repo: "o/r",
	login: "iain",
	nextId: 3,
	questions: [{ kind: "question" as const, id: 1, source: "name: q\n", base }],
	schemes: [
		{ kind: "scale" as const, name: "yn", id: 2, source: "labels: {}\n" },
	],
};

describe("this tab's work and the default settings", () => {
	it("keeps them under their own keys", () => {
		expect(WORK_KEY).toBe("qretools.work");
		expect(SETTINGS_KEY).toBe("qretools.settings");
		expect(WORK_UNREADABLE_KEY).toBe("qretools.work.unreadable");
	});

	it("reads work version 5, and reports anything else as a failure", () => {
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

describe("migrating an older version's work", () => {
	const v4 = {
		version: 4,
		nextId: 5,
		questions: [{ kind: "question", id: 1, source: "name: q\n", base }],
		schemes: [],
		settings: legacy,
		workOf: { repo: "a/bank", login: "iain" },
		kept: {},
	};

	it("brings its own work into this tab and its settings into the default, and retires the old value", () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		local.setItem(LEGACY_KEY, JSON.stringify(v4));
		expect(migrate(local, session)).toEqual([]);
		expect(readWork(session.getItem(WORK_KEY))).toEqual({
			ok: true,
			value: {
				version: 5,
				repo: "a/bank",
				login: "iain",
				nextId: 5,
				questions: v4.questions,
				schemes: [],
			},
		});
		expect(readSettings(local.getItem(SETTINGS_KEY))).toEqual(settings);
		expect(local.getItem(LEGACY_KEY)).toBeNull();
		expect(local.getItem(RETIRED_KEY)).toBe(JSON.stringify(v4));
		// Once: a second tab finds nothing to migrate.
		const second = new MemoryStorage();
		expect(migrate(local, second)).toEqual([]);
		expect(second.getItem(WORK_KEY)).toBeNull();
	});

	it("never retires over an earlier retired value (a tab on the old version wrote again)", () => {
		const local = new MemoryStorage();
		local.setItem(RETIRED_KEY, "earlier");
		local.setItem(LEGACY_KEY, JSON.stringify(v4));
		migrate(local, new MemoryStorage());
		expect(local.getItem(RETIRED_KEY)).toBe("earlier");
		expect(local.getItem(`${RETIRED_KEY}.2`)).toBe(JSON.stringify(v4));
	});

	it("says once that work kept for other banks was set aside", () => {
		const local = new MemoryStorage();
		local.setItem(
			LEGACY_KEY,
			JSON.stringify({
				...v4,
				kept: {
					"x/y@ann": {
						questions: [{ kind: "question", id: 9, source: "name: a\n" }],
						schemes: [],
					},
				},
			}),
		);
		const [notice, ...rest] = migrate(local, new MemoryStorage());
		expect(rest).toEqual([]);
		expect(notice?.message).toContain(RETIRED_KEY);
		expect(local.getItem(RETIRED_KEY)).not.toBeNull();
	});

	it("reads version 3 work as its settings' bank, with no login", () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		local.setItem(
			LEGACY_KEY,
			JSON.stringify({
				version: 3,
				nextId: 1,
				questions: [],
				schemes: [],
				settings: legacy,
			}),
		);
		migrate(local, session);
		expect(JSON.parse(session.getItem(WORK_KEY) ?? "")).toEqual({
			version: 5,
			repo: "o/r",
			nextId: 1,
			questions: [],
			schemes: [],
		});
	});

	it("leaves a tab's own work alone, and retires an unreadable old value with a notice", () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem(WORK_KEY, JSON.stringify(work));
		local.setItem(LEGACY_KEY, JSON.stringify(v4));
		expect(migrate(local, session)).toEqual([]);
		expect(local.getItem(LEGACY_KEY)).not.toBeNull();
		const fresh = new MemoryStorage();
		local.setItem(LEGACY_KEY, "{not json");
		const [failure] = migrate(local, fresh);
		expect(failure?.kind).toBe("unreadable");
		expect(local.getItem(RETIRED_KEY)).toBe("{not json");
		expect(fresh.getItem(WORK_KEY)).toBeNull();
	});

	it("runs as part of starting up", () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		local.setItem(LEGACY_KEY, JSON.stringify(v4));
		const started = readStartup(local, session);
		expect(started.work.ok && started.work.value?.repo).toBe("a/bank");
		expect(started.settings).toEqual(settings);
		expect(started.notices).toEqual([]);
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
