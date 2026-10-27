import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { printCondition } from "../cond/print.ts";
import type { DdiDocument, JsonObject } from "../ddi/document.ts";
import { ddiIndexOf } from "../ddi/read.ts";
import { bankOf } from "../evaluate.ts";
import { exampleInstrument } from "../instrument/example.ts";
import { instrumentOf } from "../instrument/instrument.ts";
import {
	type Condition,
	readInstruments,
	type Step,
} from "../instrument/read.ts";
import { readWorkspace } from "./index.ts";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

const cond = (c: Condition): string =>
	c.kind === "parsed"
		? printCondition(c.expr)
		: `as written: ${c.command.text}`;

/** A flow as indented lines: each step's kind and what it turns on. */
const lines = (steps: readonly Step[], ind = ""): string[] =>
	steps.flatMap((s): string[] => {
		const inner = (flow: readonly Step[]) => lines(flow, `${ind}  `);
		switch (s.kind) {
			case "ask":
				return [
					`${ind}ask ${s.question.name} ${s.records.map((r) => r.variable).join(",")}`,
					...s.checks.map(
						(c) => `${ind}  check ${c.severity} ${cond(c.ensure)}`,
					),
				];
			case "say":
				return [`${ind}say`];
			case "compute":
				return [`${ind}compute ${s.variable} = ${cond(s.value)}`];
			case "if":
				return [
					...s.branches.flatMap((b) => [
						`${ind}if${s.type === undefined ? "" : ` (${s.type})`} ${cond(b.cond)}`,
						...inner(b.then),
					]),
					...(s.else === undefined ? [] : [`${ind}else`, ...inner(s.else)]),
				];
			case "stop":
				return [
					`${ind}stop ${cond(s.cond)}`,
					...inner(s.say),
					...lines(s.else, ind),
				];
			case "count":
				return [`${ind}count ${cond(s.count)} max ${s.max}`, ...inner(s.flow)];
			case "repeat":
				return [`${ind}repeat ${cond(s.more)} max ${s.max}`, ...inner(s.flow)];
			case "loop":
				return [`${ind}${s.construct} ${cond(s.cond)}`, ...inner(s.flow)];
			case "section":
				return [`${ind}section ${s.name ?? ""}`, ...inner(s.flow)];
			default:
				return s satisfies never;
		}
	});

