import { describe, expect, it } from "vitest";
import { parseDocument, type Scalar } from "yaml";
import { bankOf } from "../evaluate.ts";
import type { Finding } from "../findings.ts";
import { parseInstrument } from "./parse.ts";
import { scalarMap } from "./scalar.ts";

const BAS = bankOf({
	"bank.yaml": "agency: org.example\n",
	"missing.yaml": 'labels:\n  "-8": Refused\n',
	"scales/agree2.yaml": 'labels:\n  "1": Agree\n  "2": Disagree\n',
	"universes/renters.yaml": "text: Respondents who rent their home\n",
	"questions/c/consent.yaml":
		'name: consent\ntext: Do you agree to take part?\nintent: i\nresponses:\n  "1": Yes\n  "2": No\n',
	"questions/h/tenure.yaml":
		'name: tenure\ntext: Do you own or rent?\nintent: i\nresponses:\n  "1": Own\n  "2": Rent\n',
	"questions/h/rent.yaml":
		"name: rent\ntext: How much is your rent?\nintent: i\nnumber: { min: 0 }\n",
	"questions/h/util.yaml":
		'name: util\ntext: "You pay {{rent}} a month. Does that include utilities?"\nintent: i\nresponses: agree2\nfills:\n  rent: number\n',
	"questions/n/sat.yaml":
		'name: sat\ntext: How satisfied are you?\nintent: i\nresponses:\n  "1": Satisfied\n  "2": Neutral\n  "3": Dissatisfied\n',
	"questions/n/why.yaml": "name: why\ntext: Why?\nintent: i\nopen: {}\n",
	"questions/m/modes.yaml":
		'name: modes\ntext: How do you travel?\nintent: i\nselect: many\nresponses:\n  "b": Bus\n  "w": Walk\n',
});
const banks = { bas: BAS };
const read = (source: string) => parseInstrument(source, banks);
const brief = (f: Finding) => `${f.severity} ${f.code} ${f.path}`;

const COMPLETE = `name: demo
title: A demonstration
uses:
  bas: JHUCities/bas-question-bank@2026.1
inputs:
  jurisdiction:
    responses:
      "1": Baltimore City
      "2": Baltimore County
  wording:
    responses: bas.agree2
    description: Assigned upstream.
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
              - ensure: bas.rent >= 0 and bas.rent <= 10000
                severity: blocking
                message: Enter an amount from 0 to 10,000.
          - ask: bas.util
            fill:
              rent: bas.rent
        else:
          if: bas.tenure = "1"
          then:
            - ask: bas.modes
          else:
            - say: Neither, then.
  - ask: bas.sat
    options: rotate
  - if: bas.sat in {"2", "3"} and bas.modes_b = "1"
    then:
      - ask: bas.why
  - ask: bas.sat
    as: sat_end
`;

