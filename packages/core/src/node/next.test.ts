import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ddiIndexOf } from "../ddi/read.ts";
import { bankOf } from "../evaluate.ts";
import { instrumentOf } from "../instrument/instrument.ts";
import { Next, NextState, nextStep } from "../instrument/next.ts";
import {
	type Condition,
	type Parsed,
	readInstruments,
	type Step,
} from "../instrument/read.ts";
import { recordsOf } from "../instrument/records.ts";
import { readWorkspace } from "./index.ts";

const root = fileURLToPath(
	new URL("../../fixtures/households", import.meta.url),
);
const files = {
	...(await readWorkspace(root)),
	// A select-all question with an instruction, which the fixture bank lacks.
	"questions/household/pets.yaml": `name: pets
text: Which pets live in your home?
intent: Pets in the household
instruction: Read the list aloud.
select: many
responses:
  "1": Dog
  "2": Cat
`,
};
const bank = bankOf(files);
const flowOf = (yaml: string) => {
	const read = readInstruments(
		ddiIndexOf(
			instrumentOf(yaml, {
				banks: { hh: bank },
				agency: "org.example",
				host: bank.env,
			}).ddi,
		),
	).value;
	const instrument = read.instruments[0];
	if (instrument === undefined) throw new Error("no instrument read");
	return { instrument, inputs: read.inputs };
};
const households = flowOf(
	await readFile(`${root}/instruments/households.yaml`, "utf8"),
);

/** The reply to a state, checked against the published output schema. */
const next = (state: NextState, { instrument, inputs } = households): Next => {
	const r = nextStep(instrument, inputs, NextState.parse(state));
	if (!r.ok) throw new Error(r.error);
	return Next.parse(r.value);
};
const refused = (state: NextState, flow = households): string => {
	const r = nextStep(flow.instrument, flow.inputs, NextState.parse(state));
	return r.ok ? "" : r.error;
};
/** The URN of the variable a question records, read from the reply that asks it. */
const urnOf = (reply: Next): string => {
	if (reply.kind !== "ask" || reply.domain.kind === "select-all")
		throw new Error(`not a single question: ${JSON.stringify(reply)}`);
	return reply.domain.variable;
};

