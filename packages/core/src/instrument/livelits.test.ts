import { describe, expect, it } from "vitest";
import { addressOf, joinFolder } from "../address.ts";
import { bankOf } from "../evaluate.ts";
import { applyLivelit } from "../surface/livelits.ts";
import { instrumentOf } from "./instrument.ts";
import { bankChoices, questionChoices } from "./livelits.ts";

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
			l.picker.source.kind,
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
