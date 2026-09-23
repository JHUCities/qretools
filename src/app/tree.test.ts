import { describe, expect, it } from "vitest";
import { evaluate } from "../core/evaluate.js";
import { ok } from "../core/result.js";
import { evaluateScheme, schemePath } from "../core/schemes.js";
import { indexOf } from "../core/symbols.js";
import {
	envOf,
	init,
	type Model,
	type Question,
	type SchemeEntry,
} from "./model.js";
import { schemeSections, treeOf, UNFILED } from "./tree.js";

const bank = (
	id: number,
	path: string,
	text: string,
	source = text,
): Question => ({
	id,
	kind: "question",
	source,
	origin: { kind: "bank", path, sha: "s", original: text },
	activity: { kind: "idle" },
});
const draft = (id: number, source: string): Question => ({
	id,
	kind: "question",
	source,
	origin: { kind: "draft" },
	activity: { kind: "idle" },
});
const base = init({ stored: ok(undefined), hasToken: false })[0];
const model: Model = {
	...base,
	files: {
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
	treeOf(m, (q) => evaluate(q.source, m.agency, envOf(m.files)));

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
			files: {
				...model.files,
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

describe("schemeSections", () => {
	const scheme = (
		id: number,
		kind: SchemeEntry["kind"],
		name: string,
		text: string,
	): SchemeEntry => ({
		id,
		kind,
		name,
		source: text,
		origin: {
			kind: "bank",
			path: schemePath(kind, name),
			sha: "s",
			original: text,
		},
		activity: { kind: "idle" },
	});
	const m: Model = {
		...model,
		files: {
			...model.files,
			5: bank(
				5,
				"questions/nhd/nhd_a.yaml",
				"name: nhd_a\nresponses: agree4\n",
			),
			// Names a scale that does not exist: still counted as a use.
			6: bank(6, "questions/nhd/nhd_b.yaml", "name: nhd_b\nresponses: gone\n"),
			10: scheme(10, "scale", "agree4", "labels:\n  1: Agree\n"),
			11: scheme(11, "scale", "unused", "labels:\n  1: X\n"),
			12: scheme(12, "missing", "missing", 'labels:\n  "-8": NR\n'),
		},
	};
	const index = (mm: Model) =>
		indexOf(
			Object.values(mm.files).flatMap((q) =>
				q.kind === "question"
					? [
							{
								key: q.id,
								symbols: evaluate(q.source, mm.agency, envOf(mm.files)).symbols,
							},
						]
					: [],
			),
		);
	const sections = (mm: Model) =>
		schemeSections(
			mm,
			(e) => evaluateScheme(e.kind, e.source, envOf(mm.files)),
			index(mm),
		);

	it("shows every kind, even empty, with how many questions name each file", () => {
		const s = sections(m);
		expect(
			s.map((x) => [x.kind, x.leaves.map((l) => [l.name, l.usedBy])]),
		).toEqual([
			[
				"scale",
				[
					["agree4", 1],
					["unused", 0],
				],
			],
			["universe", []],
			["instruction", []],
			["missing", [["missing", undefined]]],
		]);
	});

	it("filters by name, and opens the section holding the open file", () => {
		expect(
			sections({ ...m, browser: { ...m.browser, filter: "agree" } }).map(
				(x) => x.kind,
			),
		).toEqual(["scale"]);
		expect(
			sections({ ...m, screen: { kind: "editing", id: 12 } }).find(
				(x) => x.kind === "missing",
			)?.expanded,
		).toBe(true);
	});
});