describe("reading an instrument", () => {
	it("reads every construct of the language, with nothing to say", () => {
		const { draft, findings, scope } = read(COMPLETE);
		expect(findings.map(brief)).toEqual([]);
		expect(draft.name).toBe("demo");
		expect(draft.uses).toEqual([
			{ alias: "bas", address: "JHUCities/bas-question-bank@2026.1" },
		]);
		expect(draft.inputs.map((i) => i.domain?.kind)).toEqual([
			"responses",
			"responses",
		]);
		expect(draft.flow.map((n) => n.kind)).toEqual([
			"say",
			"ask",
			"stop",
			"section",
			"ask",
			"if",
			"ask",
		]);
		const section = draft.flow[3];
		expect(section?.kind === "section" && section.order).toBe("random");
		const branch = section?.kind === "section" ? section.flow[2] : undefined;
		expect(branch?.kind === "if" && branch.branches.length).toBe(2);
		expect(branch?.kind === "if" && branch.else?.length).toBe(1);
		expect([...scope.keys()].sort()).toEqual([
			"jurisdiction",
			"renter",
			"sat_end",
			"wording",
		]);
		expect(scope.get("renter")?.type.kind).toBe("boolean");
		const last = draft.flow[6];
		expect(last?.kind === "ask" && last.question?.path).toBe(
			"questions/n/sat.yaml",
		);
	});

	it("an unknown question or bank is said where it's written", () => {
		const { findings } = read(
			"name: x\nuses:\n  bas: here\n  other: there\nflow:\n  - ask: bas.nope\n  - ask: zz.sat\n",
		);
		expect(findings.map(brief)).toEqual([
			"error unknown-bank uses.other",
			"hole unknown-question flow.0.ask",
			"error unknown-bank flow.1.ask",
		]);
	});

	it("a name nothing has is a hole at the name, listing what is in scope", () => {
		const source =
			'name: x\nuses:\n  bas: here\nflow:\n  - if: bas.sat = "1" and nope\n    then: [{ask: bas.why}]\n';
		const { findings } = read(source);
		const [hole] = findings;
		expect(hole && brief(hole)).toBe("hole unknown-name flow.0.if");
		expect(hole?.range && source.slice(...hole.range)).toBe("nope");
		expect(hole?.hint).toContain("bas.…");
	});

	it("a type error points into the condition, whatever the scalar's style", () => {
		for (const written of [
			"bas.sat = 1",
			"'bas.sat = 1'",
			'"bas.sat = 1"',
			">-\n      bas.sat\n      = 1",
		]) {
			const source = `name: x\nuses:\n  bas: here\nflow:\n  - if: ${written}\n    then: [{ask: bas.why}]\n`;
			const [f] = read(source).findings;
			expect([
				written,
				f?.message,
				f?.range && source.slice(...f.range),
			]).toEqual([written, 'A code is text: write `"1"`.', "1"]);
		}
	});

	it("knows a condition from an answer, and asks each to be complete", () => {
		const { findings } = read(
			"name: x\nuses:\n  bas: here\nflow:\n  - if: bas.sat\n    then: []\n  - if:\n    then: []\n  - if: bas.sat =\n    then: []\n",
		);
		expect(findings.map(brief)).toEqual([
			"hole hole flow.1.if",
			"hole hole flow.2.if",
			"error type flow.0.if",
		]);
	});

	it("keeps `stop` at the top", () => {
		const { findings } = read(
			"name: x\nflow:\n  - section: s\n    flow:\n      - stop: true\n",
		);
		expect(findings.map(brief)).toEqual(["error misplaced flow.0.flow.0.stop"]);
	});

	it("reads rosters, ending by a count or by `more`, and `each` over one", () => {
		const { draft, findings } = read(`name: x
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
    more: bas.sat = "1"
    flow:
      - ask: bas.sat
  - each: members
    flow:
      - if: members.index > 1
        then: []
`);
		expect(findings.map(brief)).toEqual([]);
		const [, members, jobs, each] = draft.flow;
		expect(members?.kind === "roster" && members.end?.kind).toBe("count");
		expect(jobs?.kind === "roster" && jobs.end?.kind).toBe("more");
		expect(each?.kind === "each" && each.roster).toBe("members");
		const say = members?.kind === "roster" ? members.flow[0] : undefined;
		expect(say?.kind === "say" && say.reads.map((r) => r.name)).toEqual([
			"members.index",
		]);
	});

	it("says what a roster lacks, and where a row's number can't be read", () => {
		const { findings } = read(`name: x
uses:
  bas: here
flow:
  - roster: a
    flow: []
  - roster: b
    count: bas.sat = "1"
    more: true
    flow: []
  - if: a.index = 1
    then: []
  - each: nope
    flow: []
`);
		expect(findings.map(brief)).toEqual([
			"hole hole flow.0.roster",
			"error unknown-key flow.1.more",
			"error type flow.1.count",
			"error misplaced flow.2.if",
			"hole unknown-name flow.3.each",
		]);
		const nested = read(
			"name: x\nflow:\n  - roster: a\n    count: 2\n    flow:\n      - roster: b\n        count: 1\n        flow: []\n",
		);
		expect(nested.findings.map(brief)).toEqual([
			"error not-yet flow.0.flow.0.roster",
		]);
	});

	it("gives each name one meaning, and keeps VTL's words out of names", () => {
		const { findings } = read(
			"name: x\ninputs:\n  and:\n    open: {}\n  t:\n    open: {}\nflow:\n  - compute: t\n    value: 1\n",
		);
		expect(findings.map(brief)).toEqual([
			"error name-clash inputs.and",
			"error name-clash flow.0.compute",
		]);
	});

	it("fills a question's fills, and says which are left empty or don't exist", () => {
		const empty = read(
			"name: x\nuses:\n  bas: here\nflow:\n  - ask: bas.util\n",
		);
		expect(empty.findings.map(brief)).toEqual(["hole hole flow.0.ask"]);
		const wrong = read(
			"name: x\nuses:\n  bas: here\nflow:\n  - ask: bas.util\n    fill:\n      rent: bas.rent\n      other: bas.rent\n",
		);
		expect(wrong.findings.map(brief)).toEqual([
			"error unknown-name flow.0.fill.other",
		]);
	});

	it("fills a fill with one name, for now", () => {
		const { findings } = read(
			"name: x\nuses:\n  bas: here\nflow:\n  - ask: bas.rent\n  - ask: bas.util\n    fill:\n      rent: bas.rent + 1\n",
		);
		expect(findings.map(brief)).toEqual(["error not-yet flow.1.fill.rent"]);
	});

	it("asks for each check's severity and message", () => {
		const { findings } = read(
			"name: x\nuses:\n  bas: here\nflow:\n  - ask: bas.rent\n    checks:\n      - ensure: bas.rent > 0\n        severity: fatal\n      - ensure:\n",
		);
		expect(findings.map(brief)).toEqual([
			"error wrong-type flow.0.checks.0.severity",
			"hole hole flow.0.checks.0.message",
			"hole hole flow.0.checks.1.ensure",
			"hole hole flow.0.checks.1.severity",
			"hole hole flow.0.checks.1.message",
		]);
	});

	it("keeps an earlier name when a compute clashes with it", () => {
		const { findings, scope } = read(
			'name: x\ninputs:\n  renter:\n    open: {}\nflow:\n  - compute: renter\n    value: 1\n  - if: renter = "a"\n    then: []\n',
		);
		expect(findings.map(brief)).toEqual(["error name-clash flow.0.compute"]);
		expect(scope.get("renter")?.kind).toBe("input");
	});

	it("reaches only the banks `uses` names, and asks where each is", () => {
		const { findings } = parseInstrument(
			"name: x\nuses:\n  bas:\nflow:\n  - say: hi {{zz.sat}}\n",
			{ bas: BAS, zz: BAS },
		);
		expect(findings.map(brief)).toEqual([
			"hole hole uses.bas",
			"hole unknown-name flow.0.say",
		]);
	});

	it("says a hole once where a problem already covers it", () => {
		const { findings } = read(
			"name: x\nuses:\n  bas: here\nflow:\n  - if: bas.sat in\n    then: []\n",
		);
		expect(findings.map(brief)).toEqual(["error condition flow.0.if"]);
	});

	it("reads an input's type as strictly as a question's", () => {
		const { findings } = read(
			"name: x\ninputs:\n  n:\n    number: {min: x, foo: 1}\n  t:\n    open:\nflow: []\n",
		);
		expect(findings.map(brief)).toEqual([
			"error wrong-type inputs.n.number.min",
			"error unknown-key inputs.n.number.foo",
			"hole hole inputs.t.open",
		]);
	});

	it("explains a select-all question's own name, listing its options' variables", () => {
		const { findings } = read(
			'name: x\nuses:\n  bas: here\nflow:\n  - if: bas.modes = "1"\n    then: []\n',
		);
		expect(findings[0]?.hint).toContain("`bas.modes_b`, `bas.modes_w`");
	});

	it("types computes in the order they read each other, and finds a cycle", () => {
		const ordered = read(
			'name: x\nflow:\n  - compute: a\n    value: b + 1\n  - compute: b\n    value: 2\n  - if: a = "x"\n    then: []\n',
		);
		expect(ordered.findings.map((f) => f.message)).toEqual([
			"A number can't be compared with text.",
		]);
		const cycle = read(
			"name: x\nflow:\n  - compute: a\n    value: b + 1\n  - compute: b\n    value: a + 1\n",
		);
		expect(cycle.findings.map(brief)).toEqual(["error cycle flow.0.value"]);
	});

	it("declares `as` even when its question doesn't resolve", () => {
		const { findings } = read(
			"name: x\nuses:\n  bas: here\nflow:\n  - ask: bas.nope\n    as: again\n  - if: isnull(again)\n    then: []\n",
		);
		expect(findings.map(brief)).toEqual(["hole unknown-question flow.0.ask"]);
	});

	it("puts a placeholder's finding on the placeholder", () => {
		const source = "name: x\nflow:\n  - say: Hello {{nobody}}, welcome.\n";
		const [f] = read(source).findings;
		expect(f?.range && source.slice(...f.range)).toBe("{{nobody}}");
	});

	it("never throws, whatever it's given", () => {
		for (const source of [
			"",
			"[",
			"flow: 3",
			"flow:\n  - 3\n  - ask:\n",
			"inputs: x\nuses: 1\n",
			"flow:\n  - if: '{'\n",
		])
			expect(() => read(source)).not.toThrow();
	});
});

