import { describe, expect, it } from "vitest";
import { bankOf } from "../evaluate.ts";
import type { Finding } from "../findings.ts";
import { checkInstrument } from "./check.ts";
import { parseInstrument } from "./parse.ts";

const q = (name: string, rest: string) =>
	`name: ${name}\ntext: ${name}?\nintent: i\n${rest}`;
const BAS = bankOf({
	"bank.yaml": "agency: org.example\n",
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
});
const OTHER = bankOf({
	"bank.yaml": "agency: org.other\n",
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

	it("counts what follows a stop as reached by only some", () => {
		expect(
			checked(
				`  - ask: bas.consent
  - stop: bas.consent = "2"
  - ask: bas.why
`,
				true,
			),
		).toEqual(["info universe flow.2.ask"]);
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
