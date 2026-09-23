/**
 * A Draft is the core's view of a question: every field may still be a hole,
 * but what is present is typed, and impossible states are unrepresentable.
 * In particular the response domain is one tagged union, never three optional
 * fields that must be checked together, and a named scale that did not resolve
 * is not a domain at all (it is a hole).
 */

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

export interface Draft {
	readonly name?: string;
	readonly title?: string;
	readonly text?: string;
	readonly intent?: string;
	readonly concept?: string;
	readonly universe?: string;
	readonly instruction?: string;
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
