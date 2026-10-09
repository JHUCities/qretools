import { describe, expect, it } from "vitest";
import { addressOf, joinFolder } from "../address.ts";
import { bankOf } from "../evaluate.ts";
import { applyLivelit } from "../surface/livelits.ts";
import { instrumentOf } from "./instrument.ts";
import { bankChoices, codeChoices, questionChoices } from "./livelits.ts";
import { parseInstrument } from "./parse.ts";

const BAS = bankOf({
	"bank.yaml": "agency: org.example\n",
	"questions/h/tenure.yaml":
		'name: tenure\ntext: Do you own or rent?\nintent: i\nresponses:\n  "1": Own\n  "2": Rent\n',
	"questions/h/rent.yaml":
		"name: rent\ntext: How much is your rent?\nintent: i\nnumber: { min: 0 }\n",
	"questions/m/modes.yaml":
		'name: modes\ntitle: Travel modes\ntext: How do you travel?\nintent: i\nselect: many\nresponses:\n  "b": Bus\n  "w": Walk\n',
	"questions/n/why.yaml": "name: why\ntext: Why?\nintent: i\nopen: {}\n",
});

const SOURCE = `name: demo
uses:
  bas: ../banks/bas
  other:
flow:
  - ask: bas.tenure
    options: random
  - ask:
  - ask: bas.nothing
  - ask: Do you rent?
  - section: Travel
    order:
    flow:
      - if: bas.tenure = "2"
        then:
          - ask: bas.rent
      - roster: people
        count: 2
        flow:
          - ask: bas.why
`;

const ids = (banks: Parameters<typeof instrumentOf>[1]["banks"]) =>
	instrumentOf(SOURCE, { banks }).livelits;

describe("an instrument's pickers", () => {
	it("sit at each use, each ask naming a question or empty, and each order, at any depth", () => {
		const shown = ids({ bas: BAS }).map((l) => [
			l.id,
			SOURCE.slice(l.span[0], l.span[1]),
			l.picker.kind === "actions" ? "actions" : l.picker.source.kind,
		]);
		expect(shown).toEqual([
			["uses.bas", "../banks/bas", "banks"],
			["uses.other", "", "banks"],
			["flow.0.ask", "bas.tenure", "questions"],
			["flow.0.options", "random", "enum"],
			["flow.1.ask", "", "questions"],
			["flow.2.ask", "bas.nothing", "questions"],
			// Not at `Do you rent?`: prose isn't a question's name.
			["flow.4.order", "", "enum"],
			["flow.4.flow.0.then.0.ask", "bas.rent", "questions"],
			["flow.4.flow.1.flow.0.ask", "bas.why", "questions"],
		]);
	});

	it("sit at any name the parse reads as a question's, however unusual", () => {
		const text = "uses:\n  b9_: ./b\nflow:\n  - ask: b9_.x_1_\n";
		expect(instrumentOf(text, { banks: {} }).livelits.map((l) => l.id)).toEqual(
			["uses.b9_", "flow.0.ask"],
		);
	});

	it("offer a new bank here, or one from GitHub, at each use", () => {
		const uses = ids({}).find((l) => l.id === "uses.other");
		expect(uses?.actions).toEqual([
			{
				kind: "bank",
				label: "New bank in this workspace…",
				how: "new",
				path: "uses.other",
			},
			{
				kind: "bank",
				label: "Use a bank from GitHub…",
				how: "import",
				path: "uses.other",
			},
		]);
	});

	it("are the same whether the banks resolve or not, so a choice finds its picker", () => {
		expect(ids({})).toEqual(ids({ bas: BAS }));
	});

	it("write a question's name over an empty ask", () => {
		const l = ids({}).find((x) => x.id === "flow.1.ask");
		expect(l && applyLivelit(SOURCE, l, "bas.rent")?.text).toContain(
			"  - ask: bas.rent\n  - ask: bas.nothing",
		);
	});
});

describe("what the pickers offer", () => {
	it("lists every question with its answer and its title or text", () => {
		expect(questionChoices({ bas: BAS })).toEqual(
			expect.arrayContaining([
				{
					name: "bas.tenure",
					detail: "select one, 2 options · Do you own or rent?",
				},
				{ name: "bas.rent", detail: "number · How much is your rent?" },
				{
					name: "bas.modes",
					detail: "select all that apply, 2 options · Travel modes",
				},
				{ name: "bas.why", detail: "open · Why?" },
			]),
		);
	});

	it("lists the workspace's banks as written from the instrument, then GitHub's", () => {
		const remote = addressOf("JHUCities/Bank/banks/hh@v1");
		const choices = bankChoices(
			"instruments",
			["", "banks/hh"],
			remote.kind === "remote" ? [remote] : [],
		);
		expect(choices.map((c) => c.name)).toEqual([
			"../",
			"../banks/hh",
			// As written, not the lowercased key.
			"JHUCities/Bank/banks/hh@v1",
		]);
		for (const [c, bank] of [
			[choices[0], ""],
			[choices[1], "banks/hh"],
		] as const) {
			const a = addressOf(c?.name ?? "");
			expect(a.kind === "local" && joinFolder("instruments", a.path)).toBe(
				bank,
			);
		}
	});
});

