import { describe, expect, it } from "vitest";
import {
	type DdiDocument,
	documentOf,
	type JsonObject,
} from "./ddi/document.ts";
import { ddiIndexOf } from "./ddi/read.ts";
import { bankOf, questionItems } from "./evaluate.ts";
import { aboveLevel, accessPoliciesOf, filterAnswers } from "./filter.ts";
import { instrumentOf } from "./instrument/instrument.ts";
import { type Answer, answersCsv, answersOf } from "./responses.ts";
import { remoteScope } from "./workspace.ts";

const q = (name: string, rest = "") =>
	`name: ${name}\ntext: ${name}?\nintent: i\nopen: {}\n${rest}`;
const LEVELS = "access: [public, restricted, secret]\n";
const files = (workspace: string, open = false) => ({
	"workspace.yaml": `agency: org.bank\n${workspace}`,
	"questions/a/tenure.yaml": q("tenure", open ? "" : "access: public\n"),
	"questions/a/zip.yaml": q("zip", open ? "" : "access: restricted\n"),
	"questions/a/ssn.yaml": q("ssn", open ? "" : "access: secret\n"),
});

/** A bank's DDI as `export` writes it. */
const docOf = (f: Record<string, string>): DdiDocument => {
	const bank = bankOf(f);
	return documentOf(
		Object.entries(bank.questions).flatMap(([path, ev]) =>
			questionItems(ev.draft, bank, path),
		),
	);
};
const doc = docOf(files(LEVELS));
const index = ddiIndexOf(doc);
const POLICY = "urn:ddi:org.bank:access-public-restricted-secret.codes:1";
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

/** The document with one variable's embargo changed. */
const withEmbargo = (name: string, change: (e: JsonObject) => JsonObject) => {
	const key = `org.bank:variable-${name}:1`;
	const variable = doc.Variable?.[key] ?? {};
	return ddiIndexOf({
		...doc,
		Variable: {
			...doc.Variable,
			[key]: {
				...variable,
				EmbargoReference: change(variable.EmbargoReference as JsonObject),
			},
		},
	});
};