describe("reading an instrument's DDI back", async () => {
	const root = here("../../fixtures/households");
	const hh = bankOf(await readWorkspace(root));
	const ddiOf = (text: string) =>
		instrumentOf(text, { banks: { hh }, agency: "org.example" }).ddi;
	const ddi = ddiOf(
		await readFile(`${root}/instruments/households.yaml`, "utf8"),
	);
	const blocking = ddiOf(`name: blocking
uses:
  hh: ../
flow:
  - say: About your home.
  - ask: hh.rent
    checks:
      - ensure: hh.rent >= 0
        severity: blocking
        message: Rent can't be negative.
`);
	/** Every step, at any depth. */
	const all = (steps: readonly Step[]): Step[] =>
		steps.flatMap((s) => [
			s,
			...all(
				s.kind === "if"
					? [...s.branches.flatMap((b) => b.then), ...(s.else ?? [])]
					: s.kind === "stop"
						? [...s.say, ...s.else]
						: "flow" in s
							? s.flow
							: [],
			),
		]);

	/** The DDI with one item changed, by the end of its ID. */
	const changed = (
		type: keyof DdiDocument,
		id: string,
		change: (item: JsonObject) => JsonObject,
		from: DdiDocument = ddi,
	): DdiDocument => {
		const items = { ...(from[type] ?? {}) };
		const [key, item] =
			Object.entries(items).find(([, i]) => String(i.ID).endsWith(id)) ?? [];
		if (key === undefined || item === undefined) throw new Error(id);
		items[key] = change(item);
		return { ...from, [type]: items };
	};
	const read = (d: DdiDocument) => readInstruments(ddiIndexOf(d));

	it("lifts back what the elaborator lowers: checks, rosters, a screen-out", () => {
		const { value, findings } = read(ddi);
		expect(findings).toEqual([]);
		expect(value.inputs.map((i) => i.variable)).toEqual(["county"]);
		expect(value.instruments.map((i) => i.name)).toEqual(["households"]);
		expect(lines(value.instruments[0]?.flow ?? [])).toMatchInlineSnapshot(`
			[
			  "say",
			  "ask consent consent",
			  "stop consent = "2"",
			  "  say",
			  "ask size size",
			  "count size max 20",
			  "  say",
			  "  ask age age",
			  "  ask works works",
			  "section Housing",
			  "  ask tenure tenure",
			  "  compute renter = tenure = "2"",
			  "  if renter",
			  "    ask rent rent",
			  "      check warning rent < 10000",
			  "    ask utilities utilities",
			  "repeat more_vehicles = "1" max 4",
			  "  ask vehicle vehicle",
			  "  ask more_vehicles more_vehicles",
			  "count size max 20",
			  "  if works = "1"",
			  "    say",
			  "ask comments comments",
			]
		`);
	});

	it("keeps a condition it can't parse as written, and the structure around it", () => {
		const { value, findings } = read(
			changed("IfThenElse", ".if-1", (b) => ({
				...b,
				IfCondition: {
					Command: [
						{
							ProgramLanguage: { StringValue: "SPSS" },
							CommandContent: "renter EQ 1",
						},
					],
				},
			})),
		);
		expect(findings.map((f) => [f.code, f.severity])).toEqual([
			["ddi-verbatim", "info"],
		]);
		expect(lines(value.instruments[0]?.flow ?? [])).toContain(
			"  if as written: renter EQ 1",
		);
	});

	it("asks a question whose domain it doesn't read, its domain `other`", () => {
		const { value, findings } = read(
			changed("QuestionItem", "rent", (q) => ({
				...q,
				ResponseDomain: { $type: "DateTimeDomain" },
			})),
		);
		expect(findings).toEqual([]);
		const rent = all(value.instruments[0]?.flow ?? []).find(
			(s) => s.kind === "ask" && s.question.name === "rent",
		);
		expect(rent?.kind === "ask" && rent.question.domain).toEqual({
			kind: "other",
		});
	});

	it("shows a text in the language asked for, else the first", () => {
		const said = (lang?: string) => {
			const two = changed("StatementItem", "say-1", (st) => {
				const [en] = st.DisplayText as JsonObject[];
				const words = (v: string) => ({
					...en,
					AudienceLanguage: v,
					TextContent: [
						{ Text: { MultilingualStringValue: { LanguageTag: v, Value: v } } },
					],
				});
				return { ...st, DisplayText: [words("en"), words("es")] };
			});
			const first = readInstruments(ddiIndexOf(two), lang).value.instruments[0]
				?.flow[0];
			return first?.kind === "say" ? first.text : undefined;
		};
		expect(said("es")).toEqual([{ kind: "text", text: "es" }]);
		expect(said("fr")).toEqual([{ kind: "text", text: "en" }]);
	});

	it("reads a loop that isn't a roster as a loop", () => {
		const { value } = read(
			changed("Loop", ".roster-members", (l) => {
				const code = l.LoopWhile as JsonObject;
				const [first] = code.Command as JsonObject[];
				return {
					...l,
					LoopWhile: {
						...code,
						Command: [{ ...first, CommandContent: "members_index > size" }],
					},
				};
			}),
		);
		expect(lines(value.instruments[0]?.flow ?? [])).toContain(
			"Loop members_index > size",
		);
	});

	it("says where a step refers to itself, and stops", () => {
		const { findings } = read(
			changed("Sequence", "-then", (s) => ({
				...s,
				ControlConstructReference: [
					...(s.ControlConstructReference as JsonObject[]),
					{ URN: String(s.URN) },
				],
			})),
		);
		expect(findings.map((f) => f.code)).toEqual(["ddi-unread"]);
	});

	it("lifts the example instrument whole: a label fill, a check, a form experiment", async () => {
		const example = exampleInstrument(
			"example",
			"../",
			bankOf(await readWorkspace(here("../../fixtures/bank"))),
		);
		const { value, findings } = read(
			instrumentOf(example ?? "", {
				banks: {
					example: bankOf(await readWorkspace(here("../../fixtures/bank"))),
				},
				agency: "org.example",
			}).ddi,
		);
		expect(findings).toEqual([]);
		const steps = all(value.instruments[0]?.flow ?? []);
		expect(steps.some((s) => s.kind === "loop")).toBe(false);
		expect(steps.some((s) => s.kind === "if" && s.type !== undefined)).toBe(
			false,
		);
		expect(
			steps.some(
				(s) =>
					s.kind === "ask" && s.text.some((p) => p.kind === "value" && p.label),
			),
		).toBe(true);
		expect(
			steps.flatMap((s) => (s.kind === "ask" ? s.checks : [])),
		).toHaveLength(1);
	});

	it("lifts a blocking check: the ask, asked again until it holds", () => {
		const { value, findings } = read(blocking);
		expect(findings).toEqual([]);
		expect(lines(value.instruments[0]?.flow ?? [])).toEqual([
			"say",
			"ask rent rent",
			"  check blocking rent >= 0",
		]);
	});

	it("keeps a repeat whose body is more than an ask and its checks", () => {
		const say = Object.values(blocking.StatementItem ?? {})[0];
		const { value } = read(
			changed(
				"Sequence",
				"-until-body",
				(s) => ({
					...s,
					ControlConstructReference: [
						...(s.ControlConstructReference as JsonObject[]),
						{ URN: String(say?.URN) },
					],
				}),
				blocking,
			),
		);
		expect(lines(value.instruments[0]?.flow ?? [])).toEqual([
			"say",
			"RepeatUntil nvl(rent >= 0, true)",
			"  ask rent rent",
			"    check blocking rent >= 0",
			"  say",
		]);
	});

	it("reads a check that does more than say its message as a typed if", () => {
		const say = Object.values(ddi.StatementItem ?? {})[0];
		const { value } = read(
			changed("Sequence", "check-1-then", (s) => ({
				...s,
				ControlConstructReference: [
					...(s.ControlConstructReference as JsonObject[]),
					{ URN: String(say?.URN) },
				],
			})),
		);
		const flow = lines(value.instruments[0]?.flow ?? []);
		expect(flow).toContain("    ask rent rent");
		expect(flow).toContain("    if (warning) not nvl(rent < 10000, true)");
	});
});