describe("a checklist at each set of codes in a condition", () => {
	const HEADER =
		"name: demo\nuses:\n  bas: ../banks/bas\nflow:\n  - ask: bas.tenure\n";
	const sets = (source: string) =>
		instrumentOf(source, { banks: {} }).livelits.filter((l) => l.set);
	const write = (source: string, id: string, codes: readonly string[]) => {
		const l = sets(source).find((x) => x.id === id);
		return l === undefined ? undefined : applyLivelit(source, l, codes)?.text;
	};
	/** The sets the condition at `path` tests, as the parser reads them back. */
	const readBack = (source: string, path: string) =>
		parseInstrument(source, {})
			.conds.filter((c) => c.path === path)
			.map((c) =>
				JSON.stringify(c.cond.expr)
					.match(/"value":"[^"]*"/g)
					?.join(","),
			);

	it("sits at each set, in the order its condition reads, and each writes its own", () => {
		const text = `${HEADER}  - if: (bas.tenure in {"1"}) or (bas.tenure not_in {"2", "3"})\n    then:\n      - say: Hi\n`;
		const found = sets(text);
		expect(found.map((l) => [l.id, text.slice(l.span[0], l.span[1])])).toEqual([
			["flow.1.if#0", '{"1"}'],
			["flow.1.if#1", '{"2", "3"}'],
		]);
		expect(found[1]?.picker).toEqual({
			kind: "many",
			source: { kind: "codes", name: "bas.tenure" },
			chosen: ["2", "3"],
			min: 1,
		});
		expect(write(text, "flow.1.if#1", ["1", "-8"])).toBe(
			text.replace('{"2", "3"}', '{"1", "-8"}'),
		);
	});

	it("writes into a plain, double- or single-quoted value, and reads back the same set", () => {
		for (const value of [
			'bas.tenure in {"1"}',
			'"bas.tenure in {\\"1\\"}"',
			"'bas.tenure in {\"1\"}'",
		]) {
			const text = `${HEADER}  - stop: ${value}\n`;
			const after = write(text, "flow.1.stop#0", ["1", "2"]);
			expect(after, value).toBeDefined();
			expect(readBack(after ?? "", "flow.1.stop")).toEqual([
				'"value":"1","value":"2"',
			]);
		}
	});

	it("draws a lone set's button after the whole value, never inside its quotes", () => {
		const text = `${HEADER}  - stop: "bas.tenure in {\\"1\\"}"\n`;
		const [lone] = sets(text);
		expect(lone?.at).toBe(text.indexOf('}"') + 2);
		const two = `${HEADER}  - stop: bas.tenure in {"1"} or bas.tenure in {"2"}\n`;
		expect(sets(two).map((l) => two.slice(l.at - 1, l.at))).toEqual(["}", "}"]);
	});

	it("writes nothing when nothing changes, and nothing it can't escape", () => {
		const text = `${HEADER}  - stop: bas.tenure in {"1", "2"}\n`;
		expect(write(text, "flow.1.stop#0", ["1", "2"])).toBeUndefined();
		expect(write(text, "flow.1.stop#0", ['a"b'])).toBeUndefined();
	});

	it("is absent from a set holding more than codes, an unclosed one, and a block scalar", () => {
		for (const value of [
			'bas.tenure in {"1", x}',
			'bas.tenure in {"1"',
			'>\n      bas.tenure in {"1"}',
		])
			expect(sets(`${HEADER}  - stop: ${value}\n`), value).toEqual([]);
	});

	it("offers the name's codes with their labels, or says why there are none", () => {
		// The names a set's checklist asks about are those its conditions read.
		const text = `${HEADER}  - ask: bas.rent\n  - stop: bas.tenure in {"1"} or bas.rent in {"1"}\n`;
		expect(codeChoices(text, { bas: BAS }, "bas.tenure")).toEqual([
			{ name: "1", detail: "Own" },
			{ name: "2", detail: "Rent" },
		]);
		expect(codeChoices(text, { bas: BAS }, "bas.rent")).toEqual({
			reason: "`bas.rent` is a number: it has no codes.",
		});
		expect(codeChoices(text, { bas: BAS }, "nope")).toEqual({
			reason: "Nothing is named `nope` here.",
		});
	});
});