describe("accessPoliciesOf", () => {
	it("reads each policy's levels in order, with how many variables stand at each", () => {
		expect(accessPoliciesOf(index)).toEqual({
			ok: true,
			value: {
				policies: [
					{
						urn: POLICY,
						levels: ["public", "restricted", "secret"],
						counts: [1, 1, 1],
					},
				],
				untraced: [],
			},
		});
	});

	it("finds no policy in a DDI from a bank with no levels", () => {
		expect(accessPoliciesOf(ddiIndexOf(docOf(files("", true))))).toEqual({
			ok: true,
			value: { policies: [], untraced: [] },
		});
	});

	it("refuses a policy whose list can't be read", () => {
		const list =
			doc.CodeList?.["org.bank:access-public-restricted-secret.codes:1"];
		const broken = ddiIndexOf({
			...doc,
			CodeList: {
				[String(list?.ID)]: {
					...list,
					Code: ((list?.Code ?? []) as JsonObject[]).map((c) => ({
						...c,
						Value: { StringValue: "1" },
					})),
				},
			},
		});
		expect(accessPoliciesOf(broken)).toMatchObject({
			ok: false,
			error: { kind: "unreadable-levels" },
		});
	});
});

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

	it("reads an imported question's level against its home bank's policy, never the instrument's", () => {
		// Workspace A (the instrument's) lists other levels than bank B, read at its tag.
		const a = bankOf({
			"workspace.yaml": "agency: org.a\naccess: [public, secret]\n",
			"questions/a/mood.yaml": q("mood", "access: secret\n"),
		});
		const b = remoteScope("acme/b@v1", {
			kind: "files",
			files: {
				"workspace.yaml": "agency: org.bank\naccess: [public, restricted]\n",
				"questions/a/zip.yaml": q("zip", "access: restricted\n"),
				"questions/a/tenure.yaml": q("tenure", "access: public\n"),
			},
		});
		const { ddi } = instrumentOf(
			"name: t\nuses:\n  a: here\n  b: acme/b@v1\nflow:\n  - ask: b.zip\n  - ask: b.tenure\n  - ask: a.mood\n",
			{ banks: { a, b }, agency: "org.a" },
		);
		const t = (name: string) => `urn:ddi:org.a:instrument-t.var-${name}:1`;
		const embargo = (name: string) =>
			JSON.stringify(ddi.Variable?.[`org.a:instrument-t.var-${name}:1`]);
		expect(embargo("zip")).toContain(
			"urn:ddi:org.bank:access-public-restricted.codes:1",
		);
		expect(embargo("mood")).toContain(
			"urn:ddi:org.a:access-public-secret.codes:1",
		);
		const answers = ["zip", "tenure", "mood"].map(
			(n): Answer => ({ respondent: "r", variable: t(n), value: "1" }),
		);
		const r = filterAnswers(ddiIndexOf(ddi), answers, "public");
		expect(r.ok && r.value.removed).toEqual([
			{ urn: t("mood"), name: "mood", level: "secret" },
			{ urn: t("zip"), name: "zip", level: "restricted" },
		]);
		// `restricted` is B's alone: A's policy doesn't list it, so the set is refused.
		expect(filterAnswers(ddiIndexOf(ddi), answers, "restricted")).toMatchObject(
			{
				ok: false,
				error: {
					kind: "unknown-level",
					policies: [{ urn: "urn:ddi:org.a:access-public-secret.codes:1" }],
				},
			},
		);
	});

	it("refuses a level a policy doesn't list, a DDI with no policy, and answers to a variable it doesn't have", () => {
		expect(filterAnswers(index, ANSWERS, "Public")).toMatchObject({
			ok: false,
			error: { kind: "unknown-level", level: "Public" },
		});
		expect(
			filterAnswers(ddiIndexOf(docOf(files("", true))), ANSWERS, "public"),
		).toEqual({ ok: false, error: { kind: "no-levels" } });
		expect(
			filterAnswers(index, [...ANSWERS, answer("r1", "gone", "x")], "secret"),
		).toEqual({
			ok: false,
			error: { kind: "unknown-variables", urns: [v("gone")] },
		});
	});

	it("refuses the whole set when a variable's level can't be traced to its policy", () => {
		const untraced = (i: ReturnType<typeof ddiIndexOf>) =>
			expect(filterAnswers(i, ANSWERS, "secret")).toEqual({
				ok: false,
				error: { kind: "untraced", urns: [v("zip")] },
			});
		// No embargo, while the DDI holds a policy.
		untraced(withEmbargo("zip", () => undefined as unknown as JsonObject));
		// No link to a policy, or one to a list that isn't there.
		untraced(withEmbargo("zip", ({ UserAttributePair, ...e }) => e));
		untraced(
			withEmbargo("zip", (e) => ({
				...e,
				UserAttributePair: [
					{
						AttributeKey: { StringValue: "access-policy" },
						AttributeValue: {
							StringValue: "urn:ddi:org.bank:access-x.codes:1",
						},
					},
				],
			})),
		);
		// A level its policy doesn't list.
		untraced(
			withEmbargo("zip", (e) => ({
				...e,
				EmbargoName: [
					{
						String: [
							{
								MultilingualStringValue: { LanguageTag: "en", Value: "other" },
							},
						],
					},
				],
			})),
		);
	});
});

describe("aboveLevel, the check after filtering", () => {
	it("finds what a level may not see, failing closed on what the DDI doesn't know", () => {
		expect(
			aboveLevel(
				index,
				ANSWERS.map((a) => a.variable),
				"public",
			),
		).toEqual({
			ok: true,
			value: [v("zip"), v("ssn")],
		});
		expect(aboveLevel(index, [v("gone")], "secret")).toEqual({
			ok: true,
			value: [v("gone")],
		});
		const kept = filterAnswers(index, ANSWERS, "public");
		expect(
			kept.ok &&
				aboveLevel(
					index,
					kept.value.kept.map((a) => a.variable),
					"public",
				),
		).toEqual({
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
