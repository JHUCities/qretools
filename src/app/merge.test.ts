import { describe, expect, it } from "vitest";
import { mergeBank } from "./merge.js";
import type { Question } from "./model.js";

const bank = (
	id: number,
	path: string,
	text: string,
	source = text,
): Question => ({
	id,
	source,
	origin: { kind: "bank", path, sha: `sha-${id}`, original: text },
	activity: { kind: "idle" },
});
const draft = (id: number, source: string): Question => ({
	id,
	source,
	origin: { kind: "draft" },
	activity: { kind: "idle" },
});

describe("mergeBank", () => {
	it("refreshes unmodified files, keeps modified ones, adds new, drops gone-and-clean, keeps gone-and-dirty as drafts", () => {
		const questions = {
			1: bank(1, "questions/a/a.yaml", "old a"),
			2: bank(2, "questions/b/b.yaml", "old b", "edited b"),
			3: bank(3, "questions/c/c.yaml", "old c"),
			4: bank(4, "questions/d/d.yaml", "old d", "edited d"),
			5: draft(5, "a draft"),
		};
		const files = [
			{ path: "questions/a/a.yaml", sha: "A", text: "new a" },
			{ path: "questions/b/b.yaml", sha: "B", text: "new b" },
			{ path: "questions/e/e.yaml", sha: "E", text: "new e" },
		];
		const { questions: out, nextId } = mergeBank(questions, files, 6);
		expect(out[1]).toMatchObject({
			source: "new a",
			origin: { sha: "A", original: "new a" },
		});
		expect(out[2]).toMatchObject({
			source: "edited b",
			origin: { sha: "sha-2" },
		});
		expect(out[3]).toBeUndefined();
		expect(out[4]).toMatchObject({
			source: "edited d",
			origin: { kind: "draft" },
		});
		expect(out[5]).toEqual(questions[5]);
		expect(out[6]).toMatchObject({
			source: "new e",
			origin: { kind: "bank", path: "questions/e/e.yaml", sha: "E" },
		});
		expect(nextId).toBe(7);
	});
});
