import { describe, expect, it } from "vitest";
import { bankOf } from "../evaluate.ts";
import type { Finding } from "../findings.ts";
import { checkInstrument, inspectInstrument } from "./check.ts";
import { fillCompatibility } from "./fills.ts";
import { parseInstrument } from "./parse.ts";

const q = (name: string, rest: string) =>
	`name: ${name}\ntext: ${name}?\nintent: i\n${rest}`;
const BAS = bankOf({
	"workspace.yaml": "agency: org.example\n",
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
	"questions/a/util.yaml":
		'name: util\ntext: "You pay {{rent}}. Utilities included?"\nintent: i\nopen: {}\nfills:\n  rent: number\n',
	"questions/a/echo.yaml":
		'name: echo\ntext: "You selected {{neighborhood}}."\nintent: i\nopen: {}\nfills:\n  neighborhood: text\n',
});
const OTHER = bankOf({
	"workspace.yaml": "agency: org.other\n",
	"questions/a/why.yaml": q("why", "open: {}\n"),
});

/** The flow's findings; universe advice only when asked for, since it's on most branches. */
const checked = (flow: string, universe = false) => {
	const parsed = parseInstrument(
		`name: x\nuses:\n  bas: here\n  oth: there\nflow:\n${flow}`,
		{ bas: BAS, oth: OTHER },
	);
	expect(parsed.findings.filter((f) => f.severity !== "info")).toEqual([]);
	return checkInstrument(parsed)
		.filter((f) => universe || f.code !== "universe")
		.map((f: Finding) => `${f.severity} ${f.code} ${f.path}`);
};

