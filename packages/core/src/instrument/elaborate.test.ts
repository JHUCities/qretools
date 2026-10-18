import { describe, expect, it } from "vitest";
import schemaText from "../../ddi/ddi-lifecycle-4.0-beta4.schema.json?raw";
import type { JsonObject } from "../ddi/document.ts";
import { makeValidator } from "../ddi/validate.ts";
import { bankOf } from "../evaluate.ts";
import { checkInstrument } from "./check.ts";
import { elaborateInstrument, instrumentDocument } from "./elaborate.ts";
import { parseInstrument } from "./parse.ts";

const schema = JSON.parse(schemaText) as {
	$defs: Record<
		string,
		{ properties?: Record<string, unknown>; allOf?: { $ref?: string }[] }
	>;
};
const validator = makeValidator(schema);

const q = (name: string, rest: string) =>
	`name: ${name}\ntext: ${name}?\nintent: i\n${rest}`;
const BAS = bankOf({
	"workspace.yaml": "agency: org.bank\n",
	"missing.yaml": 'labels:\n  "-8": Refused\n',
	"scales/yesno01.yaml": 'labels:\n  "0": No\n  "1": Yes\n',
	"universes/renters.yaml": "text: Renters\n",
	"questions/a/consent.yaml": q(
		"consent",
		'responses:\n  "1": Yes\n  "2": No\n',
	),
	"questions/a/tenure.yaml": q(
		"tenure",
		'responses:\n  "1": Own\n  "2": Rent\n',
	),
	"questions/a/rent.yaml": q("rent", "number: {}\nuniverse: renters\n"),
	"questions/a/why.yaml": q("why", "open: {}\n"),
	"questions/a/modes.yaml": q(
		"modes",
		'select: many\nresponses:\n  "b": Bus\n  "w": Walk\n',
	),
	"questions/a/util.yaml":
		'name: util\ntext: "You pay {{rent}}. Utilities included?"\nintent: i\nopen: {}\nfills:\n  rent: number\n',
	"questions/a/echo.yaml":
		'name: echo\ntext: "You selected {{neighborhood}}."\nintent: i\nopen: {}\nfills:\n  neighborhood: text\n',
});

const SOURCE = `name: demo
title: A demonstration
description: Every construct of the language, once.
uses:
  bas: here
inputs:
  jurisdiction:
    responses:
      "1": City
      "2": County
  wave:
    number: {}
flow:
  - say: Thank you for taking part, in {{jurisdiction}}.
  - ask: bas.consent
  - stop: bas.consent = "2"
    say: Thank you for your time.
  - section: Housing
    order: random
    flow:
      - ask: bas.tenure
      - compute: renter
        value: bas.tenure = "2"
      - if: renter
        then:
          - ask: bas.rent
            universe: bas.renters
            seconds: 20
            checks:
              - ensure: bas.rent >= 0
                severity: blocking
                message: The rent can't be negative.
              - ensure: bas.rent < 10000
                severity: warning
                message: "{{bas.rent}} is a lot. Is that right?"
          - ask: bas.util
            universe: bas.renters
            fill:
              rent: bas.rent
        else:
          if: bas.tenure = "1"
          then:
            - ask: bas.modes
          else:
            - say: Neither, then.
  - ask: bas.why
    options: rotate
  - ask: bas.why
    as: why_end
`;

const build = () => {
	const parsed = parseInstrument(SOURCE, { bas: BAS });
	const findings = [...parsed.findings, ...checkInstrument(parsed)].filter(
		(f) => f.severity !== "info",
	);
	const e = elaborateInstrument(parsed, { agency: "org.example" });
	return { findings, e, ...instrumentDocument(e) };
};

/** The constructs of a flow: DDI's ControlConstruct substitution group, as we emit it. */
const CONSTRUCTS = [
	"QuestionConstruct",
	"StatementItem",
	"ComputationItem",
	"IfThenElse",
	"Sequence",
	"Loop",
	"RepeatUntil",
];

/** Every object in a document, however deep. */
function* objects(x: unknown): Generator<JsonObject> {
	if (Array.isArray(x)) for (const v of x) yield* objects(v);
	else if (x !== null && typeof x === "object") {
		yield x as JsonObject;
		for (const v of Object.values(x)) yield* objects(v);
	}
}

