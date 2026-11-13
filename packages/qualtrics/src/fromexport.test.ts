import { bankOf, instrumentOf } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { qsfMapFromExport } from "./fromexport.ts";
import { qsfOf } from "./qsf.ts";
import { type ExportOptions, exportOfSurvey } from "./testing.ts";

const q = (name: string, rest: string) =>
	`name: ${name}\ntext: ${name}?\nintent: i\n${rest}`;
const BANK = bankOf({
	"workspace.yaml": "agency: org.bank\n",
	"missing.yaml": 'labels:\n  "D": Don\'t know\n',
	"scales/yesno01.yaml": 'labels:\n  "0": No\n  "1": Yes\n',
	"questions/a/tenure.yaml": q(
		"tenure",
		'responses:\n  "010": Own\n  "b": Rent\n',
	),
	"questions/a/modes.yaml": q(
		"modes",
		'select: many\nresponses:\n  "1": Bus\n  "b": Bike\n',
	),
	"questions/a/size.yaml": q("size", "number: { max: 2 }\n"),
	"questions/a/age.yaml": q("age", "number: {}\n"),
	"questions/a/car.yaml": q("car", 'responses:\n  "1": Yes\n  "2": No\n'),
	"questions/a/kinds.yaml": q(
		"kinds",
		'select: many\nresponses:\n  "1": Car\n  "2": Van\n',
	),
	"questions/a/more.yaml": q("more", 'responses:\n  "1": Yes\n  "2": No\n'),
	"questions/a/why.yaml": q("why", "open: {}\n"),
});
// An input, a compute, select-all, a loop Qualtrics runs, and a roster written out row by row.
const SOURCE = `name: t
uses:
  b: here
inputs:
  wave:
    number: {}
flow:
  - ask: b.tenure
  - ask: b.modes
  - ask: b.size
  - compute: double
    value: b.size * 2
  - roster: people
    count: b.size
    flow:
      - ask: b.age
  - roster: cars
    more: b.more = "1"
    max: 3
    flow:
      - ask: b.car
      - ask: b.kinds
      - ask: b.more
  - ask: b.why
`;
const DDI = instrumentOf(SOURCE, {
	banks: { b: BANK },
	agency: "org.example",
}).ddi;
const OPTIONS = { digest: "sha256:abc", version: "9" };
const made = qsfOf(DDI, { ...OPTIONS, name: "t", created: "" });
if (made.kind !== "made") throw new Error("the test survey isn't made");
const URN = "urn:ddi:org.example:instrument-t:1";

/** The export of the test survey, with one response, every answer `SECRET`. */
const exportOf = (options: ExportOptions = {}) =>
	exportOfSurvey(made, {
		stamp: [URN, OPTIONS.digest, OPTIONS.version],
		...options,
	});

const shifted = (x: string) => `QID${Number(x.slice(3)) + 100}`;
const messages = (r: { findings: readonly { message: string }[] }) =>
	r.findings.map((f) => f.message);

describe("a QSF column map made from a Qualtrics export", () => {
	it("is the map `qsf-map` makes from the DDI, when the export is that survey's, with nothing to say", () => {
		const r = qsfMapFromExport(exportOf(), DDI, OPTIONS);
		expect(r.kind).toBe("made");
		if (r.kind !== "made") return;
		expect(JSON.stringify(r.columns)).toBe(JSON.stringify(made.columns));
		expect(r.findings).toEqual([]);
	});

	it("takes the export's QIDs, matched by export tag, and by place among questions with one text", () => {
		const r = qsfMapFromExport(exportOf({ qid: shifted }), DDI, OPTIONS);
		expect(r.kind).toBe("made");
		if (r.kind !== "made") return;
		expect(r.columns.columns).toEqual(
			made.columns.columns.map((c) => ({
				...c,
				importId: c.importId.replace(/QID\d+/, shifted),
			})),
		);
		const by = (s: string) =>
			r.findings.filter((f) => f.message.includes(s)).length;
		expect(by("by its export tag")).toBeGreaterThan(0);
		// The roster's later rows: tagged by QID (a name clash), with the first row's text.
		expect(by("by its place among 2 questions with its text")).toBe(2);
		expect(r.findings.every((f) => f.code === "qsf-map-matched")).toBe(true);
	});

	it("matches a question by its text when its tag was changed in Qualtrics", () => {
		const r = qsfMapFromExport(
			exportOf({ qid: shifted, tag: (t) => (t === "why" ? "reason" : t) }),
			DDI,
			OPTIONS,
		);
		expect(r.kind).toBe("made");
		expect(r.findings).toContainEqual(
			expect.objectContaining({
				code: "qsf-map-matched",
				severity: "warning",
				column: "reason",
				message: expect.stringMatching(
					/^Matched to `why` .* by its question text\.$/,
				),
			}),
		);
	});

	it("is refused, naming the column, when an answer column matches no question", () => {
		const r = qsfMapFromExport(
			exportOf({
				tag: (t) => (t === "why" ? "reason" : t),
				text: (t) => (t === "why?" ? "Why not?" : t),
				qid: shifted,
				extra: [
					["Q99", "Another?", { ImportId: "QID999" }],
					// An "other, specify" box holds an answer; display order doesn't.
					["tenure_4_TEXT", "tenure? - Other", { ImportId: "QID101_4_TEXT" }],
					["tenure_DO", "Display order", { ImportId: "QID101_DO" }],
				],
			}),
			DDI,
			OPTIONS,
		);
		expect(r.kind).toBe("refused");
		const unmatched = r.findings.filter((f) => f.code === "qsf-map-unmatched");
		expect(unmatched.map((f) => f.column)).toEqual([
			"reason",
			"Q99",
			"tenure_4_TEXT",
		]);
		expect(messages(r).join()).not.toContain("SECRET");
	});

	it("leaves out what the export doesn't have, and warns when its survey names another DDI", () => {
		const r = qsfMapFromExport(
			exportOf({
				stamp: [URN, "sha256:other", "8"],
				drop: (_, t) => t === "why",
			}),
			DDI,
			OPTIONS,
		);
		expect(r.kind).toBe("made");
		if (r.kind !== "made") return;
		expect(r.columns.columns).toEqual(made.columns.columns.slice(0, -1));
		expect(r.columns.ddi).toBe(OPTIONS.digest);
		expect(r.findings).toEqual([
			expect.objectContaining({
				code: "qsf-map-absent",
				message:
					"The export has no column for `why`, so the map leaves it out.",
			}),
			expect.objectContaining({
				code: "qsf-map-provenance",
				severity: "warning",
				column: "qretools_ddi",
				line: 4,
			}),
		]);
		expect(messages(r).join()).not.toContain("sha256:other");
	});

	it("doesn't match a loop's question asked for another number of rounds", () => {
		const r = qsfMapFromExport(
			exportOf({ drop: (id) => id.startsWith("2_") }),
			DDI,
			OPTIONS,
		);
		expect(r.kind).toBe("refused");
	});
});
