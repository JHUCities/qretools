/**
 * The access-level decisions in one table: what a question's level is, what it's told,
 * and whether its export stops, for each kind of workspace list and `access` line. Every
 * surface (`check`, the exports, the app) reads these from the core, never decides them.
 */
import { describe, expect, it } from "vitest";
import { collisions, documentOf } from "./ddi/document.ts";
import { bankOf, questionItems } from "./evaluate.ts";
import { exportRefusal } from "./refusal.ts";

const Q = "questions/a/q.yaml";
const text = (line: string) =>
	`name: q\ntext: Q?\nintent: i\nopen: {}\n${line}`;

const CASES: readonly (readonly [
	/** workspace.yaml's `access` line, or none. */
	workspace: string,
	/** The question's `access` line, or none. */
	question: string,
	/** The level its variable is published at (its embargo's name). */
	level: string | undefined,
	/** The codes of the findings at `access`. */
	codes: readonly string[],
	refused: boolean,
])[] = [
	["", "", undefined, [], false],
	["", "access: public\n", undefined, ["no-access-levels"], true],
	["access: [public, restricted]\n", "access: public\n", "public", [], false],
	[
		"access: [public, restricted]\n",
		"access: restricted\n",
		"restricted",
		[],
		false,
	],
	// B and C: required once levels are listed, held at the most closed until written.
	["access: [public, restricted]\n", "", "restricted", ["hole"], false],
	[
		"access: [public, restricted]\n",
		"access:\n",
		"restricted",
		["hole"],
		false,
	],
	[
		"access: [public, restricted]\n",
		"access: secret\n",
		"restricted",
		["unknown-access"],
		false,
	],
	// A list that can't be read: nothing can be trusted, so the export stops.
	["access:\n", "", undefined, ["access-unreadable"], true],
	[
		"access: public\n",
		"access: public\n",
		undefined,
		["access-unreadable"],
		true,
	],
];

describe("a question's access level, in every workspace", () => {
	it.each(CASES)(
		"workspace %j, question %j",
		(workspace, line, level, codes, refused) => {
			const bank = bankOf({
				"workspace.yaml": `agency: org.example\n${workspace}`,
				[Q]: text(line),
			});
			const findings = bank.findings[Q] ?? [];
			expect(
				findings.filter((f) => f.path === "access").map((f) => f.code),
			).toEqual(codes);
			const ev = bank.questions[Q];
			const items = ev === undefined ? [] : questionItems(ev.draft, bank, Q);
			const embargo = JSON.stringify(
				Object.values(documentOf(items).Variable ?? {})[0]?.EmbargoReference,
			);
			expect(embargo?.match(/"Value":"(\w+)"/)?.[1]).toBe(level);
			expect(
				exportRefusal(
					{
						agency: "org.example",
						findings: Object.values(bank.findings).flat(),
						collisions: collisions([[Q, items]]),
					},
					[],
				)?.kind === "access",
			).toBe(refused);
		},
	);
});