/** The properties a schema definition allows, its bases' included. */
function allowed(name: string): Set<string> {
	const out = new Set<string>();
	const walk = (n: string) => {
		const def = schema.$defs[n];
		if (def === undefined) return;
		for (const k of Object.keys(def.properties ?? {})) out.add(k);
		for (const a of def.allOf ?? [])
			if (a.$ref) walk(a.$ref.split("/").at(-1) ?? "");
	};
	walk(name);
	return out;
}

describe("an instrument as DDI", () => {
	it("is valid against the official schema, with nothing to fix first", () => {
		const { findings, document, collisions } = build();
		expect(
			Object.fromEntries(
				Object.entries(document).map(([type, items]) => [
					type,
					Object.keys(items ?? {}).length,
				]),
			),
		).toMatchInlineSnapshot(`
			{
			  "Category": 15,
			  "CodeList": 7,
			  "ComputationItem": 1,
			  "IfThenElse": 4,
			  "Instrument": 1,
			  "ManagedMissingValuesRepresentation": 1,
			  "QuestionConstruct": 7,
			  "QuestionItem": 6,
			  "RepeatUntil": 1,
			  "Sequence": 10,
			  "StatementItem": 5,
			  "Universe": 1,
			  "Variable": 10,
			}
		`);
		expect(findings).toEqual([]);
		expect(validator.ok && validator.value(document)).toEqual([]);
		expect(collisions).toEqual([]);
		expect(Object.keys(document.Instrument ?? {})).toEqual([
			"org.example:instrument-demo:1",
		]);
	});

	it("uses only properties its types declare (the schema doesn't check most)", () => {
		const { document } = build();
		// A construct also has ControlConstruct's properties (its name, its bindings): DDI
		// 4.0 says so, though the JSON schema's construct types don't inherit them.
		for (const [type, items] of Object.entries(document)) {
			const ok = new Set([
				...allowed(type),
				...allowed("Versionable"),
				...(CONSTRUCTS.includes(type) ? allowed("ControlConstruct") : []),
			]);
			for (const it of Object.values(items ?? {}))
				for (const key of Object.keys(it))
					expect([type, key, ok.has(key)]).toEqual([type, key, true]);
		}
	});

	it("resolves every reference and every parameter it binds", () => {
		const { document } = build();
		const items = new Set(
			Object.entries(document).flatMap(([type, byKey]) =>
				Object.keys(byKey ?? {}).map((k) => `${type} ${k}`),
			),
		);
		const identities = new Set<string>();
		for (const o of objects(document))
			if (typeof o.URN === "string") identities.add(o.URN);
		for (const o of objects(document)) {
			if (typeof o.$type === "string" && Array.isArray(o.value)) {
				const [a, id, v] = o.value as string[];
				expect([o.$type, id, items.has(`${o.$type} ${a}:${id}:${v}`)]).toEqual([
					o.$type,
					id,
					true,
				]);
			}
			for (const key of [
				"SourceParameterReference",
				"TargetParameterReference",
			]) {
				const p = o[key] as JsonObject | undefined;
				if (p !== undefined)
					expect([key, p.URN, identities.has(p.URN as string)]).toEqual([
						key,
						p.URN,
						true,
					]);
			}
		}
	});

	it("keeps DDI's one dot in every identity, nested parameters included", () => {
		const { document } = build();
		for (const o of objects(document))
			if (typeof o.ID === "string")
				expect([o.ID, o.ID.split(".").length <= 2]).toEqual([o.ID, true]);
	});

	it("writes conditions as VTL over the variables' names, never a hole or a bank alias", () => {
		const { document } = build();
		const commands = [...objects(document)].flatMap((o) =>
			typeof o.CommandContent === "string" ? [o.CommandContent] : [],
		);
		expect(commands).toContain('consent = "2"');
		expect(commands).toContain("not nvl(rent < 10000, true)");
		expect(commands).toContain("nvl(rent >= 0, true)");
		for (const c of commands) {
			expect(c).not.toContain("?");
			expect(c).not.toMatch(/\bbas\./);
		}
	});

	it("is valid with the inheritance DDI describes, so a construct's bindings are checked too", () => {
		const { document } = build();
		const inherited = JSON.parse(JSON.stringify(schema)) as typeof schema;
		for (const type of CONSTRUCTS) {
			const def = inherited.$defs[type];
			if (def !== undefined)
				def.allOf = [
					...(def.allOf ?? []),
					{ $ref: "#/$defs/ControlConstruct" },
				];
		}
		const strict = makeValidator(inherited);
		expect(strict.ok && strict.value(document)).toEqual([]);
	});

	it("links each answer to the asks that record it and, for an option, its code", () => {
		const { document } = build();
		// Definitions only: a reference carries the same identity as what it names.
		const byId = new Map<string, JsonObject>();
		for (const o of objects(document))
			if (
				typeof o.ID === "string" &&
				typeof o.URN === "string" &&
				("ParameterName" in o ||
					"CategoryReference" in o ||
					"QuestionItemName" in o)
			)
				byId.set(o.ID, o);
		const idOf = (r: unknown) => (r as JsonObject | undefined)?.ID as string;
		const constructs = Object.values(document.QuestionConstruct ?? {});
		const read = Object.values(document.Variable ?? {}).flatMap((v) => {
			if (v.QuestionReference === undefined) return [];
			const name = [...objects(v.VariableName)].find(
				(o) => "Value" in o,
			)?.Value;
			const out = idOf(v.OutParameter);
			// Only what the fields say: the asks binding into this variable's output…
			const asks = constructs.flatMap((c) =>
				((c.Binding ?? []) as JsonObject[])
					.filter((b) => idOf(b.TargetParameterReference) === out)
					.map((b) => ({ c, source: idOf(b.SourceParameterReference) })),
			);
			for (const { c, source } of asks) {
				// …each from the output of the question it asks, the one the variable says.
				const question = (c.QuestionReference as JsonObject).value as string[];
				const outputs = (
					(byId.get(question[1] ?? "")?.OutParameter ?? []) as JsonObject[]
				).map(idOf);
				expect(outputs).toContain(source);
				expect(source).toBe(idOf(v.SourceParameterReference));
			}
			// …and an option's output names its code.
			const code = [...objects(byId.get(idOf(v.SourceParameterReference)))]
				.flatMap((o) => (o.CodeReference ?? []) as JsonObject[])
				.map((r) => byId.get(idOf(r)));
			const value = (code[0]?.Value as JsonObject | undefined)?.StringValue;
			return [
				[
					name,
					asks.map(({ c }) => String(c.ID).split(".").at(-1)),
					...(value === undefined ? [] : [value]),
				],
			];
		});
		expect(read).toEqual([
			["consent", ["ask-consent"]],
			["tenure", ["ask-tenure"]],
			["rent", ["ask-rent"]],
			["util", ["ask-util"]],
			["modes_b", ["ask-modes"], "b"],
			["modes_w", ["ask-modes"], "w"],
			["why", ["ask-why"]],
			["why_end", ["ask-why_end"]],
		]);
		// Exclusive branches may ask one question: one variable, recorded by both asks.
		const branches = instrumentDocument(
			elaborateInstrument(
				parseInstrument(
					'name: x\nuses:\n  bas: here\nflow:\n  - ask: bas.consent\n  - if: bas.consent = "1"\n    then:\n      - ask: bas.why\n    else:\n      - ask: bas.why\n',
					{ bas: BAS },
				),
				{ agency: "org.example" },
			),
		).document;
		const why = Object.values(branches.Variable ?? {}).filter((v) =>
			String(v.ID).endsWith("var-why"),
		);
		expect(why).toHaveLength(1);
		const out = (why[0]?.OutParameter as JsonObject | undefined)?.ID;
		const into = Object.values(branches.QuestionConstruct ?? {}).filter((c) =>
			((c.Binding ?? []) as JsonObject[]).some(
				(b) => (b.TargetParameterReference as JsonObject).ID === out,
			),
		);
		expect(into).toHaveLength(2);
	});

	it("says what each branch is for: a stop, or a check's severity; a plain if says nothing", () => {
		const { document } = build();
		const kinds = Object.values(document.IfThenElse ?? {}).map(
			(b): [string, string | undefined] => [
				String(b.ID).split(".").at(-1) ?? "",
				(b.TypeOfIfThenElse as JsonObject | undefined)?.StringValue as
					| string
					| undefined,
			],
		);
		expect(kinds).toEqual(
			expect.arrayContaining([
				["stop-1", "stop"],
				["ask-rent-check-1", "blocking"],
				["ask-rent-check-2", "warning"],
			]),
		);
		// An if the author wrote has no kind: a reader never takes it for a stop.
		const ifs = kinds.filter(([id]) => id.startsWith("if"));
		expect(ifs.length).toBeGreaterThan(0);
		expect(ifs.every(([, kind]) => kind === undefined)).toBe(true);
	});

	it("records each answer once, in a Variable of its own, never the bank's", () => {
		const { document } = build();
		const variables = Object.values(document.Variable ?? {}).map((v) => v.ID);
		expect(variables.sort()).toEqual(
			[
				"consent",
				"jurisdiction",
				"modes_b",
				"modes_w",
				"rent",
				"tenure",
				"util",
				"wave",
				"why",
				"why_end",
			].map((n) => `instrument-demo.var-${n}`),
		);
	});

	it("lowers label(source) to an instrument-owned text variable before its ask", () => {
		const parsed = parseInstrument(
			`name: labels
uses:
  bas: here
flow:
  - ask: bas.tenure
    as: selected_neighborhood
  - ask: bas.echo
    fill:
      neighborhood: label(selected_neighborhood)
`,
			{ bas: BAS },
		);
		expect([...parsed.findings, ...checkInstrument(parsed)]).toEqual([]);
		const { document } = instrumentDocument(
			elaborateInstrument(parsed, { agency: "org.example" }),
		);
		expect(validator.ok && validator.value(document)).toEqual([]);
		const conditions = Object.values(document.IfThenElse ?? {}).flatMap(
			(item) => (item.IfCondition as JsonObject | undefined)?.Command ?? [],
		);
		expect(conditions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					CommandContent: 'selected_neighborhood = "1"',
				}),
				expect.objectContaining({
					CommandContent: 'selected_neighborhood = "2"',
				}),
			]),
		);
		expect(
			[...objects(document)].some((item) => item.CommandContent === '"Own"'),
		).toBe(true);
		const displayVariable = Object.values(document.Variable ?? {}).find(
			(item) => String(item.ID).endsWith("var-display_label_1"),
		);
		expect(displayVariable?.VariableRepresentation).toEqual({
			ValueRepresentation: { $type: "TextDomain" },
		});
		const echo = Object.values(document.QuestionConstruct ?? {}).find((item) =>
			String(item.ID).endsWith("ask-echo"),
		);
		// The fill binds into the question; its answer, out of it into the instrument's variable.
		expect(echo?.Binding).toMatchObject([
			{
				SourceParameterReference: {
					ID: "instrument-labels.out-display_label_1",
				},
			},
			{
				SourceParameterReference: { ID: "echo.out-echo" },
				TargetParameterReference: { ID: "instrument-labels.out-echo" },
			},
		]);

		const qualified = parseInstrument(
			`name: qualified
uses:
  bas: here
flow:
  - ask: bas.tenure
  - ask: bas.echo
    fill:
      neighborhood: label(bas.tenure)
`,
			{ bas: BAS },
		);
		const qualifiedDocument = instrumentDocument(
			elaborateInstrument(qualified, { agency: "org.example" }),
		).document;
		expect(validator.ok && validator.value(qualifiedDocument)).toEqual([]);
		for (const item of objects(qualifiedDocument))
			if (typeof item.ID === "string")
				expect(item.ID.split(".").length).toBeLessThanOrEqual(2);
	});

	it("shows a label only for an answer that has one: reset first, no missing-value words, no borrowed name", () => {
		const bank = bankOf({
			"workspace.yaml": "agency: org.example\n",
			"missing.yaml": 'labels:\n  "-8": Refused\n',
			"questions/h/tenure.yaml":
				'name: tenure\ntext: Do you own or rent?\nintent: i\nresponses:\n  "1": Own\n  "2": Rent\n',
			"questions/h/echo.yaml":
				'name: echo\ntext: "You selected {{neighborhood}}."\nintent: i\nopen: {}\nfills:\n  neighborhood: text\n',
		});
		const parsed = parseInstrument(
			`name: rows
uses:
  bas: here
flow:
  - compute: display_label_1
    value: 1
  - ask: bas.tenure
  - if: bas.tenure = "-8"
    then:
      - say: A missing-value code is still an answer a condition may test.
  - ask: bas.echo
    fill:
      neighborhood: label(bas.tenure)
`,
			{ bas: bank },
		);
		expect([...parsed.findings, ...checkInstrument(parsed)]).toEqual([]);
		const { document } = instrumentDocument(
			elaborateInstrument(parsed, { agency: "org.example" }),
		);
		expect(validator.ok && validator.value(document)).toEqual([]);
		const commands = [...objects(document)].flatMap((o) =>
			typeof o.CommandContent === "string" ? [o.CommandContent] : [],
		);
		// "Refused" is the bank's word for the data, never the respondent's.
		expect(commands).not.toContain('"Refused"');
		expect(commands).toContain('"Own"');
		// The author's `display_label_1` keeps its name; the generated value takes the next.
		const echo = Object.values(document.QuestionConstruct ?? {}).find((item) =>
			String(item.ID).endsWith("ask-echo"),
		);
		// The fill binds into the question; its answer, out of it into the instrument's variable.
		expect(echo?.Binding).toMatchObject([
			{
				SourceParameterReference: {
					ID: "instrument-rows.out-display_label_2",
				},
			},
			{
				SourceParameterReference: { ID: "echo.out-echo" },
				TargetParameterReference: { ID: "instrument-rows.out-echo" },
			},
		]);
		// The lookup starts by forgetting the last answer's label (a roster's next row).
		const lookup = Object.values(document.Sequence ?? {}).find((item) =>
			String(item.ID).endsWith("label-bas_tenure"),
		);
		const steps = (
			(lookup?.ControlConstructReference ?? []) as { value: string[] }[]
		).map((r) => r.value[1]);
		expect(steps).toEqual(
			["reset", "code-1", "code-2"].map(
				(n) => `instrument-rows.label-bas_tenure-${n}`,
			),
		);
		const reset = Object.values(document.ComputationItem ?? {}).find(
			(item) => item.ID === steps[0],
		);
		expect(JSON.stringify(reset?.CommandCode)).toContain(
			'"CommandContent":"null"',
		);
	});

	it("says nothing it doesn't know: no severity guessed, no binding to what isn't recorded", () => {
		const parsed = parseInstrument(
			`name: x
uses:
  bas: here
universe: bas.renters
flow:
  - say: "{{bas.why}} is never asked."
  - ask: bas.rent
    checks:
      - ensure: bas.rent > 0
        message: Positive, please.
  - if: bas.why = "x"
    then: []
`,
			{ bas: BAS },
		);
		const { document } = instrumentDocument(
			elaborateInstrument(parsed, { agency: "org.example" }),
		);
		expect(validator.ok && validator.value(document)).toEqual([]);
		const checks = Object.values(document.IfThenElse ?? {});
		expect(checks.some((c) => "TypeOfIfThenElse" in c)).toBe(false);
		const commands = [...objects(document)].flatMap((o) =>
			typeof o.CommandContent === "string" ? [o.CommandContent] : [],
		);
		expect(commands).toContain('null = "x"');
		// The default universe is there though no asked question names it.
		expect(Object.keys(document.Universe ?? {})).toEqual([
			"org.bank:universe-renters:1",
		]);
		const outs = new Set<string>();
		for (const o of objects(document))
			if (typeof o.ID === "string" && o.ID.includes(".out-"))
				outs.add(o.URN as string);
		for (const o of objects(document))
			for (const key of ["SourceParameterReference"]) {
				const p = o[key] as JsonObject | undefined;
				if (p !== undefined) expect(outs.has(p.URN as string)).toBe(true);
			}
	});

	it("makes rosters loops, with each row's number bound where it's read", () => {
		const parsed = parseInstrument(
			`name: households
uses:
  bas: here
flow:
  - ask: bas.rent
  - roster: members
    count: bas.rent
    max: 12
    flow:
      - say: Person {{index}}.
      - ask: bas.why
        checks:
          - ensure: bas.rent >= 0
            severity: warning
            message: Person {{index}}, check the rent.
  - roster: jobs
    more: bas.consent = "1"
    max: 5
    flow:
      - ask: bas.tenure
      - ask: bas.consent
  - each: members
    flow:
      - say: "Again, person {{index}}: {{bas.why}}"
`,
			{ bas: BAS },
		);
		expect(
			[...parsed.findings, ...checkInstrument(parsed)].filter(
				(f) => f.severity !== "info",
			),
		).toEqual([]);
		const { document, collisions } = instrumentDocument(
			elaborateInstrument(parsed, { agency: "org.example" }),
		);
		expect(validator.ok && validator.value(document)).toEqual([]);
		expect(collisions).toEqual([]);
		const commands = [...objects(document)].flatMap((o) =>
			typeof o.CommandContent === "string" ? [o.CommandContent] : [],
		);
		expect(commands).toEqual(
			expect.arrayContaining([
				// The roster's max limits it, and the `each` over it too.
				"members_index <= rent and members_index <= 12",
				"members_index + 1",
				"nvl(jobs_index, 0) + 1",
				// Tested before each row (RepeatUntil), so only once a row is asked; and its max.
				'nvl(jobs_index, 0) >= 1 and not nvl(consent = "1", false) or nvl(jobs_index, 0) >= 5',
			]),
		);
		// `{{index}}` in what is said is the row of the loop it's said in, never the words.
		const said = Object.values(document.StatementItem ?? {}).map((st) =>
			[...objects(st)]
				.flatMap((o) => {
					const p = o.SourceParameterReference as JsonObject | undefined;
					const t = o.MultilingualStringValue as JsonObject | undefined;
					return p !== undefined ? [`<${p.ID}>`] : t ? [t.Value] : [];
				})
				.join(""),
		);
		expect(said).toEqual([
			"Person <instrument-households.out-members_index>.",
			"Person <instrument-households.out-members_index>, check the rent.",
			"Again, person <instrument-households.each-members-out-members_index>: <instrument-households.out-why>",
		]);
		expect(Object.keys(document.Loop ?? {})).toHaveLength(2);
		expect(Object.keys(document.RepeatUntil ?? {})).toHaveLength(1);
		// Every parameter bound is defined, in the loop or count it comes from.
		const identities = new Set<string>();
		for (const o of objects(document))
			if (typeof o.URN === "string") identities.add(o.URN);
		for (const o of objects(document)) {
			const p = o.SourceParameterReference as JsonObject | undefined;
			if (p !== undefined) expect(identities.has(p.URN as string)).toBe(true);
			if (typeof o.ID === "string")
				expect(o.ID.split(".").length <= 2).toBe(true);
		}
	});

	it("records every option of a select-all ask whose `as` is refused, under its own names", () => {
		const parsed = parseInstrument(
			"name: x\nuses:\n  bas: here\nflow:\n  - ask: bas.modes\n    as: trips\n",
			{ bas: BAS },
		);
		const { document } = instrumentDocument(
			elaborateInstrument(parsed, { agency: "org.example" }),
		);
		const names = Object.values(document.Variable ?? {}).map(
			(v) => [...objects(v.VariableName)].find((o) => "Value" in o)?.Value,
		);
		expect(names).toEqual(["modes_b", "modes_w"]);
	});

	it("is total: a draft with holes still elaborates", () => {
		const parsed = parseInstrument(
			"name: x\nuses:\n  bas: here\nflow:\n  - if: bas.consent =\n    then:\n      - ask: bas.nope\n  - ask:\n",
			{ bas: BAS },
		);
		const { document } = instrumentDocument(
			elaborateInstrument(parsed, { agency: "org.example" }),
		);
		expect(validator.ok && validator.value(document)).toEqual([]);
		const commands = [...objects(document)].flatMap((o) =>
			typeof o.CommandContent === "string" ? [o.CommandContent] : [],
		);
		expect(commands).toEqual(["null = null"]);
		for (const c of commands) expect(c).not.toMatch(/\?|\bbas\./);
	});
});
