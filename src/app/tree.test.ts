import { describe, expect, it } from "vitest";
import { evaluate } from "../core/evaluate.js";
import { ok } from "../core/result.js";
import { init, type Model, type Question } from "./model.js";
import { treeOf, UNFILED } from "./tree.js";

const bank = (
	id: number,
	path: string,
	text: string,
	source = text,
): Question => ({
	id,
	source,
	origin: { kind: "bank", path, sha: "s", original: text },
	activity: { kind: "idle" },
});
const draft = (id: number, source: string): Question => ({
	id,
	source,
	origin: { kind: "draft" },
	activity: { kind: "idle" },
});
const base = init({ stored: ok(undefined), hasToken: false })[0];
const model: Model = {
	...base,
	questions: {
		1: bank(
			1,
			"questions/nhd/nhd_sat.yaml",
			"name: nhd_sat\ntitle: Satisfaction\n",
		),
		2: bank(2, "questions/svy/dem_latx.yaml", "name: dem_latx\n"),
		3: draft(3, "name: att_new\n"),
		4: draft(4, "text: nameless\n"),
	},
};
const tree = (m: Model) =>
	treeOf(m, (q) => evaluate(q.source, m.agency, m.scales));

describe("treeOf", () => {
	it("files bank questions by their path, drafts by name prefix, unnamed drafts last", () => {
		expect(
			tree(model).map((f) => [f.name, f.leaves.map((l) => l.name)]),
		).toEqual([
			["att", ["att_new"]],
			["nhd", ["nhd_sat"]],
			["svy", ["dem_latx"]],
			[UNFILED, [undefined]],
		]);
	});

	it("prunes by filter over name and title, and opens every folder while filtering", () => {
		const t = tree({
			...model,
			browser: { ...model.browser, filter: "satis" },
		});
		expect(t.map((f) => f.name)).toEqual(["nhd"]);
		expect(t[0]?.expanded).toBe(true);
	});

	it("opens the folder the user toggled and the folder holding the open question", () => {
		const t = tree({
			...model,
			screen: { kind: "editing", id: 2 },
			browser: { ...model.browser, expanded: ["att"] },
		});
		expect(Object.fromEntries(t.map((f) => [f.name, f.expanded]))).toEqual({
			att: true,
			nhd: false,
			svy: true,
			[UNFILED]: false,
		});
	});

	it("marks drafts, unsaved bank files and the status verdict", () => {
		const t = tree({
			...model,
			questions: {
				...model.questions,
				1: bank(
					1,
					"questions/nhd/nhd_sat.yaml",
					"name: nhd_sat\n",
					"name: nhd_sat\ntext: edited\n",
				),
			},
		});
		const nhd = t.find((f) => f.name === "nhd")?.leaves[0];
		expect(nhd).toMatchObject({
			unsaved: true,
			draft: false,
			status: { kind: "incomplete" },
		});
		expect(t.find((f) => f.name === "att")?.leaves[0]).toMatchObject({
			draft: true,
		});
	});
});
