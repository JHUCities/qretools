import { describe, expect, it } from "vitest";
import { readPersisted } from "./persist.js";

describe("readPersisted", () => {
	it("accepts nothing, a valid value, and reports the rest as failures", () => {
		expect(readPersisted(null)).toEqual({ ok: true, value: undefined });
		const good = {
			version: 1,
			nextId: 2,
			questions: [{ id: 1, source: "name: q\n", origin: { kind: "draft" } }],
			settings: { owner: "o", repo: "r", branch: "b", remember: false },
		};
		expect(readPersisted(JSON.stringify(good))).toEqual({
			ok: true,
			value: good,
		});
		expect(readPersisted("{not json").ok).toBe(false);
		const wrong = readPersisted(JSON.stringify({ ...good, version: 2 }));
		expect(!wrong.ok && wrong.error.kind).toBe("unreadable");
	});
});
