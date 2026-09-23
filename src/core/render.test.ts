import { describe, expect, it } from "vitest";
import nhdNyrs from "../examples/nhd_nyrs.yaml?raw";
import nhdSat from "../examples/nhd_sat.yaml?raw";
import { codebookView, respondentView } from "./render.js";
import { EMPTY_ENV } from "./surface/env.js";
import { parseSurface } from "./surface/parse.js";

const draftOf = (source: string) => parseSurface(source, EMPTY_ENV).draft;

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

	it("evaluates around holes", () => {
		const v = respondentView(draftOf(""));
		expect(v.text.kind).toBe("hole");
		expect(v.input).toMatchObject({ kind: "hole", path: "" });
		expect(v.instruction).toBeUndefined();
	});
});

describe("codebookView", () => {
	it("formats a code list the way the codebook does", () => {
		const v = codebookView(draftOf(nhdSat), EMPTY_ENV);
		expect(v.title).toEqual({
			kind: "filled",
			text: "neighborhood satisfaction",
		});
		expect(v.variable).toEqual({ kind: "filled", text: "nhd_sat" });
		expect(v.values).toEqual({
			kind: "lines",
			lines: [
				"1 = Very satisfied",
				"2 = Somewhat satisfied",
				"3 = Neither satisfied nor dissatisfied",
				"4 = Somewhat dissatisfied",
				"5 = Very dissatisfied",
			],
		});
		expect(v.universe).toEqual({ text: "All respondents" });
		expect(v.source).toBe("DCAS 2018 Q6");
		expect(v.notes).toEqual([]);
	});

	it("formats number and open domains, and notes select-all", () => {
		expect(codebookView(draftOf(nhdNyrs), EMPTY_ENV).values).toEqual({
			kind: "lines",
			lines: ["Range: 0–100 years"],
		});
		expect(
			codebookView(draftOf("number:\n  min: 18\n"), EMPTY_ENV).values,
		).toEqual({
			kind: "lines",
			lines: ["Minimum: 18"],
		});
		expect(
			codebookView(draftOf("open:\n  max_length: 200\n"), EMPTY_ENV).values,
		).toEqual({
			kind: "lines",
			lines: ["Free text, up to 200 characters"],
		});
		expect(
			codebookView(draftOf("select: many\nresponses:\n  1: a\n"), EMPTY_ENV)
				.notes,
		).toHaveLength(1);
	});

	it("falls back to the name for the title, then to a hole", () => {
		expect(codebookView(draftOf("name: q1\n"), EMPTY_ENV).title).toEqual({
			kind: "filled",
			text: "q1",
		});
		expect(codebookView(draftOf(""), EMPTY_ENV).title.kind).toBe("hole");
		expect(codebookView(draftOf(""), EMPTY_ENV).values.kind).toBe("hole");
	});
});

describe("scheme references in the previews", () => {
	it("shows the resolved text with the name kept, and the bank's missing-value line", async () => {
		const { EMPTY_ENV } = await import("./surface/env.js");
		const { parseScale } = await import("./surface/scales.js");
		const env = {
			...EMPTY_ENV,
			universes: { renters: { text: "Renters only" } },
			instructions: { select_one: { text: "Select one" } },
			missing:
				parseScale('labels:\n  "-8": Item non-response\n').scale?.codes ?? [],
		};
		const d = parseSurface(
			"name: q\ntext: Q?\nintent: i\nuniverse: renters\ninstruction: select_one\nopen:\n",
			env,
		).draft;
		expect(respondentView(d).instruction).toEqual({
			text: "Select one",
			ref: "select_one",
		});
		const cb = codebookView(d, env);
		expect(cb.universe).toEqual({ text: "Renters only", ref: "renters" });
		expect(cb.missing).toBe("Missing: -8 (Item non-response)");
		const prose = parseSurface(
			"name: q\ntext: Q?\nintent: i\nuniverse: Everyone here\nopen:\n",
			EMPTY_ENV,
		).draft;
		expect(codebookView(prose, EMPTY_ENV).universe).toEqual({
			text: "Everyone here",
		});
		expect(codebookView(prose, EMPTY_ENV).missing).toBeUndefined();
	});
});
