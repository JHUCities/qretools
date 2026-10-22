import { describe, expect, it } from "vitest";
import nhdNyrs from "../examples/nhd_nyrs.yaml?raw";
import nhdSat from "../examples/nhd_sat.yaml?raw";
import { respondentView } from "./render.ts";
import { EMPTY_ENV } from "./surface/env.ts";
import { parseSurface } from "./surface/parse.ts";

// The examples name a shared unit, `years`.
const WITH_UNITS = { ...EMPTY_ENV, units: { years: { label: "years" } } };

const draftOf = (source: string) => parseSurface(source, WITH_UNITS).draft;

describe("respondentView", () => {
	it("renders a single-choice question", () => {
		const v = respondentView(draftOf(nhdSat));
		expect(v.text).toEqual({
			kind: "filled",
			text: "How satisfied are you with your neighborhood as a place to live?",
		});
		expect(v.instruction).toEqual({ text: "Select one" });
		expect(v.input.kind === "choice" && v.input.select).toBe("one");
		expect(
			v.input.kind === "choice" && v.input.options.map((o) => o.label),
		).toHaveLength(5);
	});

	it("renders a number question with its unit, and a step from decimals", () => {
		expect(respondentView(draftOf(nhdNyrs)).input).toEqual({
			kind: "number",
			min: 0,
			max: 100,
			unit: "years",
		});
		expect(respondentView(draftOf("number:\n  decimals: 2\n")).input).toEqual({
			kind: "number",
			step: 0.01,
		});
	});

	it("shows a shared instruction's text, with its name", () => {
		const env = {
			...EMPTY_ENV,
			instructions: { select_one: { text: "Select one" } },
		};
		const d = parseSurface(
			"name: q\ntext: Q?\nintent: i\ninstruction: select_one\nopen: {}\n",
			env,
		).draft;
		expect(respondentView(d).instruction).toEqual({
			text: "Select one",
			ref: "select_one",
		});
	});

	it("evaluates around holes", () => {
		const v = respondentView(draftOf(""));
		expect(v.text.kind).toBe("hole");
		expect(v.input).toMatchObject({ kind: "hole", path: "" });
		expect(v.instruction).toBeUndefined();
	});
});
