import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { parseBankFile } from "./bankfile.ts";
import { EMPTY_ENV, type Env } from "./env.ts";
import {
	applyLivelit,
	choicesOf,
	createFor,
	type Livelit,
	livelitsOf,
	settingsLivelits,
} from "./livelits.ts";
import { indexDocument, parseSurface } from "./parse.ts";

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
const at = (source: string) => livelitsOf(source, parseSurface(source, env));
/** Each picker as `[id, at, the text it would replace, what is written there]`. */
const summary = (source: string) =>
	at(source).map((l) => [
		l.id,
		l.at,
		source.slice(l.span[0], l.span[1]),
		l.picker.kind === "one" ? l.picker.current : l.picker.chosen,
	]);
const choose = (source: string, id: string, value: string) => {
	const l = at(source).find((x) => x.id === id) as Livelit;
	return applyLivelit(source, l, value);
};

describe("a scale picker", () => {
	it("sits at an empty `responses:`, at the point the author types", () => {
		const text = `${HEAD}responses:\n`;
		const end = `${HEAD}responses:`.length;
		expect(summary(text)).toEqual([["responses", end, "", undefined]]);
		expect(at(text)[0]).toMatchObject({
			label: "Choose a shared scale",
			picker: { kind: "one", source: { kind: "scheme", scheme: "scale" } },
			actions: [createFor("scale", "responses")],
		});
	});

	it("sits after a scale's name, known or not, and replaces exactly the name", () => {
		const known = `${HEAD}responses: agree4\n`;
		expect(summary(known)).toEqual([
			["responses", `${HEAD}responses: agree4`.length, "agree4", "agree4"],
		]);
		expect(summary(`${HEAD}responses: agre\n`)).toEqual([
			["responses", `${HEAD}responses: agre`.length, "agre", "agre"],
		]);
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

	it("writes the name chosen over an empty value or another name, the caret after it", () => {
		expect(choose(`${HEAD}responses:\n`, "responses", "agree4")).toEqual({
			text: `${HEAD}responses: agree4\n`,
			caret: `${HEAD}responses: agree4`.length,
		});
		expect(
			choose(`${HEAD}responses: agre\n`, "responses", "agree4")?.text,
		).toBe(`${HEAD}responses: agree4\n`);
		expect(choose(`${HEAD}responses:\n`, "responses", "")).toBeUndefined();
		// Quoted where YAML would read it as something else.
		expect(choose(`${HEAD}responses:\n`, "responses", "010")?.text).toBe(
			`${HEAD}responses: "010"\n`,
		);
		expect(choose(`${HEAD}responses: x\n`, "responses", "yes: no")?.text).toBe(
			`${HEAD}responses: "yes: no"\n`,
		);
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
		expect(summary(text).map(([id, , , current]) => [id, current])).toEqual([
			["concept", undefined],
			["universe", "renters"],
		]);
	});

	it("sit at a unit inside `number:`, after its value", () => {
		const text = `${HEAD}number:\n  min: 0\n  unit: days\n`;
		expect(summary(text)).toEqual([
			[
				"number.unit",
				`${HEAD}number:\n  min: 0\n  unit: days`.length,
				"days",
				"days",
			],
		]);
		const empty = `${HEAD}number:\n  unit:\n`;
		expect(summary(empty)).toEqual([
			["number.unit", `${HEAD}number:\n  unit:`.length, "", undefined],
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
		expect(
			choose(`${HEAD}number:\n  unit:\n`, "number.unit", "days")?.text,
		).toBe(`${HEAD}number:\n  unit: days\n`);
	});
});

describe("pickers of fixed values", () => {
	it("sit at `select` and at each fill's type, empty or one word, and offer their values", () => {
		const text = `${HEAD}select:\nfills:\n  rent: number\nresponses:\n  "1": Yes\n`;
		expect(summary(text)).toEqual([
			["select", `${HEAD}select:`.length, "", undefined],
			[
				"fills.rent",
				`${HEAD}select:\nfills:\n  rent: number`.length,
				"number",
				"number",
			],
		]);
		const [select] = at(text);
		expect(select?.picker.source).toEqual({
			kind: "enum",
			values: [
				{ name: "one", detail: "The respondent picks one response" },
				{ name: "many", detail: "Select all that apply" },
			],
		});
		expect(choose(text, "select", "many")?.text).toBe(
			`${HEAD}select: many\nfills:\n  rent: number\nresponses:\n  "1": Yes\n`,
		);
	});
});

describe("the checklist of a bank's required fields", () => {
	const bank = (text: string) => {
		const doc = parseDocument(text, { prettyErrors: false });
		return settingsLivelits(
			text,
			indexDocument(doc, text.length),
			parseBankFile(text).required,
		);
	};
	const write = (text: string, value: readonly string[]) => {
		const [l] = bank(text);
		return l === undefined ? undefined : applyLivelit(text, l, value)?.text;
	};

	it("reads what is chosen, and writes the set in the form it was written", () => {
		const block = "agency: org.example\nrequired:\n  - title\n";
		expect(bank(block)[0]?.picker).toMatchObject({
			kind: "many",
			chosen: ["title"],
		});
		// A block list stays a block, at its indent.
		expect(write(block, ["title", "concept"])).toBe(
			"agency: org.example\nrequired:\n  - title\n  - concept\n",
		);
		expect(
			write("agency: org.example\nrequired:\n    - note\n", ["title"]),
		).toBe("agency: org.example\nrequired:\n    - title\n");
		// Emptied, it is the empty list on its line.
		expect(write(block, [])).toBe("agency: org.example\nrequired: []\n");
		expect(write("agency: org.example\nrequired: [note]\n", [])).toBe(
			"agency: org.example\nrequired: []\n",
		);
		expect(write("agency: org.example\nrequired:\n", ["note"])).toBe(
			"agency: org.example\nrequired: [note]\n",
		);
	});

	it("is absent where `required` isn't written, as a commented line isn't", () => {
		expect(bank("agency: org.example\n#required:\n#  - title\n")).toEqual([]);
	});
});
