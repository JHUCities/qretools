import { describe, expect, it } from "vitest";
import schemaText from "../ddi/ddi-lifecycle-4.0-beta4.schema.json?raw";
import type { DdiDocument, JsonObject } from "./ddi/document.ts";
import { elaborate } from "./ddi/elaborate.ts";
import { asList, asObj, ddiIndexOf } from "./ddi/read.ts";
import { makeValidator } from "./ddi/validate.ts";
import { bankOf, evaluate } from "./evaluate.ts";
import { instrumentOf } from "./instrument/instrument.ts";
import { readInstruments, type Step } from "./instrument/read.ts";
import { DEFAULT_SELECT_ALL } from "./selectAll.ts";
import { definedVariables } from "./surface/draft.ts";
import { EMPTY_ENV } from "./surface/env.ts";

const head =
	"name: commute\ntext: How do you get to work?\nintent: Modes of transport adults use\n";
const one = `${head}responses:\n  "1": Bus\n  "4":\n    label: Other (please specify)\n    specify: true\n`;
const many = `${head}select: many\nresponses:\n  "1":\n    label: Bus\n    variable: commute_bus\n  "4":\n    label: Other (please specify)\n    specify: true\n`;

const said = (source: string) =>
	evaluate(source, EMPTY_ENV).findings.map(
		(f) => `${f.severity}:${f.code}@${f.path}`,
	);
const variables = (source: string) =>
	definedVariables(evaluate(source, EMPTY_ENV).draft).map(
		(d) => `${d.kind}:${d.name}@${d.path}`,
	);

describe("a box beside an option", () => {
	it("is a text variable after the question's, in select one", () => {
		expect(said(one)).toEqual([]);
		expect(variables(one)).toEqual([
			"question:commute@name",
			"specify:commute_4_text@responses.4.specify",
		]);
	});

	it("follows its option's variable, right after it, in select all that apply", () => {
		const boxed = many.replace(
			"specify: true",
			"variable: commute_oth\n    specify: true",
		);
		expect(variables(boxed)).toEqual([
			"option:commute_bus@responses.1",
			"option:commute_oth@responses.4",
			"specify:commute_oth_text@responses.4.specify",
		]);
	});

	it("is named from the question in select one, where an option's `variable` is ignored", () => {
		expect(
			variables(one.replace("specify: true", "variable: x\n    specify: true")),
		).toContain("specify:commute_4_text@responses.4.specify");
	});

	it("takes a name of its own, or `{}` for the default", () => {
		expect(
			variables(
				one.replace("specify: true", "specify: { variable: commute_else }"),
			),
		).toContain("specify:commute_else@responses.4.specify");
		expect(variables(one.replace("specify: true", "specify: {}"))).toContain(
			"specify:commute_4_text@responses.4.specify",
		);
	});

	it("is a hole written empty, advice written false, an error with a bad name", () => {
		expect(said(one.replace("specify: true", "specify:"))).toContain(
			"hole:hole@responses.4.specify",
		);
		expect(said(one.replace("specify: true", "specify: false"))).toEqual([
			"warning:ignored-key@responses.4.specify",
		]);
		expect(variables(one.replace("specify: true", "specify: false"))).toEqual([
			"question:commute@name",
		]);
		expect(
			said(one.replace("specify: true", "specify: { variable: Bad-Name }")),
		).toContain("error:wrong-type@responses.4.specify.variable");
	});

	it("can't share a name with another of the question's variables", () => {
		expect(
			said(one.replace("specify: true", "specify: { variable: commute }")),
		).toEqual(["warning:duplicate-option-variable@responses.4.specify"]);
	});

	it("keeps a list from being offered as a shared scale, which can't hold the box", () => {
		const env = {
			...EMPTY_ENV,
			scales: {
				modes: {
					codes: [
						{ code: "1", label: "Bus" },
						{ code: "4", label: "Other (please specify)" },
					],
				},
			},
		};
		const codes = (source: string) =>
			evaluate(source, env).findings.map((f) => f.code);
		expect(codes(one)).not.toContain("matches-scale");
		expect(codes(one.replace("    specify: true\n", ""))).toContain(
			"matches-scale",
		);
	});
});

