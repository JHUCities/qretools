import { describe, expect, it } from "vitest";
import { type History, versionsOf } from "./history.ts";

const Q = "questions/work/q.yaml";
const SCALE = "scales/yes_no.yaml";
const ON_SCALE = "name: q\ntext: Hi?\nintent: x\nresponses: yes_no\n";
const ON_UNIVERSE =
	"name: q\ntext: Hi?\nintent: x\nuniverse: adults\nresponses: yes_no\n";

/** A history from snapshots written as [date, {path: blob}], with question blobs' text. */
const history = (
	snapshots: readonly (readonly [string, Record<string, string>])[],
	texts: Record<string, string> = {},
): History => ({
	snapshots: snapshots.map(([date, blobs]) => ({ date, blobs })),
	texts,
});

describe("versionsOf", () => {
	it("counts each change to a file's own content, dated by the change", () => {
		const v = versionsOf(
			history(
				[
					["2026-01-01", { [SCALE]: "s1", "workspace.yaml": "w1" }],
					["2026-01-02", { [SCALE]: "s1", "workspace.yaml": "w2" }],
					["2026-01-03", { [SCALE]: "s2", "workspace.yaml": "w2" }],
				],
				{},
			),
		);
		expect(v[SCALE]).toEqual({ number: "2", date: "2026-01-03", blob: "s2" });
		// The settings carry no items of their own.
		expect(v["workspace.yaml"]).toBeUndefined();
	});

	it("moves a question when a shared file it names changes, and not for one it doesn't", () => {
		const v = versionsOf(
			history(
				[
					["d1", { [Q]: "q1", [SCALE]: "s1", "units/years.yaml": "u1" }],
					["d2", { [Q]: "q1", [SCALE]: "s1", "units/years.yaml": "u2" }],
					["d3", { [Q]: "q1", [SCALE]: "s2", "units/years.yaml": "u2" }],
				],
				{ q1: ON_SCALE },
			),
		);
		expect(v[Q]).toEqual({ number: "2", date: "d3", blob: "q1" });
	});

	it("moves every question when missing.yaml changes", () => {
		const v = versionsOf(
			history(
				[
					["d1", { [Q]: "q1", "missing.yaml": "m1" }],
					["d2", { [Q]: "q1", "missing.yaml": "m2" }],
				],
				{ q1: ON_SCALE },
			),
		);
		expect(v[Q]?.number).toBe("2");
	});

	it("reads what a question names at each commit, as its text then said", () => {
		const v = versionsOf(
			history(
				[
					["d1", { [Q]: "q1", "universes/adults.yaml": "a1" }],
					// The universe changes while the question doesn't name it: no move.
					["d2", { [Q]: "q1", "universes/adults.yaml": "a2" }],
					// The question starts naming it: a move, for its own text.
					["d3", { [Q]: "q2", "universes/adults.yaml": "a2" }],
					// Now it names it, so the universe's change moves it.
					["d4", { [Q]: "q2", "universes/adults.yaml": "a3" }],
				],
				{ q1: ON_SCALE, q2: ON_UNIVERSE },
			),
		);
		expect(v[Q]).toEqual({ number: "3", date: "d4", blob: "q2" });
	});

	it("keeps a version across a file's removal and return unchanged, and drops files gone at the end", () => {
		const v = versionsOf(
			history([
				["d1", { [SCALE]: "s1", "scales/gone.yaml": "g1" }],
				["d2", {}],
				["d3", { [SCALE]: "s1" }],
			]),
		);
		expect(v[SCALE]).toEqual({ number: "1", date: "d1", blob: "s1" });
		expect(v["scales/gone.yaml"]).toBeUndefined();
	});

	it("gives nothing for no history, and ignores files the workspace doesn't read", () => {
		expect(versionsOf(history([]))).toEqual({});
		expect(
			versionsOf(history([["d1", { "tools/generate.py": "t1" }]])),
		).toEqual({});
	});
});
