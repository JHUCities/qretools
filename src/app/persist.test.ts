import { describe, expect, it } from "vitest";
import { readPersisted } from "./persist.js";

const settings = { owner: "o", repo: "r", branch: "b", remember: false };

describe("readPersisted", () => {
	it("accepts nothing, a valid value, and reports the rest as failures", () => {
		expect(readPersisted(null)).toEqual({ ok: true, value: undefined });
		const good = {
			version: 2,
			nextId: 3,
			files: [
				{
					id: 1,
					kind: "question",
					source: "name: q\n",
					origin: { kind: "draft" },
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
		expect(readPersisted(JSON.stringify(good))).toEqual({
			ok: true,
			value: good,
		});
		expect(readPersisted("{not json").ok).toBe(false);
		const wrong = readPersisted(JSON.stringify({ ...good, version: 3 }));
		expect(!wrong.ok && wrong.error.kind).toBe("unreadable");
		// A scheme file without its name is not readable: the name is its identity.
		const nameless = readPersisted(
			JSON.stringify({
				...good,
				files: [{ ...good.files[1], name: undefined }],
			}),
		);
		expect(nameless.ok).toBe(false);
	});

	it("reads version 1, which held only questions, as version 2", () => {
		const v1 = {
			version: 1,
			nextId: 2,
			questions: [{ id: 1, source: "name: q\n", origin: { kind: "draft" } }],
			settings,
		};
		expect(readPersisted(JSON.stringify(v1))).toEqual({
			ok: true,
			value: {
				version: 2,
				nextId: 2,
				files: [
					{
						id: 1,
						kind: "question",
						source: "name: q\n",
						origin: { kind: "draft" },
					},
				],
				settings,
			},
		});
	});
});
