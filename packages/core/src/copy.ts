/**
 * Words the user reads that appear in more than one place, so they are spelled one
 * way (AGENTS.md, "Glossary for everything a user reads"). Only shared phrases live
 * here; a sentence used once stays where it is used.
 */
import type { SchemeKind } from "./schemes.ts";

/** Anything without a name: a draft, an option variable whose question has none. */
export const UNNAMED = "(no name yet)";

/** An empty required field, counted: "1 to fill in", "2 to fill in". */
export const toFillIn = (n: number): string => `${n} to fill in`;

export const NAME_RULE_TEXT =
	"Lowercase letters, digits and underscores, starting with a letter.";

export const FOLDER_RULE_TEXT =
	"Lowercase letters, digits, hyphens and underscores, starting with a letter.";

/** Each kind of shared element, singular, as a heading or a "New …" item says it. */
export const SCHEME_SINGULAR: Readonly<Record<SchemeKind, string>> = {
	concept: "concept",
	scale: "scale",
	unit: "unit",
	universe: "universe",
	instruction: "instruction",
	missing: "missing values",
	bank: "bank details",
};

/** Each kind, plural, as a section of the tree names it. */
export const SCHEME_LABELS: Readonly<Record<SchemeKind, string>> = {
	concept: "Concepts",
	scale: "Scales",
	unit: "Units",
	universe: "Universes",
	instruction: "Instructions",
	missing: "Missing values",
	bank: "Bank",
};

/** Each kind in running text: "shared scale", "missing values". */
export const SCHEME_NAME: Readonly<Record<SchemeKind, string>> = {
	concept: "shared concept",
	scale: "shared scale",
	unit: "shared unit",
	universe: "shared universe",
	instruction: "shared instruction",
	missing: "missing values",
	bank: "bank details",
};

/** A quick fix's label: what the click will write. */
export const fixLabel = (value: string): string => `Use \`${value}\``;
