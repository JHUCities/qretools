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
		expect(outline(instrument.flow)).toMatchInlineSnapshot(`
			[
			  "say Thank you for taking part, in <input:jurisdiction>.",
			  "ask consent choice consent: consent?",
			  "stop consent = "2" {consent=consent}",
			  "  say Thank you for your time.",
			  "section Housing random",
			  "  ask tenure choice tenure: tenure?",
			  "  compute renter = tenure = "2" {tenure=tenure}",
			  "  if renter {renter=compute:renter}",
			  "    ask rent number rent: rent?",
			  "      check blocking rent >= 0 {rent=rent}: The rent can't be negative.",
			  "      check warning rent < 10000 {rent=rent}: <rent> is a lot. Is that right?",
			  "    ask util text util: You pay <rent>. Utilities included?",
			  "  elif tenure = "1" {tenure=tenure}",
			  "    ask modes choice* modes_b#b,modes_w#w: modes?",
			  "  else",
			  "    say Neither, then.",
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
});
