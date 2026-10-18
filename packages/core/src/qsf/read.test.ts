import { describe, expect, it } from "vitest";
import type { DdiDocument, JsonObject } from "../ddi/document.ts";
import { bankOf } from "../evaluate.ts";
import {
	elaborateInstrument,
	instrumentDocument,
} from "../instrument/elaborate.ts";
import { parseInstrument } from "../instrument/parse.ts";
import { readInstrument } from "./read.ts";
import { outline } from "./testing.ts";

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

const demoDdi = (): DdiDocument =>
	instrumentDocument(
		elaborateInstrument(parseInstrument(SOURCE, { bas: BAS }), {
			agency: "org.example",
		}),
	).document;

describe("reading an instrument's DDI back", () => {
	it("reads every construct of the demonstration: checks, branches, labels, a renamed ask", () => {
		const { instrument, findings } = readInstrument(demoDdi());
		expect(findings).toEqual([]);
		expect(instrument.inputs.map((i) => i.variable)).toEqual([
			"jurisdiction",
			"wave",
		]);
		expect(outline(instrument.flow)).toMatchInlineSnapshot(`
			[
			  "say Thank you for taking part, in <input:jurisdiction>.",
			  "ask consent choice consent: consent?",
			  "stop consent = "2" {consent=consent}",
			  "  say Thank you for your time.",
			  "section Housing random",
			  "  ask tenure choice tenure: tenure?",
			  "  ask echo text echo: You selected <tenure:label>.",
			  "  compute renter = tenure = "2" {tenure=tenure}",
			  "  if renter {renter=compute:renter}",
			  "    ask rent number rent: rent?",
			  "      check blocking rent >= 0 {rent=rent}: The rent can't be negative.",
			  "      check warning rent < 10000 {rent=rent}: <rent> is a lot. Is that right?",
			  "    ask util text util: You pay <rent>. Utilities included?",
			  "  elif tenure = "1" {tenure=tenure}",
			  "    ask modes choice* modes_b#b,modes_w#w: modes?",
			  "    ask pets choice* pets_d#d: pets?",
			  "  else",
			  "    say Neither, then.",
			  "    ask pets choice* pets_d#d: pets?",
			  "ask size number size: size?",
			  "loop count size {people_index=row(roster-people), size=size} max 9",
			  "  ask nick text nick: nick?",
			  "ask why text why rotate: why?",
			  "ask why text why_end: why?",
			]
		`);
	});

	it("says what it can't read, at the DDI item, and carries on", () => {
		const ddi = demoDdi();
		const branches = { ...(ddi.IfThenElse ?? {}) };
		// An author's if whose condition isn't VTL the export reads.
		const [key, first] =
			Object.entries(branches).find(([, b]) =>
				String(b.ID).endsWith(".if-1"),
			) ?? [];
		if (key === undefined || first === undefined) throw new Error("no if");
		const broken: JsonObject = {
			...first,
			IfCondition: { Command: [{ CommandContent: "renter =" }] },
		};
		const { findings } = readInstrument({
			...ddi,
			IfThenElse: { ...branches, [key]: broken },
		});
		expect(findings.map((f) => [f.code, f.path])).toEqual([
			["qsf-unread", first.ID],
		]);
		expect(readInstrument({}).findings.map((f) => f.code)).toEqual([
			"qsf-unread",
		]);
	});

	/** The demonstration's DDI with one item changed, by the end of its ID. */
	const tampered = (
		type: "Loop" | "IfThenElse" | "QuestionConstruct" | "Sequence",
		id: string,
		change: (item: JsonObject) => JsonObject | undefined,
	): DdiDocument => {
		const ddi = demoDdi();
		const items = { ...(ddi[type] ?? {}) };
		const [key, item] =
			Object.entries(items).find(([, i]) => i.ID === `instrument-demo.${id}`) ??
			[];
		if (key === undefined || item === undefined) throw new Error(id);
		const changed = change(item);
		if (changed === undefined) delete items[key];
		else items[key] = changed;
		return { ...ddi, [type]: items };
	};
	const command = (
		item: JsonObject,
		key: string,
		f: (c: JsonObject) => JsonObject,
	) => {
		const code = item[key] as JsonObject;
		const [first] = code.Command as JsonObject[];
		return { ...item, [key]: { ...code, Command: [f(first as JsonObject)] } };
	};
	const found = (ddi: DdiDocument) =>
		readInstrument(ddi).findings.map((f) => [f.code, f.path]);

	it("reads only a roster's own loop condition", () => {
		const ddi = tampered("Loop", "roster-people", (l) =>
			command(l, "LoopWhile", (c) => ({
				...c,
				CommandContent: "people_index > size",
			})),
		);
		expect(found(ddi)).toEqual([
			["qsf-unread", "instrument-demo.roster-people"],
		]);
	});

	it("reads a name only through its binding", () => {
		const ddi = tampered("IfThenElse", "if-1", (b) =>
			command(b, "IfCondition", (c) => ({ ...c, Binding: [] })),
		);
		expect(found(ddi)).toEqual([["qsf-unread", "instrument-demo.if-1"]]);
	});

	it("reads a check only straight after its ask", () => {
		const ddi = tampered("Sequence", "ask-rent-until-body", (s) => ({
			...s,
			ControlConstructReference: [
				...(s.ControlConstructReference as JsonObject[]),
			].reverse(),
		}));
		expect(found(ddi)).toContainEqual([
			"qsf-unread",
			"instrument-demo.ask-rent-check-2",
		]);
	});

	it("says which construct refers to one that isn't there", () => {
		const ddi = tampered("Sequence", "if-1-else", () => undefined);
		expect(found(ddi)).toEqual([["qsf-unread", "instrument-demo.if-1"]]);
	});

	it("refuses one variable recorded by asks a respondent can meet both of", () => {
		const pets = Object.values(demoDdi().QuestionConstruct ?? {}).find(
			(c) => c.ID === "instrument-demo.ask-pets-2",
		);
		const extra = ((pets?.Binding as JsonObject[] | undefined) ?? []).at(-1);
		if (extra === undefined) throw new Error("no answer binding");
		const ddi = tampered("QuestionConstruct", "ask-why", (c) => ({
			...c,
			Binding: [...((c.Binding as JsonObject[] | undefined) ?? []), extra],
		}));
		expect(found(ddi)).toEqual([
			["qsf-inexpressible", "instrument-demo.ask-why"],
		]);
	});
});