describe("where a scalar's characters are", () => {
	it("counts as ranges do, so an emoji before a token doesn't move it", () => {
		const source = 'k: "😀 x = 1"\n';
		const doc = parseDocument(source);
		const node = doc.get("k", true) as Scalar;
		const text = String(node.value);
		const i = text.indexOf("x");
		expect(source.slice(...scalarMap(source, node, text)([i, i + 1]))).toBe(
			"x",
		);
	});

	it("maps every token back to where it's written, in every style (a quoted one's escapes included)", () => {
		const value = 'bas.sat in {"2", "3"} and x = "a b"';
		for (const written of [
			value,
			`'${value}'`,
			JSON.stringify(value),
			`>-\n  bas.sat in {"2", "3"}\n  and x = "a b"`,
			`|-\n  ${value}`,
		]) {
			const source = `k: ${written}\n`;
			const doc = parseDocument(source);
			const node = doc.get("k", true) as Scalar;
			const text = String(node.value);
			const at = scalarMap(source, node, text);
			for (const token of ["bas.sat", '"3"', "and", '"a b"']) {
				const i = text.indexOf(token);
				const mapped = at([i, i + token.length]);
				expect([
					written,
					source
						.slice(...mapped)
						.replace(/\\"/g, '"')
						.replace(/\s+/g, " "),
				]).toEqual([written, token]);
			}
		}
	});
});
