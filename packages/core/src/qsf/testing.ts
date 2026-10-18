/** A read flow as lines of text, for tests to compare whole. */
import { printCondition } from "../cond/print.ts";
import type { DdiDocument } from "../ddi/document.ts";
import { bankOf } from "../evaluate.ts";
import {
	elaborateInstrument,
	instrumentDocument,
} from "../instrument/elaborate.ts";
import { parseInstrument } from "../instrument/parse.ts";
import type { Cond, Part, Source, Step } from "./read.ts";
import type { Qsf } from "./skeleton.ts";

/** A read flow as lines of text, to compare whole. */
export const source = (s: Source): string =>
	s.kind === "answer"
		? `${s.variable}${s.option === undefined ? "" : `#${s.option.code}/${s.option.ticked}`}${s.asks.length > 1 ? `x${s.asks.length}` : ""}`
		: s.kind === "row"
			? `row(${s.loop.split(".").at(-1)})`
			: `${s.kind}:${s.variable}`;
export const cond = (c: Cond): string =>
	`${printCondition(c.expr)} {${[...c.sources].map(([a, s]) => `${a}=${source(s)}`).join(", ")}}`;
export const text = (t: readonly Part[]): string =>
	t
		.map((p) =>
			p.kind === "text"
				? p.text
				: `<${source(p.source)}${p.label ? ":label" : ""}>`,
		)
		.join("");
export const outline = (steps: readonly Step[], ind = ""): string[] =>
	steps.flatMap((s): string[] => {
		switch (s.kind) {
			case "ask":
				return [
					`${ind}ask ${s.question.name} ${s.question.domain.kind}${s.question.domain.kind === "choice" && s.question.domain.many ? "*" : ""} ${s.records.map((r) => r.variable + (r.code === undefined ? "" : `#${r.code}`)).join(",")}${s.options ? ` ${s.options}` : ""}: ${text(s.text)}`,
					...s.checks.map(
						(c) =>
							`${ind}  check ${c.severity} ${cond(c.ensure)}${c.message ? `: ${text(c.message)}` : ""}`,
					),
				];
			case "say":
				return [`${ind}say ${text(s.text)}`];
			case "compute":
				return [`${ind}compute ${s.variable} = ${cond(s.value)}`];
			case "stop":
				return [`${ind}stop ${cond(s.cond)}`, ...outline(s.say, `${ind}  `)];
			case "if":
				return [
					...s.branches.flatMap((b, i) => [
						`${ind}${i === 0 ? "if" : "elif"} ${cond(b.cond)}`,
						...outline(b.then, `${ind}  `),
					]),
					...(s.else === undefined
						? []
						: [`${ind}else`, ...outline(s.else, `${ind}  `)]),
				];
			case "loop":
				return [
					`${ind}loop count ${cond(s.count)} max ${s.max}`,
					...outline(s.flow, `${ind}  `),
				];
			case "repeat":
				return [
					`${ind}repeat more ${cond(s.more)} max ${s.max}`,
					...outline(s.flow, `${ind}  `),
				];
			case "section":
				return [
					`${ind}section ${s.title ?? ""} ${s.order ?? ""}`.trimEnd(),
					...outline(s.flow, `${ind}  `),
				];
			default:
				return s satisfies never;
		}
	});

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
	"questions/a/pets.yaml": q("pets", 'select: many\nresponses:\n  "d": Dog\n'),
	"questions/a/size.yaml": q("size", "number: { max: 9 }\n"),
	"questions/a/nick.yaml": q("nick", "open: {}\n"),
	"questions/a/more.yaml": q("more", 'responses:\n  "1": Yes\n  "2": No\n'),
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
      - ask: bas.echo
        fill:
          neighborhood: label(bas.tenure)
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
            - ask: bas.pets
          else:
            - say: Neither, then.
            - ask: bas.pets
  - ask: bas.size
  - roster: people
    count: bas.size
    flow:
      - ask: bas.nick
  - ask: bas.why
    options: rotate
  - ask: bas.why
    as: why_end
`;

/** An instrument's DDI, its source using the test bank as `bas`. */
export const ddiOf = (source: string): DdiDocument =>
	instrumentDocument(
		elaborateInstrument(parseInstrument(source, { bas: BAS }), {
			agency: "org.example",
		}),
	).document;

/** The demonstration instrument: every construct of the language, once. */
export const demoDdi = (): DdiDocument => ddiOf(SOURCE);

type FlowNode = {
	readonly Type: string;
	readonly ID?: string;
	readonly Description?: string;
	readonly Flow?: readonly FlowNode[];
	readonly BranchLogic?: {
		readonly "0": Readonly<Record<string, unknown>>;
	};
	readonly EmbeddedData?: readonly { Field: string; Value?: string }[];
};
type Expression = {
	readonly Operator: string;
	readonly LeftOperand: string;
	readonly RightOperand?: string;
	readonly Conjuction?: string;
};
/** A written survey's flow as lines: each element, its branch logic as written, its fields set. */
export const flowOutline = (qsf: Qsf): string[] => {
	const elements = (
		qsf as { SurveyElements: { Element: string; Payload: unknown }[] }
	).SurveyElements;
	const flow = elements.find((e) => e.Element === "FL")?.Payload as {
		Flow: FlowNode[];
	};
	const tree = (ns: readonly FlowNode[], ind: string): string[] =>
		ns.flatMap((n) => {
			const logic = n.BranchLogic
				? `: ${Object.values(n.BranchLogic["0"])
						.filter((x): x is Expression => typeof x === "object")
						.map((x) =>
							`${x.Conjuction ?? ""} ${x.LeftOperand} ${x.Operator} ${x.RightOperand ?? ""}`.trim(),
						)
						.join(" ")}`
				: "";
			const set = n.EmbeddedData
				? ` ${n.EmbeddedData.map((f) => `${f.Field}=${f.Value ?? "(url)"}`).join(",")}`
				: "";
			return [
				`${ind}${n.Type} ${n.ID ?? n.Description ?? ""}${logic}${set}`.trimEnd(),
				...tree(n.Flow ?? [], `${ind}  `),
			];
		});
	return tree(flow.Flow, "");
};
