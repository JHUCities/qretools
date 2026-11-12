import { describe, expect, it } from "vitest";
import { documentOf } from "./ddi/document.ts";
import { ddiIndexOf } from "./ddi/read.ts";
import { bankOf, questionItems } from "./evaluate.ts";
import { aboveLevel, accessLevelsOf, filterAnswers } from "./filter.ts";
import { instrumentOf } from "./instrument/instrument.ts";
import { type Answer, answersCsv, answersOf } from "./responses.ts";

const q = (name: string, rest = "") =>
	`name: ${name}\ntext: ${name}?\nintent: i\nopen: {}\n${rest}`;
const LEVELS = "access: [public, restricted, secret]\n";
const files = (workspace: string) => ({
	"workspace.yaml": `agency: org.bank\n${workspace}`,
	"questions/a/tenure.yaml": q("tenure"),
	"questions/a/zip.yaml": q("zip", "access: restricted\n"),
	"questions/a/ssn.yaml": q("ssn", "access: secret\n"),
});

/** A bank's DDI as `export` writes it, read back as any program reads DDI. */
const indexOf = (f: Record<string, string>) => {
	const bank = bankOf(f);
	const doc = documentOf(
		Object.entries(bank.questions).flatMap(([path, ev]) =>
			questionItems(ev.draft, bank, path),
		),
	);
	return { doc, index: ddiIndexOf(doc) };
};
const { doc, index } = indexOf(files(LEVELS));
const v = (name: string) => `urn:ddi:org.bank:variable-${name}:1`;
const answer = (respondent: string, name: string, value: string): Answer => ({
	respondent,
	variable: v(name),
	value,
});
const ANSWERS = [
	answer("r1", "tenure", "own"),
	answer("r1", "zip", "21218"),
	answer("r1", "ssn", "000"),
	answer("r2", "tenure", "rent"),
];

describe("accessLevelsOf", () => {
	it("reads the levels in order from the code list a restricted question publishes", () => {
		expect(accessLevelsOf(index)).toEqual({
			ok: true,
			value: ["public", "restricted", "secret"],
		});
	});

	it("finds no levels in a DDI with no embargo", () => {
		expect(accessLevelsOf(indexOf({ ...files(""), ...open }).index)).toEqual({
			ok: true,
			value: [],
		});
	});

	it("refuses an embargo with no list, and two lists that differ", () => {
		const { CodeList, Category, ...rest } = doc;
		expect(accessLevelsOf(ddiIndexOf(rest)).ok).toBe(false);
		// Another bank's list: the same levels, ranked the other way round.
		const list = Object.values(doc.CodeList ?? {}).find(
			(l) => l.ID === "access-levels.codes",
		);
		const codes = (list?.Code ?? []) as readonly Record<string, unknown>[];
		const both = ddiIndexOf({
			...doc,
			CodeList: {
				...doc.CodeList,
				"org.other:access-levels.codes:1": {
					URN: "urn:ddi:org.other:access-levels.codes:1",
					Code: codes.map((c, i) => ({
						...c,
						URN: `urn:ddi:org.other:access-levels.code-${i}:1`,
						Value: { StringValue: String(codes.length - i) },
					})),
				},
			},
		});
		expect(accessLevelsOf(ddiIndexOf({ ...doc })).ok).toBe(true);
		expect(accessLevelsOf(both)).toMatchObject({
			ok: false,
			error: { kind: "unreadable-levels" },
		});
	});
});

/** The bank with every question at the most open level. */
const open = {
	"questions/a/zip.yaml": q("zip"),
	"questions/a/ssn.yaml": q("ssn"),
};