describe("its DDI", () => {
	const validator = makeValidator(JSON.parse(schemaText));
	const ddiOf = (source: string): DdiDocument => {
		const draft = evaluate(source, EMPTY_ENV).draft;
		const items = elaborate(draft, "org.example", [], DEFAULT_SELECT_ALL);
		return items;
	};
	const item = (doc: DdiDocument, type: keyof DdiDocument, id: string) =>
		(doc[type]?.[`org.example:${id}:1`] ?? {}) as JsonObject;

	it("joins the list and the box as DDI's mixed domain, and validates", () => {
		const doc = ddiOf(one);
		expect(validator.ok && validator.value(doc)).toEqual([]);
		const question = item(doc, "QuestionItem", "commute");
		expect(question.ResponseDomain).toBeUndefined();
		const mixed = (question.StructuredMixedResponseDomain as JsonObject)
			.ResponseDomainInMixed as JsonObject[];
		expect(mixed).toHaveLength(2);
		expect(mixed[0]?.AttachmentBase).toBe(1);
		expect(mixed[1]).toMatchObject({
			ResponseDomain: [{ $type: "TextDomain" }],
			AttachmentLocation: {
				DomainSpecificValue: [
					{ Value: [{ StringValue: "4" }], AttachmentDomain: 1 },
				],
			},
		});
	});

	it("records the typed text as a text variable, labelled by its option, through the box's own parameter", () => {
		const doc = ddiOf(one);
		const v = item(doc, "Variable", "variable-commute_4_text");
		expect(JSON.stringify(v.Label)).toContain("Other (please specify)");
		expect(v.Description).toBeUndefined();
		expect(
			(v.VariableRepresentation as JsonObject).ValueRepresentation,
		).toEqual({ $type: "TextDomain" });
		const question = item(doc, "QuestionItem", "commute");
		const box = (
			(question.StructuredMixedResponseDomain as JsonObject)
				.ResponseDomainInMixed as JsonObject[]
		)[1]?.ResponseDomain as JsonObject[];
		const parameter = box[0]?.OutParameter as JsonObject;
		expect(parameter.ID).toBe("commute.out-commute_4_text");
		expect((v.SourceParameterReference as JsonObject).ID).toBe(parameter.ID);
		// The question's own outputs are its options', never the box's.
		expect((question.OutParameter as JsonObject[]).map((p) => p.ID)).toEqual([
			"commute.out-commute",
		]);
	});

	it("leaves a question without a box as it was", () => {
		const plain = ddiOf(one.replace("    specify: true\n", ""));
		const question = item(plain, "QuestionItem", "commute");
		expect(question.StructuredMixedResponseDomain).toBeUndefined();
		expect(question.ResponseDomain).toBeDefined();
	});

	it("gives each box its own parameter, even while two options share a code", () => {
		const repeated = `${head}responses:\n  "4":\n    label: Other\n    specify: { variable: a_text }\n  "4 ":\n    label: Else\n    specify: { variable: b_text }\n`;
		const doc = ddiOf(repeated.replace('"4 "', "4"));
		const boxes = (
			(
				item(doc, "QuestionItem", "commute")
					.StructuredMixedResponseDomain as JsonObject
			).ResponseDomainInMixed as JsonObject[]
		)
			.slice(1)
			.map((m) => asObj(asObj(asList(m.ResponseDomain)[0])?.OutParameter)?.ID);
		expect(boxes).toEqual(["commute.out-a_text", "commute.out-b_text"]);
	});

	it("validates in select all that apply", () => {
		expect(validator.ok && validator.value(ddiOf(many))).toEqual([]);
	});
});

describe("an instrument that asks it", () => {
	const bank = bankOf({
		"workspace.yaml": "agency: org.bank\n",
		"questions/a/commute.yaml": one,
		"questions/a/modes.yaml": many.replace("name: commute", "name: modes"),
	});
	const ask = (source: string) =>
		instrumentOf(source, { banks: { b: bank }, agency: "org.example" });

	it("reads the question's options back, and the box's text as words", () => {
		const { ddi, findings } = ask(
			"name: i\nuses:\n  b: here\nflow:\n  - ask: b.commute\n  - ask: b.modes\n",
		);
		expect(findings.filter((f) => f.severity === "error")).toEqual([]);
		const read = readInstruments(ddiIndexOf(ddi));
		const asks = (read.value.instruments[0]?.flow ?? []).filter(
			(s): s is Extract<Step, { kind: "ask" }> => s.kind === "ask",
		);
		expect(asks.map((a) => a.question.domain.kind)).toEqual([
			"choice",
			"choice",
		]);
		// The box's text names the option it's beside, and is marked typed: never a tick.
		const shown = (r: { variable: string; code?: string; typed?: true }) =>
			`${r.variable}:${r.code ?? "-"}${r.typed ? ":typed" : ""}`;
		expect(asks.map((a) => a.records.map(shown))).toEqual([
			["commute:-", "commute_4_text:4:typed"],
			["commute_bus:1", "modes_4:4", "modes_4_text:4:typed"],
		]);
	});

	it("types the box's text as words in a condition", () => {
		const { findings } = ask(
			"name: i\nuses:\n  b: here\nflow:\n  - ask: b.commute\n  - if: isnull(b.commute_4_text)\n    then:\n      - say: Nothing typed.\n",
		);
		expect(findings.filter((f) => f.severity === "error")).toEqual([]);
	});

	it("refuses `as` on it for now", () => {
		const { findings } = ask(
			"name: i\nuses:\n  b: here\nflow:\n  - ask: b.commute\n    as: again\n",
		);
		expect(findings.map((f) => f.code)).toContain("not-yet");
	});
});
