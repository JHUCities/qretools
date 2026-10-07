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
	"bank.yaml": "agency: org.bank\n",
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
			  "Category": 14,
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
		const construct = allowed("ControlConstruct");
		// Declared by DDI on a ControlConstruct in 4.0's model, though the JSON schema's
		// types don't carry them over: a construct's name, and a question's fill bindings.
		const extra = new Set(["ConstructName", "Binding"]);
		for (const [type, items] of Object.entries(document)) {
			const ok = new Set([
				...allowed(type),
				...allowed("Versionable"),
				...construct,
				...extra,
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
    flow:
      - say: Person {{index}}.
      - ask: bas.why
  - roster: jobs
    more: bas.consent = "1"
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
				"members_index <= rent",
				"members_index + 1",
				"nvl(jobs_index, 0) + 1",
				'not nvl(consent = "1", false)',
			]),
		);
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
