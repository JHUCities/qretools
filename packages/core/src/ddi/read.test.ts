import { describe, expect, it } from "vitest";
import { asList, ddiIndexOf, deref, refUrn, words } from "./read.ts";

const label = (...values: [string, string][]) => [
	{
		Content: values.map(([LanguageTag, Value]) => ({
			MultilingualStringValue: { LanguageTag, Value },
		})),
	},
];

describe("words", () => {
	it("reads every string shape, in the language asked for, else the first", () => {
		expect(words(label(["en", "Yes"], ["fr", "Oui"]))).toBe("Yes");
		expect(words(label(["en", "Yes"], ["fr", "Oui"]), "fr")).toBe("Oui");
		expect(words(label(["en", "Yes"]), "de")).toBe("Yes");
		expect(
			words({
				String: [
					{ MultilingualStringValue: { LanguageTag: "en", Value: "n" } },
				],
			}),
		).toBe("n");
		expect(
			words({ MultilingualStringValue: { LanguageTag: "en", Value: "t" } }),
		).toBe("t");
	});
	it("is undefined for anything else", () => {
		for (const j of [null, 1, "x", [], {}, [null], { Content: "x" }])
			expect(words(j)).toBeUndefined();
	});
});

describe("asList", () => {
	it("keeps an array's objects and takes a lone object as one", () => {
		expect(asList([{ a: 1 }, 2, null, [3]])).toEqual([{ a: 1 }]);
		expect(asList({ a: 1 })).toEqual([{ a: 1 }]);
		expect(asList("x")).toEqual([]);
	});
});

describe("ddiIndexOf and deref", () => {
	const doc = {
		Variable: {
			"a:v:1": { URN: "urn:ddi:a:v:1", Agency: "a", ID: "v", Version: "1" },
			"a:v:1.10": { Agency: "a", ID: "v", Version: "1.10" },
			"a:v:1.9": { URN: "URN:DDI:a:v:1.9" },
			junk: 3,
		},
		Unknown: { x: { URN: "urn:ddi:a:x:1" } },
		topLevelReference: [{ $type: "Variable", value: ["a", "v", "1"] }],
	};
	const index = ddiIndexOf(doc);

	it("indexes every item under every root key, by URN", () => {
		expect([...index.byUrn.keys()].sort()).toEqual([
			"urn:ddi:a:v:1",
			"urn:ddi:a:v:1.10",
			"urn:ddi:a:v:1.9",
			"urn:ddi:a:x:1",
		]);
		expect(index.byUrn.get("urn:ddi:a:x:1")?.type).toBe("Unknown");
	});

	it("follows a reference in every form a producer writes", () => {
		const v1 = index.byUrn.get("urn:ddi:a:v:1");
		for (const r of [
			{ $type: "Variable", value: ["a", "v", "1"] },
			"urn:ddi:a:v:1",
			"URN:DDI:a:v:1",
			{ URN: "urn:ddi:a:v:1" },
			{ Agency: "a", ID: "v", Version: "1" },
		])
			expect(deref(index, r)).toBe(v1);
	});

	it("takes the highest version for a reference that names none", () => {
		const latest = index.byUrn.get("urn:ddi:a:v:1.10");
		for (const r of [
			"urn:ddi:a:v",
			"urn:ddi:a:v:latest",
			{ $type: "Variable", value: ["a", "v"] },
			{ Agency: "a", ID: "v", Version: "latest" },
			{ Agency: "a", ID: "v" },
		])
			expect(deref(index, r)).toBe(latest);
		expect(refUrn({ Agency: "a", ID: "v" })).toBe("urn:ddi:a:v:");
	});

	it("indexes a question's parameters and a list's codes, with their owner", () => {
		const nested = ddiIndexOf({
			QuestionItem: {
				q: {
					URN: "urn:ddi:a:q:1",
					OutParameter: [{ URN: "urn:ddi:a:q.out:1" }],
				},
			},
			CodeList: {
				l: { URN: "urn:ddi:a:l:1", Code: { URN: "urn:ddi:a:l.c:1" } },
			},
		});
		const out = deref(nested, { URN: "urn:ddi:a:q.out:1" });
		expect(out?.type).toBe("OutParameter");
		expect(out?.owner?.urn).toBe("urn:ddi:a:q:1");
		expect(deref(nested, "urn:ddi:a:l.c:1")?.owner?.type).toBe("CodeList");
	});

	it("is total: anything else is no item and no URN", () => {
		for (const j of [null, 1, "x", "urn:isbn:1", [], {}, { value: [1, 2] }]) {
			expect(deref(index, j)).toBeUndefined();
			expect(refUrn(j)).toBeUndefined();
		}
		for (const j of [null, [], "x", 3, { a: null }, { a: [1] }])
			expect(ddiIndexOf(j).byUrn.size).toBe(0);
	});
});
