/**
 * How a bank stores a select-all option's answer: every option is its own variable,
 * holding one of two values, one meaning the respondent chose the option and one that
 * they didn't. The bank says which in its `select_all.yaml`, and everything that
 * needs the coding reads it from the bank's environment: the DDI code list its option
 * variables are published on, what an instrument's conditions may compare them with, and
 * the codebook's note. A bank that says nothing uses 0 No, 1 Yes.
 */
import type { Code } from "./surface/draft.ts";

export interface SelectAll {
	/** The value stored when the respondent chose the option, with its label. */
	readonly chosen: Code;
	/** The value stored when they didn't. */
	readonly notChosen: Code;
	/** Which the bank wrote first: the order its codebook lists the two in. */
	readonly first: "chosen" | "not_chosen";
}

export const DEFAULT_SELECT_ALL: SelectAll = {
	chosen: { code: "1", label: "Yes" },
	notChosen: { code: "0", label: "No" },
	first: "not_chosen",
};

/** The two values as a code list, in the bank's order. */
export const selectAllCodes = (s: SelectAll): readonly [Code, Code] =>
	s.first === "chosen" ? [s.chosen, s.notChosen] : [s.notChosen, s.chosen];

/** The coding in words, as a codebook says it: "0 = No, 1 = Yes". */
export const selectAllText = (s: SelectAll): string =>
	selectAllCodes(s)
		.map((c) => `${c.code} = ${c.label}`)
		.join(", ");