describe("checking an instrument's flow", () => {
	it("passes a flow that asks before it reads", () => {
		expect(
			checked(`  - ask: bas.tenure
  - if: bas.tenure = "2"
    then:
      - ask: bas.rent
        checks:
          - ensure: bas.rent >= 0
            severity: blocking
            message: "{{bas.rent}} can't be negative."
      - ask: bas.util
        universe: bas.renters
        fill:
          rent: bas.rent
`),
		).toEqual([]);
	});

	it("says a name is read before it's asked or computed", () => {
		expect(
			checked(`  - if: bas.tenure = "2"
    then: []
  - ask: bas.tenure
  - say: "{{late}}"
  - compute: late
    value: 1
`),
		).toEqual(["error order flow.0.if", "error order flow.2.say"]);
	});

	it("says a name may be unasked, unless the condition asks with isnull", () => {
		const flow = (cond: string) => `  - ask: bas.consent
  - if: bas.consent = "1"
    then:
      - ask: bas.tenure
  - if: ${cond}
    then: []
`;
		expect(checked(flow('bas.tenure = "2"'))).toEqual(["info order flow.2.if"]);
		expect(checked(flow('isnull(bas.tenure) or bas.tenure = "2"'))).toEqual([]);
	});

	it("says who has no answer, and what that does where it's read", () => {
		// `bas.tenure` is asked only of those who consent; each use below reads it after.
		const notes = (use: string) => {
			const parsed = parseInstrument(
				`name: x\nuses:\n  bas: here\nflow:\n  - ask: bas.consent\n  - if: bas.consent = "1"\n    then:\n      - ask: bas.tenure\n      - ask: bas.rent\n      - compute: owner\n        value: bas.tenure = "1"\n${use}`,
				{ bas: BAS },
			);
			return checkInstrument(parsed)
				.filter((f) => f.code === "order" && f.severity === "info")
				.map((f) => `${f.message} | ${f.hint}`);
		};
		const asked = "Some respondents may not have been asked `bas.tenure` yet.";
		const people = "People with no answer to `bas.tenure`";
		expect(notes('  - if: bas.tenure = "2"\n    then: []\n')).toEqual([
			`${asked} | ${people} may skip this branch. To include them, add \`or isnull(bas.tenure)\`.`,
		]);
		expect(
			notes(
				'  - ask: bas.why\n    checks:\n      - ensure: bas.tenure = "1"\n        severity: warning\n        message: Owners only.\n',
			),
		).toEqual([
			`${asked} | ${people} may pass this check. To check them too, add a check on \`isnull(bas.tenure)\`.`,
		]);
		expect(notes('  - compute: renter\n    value: bas.tenure = "2"\n')).toEqual(
			[
				`${asked} | ${people} get no value here. To give them one, compute it in a branch on \`isnull(bas.tenure)\`.`,
			],
		);
		expect(notes('  - say: "You said {{bas.tenure}}."\n')).toEqual([
			`${asked} | ${people} see a blank here. Ask \`bas.tenure\` on every route to here, or move this text into the branch that asks it.`,
		]);
		expect(
			notes(
				"  - roster: rooms\n    count: bas.rent\n    max: 5\n    flow:\n      - ask: bas.why\n",
			),
		).toEqual([
			"Some respondents may not have been asked `bas.rent` yet. | People with no answer to `bas.rent` get no rows. Ask `bas.rent` on every route to here.",
		]);
		expect(notes('  - stop: bas.tenure = "2"\n')).toEqual([
			`${asked} | ${people} may not be stopped here. To stop them too, add \`or isnull(bas.tenure)\`.`,
		]);
		expect(
			notes(
				'  - roster: visits\n    more: bas.tenure = "2"\n    max: 5\n    flow:\n      - ask: bas.why\n',
			),
		).toEqual([
			`${asked} | ${people} may get no more rows. To keep asking them, add \`or isnull(bas.tenure)\`.`,
		]);
		expect(notes("  - if: owner\n    then: []\n")).toEqual([
			"`owner` may not have been computed for some respondents yet. | People with no value for `owner` may skip this branch. To include them, add `or isnull(owner)`.",
		]);
	});

	it("words the order error, the universe note and a roster's value as they are", () => {
		const said = (flow: string, bank = BAS) =>
			[
				...((parsed) => [...parsed.findings, ...checkInstrument(parsed)])(
					parseInstrument(`name: x\nuses:\n  bas: here\nflow:\n${flow}`, {
						bas: bank,
					}),
				),
			]
				.filter((f) => f.severity !== "hole")
				.map((f) => `${f.code}: ${f.message} | ${f.hint ?? ""}`);
		expect(
			said('  - if: bas.tenure = "2"\n    then: []\n  - ask: bas.tenure\n'),
		).toContain(
			"order: `bas.tenure` is used here, but no route asks it before this point. | Ask `bas.tenure` earlier, on every route to here.",
		);
		expect(
			said(
				'  - ask: bas.consent\n  - if: bas.consent = "1"\n    then:\n      - ask: bas.why\n',
			),
		).toContain(
			"universe: Not everyone reaches this question, but it has no universe. | Say who is asked with `universe:`.",
		);
		expect(
			said(
				'  - ask: bas.consent\n  - roster: people\n    more: bas.consent = "1"\n    max: 5\n    flow:\n      - compute: n\n        value: 1\n  - if: n = 1\n    then: []\n',
			),
		).toContain(
			"misplaced: `n` has a value for each row of `people`, so it can only be used inside `people`. | Move this step into `people`, or into an `each: people` step.",
		);
		// A select all that apply question's options hold the bank's own chosen code.
		const recoded = bankOf({
			"workspace.yaml": "agency: org.example\n",
			"select_all.yaml":
				'chosen: { "Y": Selected }\nnot_chosen: { "N": Not selected }\n',
			"questions/m/modes.yaml":
				'name: modes\ntext: How?\nintent: i\nselect: many\nresponses:\n  "b": Bus\n  "w": Walk\n',
		});
		const parsed = parseInstrument(
			'name: x\nuses:\n  bas: here\nflow:\n  - ask: bas.modes\n  - stop: bas.modes = "Y"\n',
			{ bas: recoded },
		);
		expect(parsed.findings.find((f) => f.code === "unknown-name")?.hint).toBe(
			'Each option of `bas.modes` has its own answer: `bas.modes_b`, `bas.modes_w`. A chosen option holds `"Y"`.',
		);
	});

	it("says what to do about a branch never taken, a stop for all, and a check with no severity", () => {
		const hints = (flow: string) =>
			((parsed) =>
				[...parsed.findings, ...checkInstrument(parsed)].map(
					(f) => `${f.code}: ${f.hint ?? "(none)"}`,
				))(
				parseInstrument(`name: x\nuses:\n  bas: here\nflow:\n${flow}`, {
					bas: BAS,
				}),
			);
		expect(
			hints(
				'  - ask: bas.consent\n  - if: bas.consent = "1" or true\n    then: []\n    else:\n      - ask: bas.why\n',
			),
		).toContain("unreachable: Change the condition above, or remove `else`.");
		expect(
			hints(
				"  - ask: bas.consent\n  - if: 1 = 2\n    then:\n      - ask: bas.why\n",
			),
		).toContain("unreachable: Change the condition, or remove the branch.");
		expect(hints("  - stop: true\n")).toContain(
			"unreachable: Change the condition so it stops only some respondents.",
		);
		expect(
			hints(
				'  - ask: bas.tenure\n    checks:\n      - ensure: bas.tenure = "1"\n        message: Owners only.\n',
			),
		).toContain(
			"hole: `blocking` asks again until the answer passes; `warning` and `info` just show the message.",
		);
		expect(
			hints(
				'  - ask: bas.consent\n  - roster: people\n    count: 2\n    more: bas.consent = "1"\n    max: 5\n    flow:\n      - ask: bas.why\n',
			),
		).toContain("unknown-key: Keep `count` or `more`, and remove the other.");
	});

	it("allows one question in exclusive branches, not twice on one path", () => {
		const branches = `  - ask: bas.consent
  - if: bas.consent = "1"
    then:
      - ask: bas.why
    else:
      - ask: bas.why
`;
		expect(checked(branches)).toEqual([]);
		expect(checked(`${branches}  - ask: bas.why\n`)).toEqual([
			"error name-clash flow.2.ask",
		]);
		expect(checked(`${branches}  - ask: bas.why\n    as: why_again\n`)).toEqual(
			[],
		);
	});

	it("finds branches never taken, but never on a hole", () => {
		expect(
			checked(`  - if: 1 = 2
    then: []
  - if: true
    then: []
    else:
      - say: never
  - stop: 1 = 1
`),
		).toEqual([
			"warning unreachable flow.0.if",
			"warning unreachable flow.1.else",
			"warning unreachable flow.2.stop",
		]);
	});

	it("needs a number to fill a number fill", () => {
		expect(
			checked(`  - ask: bas.why
  - ask: bas.util
    fill:
      rent: bas.why
`),
		).toEqual(["error type flow.1.fill.rent"]);
	});

	it("allows respondent-facing values in text fills, while keeping number fills exact", () => {
		expect(fillCompatibility("text", { kind: "string" })).toMatchObject({
			kind: "compatible",
			presentation: "text",
		});
		expect(fillCompatibility("text", { kind: "number" })).toMatchObject({
			kind: "compatible",
			presentation: "number",
		});
		expect(
			fillCompatibility("text", {
				kind: "code",
				codes: [{ code: "1", label: "Baltimore" }],
			}),
		).toMatchObject({ kind: "compatible", presentation: "label" });
		expect(fillCompatibility("number", { kind: "string" })).toEqual({
			kind: "incompatible",
			expected: "number",
		});
	});

	it("requires an explicit label projection for a coded text fill", () => {
		const raw = checked(`  - ask: bas.tenure
  - ask: bas.echo
    fill:
      neighborhood: bas.tenure
`);
		expect(raw).toEqual(["error type flow.1.fill.neighborhood"]);
		expect(
			checked(`  - ask: bas.tenure
  - ask: bas.echo
    fill:
      neighborhood: label(bas.tenure)
`),
		).toEqual([]);
	});

	it("offers a fill only inputs and answers guaranteed at that point", () => {
		const parsed = parseInstrument(
			`name: x
uses:
  bas: here
inputs:
  rent_input:
    number: {}
flow:
  - if: true
    then:
      - ask: bas.why
        as: branch_only
  - ask: bas.util
    fill:
      rent:
`,
			{ bas: BAS },
		);
		const choices = inspectInstrument(parsed).fills["flow.1.fill.rent"] ?? [];
		expect(choices.map((c) => c.name)).toEqual(["rent_input"]);
	});

	it("offers a coded source as its respondent-facing label", () => {
		const parsed = parseInstrument(
			`name: x
uses:
  bas: here
flow:
  - ask: bas.tenure
  - ask: bas.echo
    fill:
      neighborhood:
`,
			{ bas: BAS },
		);
		expect(
			inspectInstrument(parsed).fills["flow.1.fill.neighborhood"],
		).toMatchObject([{ name: "bas.tenure", presentation: "label" }]);
	});

	it("offers an earlier alias and computed value by their instrument names", () => {
		const parsed = parseInstrument(
			`name: x
uses:
  bas: here
flow:
  - ask: bas.rent
    as: prior_rent
  - compute: doubled
    value: prior_rent * 2
  - ask: bas.util
    fill:
      rent:
`,
			{ bas: BAS },
		);
		expect(
			(inspectInstrument(parsed).fills["flow.2.fill.rent"] ?? []).map(
				(c) => c.name,
			),
		).toEqual(["doubled", "prior_rent"]);
	});

	it("gives every recorded variable one name across banks", () => {
		expect(checked("  - ask: bas.why\n  - ask: oth.why\n")).toEqual([
			"error name-clash flow.1.ask",
		]);
	});

	it("allows one `as` name in exclusive branches, not twice on one path", () => {
		const branches = `  - ask: bas.consent
  - if: bas.consent = "1"
    then:
      - ask: bas.why
        as: why2
    else:
      - ask: bas.why
        as: why2
`;
		expect(checked(branches)).toEqual([]);
		expect(checked(`${branches}  - ask: bas.why\n    as: why2\n`)).toEqual([
			"error name-clash flow.2.as",
		]);
	});

	it("puts a placeholder's order finding on the placeholder", () => {
		const parsed = parseInstrument(
			"name: x\nuses:\n  bas: here\nflow:\n  - say: You said {{bas.why}}.\n  - ask: bas.why\n",
			{ bas: BAS },
		);
		const [f] = checkInstrument(parsed);
		expect(f?.code).toBe("order");
		expect(f?.range).toBeDefined();
	});

	it("doesn't cascade from an `as` whose question doesn't resolve", () => {
		const parsed = parseInstrument(
			"name: x\nuses:\n  bas: here\nflow:\n  - ask: bas.nope\n    as: zz\n  - if: isnull(zz)\n    then: []\n",
			{ bas: BAS },
		);
		expect(checkInstrument(parsed)).toEqual([]);
	});

	it("counts what follows a stop as asked of everyone the instrument is about", () => {
		expect(
			checked(
				`  - ask: bas.consent
  - stop: bas.consent = "2"
  - ask: bas.why
`,
				true,
			),
		).toEqual([]);
	});

	it("reads a row's answers only within its roster, or an `each` over it", () => {
		const flow = `  - ask: bas.consent
  - roster: people
    more: bas.consent = "1"
    max: 5
    flow:
      - ask: bas.why
  - each: people
    flow:
      - say: "{{bas.why}}"
`;
		expect(checked(flow)).toEqual([]);
		expect(checked(`${flow}  - say: "{{bas.why}}"\n`)).toEqual([
			"error misplaced flow.3.say",
		]);
	});

	it("advises on whom a question is asked of", () => {
		expect(
			checked(
				`  - ask: bas.rent
    universe: bas.renters
  - ask: bas.tenure
  - if: bas.tenure = "2"
    then:
      - ask: bas.why
`,
				true,
			),
		).toEqual(["info universe flow.0.ask", "info universe flow.2.then.0.ask"]);
	});
});
