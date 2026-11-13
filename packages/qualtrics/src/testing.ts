/** A read flow as lines of text, for tests to compare whole. */
import {
	bankOf,
	type DdiDocument,
	instrumentOf,
	printCondition,
} from "@qretools/core";
import type { ColumnMap } from "./columns.ts";
import type { Cond, Part, Source, Step } from "./read.ts";
import { expand } from "./responses.ts";
import type { Qsf, QsfObject } from "./skeleton.ts";

/** A read flow as lines of text, to compare whole. */
export const source = (s: Source): string =>
	s.kind === "answer"
		? `${s.variable}${s.row === undefined ? "" : `@${s.row}`}${s.option === undefined ? "" : `#${s.option.code}/${s.option.ticked}`}${s.asks.length > 1 ? `x${s.asks.length}` : ""}`
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
	"questions/a/trips.yaml": q(
		"trips",
		'select: many\nresponses:\n  "1": Work\n  "2": School\n  "3": Shops\n  "9": None\n',
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
	instrumentOf(source, { banks: { bas: BAS }, agency: "org.example" }).ddi;

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

/** A row-3 cell as Qualtrics writes it: JSON, quoted, its quotes doubled. */
const cell = (o: object) => `"${JSON.stringify(o).replaceAll('"', '""')}"`;

/** What changes in a survey between the QSF written and its export. */
export interface ExportOptions {
	/** Each QID as the export numbers it. */
	readonly qid?: (qid: string) => string;
	/** Each question's export tag as the export names it. */
	readonly tag?: (tag: string) => string;
	/** Each question's text (QSF HTML) as row 2 gives it. */
	readonly text?: (text: string) => string;
	/** The `qretools_*` stamps' values: instrument, DDI digest, version. */
	readonly stamp?: readonly string[];
	/** Columns added at the end: name, label, row 3's JSON. */
	readonly extra?: readonly (readonly [string, string, object])[];
	/** Whether a question's column (by ImportId and tag) is left out. */
	readonly drop?: (importId: string, tag: string) => boolean;
}

/**
 * The response export of a survey `qsfOf` made, in Qualtrics' shape (three header rows, a
 * column per round and option), with one response whose every answer is `SECRET`.
 */
export function exportOfSurvey(
	made: { readonly qsf: QsfObject; readonly columns: ColumnMap },
	{
		qid = (x) => x,
		tag = (x) => x,
		text = (x) => x,
		stamp = ["", "", ""],
		extra = [],
		drop = () => false,
	}: ExportOptions = {},
): string {
	const payloads = new Map(
		(
			made.qsf.SurveyElements as {
				Element: string;
				PrimaryAttribute: string;
				Payload: { DataExportTag: string; QuestionText: string };
			}[]
		)
			.filter((e) => e.Element === "SQ")
			.map((e) => [e.PrimaryAttribute, e.Payload]),
	);

	const columns: (readonly [string, string, object])[] = [
		["ResponseId", "Response ID", { ImportId: "_recordId" }],
		["StartDate", "Start Date", { ImportId: "startDate", timeZone: "Z" }],
		...(
			["qretools_instrument", "qretools_ddi", "qretools_version"] as const
		).map((f) => [f, f, { ImportId: f }] as const),
	];
	for (const c of made.columns.columns) {
		const m = /^(QID\d+)(.*)$/.exec(c.importId);
		const p = m === null ? undefined : payloads.get(m[1] ?? "");
		for (const e of expand(c)) {
			if (m === null || p === undefined) {
				columns.push([e.importId, e.importId, { ImportId: e.importId }]);
				continue;
			}
			const round = e.importId === c.importId ? "" : e.importId.split("_")[0];
			const id = `${round ? `${round}_` : ""}${qid(m[1] ?? "")}${m[2]}`;
			if (drop(id, p.DataExportTag)) continue;
			columns.push([
				`${round ? `${round}_` : ""}${tag(p.DataExportTag)}${c.choice === undefined ? "" : `_${c.choice}`}`,
				`${round ? `${round} - ` : ""}${text(p.QuestionText)}${c.choice === undefined ? "" : " - an option"}`,
				{ ImportId: id, ...(c.choice !== undefined && { choiceId: c.choice }) },
			]);
		}
	}
	columns.push(...extra);
	const csv = (xs: readonly string[]) =>
		xs
			.map((x) => (/[",]/.test(x) ? `"${x.replaceAll('"', '""')}"` : x))
			.join(",");
	return [
		csv(columns.map((c) => c[0])),
		csv(columns.map((c) => c[1])),
		columns.map((c) => cell(c[2])).join(","),
		csv([
			"R_1",
			"2026-01-01",
			...stamp,
			...columns.slice(5).map(() => "SECRET"),
		]),
	].join("\r\n");
}
