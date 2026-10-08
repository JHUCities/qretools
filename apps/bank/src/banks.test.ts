/**
 * Each bank of a workspace reads its own shared files: its names mean nothing in
 * another, and editing one bank never re-evaluates another.
 */
import { type Mention, ok } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { createEvaluations } from "./evaluations.js";
import {
	init,
	type Model,
	type Question,
	type SchemeEntry,
	schemeFileNamed,
} from "./model.js";
import { dependencies } from "./sync.js";
import { schemeNameProblem } from "./update.js";

const scale = (
	id: number,
	bank: string,
	labels: string,
	saved = true,
): SchemeEntry => {
	const source = `labels:\n${labels}`;
	const path = `${bank}/scales/yn.yaml`;
	return {
		kind: "scale",
		name: "yn",
		id,
		bank,
		source,
		...(saved && { base: { path, sha: `s${id}`, text: source } }),
	};
};
const question = (id: number, bank: string): Question => ({
	kind: "question",
	id,
	bank,
	source: "name: q\ntext: Q?\nintent: To see.\nresponses: yn\n",
});

/** Two banks, each with a scale `yn` of its own and a question on it. */
function twoBanks(): Model {
	const [start] = init({ work: ok(undefined), hasToken: false });
	const a = scale(1, "banks/a", '  "1": Yes\n  "2": No\n');
	const b = scale(2, "banks/b", '  "1": Oui\n  "2": Non\n');
	return {
		...start,
		banks: ["banks/a", "banks/b"],
		local: {
			questions: { 3: question(3, "banks/a"), 4: question(4, "banks/b") },
			schemes: { 1: a, 2: b },
		},
		remote: {
			questions: {},
			schemes: {
				"banks/a/scales/yn.yaml": { sha: "s1", text: a.source },
				"banks/b/scales/yn.yaml": { sha: "s2", text: b.source },
			},
		},
	};
}

describe("a workspace of banks", () => {
	it("reads each bank's questions against that bank's own scales", () => {
		const m = twoBanks();
		const evaluations = createEvaluations();
		const label = (id: number, bank: string) => {
			const q = m.local.questions[id] as Question;
			const ev = evaluations.get(q, evaluations.env(m, bank));
			return ev.draft.domain?.kind === "responses"
				? ev.draft.domain.codes.map((c) => c.label)
				: undefined;
		};
		expect(label(3, "banks/a")).toEqual(["Yes", "No"]);
		expect(label(4, "banks/b")).toEqual(["Oui", "Non"]);
	});

	it("keeps another bank's environment and evaluations when one bank's scale changes", () => {
		const m = twoBanks();
		const evaluations = createEvaluations();
		const envB = evaluations.env(m, "banks/b");
		const evB = evaluations.get(m.local.questions[4] as Question, envB);
		const envA = evaluations.env(m, "banks/a");
		const edited: Model = {
			...m,
			local: {
				...m.local,
				schemes: {
					...m.local.schemes,
					1: scale(1, "banks/a", '  "1": Yes\n  "2": No\n  "3": Maybe\n'),
				},
			},
		};
		expect(evaluations.env(edited, "banks/a")).not.toBe(envA);
		expect(evaluations.env(edited, "banks/b")).toBe(envB);
		expect(
			evaluations.get(
				edited.local.questions[4] as Question,
				evaluations.env(edited, "banks/b"),
			),
		).toBe(evB);
	});

	it("finds a name, checks a new one, and gathers what a save takes, within one bank", () => {
		const m = twoBanks();
		expect(schemeFileNamed(m.local.schemes, "scale", "yn", "banks/b")?.id).toBe(
			2,
		);
		expect(
			schemeFileNamed(m.local.schemes, "scale", "yn", "banks/c"),
		).toBeUndefined();
		expect(schemeNameProblem(m, "scale", "yn", "banks/a")).toMatch(/exists/);
		expect(schemeNameProblem(m, "scale", "yn", "banks/c")).toBeUndefined();
		// An unsaved scale in another bank is never taken along (GitHub has neither yet).
		const unsaved: Model = {
			...m,
			remote: { questions: {}, schemes: {} },
			local: {
				...m.local,
				schemes: {
					1: scale(1, "banks/a", '  "1": Y\n', false),
					2: scale(2, "banks/b", '  "1": O\n', false),
				},
			},
		};
		const mentions: readonly Mention[] = [
			{ scheme: "scale", name: "yn", path: "responses" },
		];
		expect(
			dependencies(
				unsaved.local,
				unsaved.remote,
				mentions,
				"banks/a",
			).include.map((e) => e.id),
		).toEqual([1]);
	});
});
