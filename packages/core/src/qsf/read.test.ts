import { describe, expect, it } from "vitest";
import type { DdiDocument, JsonObject } from "../ddi/document.ts";
import { readInstrument } from "./read.ts";
import { demoDdi, outline } from "./testing.ts";

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

	it("refuses one ask placed twice in the flow", () => {
		const ddi = tampered("Sequence", "if-1-else", (q) => ({
			...q,
			ControlConstructReference: [
				...(q.ControlConstructReference as JsonObject[]),
				...((
					Object.values(demoDdi().Sequence ?? {}).find(
						(x) => x.ID === "instrument-demo.if-1-elif-1-then",
					)?.ControlConstructReference as JsonObject[] | undefined
				)?.slice(0, 1) ?? []),
			],
		}));
		expect(found(ddi)).toEqual([
			["qsf-inexpressible", "instrument-demo.ask-modes"],
		]);
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
