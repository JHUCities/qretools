/**
 * A Draft is the core's view of a question: every field may still be a hole,
 * but what is present is typed, and impossible states are unrepresentable.
 * The response domain is one tagged union; a universe or instruction is either
 * prose or a resolved reference into the bank's schemes, never a dangling name
 * (an unresolved name is a hole and absent here).
 */
import type { ConceptEntry, TextEntry } from "./env.js";

export interface Code {
	readonly code: string;
	readonly label: string;
	/** Select-many only: codebook title of this option's own variable. */
	readonly title?: string;
	/** Select-many only: this option's variable name when it departs from the default. */
	readonly variable?: string;
	readonly note?: string;
}

export type Domain =
	| {
			readonly kind: "responses";
			/** In the author's order; a codebook lists options as written. */
			readonly codes: readonly Code[];
			readonly select: "one" | "many";
			/** Present when the codes came from a shared scale of this name. */
			readonly scale?: string;
	  }
	| {
			readonly kind: "number";
			readonly min?: number;
			readonly max?: number;
			readonly unit?: string;
			readonly decimals?: number;
	  }
	| { readonly kind: "open"; readonly maxLength?: number };

/** Written as a sentence. */
export type Prose = { readonly kind: "text"; readonly text: string };
/** A name resolved against a scheme; the name is kept for DDI and for "used by". */
export type Ref<T> = {
	readonly kind: "ref";
	readonly name: string;
	readonly value: T;
};
export type Named<T> = Prose | Ref<T>;

export const textOf = (n: Named<TextEntry>): string =>
	n.kind === "text" ? n.text : n.value.text;

/** A concept as people say it: its label when shared, else what was written. */
export const conceptLabel = (n: Named<ConceptEntry>): string =>
	n.kind === "text" ? n.text : n.value.label;

export interface Draft {
	readonly name?: string;
	readonly title?: string;
	readonly text?: string;
	readonly intent?: string;
	/** A shared concept by name; prose is kept (and exported as before) but is advice to share it. */
	readonly concept?: Named<ConceptEntry>;
	readonly universe?: Named<TextEntry>;
	readonly instruction?: Named<TextEntry>;
	readonly source?: string;
	readonly note?: string;
	/** Names of fields carried over verbatim from an older format; their values are never read. */
	readonly legacy?: readonly string[];
	/** Absent means a hole: no response domain yet. */
	readonly domain?: Domain;
}

/**
 * The variable a select-many option becomes in the dataset. One total function,
 * used by the previews and the elaborator alike. Undefined while `name` is a hole
 * and the option does not name its variable itself.
 */
export const optionVariable = (
	name: string | undefined,
	code: Code,
): string | undefined =>
	code.variable ?? (name === undefined ? undefined : `${name}_${code.code}`);

/** A dataset variable a question defines, where in the question it is defined, and its option if it is one. */
export interface DefinedVariable {
	readonly name: string;
	readonly path: string;
	readonly option?: Code;
}

/**
 * The variables a question defines: one named like the question, or one per
 * select-many option. None without a name or a domain (no name, or no values).
 * The elaborator and the bank index both read this, so they cannot disagree.
 */
export function definedVariables(draft: Draft): readonly DefinedVariable[] {
	const { name, domain } = draft;
	if (name === undefined || domain === undefined) return [];
	if (domain.kind !== "responses" || domain.select === "one")
		return [{ name, path: "name" }];
	return domain.codes.flatMap((option) => {
		const variable = optionVariable(name, option);
		return variable === undefined
			? []
			: [{ name: variable, path: `responses.${option.code}`, option }];
	});
}
