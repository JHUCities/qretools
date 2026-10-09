import { describe, expect, it } from "vitest";
import { applyEdits } from "./edit.ts";
import { EMPTY_ENV, type Env } from "./env.ts";
import { choicesOf, createFor, livelitsOf, useName } from "./livelits.ts";
import { parseSurface } from "./parse.ts";

const env: Env = {
	...EMPTY_ENV,
	concepts: { tenure: { label: "Housing tenure" } },
	universes: { renters: { text: "Respondents who rent" } },
	instructions: { select_one: { text: "Select one" } },
	units: { days: { label: "days" } },
	scales: {
		agree4: {
			codes: [
				{ code: "1", label: "Agree" },
				{ code: "2", label: "Disagree" },
			],
		},
	},
};
const HEAD = "name: q\ntext: Is it so?\nintent: To see why.\n";
const at = (source: string) => livelitsOf(parseSurface(source, env));

describe("a scale picker", () => {
	it("sits at an empty `responses:`, at the point the author types", () => {
		const text = `${HEAD}responses:\n`;
		expect(at(text)).toEqual([
			{
				kind: "scale",
				path: "responses",
				at: `${HEAD}responses:`.length,
				field: expect.any(Array),
			},
		]);
	});

	it("sits after a scale's name, known or not, and says which", () => {
		const known = `${HEAD}responses: agree4\n`;
		expect(at(known)).toMatchObject([
			{ at: `${HEAD}responses: agree4`.length, current: "agree4" },
		]);
		expect(at(`${HEAD}responses: agre\n`)).toMatchObject([{ current: "agre" }]);
	});

	it("is absent where the options are written inline, or there's no `responses`", () => {
		expect(at(`${HEAD}responses:\n  "1": Yes\n`)).toEqual([]);
		expect(at(`${HEAD}open: {}\n`)).toEqual([]);
	});
});

describe("what the picker offers, and what choosing writes", () => {
	it("offers each scale with its labels and codes", () => {
		expect(choicesOf(env, "scale")).toEqual([
			{
				name: "agree4",
				detail: "1 Agree · 2 Disagree",
				codes: [
					{ code: "1", label: "Agree" },
					{ code: "2", label: "Disagree" },
				],
			},
		]);
		expect(choicesOf(EMPTY_ENV, "scale")).toEqual([]);
	});

	it("writes the name chosen over an empty value or another name", () => {
		const fix = useName("responses", "agree4");
		expect(
			fix.kind === "edit" && applyEdits(`${HEAD}responses:\n`, fix.edits),
		).toBe(`${HEAD}responses: agree4\n`);
		expect(
			fix.kind === "edit" && applyEdits(`${HEAD}responses: agre\n`, fix.edits),
		).toBe(`${HEAD}responses: agree4\n`);
	});

	it("offers a new one, named in its dialog and written where it was asked for", () => {
		expect(createFor("scale", "responses")).toEqual({
			kind: "create",
			label: "New shared scale…",
			create: { scheme: "scale", name: "", text: "", path: "responses" },
		});
	});
});

describe("pickers for every field that names a shared entry", () => {
	it("sit at a concept, universe and instruction, empty or named, never at prose", () => {
		const text = `${HEAD}concept:\nuniverse: renters\ninstruction: Select one\nopen: {}\n`;
		expect(at(text).map((l) => [l.kind, l.path, l.current])).toEqual([
			["concept", "concept", undefined],
			["universe", "universe", "renters"],
		]);
	});

	it("sit at a unit inside `number:`, after its value", () => {
		const text = `${HEAD}number:\n  min: 0\n  unit: days\n`;
		expect(at(text)).toMatchObject([
			{
				kind: "unit",
				path: "number.unit",
				at: `${HEAD}number:\n  min: 0\n  unit: days`.length,
				current: "days",
			},
		]);
		const empty = `${HEAD}number:\n  unit:\n`;
		expect(at(empty)).toMatchObject([
			{
				kind: "unit",
				path: "number.unit",
				at: `${HEAD}number:\n  unit:`.length,
			},
		]);
	});

	it("offer each kind's words, and write a nested name where it is", () => {
		expect(choicesOf(env, "concept")).toEqual([
			{ name: "tenure", detail: "Housing tenure" },
		]);
		expect(choicesOf(env, "universe")).toEqual([
			{ name: "renters", detail: "Respondents who rent" },
		]);
		expect(choicesOf(env, "unit")).toEqual([{ name: "days", detail: "days" }]);
		const fix = useName("number.unit", "days");
		expect(
			fix.kind === "edit" && applyEdits(`${HEAD}number:\n  unit:\n`, fix.edits),
		).toBe(`${HEAD}number:\n  unit: days\n`);
	});
});