describe("filterAnswers", () => {
	it("keeps the level and every more open one, and names each variable removed, never a value", () => {
		const r = filterAnswers(index, ANSWERS, "restricted");
		expect(r).toEqual({
			ok: true,
			value: {
				kept: [ANSWERS[0], ANSWERS[1], ANSWERS[3]],
				removed: [{ urn: v("ssn"), name: "ssn", level: "secret" }],
			},
		});
		expect(JSON.stringify(r.ok && r.value.removed)).not.toMatch(/000/);
		const pub = filterAnswers(index, ANSWERS, "public");
		expect(pub.ok && pub.value.removed.map((x) => x.name)).toEqual([
			"ssn",
			"zip",
		]);
		const all = filterAnswers(index, ANSWERS, "secret");
		expect(all.ok && all.value).toEqual({ kept: ANSWERS, removed: [] });
	});

	it("filters an instrument's answers by the levels its bank publishes", () => {
		const { ddi } = instrumentOf(
			"name: t\nuses:\n  b: here\nflow:\n  - ask: b.tenure\n  - ask: b.zip\n",
			{ banks: { b: bankOf(files(LEVELS)) }, agency: "org.example" },
		);
		const t = (name: string) =>
			`urn:ddi:org.example:instrument-t.var-${name}:1`;
		const r = filterAnswers(
			ddiIndexOf(ddi),
			[
				{ respondent: "r", variable: t("tenure"), value: "1" },
				{ respondent: "r", variable: t("zip"), value: "2" },
			],
			"public",
		);
		expect(r.ok && r.value.removed.map((x) => x.urn)).toEqual([t("zip")]);
	});

	it("refuses a level the DDI doesn't list, and answers to a variable it doesn't have", () => {
		expect(filterAnswers(index, ANSWERS, "Public")).toEqual({
			ok: false,
			error: {
				kind: "unknown-level",
				level: "Public",
				levels: ["public", "restricted", "secret"],
			},
		});
		expect(
			filterAnswers(index, [...ANSWERS, answer("r1", "gone", "x")], "secret"),
		).toEqual({
			ok: false,
			error: { kind: "unknown-variables", urns: [v("gone")] },
		});
	});

	it("refuses an embargo whose level the list doesn't name", () => {
		const zip = `org.bank:variable-zip:1`;
		const odd = ddiIndexOf({
			...doc,
			Variable: {
				...doc.Variable,
				[zip]: {
					...doc.Variable?.[zip],
					EmbargoReference: {
						URN: "urn:ddi:org.bank:variable-zip.embargo:1",
						EmbargoName: [
							{
								String: [
									{
										MultilingualStringValue: {
											LanguageTag: "en",
											Value: "elsewhere",
										},
									},
								],
							},
						],
					},
				},
			},
		});
		expect(filterAnswers(odd, ANSWERS, "secret")).toEqual({
			ok: false,
			error: { kind: "unlisted-level", urns: [v("zip")] },
		});
	});

	it("passes every answer through a DDI that defines no levels", () => {
		const none = indexOf({ ...files(""), ...open }).index;
		expect(filterAnswers(none, ANSWERS, "anything")).toEqual({
			ok: true,
			value: { kept: ANSWERS, removed: [] },
		});
	});
});

describe("aboveLevel, the check after filtering", () => {
	it("finds what a level may not see, failing closed on what the DDI doesn't know", () => {
		expect(aboveLevel(index, ANSWERS, "public")).toEqual({
			ok: true,
			value: [v("zip"), v("ssn")],
		});
		expect(aboveLevel(index, [answer("r", "gone", "x")], "secret")).toEqual({
			ok: true,
			value: [v("gone")],
		});
		const kept = filterAnswers(index, ANSWERS, "public");
		expect(kept.ok && aboveLevel(index, kept.value.kept, "public")).toEqual({
			ok: true,
			value: [],
		});
	});
});

describe("answersOf", () => {
	it("reads back what answersCsv writes", () => {
		const answers: Answer[] = [
			{ respondent: "a", variable: "urn:x", value: 'say "hi", then\nbye' },
			{ respondent: "a", variable: "urn:y", row: 2, value: "" },
		];
		expect(answersOf(answersCsv(answers))).toEqual({
			ok: true,
			value: answers,
		});
	});

	it("refuses another header or a line that isn't an answer, by its line alone", () => {
		expect(answersOf("id,variable,row,value\n")).toMatchObject({
			ok: false,
			error: { line: 1 },
		});
		const bad = answersOf(
			"respondent,variable,row,value\na,urn:x,,1\na,urn:x,0,secret\n",
		);
		expect(bad).toMatchObject({ ok: false, error: { line: 3 } });
		expect(JSON.stringify(bad)).not.toMatch(/secret/);
	});
});
