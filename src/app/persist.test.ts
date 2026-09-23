import { describe, expect, it } from "vitest";
import { readPersisted } from "./persist.js";

const settings = { owner: "o", repo: "r", branch: "b", remember: false };
const base = { path: "questions/q/q.yaml", sha: "abc", text: "name: q\n" };

describe("readPersisted", () => {
	it("accepts nothing, a valid value, and reports the rest as failures", () => {
		expect(readPersisted(null)).toEqual({ ok: true, value: undefined });
		const good = {
			version: 3,
			nextId: 3,
			questions: [{ kind: "question", id: 1, source: "name: q2\n", base }],
			schemes: [{ kind: "scale", name: "yn", id: 2, source: "labels: {}\n" }],
			settings,
		};
		expect(readPersisted(JSON.stringify(good))).toEqual({
			ok: true,
			value: good,
		});
		expect(readPersisted("{not json").ok).toBe(false);
		const wrong = readPersisted(JSON.stringify({ ...good, version: 4 }));
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
			settings,
		};
		expect(readPersisted(JSON.stringify(v2))).toEqual({
			ok: true,
			value: {
				version: 3,
				nextId: 3,
				questions: [{ id: 1, kind: "question", source: "name: q2\n", base }],
				schemes: [{ id: 2, kind: "scale", name: "yn", source: "labels: {}\n" }],
				settings,
			},
		});
	});

	it("reads version 1, which held only questions, through version 2", () => {
		const v1 = {
			version: 1,
			nextId: 2,
			questions: [{ id: 1, source: "name: q\n", origin: { kind: "draft" } }],
			settings,
		};
		expect(readPersisted(JSON.stringify(v1))).toEqual({
			ok: true,
			value: {
				version: 3,
				nextId: 2,
				questions: [{ id: 1, kind: "question", source: "name: q\n" }],
				schemes: [],
				settings,
			},
		});
	});
});
