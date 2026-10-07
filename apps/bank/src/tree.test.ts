import { evaluate } from "@qretools/core/evaluate.js";
import { ok } from "@qretools/core/result.js";
import { evaluateScheme, schemePath } from "@qretools/core/schemes.js";
import { indexOf } from "@qretools/core/symbols.js";
import { describe, expect, it } from "vitest";
import {
	envOf,
	init,
	type Model,
	type Question,
	type SchemeEntry,
} from "./model.js";
import { openFolder, schemeSections, treeOf, UNFILED } from "./tree.js";

const bank = (
	id: number,
	path: string,
	text: string,
	source = text,
): Question => ({
	id,
	kind: "question",
	source,
	base: { path, sha: "s", text },
});
const draft = (id: number, source: string): Question => ({
	id,
	kind: "question",
	source,
});
const base = init({ work: ok(undefined), hasToken: false })[0];
const model: Model = {
	...base,
	local: {
		schemes: {},
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
	},
};
const tree = (m: Model) =>
	treeOf(m, (q) =>
		evaluate(q.source, m.agency, envOf(m.local.schemes, m.remote.schemes)),
	);

describe("treeOf", () => {
	it("files bank questions by their path, and every draft, named or not, under unfiled", () => {
		// `att_new` is a draft: its name's prefix says nothing about where it goes.
		expect(
			tree(model).map((f) => [f.name, f.leaves.map((l) => l.name)]),
		).toEqual([
			["nhd", ["nhd_sat"]],
			["svy", ["dem_latx"]],
			[UNFILED, ["att_new", undefined]],
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

	it("opens only the folders the user toggled, even one holding the open question", () => {
		// `update` opens a file's folder once (`openFolder`); after that it can be closed.
		const t = tree({
			...model,
			screen: { kind: "editing", id: 2 },
			browser: { ...model.browser, expanded: [UNFILED] },
		});
		expect(Object.fromEntries(t.map((f) => [f.name, f.expanded]))).toEqual({
			nhd: false,
			svy: false,
			[UNFILED]: true,
		});
	});

	it("names the folder of the open file, a question's or a shared file's section", () => {
		expect(openFolder({ ...model, screen: { kind: "editing", id: 2 } })).toBe(
			"svy",
		);
		expect(openFolder({ ...model, screen: { kind: "editing", id: 3 } })).toBe(
			UNFILED,
		);
		expect(openFolder(model)).toBeUndefined();
	});

	it("marks drafts, unsaved bank files and the status verdict", () => {
		const t = tree({
			...model,
			local: {
				...model.local,
				questions: {
					...model.local.questions,
					1: bank(
						1,
						"questions/nhd/nhd_sat.yaml",
						"name: nhd_sat\n",
						"name: nhd_sat\ntext: edited\n",
					),
				},
			},
		});
		const nhd = t.find((f) => f.name === "nhd")?.leaves[0];
		expect(nhd).toMatchObject({
			unsaved: true,
			draft: false,
			status: { kind: "incomplete" },
		});
		expect(t.find((f) => f.name === UNFILED)?.leaves[0]).toMatchObject({
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
		base: { path: schemePath(kind, name), sha: "s", text },
	});
	const m: Model = {
		...model,
		local: {
			questions: {
				...model.local.questions,
				5: bank(
					5,
					"questions/nhd/nhd_a.yaml",
					"name: nhd_a\nresponses: agree4\n",
				),
				// Names a scale that does not exist: still counted as a use.
				6: bank(
					6,
					"questions/nhd/nhd_b.yaml",
					"name: nhd_b\nresponses: gone\n",
				),
			},
			schemes: {
				10: scheme(10, "scale", "agree4", "labels:\n  1: Agree\n"),
				11: scheme(11, "scale", "unused", "labels:\n  1: X\n"),
				12: scheme(12, "missing", "missing", 'labels:\n  "-8": NR\n'),
			},
		},
	};
	const index = (mm: Model) =>
		indexOf(
			Object.values(mm.local.questions).map((q) => ({
				key: q.id,
				symbols: evaluate(
					q.source,
					mm.agency,
					envOf(mm.local.schemes, mm.remote.schemes),
				).symbols,
			})),
		);
	const sections = (mm: Model) =>
		schemeSections(
			mm,
			(e) =>
				evaluateScheme(
					e.kind,
					e.source,
					envOf(mm.local.schemes, mm.remote.schemes),
				),
			index(mm),
		);

	it("shows every kind, even empty, with how many questions name each file", () => {
		const s = sections(m);
		expect(
			s.map((x) => [x.kind, x.leaves.map((l) => [l.name, l.usedBy])]),
		).toEqual([
			// Concepts first: what is measured, then how it is asked.
			["concept", []],
			[
				"scale",
				[
					["agree4", 1],
					["unused", 0],
				],
			],
			["unit", []],
			["universe", []],
			["instruction", []],
			["missing", [["missing", undefined]]],
		]);
	});

	it("filters by name, and opens only the sections the user toggled", () => {
		expect(
			sections({ ...m, browser: { ...m.browser, filter: "agree" } }).map(
				(x) => x.kind,
			),
		).toEqual(["scale"]);
		expect(
			sections({ ...m, screen: { kind: "editing", id: 12 } }).find(
				(x) => x.kind === "missing",
			)?.expanded,
		).toBe(false);
		expect(openFolder({ ...m, screen: { kind: "editing", id: 12 } })).toBe(
			"scheme:missing",
		);
	});
});
