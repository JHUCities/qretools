import { describe, expect, it } from "vitest";
import schemaText from "../../ddi/ddi-lifecycle-4.0-beta4.schema.json?raw";
import { elaborate } from "../ddi/elaborate.js";
import { makeValidator } from "../ddi/validate.js";
import { locate } from "../findings.js";
import { codebookView, respondentView } from "../render.js";
import { EMPTY_ENV } from "./env.js";
import { piecesOf, withoutFills } from "./fills.js";
import { parseSurface } from "./parse.js";

const question = (text: string, fills = "fills:\n  rent: number\n") =>
	`name: q\ntext: ${text}\nintent: i\nopen: {}\n${fills}`;
const RENT = question(
	"You said you pay {{rent}} a month. Does that include utilities?",
);

const validator = makeValidator(JSON.parse(schemaText));

describe("fills", () => {
	it("are declared with a type and written in the text", () => {
		const { draft, findings } = parseSurface(RENT, EMPTY_ENV);
		expect(findings).toEqual([]);
		expect(draft.fills).toEqual([{ name: "rent", type: "number" }]);
		expect(piecesOf(draft.text ?? "", draft.fills ?? [])).toEqual([
			{ kind: "words", text: "You said you pay " },
			{ kind: "fill", name: "rent", type: "number" },
			{ kind: "words", text: " a month. Does that include utilities?" },
		]);
	});

	it("a placeholder no fill declares is a hole where it's written", () => {
		const source = question("You pay {{rnt}} a month?");
		const { findings, ranges } = parseSurface(source, EMPTY_ENV);
		const hole = findings.find((f) => f.severity === "hole");
		expect(hole?.path).toBe("text");
		expect(hole && source.slice(...locate(hole, ranges))).toBe("{{rnt}}");
		// And the declared one it was meant to be is unused.
		expect(
			findings.filter((f) => f.code === "fill-unused").map((f) => f.path),
		).toEqual(["fills.rent"]);
	});

	it("a type is checked, and written empty is a hole", () => {
		const bad = parseSurface(
			question("{{rent}}?", "fills:\n  rent: money\n").replace(
				"text: {{rent}}?",
				'text: "{{rent}}?"',
			),
			EMPTY_ENV,
		);
		expect(bad.findings.map((f) => [f.severity, f.code, f.path])).toEqual([
			["error", "fill-type", "fills.rent"],
		]);
		const empty = parseSurface(
			question('"{{rent}}?"', "fills:\n  rent:\n"),
			EMPTY_ENV,
		);
		expect(empty.findings.map((f) => [f.severity, f.path])).toEqual([
			["hole", "fills.rent"],
		]);
		expect(
			parseSurface(question("Hi?", "fills:\n"), EMPTY_ENV).findings.map(
				(f) => f.path,
			),
		).toEqual(["fills"]);
	});

	it("a malformed name under fills is an error; in the text it's the author's words", () => {
		const { findings } = parseSurface(
			question("In {{CURRENT MONTH}}, did you?", "fills:\n  Rent: number\n"),
			EMPTY_ENV,
		);
		expect(findings.map((f) => [f.code, f.path])).toEqual([
			["fill-name", "fills.Rent"],
		]);
		expect(
			parseSurface(question("In {{CURRENT MONTH}}, did you?", ""), EMPTY_ENV)
				.findings,
		).toEqual([]);
	});

	it("text that starts with a fill is told to quote, and quoted it reads", () => {
		const { findings } = parseSurface(
			question("{{rent}} a month: is that right?"),
			EMPTY_ENV,
		);
		const leading = findings.find((f) => f.path === "text");
		expect(leading?.message).toBe("Text that starts with a fill needs quotes.");
		expect(leading?.hint).toContain('"{{rent}} a month: is that right?"');
		const after = parseSurface(
			question('"{{rent}} a month: is that right?"'),
			EMPTY_ENV,
		);
		expect(after.findings).toEqual([]);
		expect(after.draft.text).toBe("{{rent}} a month: is that right?");
	});

	it("are found in the source whatever the scalar's style", () => {
		for (const text of [
			'"You pay {{rent}}?"',
			"'You pay {{rent}}?'",
			">\n  You pay\n  {{rent}}?",
			"|\n  You pay {{rent}}?",
		]) {
			const source = question(text);
			const { findings, marks } = parseSurface(source, EMPTY_ENV);
			expect([text, findings]).toEqual([text, []]);
			const fill = marks
				.filter((m) => m.kind === "fill")
				.map((m) => source.slice(...m.range));
			expect([text, fill]).toEqual([
				text,
				["{{rent}}", "rent"].sort(
					(a, b) => source.indexOf(a) - source.indexOf(b),
				),
			]);
		}
	});

	it("show as the gap they are in the previews", () => {
		const { draft } = parseSurface(RENT, EMPTY_ENV);
		const respondent = respondentView(draft);
		expect(
			respondent.text.kind === "filled" && respondent.text.pieces?.[1],
		).toEqual({
			kind: "fill",
			name: "rent",
			type: "number",
		});
		const codebook = codebookView(draft, EMPTY_ENV);
		expect(
			codebook.text.kind === "filled" && codebook.text.pieces,
		).toHaveLength(3);
		const plain = respondentView(
			parseSurface(question("Hi?", ""), EMPTY_ENV).draft,
		);
		expect(plain.text).toEqual({ kind: "filled", text: "Hi?" });
	});

	it("are parameters of the question in DDI, named in its text", () => {
		const ddi = elaborate(
			parseSurface(RENT, EMPTY_ENV).draft,
			"org.example",
			[],
		);
		expect(validator.ok && validator.value(ddi)).toEqual([]);
		const q = ddi.QuestionItem?.["org.example:q:1"] ?? {};
		const parameter = {
			URN: "urn:ddi:org.example:q.fill-rent:1",
			Agency: "org.example",
			ID: "q.fill-rent",
			Version: "1",
		};
		expect(q.InParameter).toEqual([
			{
				...parameter,
				ParameterName: [
					{
						String: [
							{ MultilingualStringValue: { LanguageTag: "en", Value: "rent" } },
						],
					},
				],
				Alias: "rent",
				ValueRepresentation: { $type: "NumericDomain" },
			},
		]);
		const words = (text: string) => ({
			Text: { MultilingualStringValue: { LanguageTag: "en", Value: text } },
		});
		expect(q.QuestionText).toEqual([
			{
				TextContent: [
					words("You said you pay "),
					{ SourceParameterReference: parameter },
					words(" a month. Does that include utilities?"),
				],
			},
		]);
	});

	it("leave a question without them exactly as it was", () => {
		const ddi = elaborate(
			parseSurface(question("Hi {{x}}?", ""), EMPTY_ENV).draft,
			"org.example",
			[],
		);
		const q = ddi.QuestionItem?.["org.example:q:1"] ?? {};
		expect(q).not.toHaveProperty("InParameter");
		expect(q.QuestionText).toEqual([
			{
				TextContent: [
					{
						Text: {
							MultilingualStringValue: {
								LanguageTag: "en",
								Value: "Hi {{x}}?",
							},
						},
					},
				],
			},
		]);
	});

	it("a name declared twice is said once; the first stands", () => {
		const { draft, findings } = parseSurface(
			question("You pay {{rent}}?", "fills:\n  rent: number\n  rent: text\n"),
			EMPTY_ENV,
		);
		expect(draft.fills).toEqual([{ name: "rent", type: "number" }]);
		expect(
			findings.filter((f) => f.path === "fills.rent").map((f) => f.code),
		).toEqual(["fill-name"]);
	});

	it("aren't words the respondent reads, for advice on wording", () => {
		expect(withoutFills("Do you rent {{x}} and {{ CURRENT MONTH }}?")).toBe(
			"Do you rent  and ?",
		);
	});
});
