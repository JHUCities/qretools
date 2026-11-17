import {
	DEFAULT_SELECT_ALL,
	EMPTY_ENV,
	elaborate,
	evaluate,
} from "@qretools/core";
import { describe, expect, it } from "vitest";
import { codebookOf, parse } from "./model.ts";

describe("the text typed in a box beside an option", () => {
	it("is its own entry, under the option it's beside", () => {
		const { draft } = evaluate(
			'name: commute\ntext: How?\nintent: i\nresponses:\n  "1": Bus\n  "4":\n    label: Other (please specify)\n    specify: true\n',
			EMPTY_ENV,
		);
		const parsed = parse(
			elaborate(draft, "org.example", [], DEFAULT_SELECT_ALL),
		);
		if (!parsed.ok) throw new Error("unparsed");
		const entries = codebookOf(parsed.value).entries;
		expect(entries.map((e) => e.name)).toEqual(["commute", "commute_4_text"]);
		expect(entries[1]?.group?.option.code).toBe("4");
		expect(entries[0]?.group).toBeUndefined();
	});
});
