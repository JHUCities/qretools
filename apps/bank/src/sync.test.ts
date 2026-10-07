import { indexOf } from "@qretools/core/symbols.js";
import { describe, expect, it } from "vitest";
import type { Local, Question, Remote, SchemeEntry } from "./model.js";
import { rebase, remoteOf, type Sync, syncOf, usersIn } from "./sync.js";

const blob = (sha: string, text: string) => ({ sha, text });
const base = (path: string, sha: string, text: string) => ({ path, sha, text });

describe("syncOf: three versions give every status", () => {
	const b = base("questions/a/a.yaml", "s1", "old");
	const table: Array<
		[
			title: string,
			file: { source: string; base?: typeof b },
			remote: { sha: string; text: string } | undefined,
			expected: Sync,
		]
	> = [
		["never saved, nothing there", { source: "x" }, undefined, "draft"],
		[
			"never saved, but GitHub has the path",
			{ source: "x" },
			blob("s9", "y"),
			"conflict",
		],
		[
			"untouched on both sides",
			{ source: "old", base: b },
			blob("s1", "old"),
			"inSync",
		],
		[
			"changed here only",
			{ source: "new", base: b },
			blob("s1", "old"),
			"unsaved",
		],
		[
			"changed on GitHub only",
			{ source: "old", base: b },
			blob("s2", "theirs"),
			"behind",
		],
		[
			"both made the same change",
			{ source: "same", base: b },
			blob("s2", "same"),
			"behind",
		],
		[
			"both changed, differently",
			{ source: "mine", base: b },
			blob("s2", "theirs"),
			"conflict",
		],
		[
			"gone from GitHub",
			{ source: "old", base: b },
			undefined,
			"deletedOnGitHub",
		],
	];
	it.each(table)("%s", (_t, file, remote, expected) => {
		expect(syncOf(file, remote)).toBe(expected);
	});
});

describe("rebase", () => {
	const q = (
		id: number,
		path: string,
		text: string,
		source = text,
		sha = `s${id}`,
	): Question => ({
		kind: "question",
		id,
		source,
		base: base(path, sha, text),
	});
	const local: Local = {
		questions: {
			1: q(1, "questions/a/a.yaml", "old a"),
			2: q(2, "questions/b/b.yaml", "old b", "edited b"),
			3: q(3, "questions/c/c.yaml", "old c"),
			4: q(4, "questions/d/d.yaml", "old d", "edited d"),
			5: { kind: "question", id: 5, source: "a draft" },
		},
		schemes: {
			// A scale drafted here under a name someone else has since pushed.
			6: { kind: "scale", id: 6, name: "yn", source: "labels:\n  1: Mine\n" },
		},
	};
	const remote = remoteOf({ questions: {}, schemes: {} }, [
		{ path: "questions/a/a.yaml", sha: "A", text: "new a" },
		{ path: "questions/b/b.yaml", sha: "B", text: "new b" },
		{ path: "questions/e/e.yaml", sha: "E", text: "new e" },
		{ path: "scales/yn.yaml", sha: "Y", text: "labels:\n  1: Theirs\n" },
		{ path: "universes/renters.yaml", sha: "R", text: "text: Renters\n" },
		{ path: "migration/README.md", sha: "M", text: "ignored" },
	]);
	const { local: out, nextId } = rebase(local, remote, 7);

	it("fast-forwards what only GitHub changed, and keeps what the author changed", () => {
		expect(out.questions[1]).toEqual(
			q(1, "questions/a/a.yaml", "new a", "new a", "A"),
		);
		// Both changed: kept with its base, so it shows as a conflict to resolve.
		expect(out.questions[2]).toBe(local.questions[2]);
		expect(
			syncOf(
				out.questions[2] as Question,
				remote.questions["questions/b/b.yaml"],
			),
		).toBe("conflict");
	});

	it("drops a clean file GitHub deleted; keeps a changed one with its base", () => {
		expect(out.questions[3]).toBeUndefined();
		expect(out.questions[4]).toBe(local.questions[4]);
		expect(out.questions[4]?.base?.path).toBe("questions/d/d.yaml");
	});

	it("keeps drafts; a scheme draft at a path GitHub now has is a conflict, not a duplicate", () => {
		expect(out.questions[5]).toBe(local.questions[5]);
		expect(
			Object.values(out.schemes).filter((e) => e.name === "yn"),
		).toHaveLength(1);
		expect(
			syncOf(out.schemes[6] as SchemeEntry, remote.schemes["scales/yn.yaml"]),
		).toBe("conflict");
	});

	it("adds what GitHub has and nobody claims, of the kind its path says", () => {
		expect(out.questions[7]).toMatchObject({
			source: "new e",
			base: { sha: "E" },
		});
		expect(out.schemes[8]).toMatchObject({ kind: "universe", name: "renters" });
		expect(nextId).toBe(9);
	});

	it("keeps every reference when nothing changed", () => {
		const settled = rebase(out, remote, nextId);
		expect(settled.local).toBe(out);
		const again: Remote = remoteOf(remote, [
			{ path: "questions/a/a.yaml", sha: "A", text: "new a" },
			{ path: "questions/b/b.yaml", sha: "B", text: "new b" },
			{ path: "questions/e/e.yaml", sha: "E", text: "new e" },
			{ path: "scales/yn.yaml", sha: "Y", text: "labels:\n  1: Theirs\n" },
			{ path: "universes/renters.yaml", sha: "R", text: "text: Renters\n" },
		]);
		expect(again.questions).toBe(remote.questions);
		expect(again.schemes).toBe(remote.schemes);
	});
});

describe("usersIn", () => {
	it("counts a question once, however many times it names the file", () => {
		const index = indexOf([
			{
				key: 1,
				symbols: {
					defines: [],
					mentions: [
						{ scheme: "scale", name: "agree4", path: "responses" },
						{ scheme: "scale", name: "agree4", path: "responses" },
					],
					variants: [],
					fingerprints: [],
				},
			},
		]);
		const scale = {
			kind: "scale",
			id: 9,
			name: "agree4",
			source: "",
		} as SchemeEntry;
		expect(usersIn(index)(scale)).toEqual([1]);
	});
});
