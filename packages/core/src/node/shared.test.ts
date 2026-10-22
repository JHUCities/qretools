import { fileURLToPath } from "node:url";
import {
	bankOf,
	documentOf,
	questionItems,
	refUrn,
	schemePath,
	sharedOf,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { describe, expect, it } from "vitest";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

/** Every URN a document's references name, as the schema writes them: `{ $type, value }`. */
function referenced(j: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(j)) for (const x of j) referenced(x, into);
	else if (j !== null && typeof j === "object") {
		const o = j as Record<string, unknown>;
		const urn =
			typeof o.$type === "string" && Array.isArray(o.value)
				? refUrn(o)
				: undefined;
		if (urn !== undefined) into.add(urn);
		else for (const v of Object.values(o)) referenced(v, into);
	}
	return into;
}

describe("the shared file a DDI item was published from", () => {
	it("is named back from every reference the example bank's export makes to one", async () => {
		const bank = bankOf(await readWorkspace(here("../../fixtures/bank")));
		const doc = documentOf(
			Object.keys(bank.questions).flatMap((p) => {
				const ev = bank.questions[p];
				return ev === undefined ? [] : questionItems(ev.draft, bank, p);
			}),
		);
		const named = new Map<string, string>();
		for (const urn of referenced(doc)) {
			const s = sharedOf(urn);
			if (s !== undefined)
				named.set(`${s.kind} ${s.name}`, schemePath(s.kind, s.name));
		}
		expect([...named.keys()].sort()).toEqual([
			"concept library_use",
			"concept news_consumption",
			"concept parks_spending_support",
			"concept service_satisfaction",
			"instruction select_all",
			"instruction select_one",
			"missing missing",
			"scale satisfied5",
			"scale support4",
			"scale support4_reversed",
			"select_all select_all",
			"universe all_respondents",
			"universe household_members",
		]);
		// Each a file the bank has; the bank has no select_all.yaml, so its default stands.
		for (const [what, path] of named)
			if (what !== "select_all select_all")
				expect(bank.schemes[path], what).toBeDefined();
	});

	it("is nothing for a question's own items, or a part of a list", () => {
		for (const urn of [
			"urn:ddi:org.example:consent:1",
			"urn:ddi:org.example:consent.codes:1",
			"urn:ddi:org.example:consent.concept:1",
			"urn:ddi:org.example:consent.universe:1",
			"urn:ddi:org.example:variable-consent:1",
			"urn:ddi:org.example:scale-support4:1",
			"urn:ddi:org.example:scale-support4.cat-1:1",
			"urn:ddi:org.example:concept-library_use.codes:1",
			"urn:ddi:org.example:concept-:1",
			"not a urn",
		])
			expect(sharedOf(urn), urn).toBeUndefined();
		expect(sharedOf("urn:ddi:org.example:scale-support4.codes:3")).toEqual({
			kind: "scale",
			name: "support4",
		});
	});
});
