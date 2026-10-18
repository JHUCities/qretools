import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bankOf, instrumentOf, placeFindings, qsfOf } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { readInstrument } from "../qsf/read.ts";
import { flowOutline, outline } from "../qsf/testing.ts";
import { writeQsf } from "../qsf/write.ts";
import { readWorkspace } from "./index.ts";

const householdsInstrument = async () => {
	const root = fileURLToPath(
		new URL("../../fixtures/households", import.meta.url),
	);
	return instrumentOf(
		await readFile(`${root}/instruments/households.yaml`, "utf8"),
		{ banks: { hh: bankOf(await readWorkspace(root)) }, agency: "org.example" },
	);
};
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
		const { qsf, findings } = writeQsf(instrument, {
			name: "households",
			created: "2026-10-18 00:00:00",
		});
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
		// The members roster is one Qualtrics loop; the vehicles roster and the each over members
		// are written out row by row (4 rounds, 20 rows).
		expect(blocks.length).toBe(32);
		const lines = flowOutline(qsf);
		expect(lines.slice(0, 11)).toMatchInlineSnapshot(`
			[
			  "EmbeddedData  county=(url)",
			  "Block BL_qretools000001",
			  "Branch stop if consent = "2": q://QID2/SelectableChoice/2 Selected",
			  "  Standard BL_qretools000002",
			  "  EndSurvey",
			  "Standard BL_qretools000003",
			  "Standard BL_qretoolsLoop001",
			  "Standard BL_qretools000005",
			  "Branch if renter: q://QID8/SelectableChoice/2 Selected",
			  "  Standard BL_qretools000006",
			  "Standard BL_qretools000007",
			]
		`);
		const renter = lines.findIndex((l) => l.includes("if renter"));
		expect(lines.slice(renter, renter + 12)).toMatchInlineSnapshot(`
			[
			  "Branch if renter: q://QID8/SelectableChoice/2 Selected",
			  "  Standard BL_qretools000006",
			  "Standard BL_qretools000007",
			  "Branch if more_vehicles = "1": q://QID13/SelectableChoice/1 Selected",
			  "  Standard BL_qretools000008",
			  "  Branch if more_vehicles = "1": q://QID15/SelectableChoice/1 Selected",
			  "    Standard BL_qretools000009",
			  "    Branch if more_vehicles = "1": q://QID17/SelectableChoice/1 Selected",
			  "      Standard BL_qretools000010",
			  "Branch if size >= 1: q://QID4/ChoiceTextEntryValue GreaterThanOrEqual 1",
			  "  Branch if works = "1": q://1_QID7/SelectableChoice/1 Selected",
			  "    Standard BL_qretools000011",
			]
		`);
		expect(questions.get("QID1")?.QuestionText).toMatchInlineSnapshot(
			`"Thank you for taking part in this survey of \${e://Field/county}."`,
		);
		expect(
			findings.map((f) => `${f.severity} ${f.path}: ${f.message}`),
		).toMatchInlineSnapshot(`
			[
			  "info : The bank's missing-value codes aren't offered to respondents in Qualtrics.",
			  "error instrument-households.ask-rent-check-1: This warning shows the answer it checks, which Qualtrics shows empty on the answer's own page.",
			  "info instrument-households.ask-comments: Qualtrics doesn't limit this answer to 500 characters.",
			]
		`);
	});

	it("places every construct of the DDI at a step of the instrument", async () => {
		const instrument = await householdsInstrument();
		const constructs = [
			"QuestionConstruct",
			"StatementItem",
			"IfThenElse",
			"Sequence",
			"Loop",
			"RepeatUntil",
			"ComputationItem",
		] as const;
		const ids = constructs.flatMap((t) =>
			Object.values(instrument.ddi[t] ?? {}).map((i) => String(i.ID)),
		);
		const unplaced = ids.filter((id) => instrument.places[id] === undefined);
		// The instrument's own top Sequence is the whole document.
		expect(unplaced).toEqual(["instrument-households.flow"]);
		const nowhere = Object.values(instrument.places).filter(
			(p) => instrument.ranges[p] === undefined,
		);
		expect(nowhere).toEqual([]);
		const { findings } = qsfOf(instrument.ddi, {
			name: "households",
			created: "2026-10-18 00:00:00",
		});
		expect(
			placeFindings(findings, instrument.places).map(
				(f) => `${f.path}: ${f.code}`,
			),
		).toMatchInlineSnapshot(`
			[
			  ": qsf-note",
			  "flow.5.flow.2.then.0.checks.0: qsf-inexpressible",
			  "flow.8: qsf-note",
			]
		`);
	});
});

describe("the households survey against its golden file", () => {
	// The golden file is the survey Qualtrics imported and ran as written (2026-10-18): its
	// re-export differed only in Qualtrics' own IDs, dates, theme and preview link.
	it("writes the survey Qualtrics was shown to run", async () => {
		const golden = fileURLToPath(
			new URL("../../fixtures/qsf/households.qsf", import.meta.url),
		);
		const { qsf } = writeQsf(readInstrument(await households()).instrument, {
			name: "households",
			created: "2026-10-18 12:00:00",
		});
		expect(`${JSON.stringify(qsf, null, 2)}\n`).toBe(
			await readFile(golden, "utf8"),
		);
	});
});
