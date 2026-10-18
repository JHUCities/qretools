import { describe, expect, it } from "vitest";
import type { Question, ReadInstrument } from "./read.ts";
import { escapeText, writeQsf } from "./write.ts";

const modes: Question = {
	id: "q-modes",
	name: "modes",
	domain: {
		kind: "choice",
		many: true,
		choices: [
			{ code: "b", label: "Bus & tram" },
			{ code: "w", label: "Walk" },
		],
	},
};
const payloads = (instrument: ReadInstrument) => {
	const { qsf, findings } = writeQsf(instrument, {
		name: "t",
		created: "2026-10-18 00:00:00",
	});
	const sq = (qsf.SurveyElements as { Element: string; Payload: unknown }[])
		.filter((e) => e.Element === "SQ")
		.map((e) => e.Payload as Record<string, unknown>);
	return { sq, findings };
};

describe("writing a survey as QSF", () => {
	it("keeps author text as text: HTML, pipes and line breaks escaped", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: an author's literal `${`, which must not pipe.
		expect(escapeText("Rent < $1,000 & ${q://QID1} \n next")).toBe(
			"Rent &lt; $1,000 &amp; &#36;{q://QID1} <br> next",
		);
	});

	it("writes a select-all question with each option's variable, and pipes an answer's words", () => {
		const { sq, findings } = payloads({
			inputs: [],
			flow: [
				{
					kind: "ask",
					id: "ask-modes",
					question: modes,
					records: [
						{ variable: "modes_bus", code: "b" },
						{ variable: "modes_walk", code: "w" },
					],
					text: [{ kind: "text", text: "How do you travel?" }],
					checks: [],
				},
			],
		});
		expect(findings).toEqual([]);
		expect(sq[0]).toMatchObject({
			QuestionType: "MC",
			Selector: "MAVR",
			DataExportTag: "modes",
			Choices: { "1": { Display: "Bus &amp; tram" }, "2": { Display: "Walk" } },
			RecodeValues: { "1": "b", "2": "w" },
			VariableNaming: { "1": "modes_bus", "2": "modes_walk" },
		});
	});

	it("meets the survey header rules Qualtrics' import checks (experiment 5a)", () => {
		const { qsf } = writeQsf(
			{ inputs: [], flow: [] },
			{ name: "t", created: "2026-10-18 09:30:00" },
		);
		const entry = qsf.SurveyEntry as Record<string, unknown>;
		const date =
			/^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
		expect(entry.SurveyOwnerID).toMatch(/^.{10,}$/);
		expect(entry.CreatorID).toMatch(/^URH?_[a-zA-Z0-9]{11,15}$/);
		expect(entry.SurveyBrandID).toMatch(/^.+$/);
		expect(entry.SurveyCreationDate).toMatch(date);
		expect(entry.LastModified).toMatch(date);
		for (const key of [
			"DivisionID",
			"SurveyActiveResponseSet",
			"SurveyStartDate",
			"SurveyExpirationDate",
			"LastAccessed",
			"LastActivated",
			"Deleted",
		])
			expect(entry).toHaveProperty(key);
	});
});
