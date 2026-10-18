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
	const { qsf, findings } = writeQsf(instrument, { name: "t" });
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
});
