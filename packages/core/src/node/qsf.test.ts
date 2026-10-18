import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bankOf, instrumentOf } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { readInstrument } from "../qsf/read.ts";
import { outline } from "../qsf/testing.ts";
import { writeQsf } from "../qsf/write.ts";
import { readWorkspace } from "./index.ts";

const households = async () => {
	const root = fileURLToPath(
		new URL("../../fixtures/households", import.meta.url),
	);
	return instrumentOf(
		await readFile(`${root}/instruments/households.yaml`, "utf8"),
		{ banks: { hh: bankOf(await readWorkspace(root)) }, agency: "org.example" },
	).ddi;
};

describe("reading the households instrument's DDI back", () => {
	it("reads the households instrument whole, with nothing it can't read", async () => {
		const { instrument, findings } = readInstrument(await households());
		expect(findings).toEqual([]);
		expect(instrument.inputs.map((i) => i.variable)).toEqual(["county"]);
		expect(outline(instrument.flow)).toMatchInlineSnapshot(`
			[
			  "say Thank you for taking part in this survey of <input:county>.",
			  "ask consent choice consent: Do you agree to take part in this survey?",
			  "stop consent = "2" {consent=consent}",
			  "  say Thank you for your time.",
			  "ask size number size: How many people live in your household, including you?",
			  "loop count size {members_index=row(roster-members), size=size} max 20",
			  "  say The next questions are about person <row(roster-members)>.",
			  "  ask age number age: How old is this person?",
			  "  ask works choice works: Does this person work for pay?",
			  "section Housing",
			  "  ask tenure choice tenure: Do you own or rent your home?",
			  "  compute renter = tenure = "2" {tenure=tenure}",
			  "  if renter {renter=compute:renter}",
			  "    ask rent number rent: How much is your rent each month, in dollars?",
			  "      check warning rent < 10000 {rent=rent}: <rent> dollars is a lot. Is that right?",
			  "    ask utilities choice utilities: You said you pay <rent> a month. Does that include utilities?",
			  "repeat more more_vehicles = "1" {vehicles_index=row(roster-vehicles), more_vehicles=more_vehicles} max 4",
			  "  ask vehicle choice vehicle: What kind of vehicle is it?",
			  "  ask more_vehicles choice more_vehicles: Does your household have another vehicle?",
			  "loop count size {members_index=row(each-members), size=size} max 20",
			  "  if works = "1" {works=works}",
			  "    say Person <row(each-members)> works.",
			  "ask comments text comments: Is there anything else you'd like to tell us?",
			]
		`);
	});

	it("writes the households survey: blocks, questions and pipes, and what isn't written yet", async () => {
		const { instrument } = readInstrument(await households());
		const { qsf, findings } = writeQsf(instrument, { name: "households" });
		const elements = qsf.SurveyElements as {
			Element: string;
			PrimaryAttribute: string;
			Payload: unknown;
		}[];
		const blocks = elements.find((e) => e.Element === "BL")?.Payload as {
			Description: string;
			BlockElements?: { QuestionID?: string }[];
		}[];
		const questions = new Map(
			elements
				.filter((e) => e.Element === "SQ")
				.map((e) => [e.PrimaryAttribute, e.Payload as Record<string, string>]),
		);
		expect(
			blocks.map(
				(b) =>
					`${b.Description}: ${(b.BlockElements ?? [])
						.flatMap((e) => {
							const q = e.QuestionID && questions.get(e.QuestionID);
							return q
								? [
										`${q.QuestionID} ${q.QuestionType}/${q.Selector} ${q.DataExportTag}`,
									]
								: [];
						})
						.join(", ")}`,
			),
		).toMatchInlineSnapshot(`
			[
			  "Default Question Block: QID1 DB/TB QID1, QID2 MC/SAVR consent, QID4 TE/SL size",
			  "Housing: QID8 MC/SAVR tenure",
			  "Block 3: QID14 TE/SL comments",
			  "Trash / Unused Questions: ",
			]
		`);
		expect(questions.get("QID1")?.QuestionText).toMatchInlineSnapshot(
			`"Thank you for taking part in this survey of \${e://Field/county}."`,
		);
		expect(
			findings.map((f) => `${f.severity} ${f.path}: ${f.message}`),
		).toMatchInlineSnapshot(`
			[
			  "error instrument-households.stop-1: A stop isn't exported to Qualtrics yet: it's left out.",
			  "error instrument-households.roster-members: A roster isn't exported to Qualtrics yet: it's left out.",
			  "error instrument-households.compute-renter: A computed value isn't exported to Qualtrics yet: it's left out.",
			  "error instrument-households.if-1: A branch isn't exported to Qualtrics yet: it's left out.",
			  "error instrument-households.roster-vehicles: A roster isn't exported to Qualtrics yet: it's left out.",
			  "error instrument-households.each-members: A roster isn't exported to Qualtrics yet: it's left out.",
			  "info instrument-households.ask-comments: Qualtrics doesn't limit this answer to 500 characters.",
			]
		`);
	});
});
