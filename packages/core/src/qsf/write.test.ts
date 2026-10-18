import { describe, expect, it } from "vitest";
import { parseCondition } from "../cond/parse.ts";
import { escapeText } from "./questions.ts";
import type {
	Cond,
	Part,
	Question,
	ReadInstrument,
	Source,
	Step,
} from "./read.ts";
import { flowOutline } from "./testing.ts";
import { writeQsf } from "./write.ts";

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
			"Rent &lt; &#36;1,000 &amp; &#36;{q://QID1} <br> next",
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

	it("writes an if with elif and else as flagged branches, a stop as an ending", () => {
		const tenure: Question = {
			id: "q-tenure",
			name: "tenure",
			domain: {
				kind: "choice",
				many: false,
				choices: [
					{ code: "1", label: "Own" },
					{ code: "2", label: "Rent" },
					{ code: "3", label: "Other" },
				],
			},
		};
		const sources = new Map<string, Source>([
			[
				"tenure",
				{
					kind: "answer",
					variable: "tenure",
					asks: ["ask-tenure"],
					question: tenure,
				},
			],
		]);
		const cond = (text: string): Cond => ({
			expr: parseCondition(text).expr,
			sources,
		});
		const arm = (c: string, ...then: Step[]) => ({ cond: cond(c), then });
		const say = (id: string): Step => ({
			kind: "say",
			id,
			text: [{ kind: "text", text: id }],
		});
		const { qsf, findings } = writeQsf(
			{
				inputs: [],
				flow: [
					{
						kind: "ask",
						id: "ask-tenure",
						question: tenure,
						records: [{ variable: "tenure" }],
						text: [{ kind: "text", text: "Own or rent?" }],
						checks: [],
					},
					{
						kind: "stop",
						id: "stop",
						cond: cond('tenure = "3"'),
						say: [say("bye")],
					},
					{
						kind: "if",
						id: "if",
						branches: [
							arm('tenure = "1"', say("owners")),
							arm('tenure = "2"', say("renters")),
						],
						else: [say("neither")],
					},
				],
			},
			{ name: "t", created: "2026-10-18 00:00:00" },
		);
		expect(flowOutline(qsf)).toMatchInlineSnapshot(`
			[
			  "Block BL_qretools000001",
			  "Branch stop if tenure = "3": q://QID1/SelectableChoice/3 Selected",
			  "  Standard BL_qretools000002",
			  "  EndSurvey",
			  "Branch if tenure = "1": q://QID1/SelectableChoice/1 Selected",
			  "  EmbeddedData  qretools_branch_1=1",
			  "  Standard BL_qretools000003",
			  "Branch elif tenure = "2": qretools_branch_1 Empty And q://QID1/SelectableChoice/2 Selected",
			  "  EmbeddedData  qretools_branch_1=1",
			  "  Standard BL_qretools000004",
			  "Branch else: qretools_branch_1 Empty",
			  "  Standard BL_qretools000005",
			]
		`);
		expect(findings.map((f) => `${f.code} ${f.path}`)).toMatchInlineSnapshot(`
			[
			  "qsf-note if",
			]
		`);
	});

	it("computes a number with $e{} once its operands are answered, and inlines a true-or-false one only where exact", () => {
		const size: Question = {
			id: "q-size",
			name: "size",
			domain: { kind: "number", decimals: 0 },
		};
		const sources = new Map<string, Source>([
			[
				"size",
				{
					kind: "answer",
					variable: "size",
					asks: ["ask-size"],
					question: size,
				},
			],
			["big", { kind: "compute", variable: "big" }],
			["late", { kind: "compute", variable: "late" }],
			["half", { kind: "compute", variable: "half" }],
		]);
		const cond = (text: string): Cond => ({
			expr: parseCondition(text).expr,
			sources,
		});
		const compute = (id: string, variable: string, value: string): Step => ({
			kind: "compute",
			id,
			variable,
			value: cond(value),
		});
		const arm = (c: string, ...then: Step[]) => ({ cond: cond(c), then });
		const say = (id: string, ...text: Part[]): Step => ({
			kind: "say",
			id,
			text,
		});
		const { qsf, findings } = writeQsf(
			{
				inputs: [],
				flow: [
					{
						kind: "ask",
						id: "ask-size",
						question: size,
						records: [{ variable: "size" }],
						text: [{ kind: "text", text: "How many?" }],
						checks: [],
					},
					compute("c-half", "half", "size / 2"),
					say("s-half", {
						kind: "value",
						source: { kind: "compute", variable: "half" },
					}),
					compute("c-big", "big", "size > 4"),
					{ kind: "stop", id: "stop-big", cond: cond("big"), say: [] },
					{
						kind: "if",
						id: "if",
						branches: [arm("big", compute("c-late", "late", "size > 9"))],
					},
					{ kind: "stop", id: "stop-late", cond: cond("late"), say: [] },
				],
			},
			{ name: "t", created: "2026-10-18 00:00:00" },
		);
		expect(flowOutline(qsf)).toMatchInlineSnapshot(`
			[
			  "Block BL_qretools000001",
			  "Branch compute half: q://QID1/ChoiceTextEntryValue NotEmpty",
			  "  EmbeddedData  half=$e{ (\${q://QID1/ChoiceTextEntryValue} / 2) }",
			  "Standard BL_qretools000002",
			  "Branch stop if big: q://QID1/ChoiceTextEntryValue GreaterThan 4",
			  "  EndSurvey",
			]
		`);
		expect(
			findings.map((f) => `${f.path}: ${f.message}`),
		).toMatchInlineSnapshot(`
			[
			  "c-half: Qualtrics' arithmetic decides what dividing by zero gives.",
			  "stop-late: \`late\` is computed only on some paths through the survey, so Qualtrics can't test it here.",
			]
		`);
	});

	it("inlines nothing whose value at its reader could differ from when it was computed", () => {
		const size: Question = {
			id: "q-size",
			name: "size",
			domain: { kind: "number", decimals: 0 },
		};
		const answer: Source = {
			kind: "answer",
			variable: "size",
			asks: ["ask-size"],
			question: size,
		};
		const cond = (text: string, ...computed: string[]): Cond => ({
			expr: parseCondition(text).expr,
			sources: new Map<string, Source>([
				["size", answer],
				...computed.map((c): [string, Source] => [
					c,
					{ kind: "compute", variable: c },
				]),
			]),
		});
		let computes = 0;
		const compute = (variable: string, value: Cond): Step => ({
			kind: "compute",
			id: `c-${++computes}`,
			variable,
			value,
		});
		const stop = (id: string, c: Cond): Step => ({
			kind: "stop",
			id,
			cond: c,
			say: [],
		});
		const write = (...flow: Step[]) =>
			writeQsf(
				{
					inputs: [],
					flow: [
						{
							kind: "ask",
							id: "ask-size",
							question: size,
							records: [{ variable: "size" }],
							text: [{ kind: "text", text: "How many?" }],
							checks: [],
						},
						...flow,
					],
				},
				{ name: "t", created: "2026-10-18 00:00:00" },
			);
		// A chain of numbers is fields, and isnull of one tests its field.
		const chain = write(
			compute("n", cond("size + 1")),
			compute("m", cond("n * 2", "n")),
			stop("stop-n", cond("isnull(n)", "n")),
		);
		expect(chain.findings).toEqual([]);
		expect(
			flowOutline(chain.qsf).filter(
				(l) => l.includes("EmbeddedData") || l.includes("Branch stop"),
			),
		).toMatchInlineSnapshot(`
			[
			  "  EmbeddedData  n=$e{ (\${q://QID1/ChoiceTextEntryValue} + 1) }",
			  "  EmbeddedData  m=$e{ (\${e://Field/n} * 2) }",
			  "Branch stop if isnull(n): n Empty",
			]
		`);
		// a reads b before b is computed: in the DDI a is null, so it can't be inlined as b's condition.
		const early = write(
			compute("a", cond("b", "b")),
			compute("b", cond("size > 4")),
			stop("stop-a", cond("a", "a")),
		);
		expect(
			early.findings.map((f) => `${f.path}: ${f.message}`),
		).toMatchInlineSnapshot(`
			[
			  "stop-a: \`b\` is read before it's computed, so Qualtrics can't test it here.",
			]
		`);
		// A true-or-false value computed twice has no single value to inline, nor a field to test.
		const twice = write(
			compute("b", cond("size > 4")),
			compute("b", cond("size > 6")),
			stop("stop-b", cond("isnull(b)", "b")),
		);
		expect(
			twice.findings.map((f) => `${f.path}: ${f.message}`),
		).toMatchInlineSnapshot(`
			[
			  "stop-b: \`b\` is computed more than once, so Qualtrics can't test it here.",
			]
		`);
	});

	it("shuffles a question's options, and says rotation is shuffled too", () => {
		const ask = (id: string, options: "random" | "rotate"): Step => ({
			kind: "ask",
			id,
			question: modes,
			records: [
				{ variable: `${id}_b`, code: "b" },
				{ variable: `${id}_w`, code: "w" },
			],
			text: [{ kind: "text", text: "How?" }],
			options,
			checks: [],
		});
		const { sq, findings } = payloads({
			inputs: [],
			flow: [ask("a", "random"), ask("b", "rotate")],
		});
		expect(sq.map((q) => q.Randomization)).toEqual([
			{ Type: "All", Advanced: null, TotalRandSubset: "" },
			{ Type: "All", Advanced: null, TotalRandSubset: "" },
		]);
		expect(
			findings
				.filter((f) => f.code !== "qsf-note")
				.map((f) => `${f.severity} ${f.path}`),
		).toEqual(["warning b"]);
	});

	it("writes a warning check as a statement on its question's page, shown while the check fails", () => {
		const rent: Question = {
			id: "q-rent",
			name: "rent",
			domain: { kind: "number", decimals: 0 },
		};
		const sources = new Map<string, Source>([
			[
				"rent",
				{
					kind: "answer",
					variable: "rent",
					asks: ["ask-rent"],
					question: rent,
				},
			],
		]);
		const { qsf, findings } = writeQsf(
			{
				inputs: [],
				flow: [
					{
						kind: "ask",
						id: "ask-rent",
						question: rent,
						records: [{ variable: "rent" }],
						text: [{ kind: "text", text: "Rent?" }],
						checks: [
							{
								id: "check-1",
								severity: "warning",
								ensure: { expr: parseCondition("rent < 10000").expr, sources },
								message: [{ kind: "text", text: "That's a lot." }],
							},
						],
					},
				],
			},
			{ name: "t", created: "2026-10-18 00:00:00" },
		);
		expect(findings).toEqual([]);
		const elements = qsf.SurveyElements as {
			Element: string;
			Payload: unknown;
		}[];
		const blocks = elements.find((e) => e.Element === "BL")?.Payload as
			| { BlockElements: unknown[] }[]
			| undefined;
		const block = blocks?.[0];
		// One page: no break between the question and its warning.
		expect(block?.BlockElements).toEqual([
			{ Type: "Question", QuestionID: "QID1" },
			{ Type: "Question", QuestionID: "QID2" },
		]);
		const warning = elements.find(
			(e) =>
				e.Element === "SQ" &&
				(e.Payload as { QuestionID: string }).QuestionID === "QID2",
		)?.Payload as {
			QuestionText: string;
			InPageDisplayLogic: {
				inPage: boolean;
				"0": { "0": Record<string, string> };
			};
		};
		expect(warning.QuestionText).toBe("That's a lot.");
		expect(warning.InPageDisplayLogic.inPage).toBe(true);
		expect(warning.InPageDisplayLogic["0"]["0"]).toMatchObject({
			Operator: "GreaterThanOrEqual",
			RightOperand: "10000",
		});
	});

	it("writes a blocking check as custom validation, the number's range folded in", () => {
		const rent: Question = {
			id: "q-rent",
			name: "rent",
			domain: { kind: "number", min: 0, max: 50000, decimals: 0 },
		};
		const sources = new Map<string, Source>([
			[
				"rent",
				{
					kind: "answer",
					variable: "rent",
					asks: ["ask-rent"],
					question: rent,
				},
			],
		]);
		const { sq, findings } = payloads({
			inputs: [],
			flow: [
				{
					kind: "ask",
					id: "ask-rent",
					question: rent,
					records: [{ variable: "rent" }],
					text: [{ kind: "text", text: "Rent?" }],
					checks: [
						{
							id: "check-1",
							severity: "blocking",
							ensure: { expr: parseCondition("rent <> 13").expr, sources },
							message: [{ kind: "text", text: "Not 13." }],
						},
					],
				},
			],
		});
		const validation = sq[0]?.Validation as
			| { Settings: Record<string, unknown> }
			| undefined;
		const settings = validation?.Settings ?? {};
		expect(settings.Type).toBe("CustomValidation");
		const logic = (
			settings.CustomValidation as {
				Logic: {
					"0": Record<
						string,
						{ Operator?: string; RightOperand?: string; Conjuction?: string }
					>;
				};
			}
		).Logic["0"];
		expect(
			Object.values(logic)
				.filter((x) => typeof x === "object")
				.map((x) =>
					`${x.Conjuction ?? ""} ${x.Operator} ${x.RightOperand ?? ""}`.trim(),
				),
		).toMatchInlineSnapshot(`
			[
			  "NotEqualTo 13",
			  "And GreaterThanOrEqual 0",
			  "And LessThanOrEqual 50000",
			  "Or Empty",
			]
		`);
		expect(
			findings.map((f) => `${f.severity} ${f.path}: ${f.message}`),
		).toMatchInlineSnapshot(`
			[
			  "warning ask-rent: With its checks, Qualtrics no longer refuses an answer that isn't a number here.",
			  "info check-1: Qualtrics shows its own message when this check fails: a custom validation's message comes from a library.",
			]
		`);
	});

	it("shuffles a section of questions with Qualtrics' block randomizer, a Default block first", () => {
		const ask = (id: string): Step => ({
			kind: "ask",
			id,
			question: { ...modes, name: id },
			records: [
				{ variable: `${id}_b`, code: "b" },
				{ variable: `${id}_w`, code: "w" },
			],
			text: [{ kind: "text", text: `${id}?` }],
			checks: [],
		});
		const { qsf, findings } = writeQsf(
			{
				inputs: [],
				flow: [
					{
						kind: "section",
						id: "s",
						title: "Travel",
						order: "rotate",
						flow: [ask("a"), ask("b"), ask("c")],
					},
				],
			},
			{ name: "t", created: "2026-10-18 00:00:00" },
		);
		expect(flowOutline(qsf)).toMatchInlineSnapshot(`
			[
			  "Block BL_qretools000001",
			  "BlockRandomizer",
			  "  Standard BL_qretools000002",
			  "  Standard BL_qretools000003",
			  "  Standard BL_qretools000004",
			]
		`);
		expect(findings.map((f) => `${f.severity} ${f.path}`)).toEqual([
			"warning s",
		]);
	});
});