describe("the next step through the households instrument", () => {
	it("asks for an input the route needs, and only when it needs one", () => {
		const first = next({});
		expect(first).toMatchObject({ kind: "input", name: "county" });
		expect(first.kind === "input" && first.domain).toEqual({
			kind: "choice",
			choices: [
				{ code: "1", label: "North County" },
				{ code: "2", label: "South County" },
			],
		});
	});

	it("pipes fills in, gives the statements on the way, and the domain with its missing codes", () => {
		const consent = next({ inputs: { county: "1" } });
		expect(consent).toMatchObject({
			kind: "ask",
			question: "consent",
			text: "Do you agree to take part in this survey?",
			statements: ["Thank you for taking part in this survey of 1."],
			domain: {
				kind: "choice",
				name: "consent",
				choices: [
					{ code: "1", label: "Yes" },
					{ code: "2", label: "No" },
				],
				missing: [
					{ code: "-8", label: "Refused" },
					{ code: "-9", label: "Don't know" },
				],
			},
		});
	});

	it("screens out, with the screen-out's words", () => {
		const consent = urnOf(next({ inputs: { county: "1" } }));
		expect(
			next({
				inputs: { county: "1" },
				answers: [{ variable: consent, value: "2" }],
			}),
		).toEqual({
			kind: "end",
			how: "stopped",
			statements: ["Thank you for your time."],
			notes: [],
		});
	});

	it("walks a roster row by row, keyed by row, then the rest to the end", () => {
		const base = { county: "1" };
		const consent = urnOf(next({ inputs: base }));
		const answers: NextState["answers"] & object[] = [
			{ variable: consent, value: "1" },
		];
		const step = () => next({ inputs: base, answers });
		const answer = (value: string | number, row?: number) => {
			const reply = step();
			answers.push({
				variable: urnOf(reply),
				value,
				...(row !== undefined && { row }),
			});
			return reply;
		};
		answer(2);
		expect(answer(40, 1)).toMatchObject({
			question: "age",
			row: 1,
			statements: ["The next questions are about person 1."],
		});
		answer("1", 1);
		expect(answer("-9", 2)).toMatchObject({ question: "age", row: 2 });
		answer("2", 2);
		expect(answer("2")).toMatchObject({ question: "tenure" });
		expect(answer(900)).toMatchObject({ question: "rent" });
		// The rent's warning check doesn't stop it; its value fills the next text.
		expect(answer("1")).toMatchObject({
			question: "utilities",
			text: "You said you pay 900 a month. Does that include utilities?",
		});
		expect(answer("1", 1)).toMatchObject({ question: "vehicle", row: 1 });
		expect(answer("1", 1)).toMatchObject({ question: "more_vehicles", row: 1 });
		answer("1", 2);
		expect(answer("2", 2)).toMatchObject({ question: "more_vehicles", row: 2 });
		expect(answer("No more")).toMatchObject({
			question: "comments",
			statements: ["Person 1 works."],
		});
		expect(step()).toEqual({
			kind: "end",
			how: "end",
			statements: [],
			notes: [],
		});
	});

	it("reads only the answers on the route: a changed answer drops what followed it", () => {
		const base = { county: "1" };
		const consent = urnOf(next({ inputs: base }));
		const size = urnOf(
			next({ inputs: base, answers: [{ variable: consent, value: "1" }] }),
		);
		const answers = [
			{ variable: consent, value: "1" },
			{ variable: size, value: "-8" },
		];
		const tenure = urnOf(next({ inputs: base, answers }));
		const rent = urnOf(
			next({
				inputs: base,
				answers: [...answers, { variable: tenure, value: "2" }],
			}),
		);
		// Owners aren't asked the rent: its answer stays, but nothing reads it.
		expect(
			next({
				inputs: base,
				answers: [
					...answers,
					{ variable: tenure, value: "1" },
					{ variable: rent, value: 900 },
				],
			}),
		).toMatchObject({ question: "vehicle", row: 1 });
	});

	it("asks a question again when its answer can't be taken", () => {
		const consent = urnOf(next({ inputs: { county: "1" } }));
		expect(
			next({
				inputs: { county: "1" },
				answers: [{ variable: consent, value: "3" }],
			}),
		).toMatchObject({
			question: "consent",
			problem: '"3" isn\'t one of its codes (1, 2, -8, -9).',
		});
		const size = urnOf(
			next({
				inputs: { county: "1" },
				answers: [{ variable: consent, value: "1" }],
			}),
		);
		const sized = (value: string | number) =>
			next({
				inputs: { county: "1" },
				answers: [
					{ variable: consent, value: "1" },
					{ variable: size, value },
				],
			});
		expect(sized(21)).toMatchObject({
			question: "size",
			problem: '"21" isn\'t a number from 1 to 20.',
		});
		expect(sized(1.5)).toMatchObject({
			problem: '"1.5" has more than 0 decimal places.',
		});
		// A number's missing code is taken, and has no value: the roster has no rows.
		expect(sized("-8")).toMatchObject({
			question: "tenure",
			notes: [
				{
					code: "next-no-count",
					message: expect.stringMatching(
						/count has no value, so it has no rows/,
					),
				},
			],
		});
	});

	it("refuses a state that can't belong to the instrument", () => {
		const consent = urnOf(next({ inputs: { county: "1" } }));
		expect(refused({ inputs: { region: "1" } })).toBe(
			"The instrument has no input `region`; its inputs are `county`.",
		);
		expect(refused({ inputs: { county: "3" } })).toBe(
			'Input `county`: "3" isn\'t one of its codes (1, 2, -8, -9).',
		);
		expect(refused({ inputs: { county: 1 } })).toMatch(/as a string/);
		// An input takes its missing codes, as an answer does.
		expect(next({ inputs: { county: "-9" } })).toMatchObject({
			question: "consent",
		});
		expect(refused({ answers: [{ variable: "urn:x", value: "1" }] })).toMatch(
			/No question in this instrument records/,
		);
		expect(refused({ answers: [{ variable: consent, value: 1 }] })).toMatch(
			/send its value as a string/,
		);
		expect(
			refused({ answers: [{ variable: consent, value: "1", row: 1 }] }),
		).toMatch(/isn't recorded in a roster/);
		expect(
			refused({
				answers: [
					{ variable: consent, value: "1" },
					{ variable: consent, value: "2" },
				],
			}),
		).toMatch(/answered twice/);
	});
});

describe("select all that apply, instructions and blocking checks", () => {
	const flow = flowOf(`name: pets
uses:
  hh: ../
flow:
  - ask: hh.pets
  - ask: hh.size
    checks:
      - ensure: hh.size < 10
        severity: blocking
        message: That's more than we expected.
`);
	it("gives each option its variable and codes, and wants every option", () => {
		const pets = next({}, flow);
		expect(pets).toMatchObject({
			question: "pets",
			instructions: ["Read the list aloud."],
		});
		if (pets.kind !== "ask" || pets.domain.kind !== "select-all")
			throw new Error("not select-all");
		const [dog, cat] = pets.domain.options;
		expect(dog).toMatchObject({
			code: "1",
			label: "Dog",
			ticked: "1",
			unticked: "0",
		});
		if (dog === undefined || cat === undefined) throw new Error("no options");
		expect(
			next({ answers: [{ variable: dog.variable, value: "1" }] }, flow),
		).toMatchObject({
			question: "pets",
			problem: expect.stringMatching(/Every option needs a value/),
		});
		const size = next(
			{
				answers: [
					{ variable: dog.variable, value: "1" },
					{ variable: cat.variable, value: "0" },
				],
			},
			flow,
		);
		expect(size).toMatchObject({ question: "size" });
		const answers = [
			{ variable: dog.variable, value: "1" },
			{ variable: cat.variable, value: "0" },
		];
		expect(
			next(
				{ answers: [...answers, { variable: urnOf(size), value: 12 }] },
				flow,
			),
		).toMatchObject({
			question: "size",
			problem: "That's more than we expected.",
		});
		expect(
			next(
				{ answers: [...answers, { variable: urnOf(size), value: 3 }] },
				flow,
			),
		).toMatchObject({ kind: "end", how: "end" });
	});
});

describe("an answer off the route", () => {
	const flow = flowOf(`name: offroute
uses:
  hh: ../
flow:
  - ask: hh.consent
  - if: hh.consent = "1"
    then:
      - ask: hh.tenure
  - if: isnull(hh.tenure)
    then:
      - ask: hh.comments
`);
	it("is never read by a condition", () => {
		const consent = urnOf(next({}, flow));
		const tenure = urnOf(
			next({ answers: [{ variable: consent, value: "1" }] }, flow),
		);
		// Consent changed to No: tenure isn't asked, so its old answer reads as none.
		expect(
			next(
				{
					answers: [
						{ variable: consent, value: "2" },
						{ variable: tenure, value: "1" },
					],
				},
				flow,
			),
		).toMatchObject({ question: "comments" });
	});
});

describe("a note's code", () => {
	const at = (id: string) => ({ id, urn: `urn:ddi:org.example:${id}:1` });
	const number = (n: number): Parsed => ({
		kind: "parsed",
		command: { text: String(n) },
		expr: { kind: "number", value: n, text: String(n), range: [0, 1] },
		sources: new Map(),
	});
	const verbatim: Condition = {
		kind: "verbatim",
		command: { text: "x > 1", language: "other" },
	};
	const asked = households.instrument.flow.find((s) => s.kind === "ask");
	if (asked === undefined) throw new Error("no ask in the fixture");
	const codesOf = (...flow: Step[]) => {
		const r = nextStep({ ...at("i"), flow }, [], NextState.parse({}));
		if (!r.ok) throw new Error(r.error);
		return r.value.notes.map((n) => n.code);
	};
	it.each<[string, Step]>([
		[
			"next-section-order",
			{ ...at("s"), kind: "section", order: "Random", flow: [] },
		],
		[
			"next-verbatim",
			{ ...at("f"), kind: "stop", cond: verbatim, say: [], else: [] },
		],
		["next-unrecorded", { ...asked, records: [] }],
		[
			"next-loop-skipped",
			{ ...at("l"), kind: "loop", construct: "Loop", cond: verbatim, flow: [] },
		],
		[
			"next-roster-cap",
			{ ...at("c"), kind: "count", count: number(150), flow: [] },
		],
	])("is %s", (code, step) => {
		expect(codesOf(step)).toEqual([code]);
	});
});

describe("the roster each variable is recorded in", () => {
	/** Each variable's name and its roster ("" outside one). */
	const rosters = (flow: typeof households) => {
		const r = recordsOf(flow.instrument.flow);
		if (!r.ok) throw new Error(r.error);
		return Object.fromEntries(
			[...r.value.values()].map((x) => [x.record.variable, x.roster ?? ""]),
		);
	};
	it("names each roster of the households instrument, and none for the rest", () => {
		expect(rosters(households)).toEqual({
			consent: "",
			size: "",
			age: "members",
			works: "members",
			tenure: "",
			rent: "",
			utilities: "",
			vehicle: "vehicles",
			more_vehicles: "vehicles",
			comments: "",
		});
	});
	it("puts a question asked in an `each` in its roster", () => {
		const flow = flowOf(`name: later
uses:
  hh: ../
flow:
  - ask: hh.size
  - roster: members
    count: hh.size
    flow:
      - ask: hh.age
  - each: members
    flow:
      - ask: hh.works
`);
		expect(rosters(flow)).toMatchObject({ age: "members", works: "members" });
	});
	it("refuses a roster inside a roster", () => {
		const flow = flowOf(`name: nested
uses:
  hh: ../
flow:
  - ask: hh.size
  - roster: members
    count: hh.size
    flow:
      - roster: vehicles
        more: hh.more_vehicles = "1"
        max: 4
        flow:
          - ask: hh.vehicle
          - ask: hh.more_vehicles
`);
		expect(recordsOf(flow.instrument.flow)).toEqual({
			ok: false,
			error: "A roster inside a roster (vehicles) isn't supported yet.",
		});
	});
});
